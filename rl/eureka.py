"""Eureka loop: design a reward, train a short PPO burst, ask SubQ to judge.

Gemini 4 Argon writes the candidate. Muse is the fallback designer. If neither
key is set, a local designer still writes a real new reward file so the rest
of the loop can run. SubQ Snap 1.1 is the judge when SUBQ_API_KEY is set.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from rl import history, scripted, spec
from rl.designers import propose
from rl.export_onnx import export_checkpoint
from rl.judge import judge
from rl.replay import policy_rollout, scripted_rollout
from rl.reward_api import RewardRejected, validate_source
from rl.train import train_skill


def _sandbox_ok() -> None:
    try:
        validate_source("import os\n\ndef compute_reward(s):\n    return 0.0, {}\n")
    except RewardRejected:
        return
    raise RuntimeError("reward loader accepted 'import os'")


def _curve(skill: str, version: int, trained: dict, scripted_result: dict, judgment: dict) -> dict:
    episodes = trained["episodes"]
    series = [ep.get("ep_return", 0.0) for ep in episodes]
    return {
        "skill": skill,
        "reward_version": version,
        "algorithm": "PPO",
        "backend": trained["backend"],
        "device": trained["device"],
        "runtime_reason": (trained.get("runtime") or {}).get("reason", ""),
        "timesteps": trained["stats"].get("timesteps"),
        "episodes": episodes,
        "series": series,
        "policy_success": trained["stats"].get("task_score"),
        "scripted_success": scripted_result["success"],
        "success": scripted_result["success"],
        "video_source": "scripted-fallback",
        "video_label": "scripted motion fallback",
        "policy_checkpoint": trained["checkpoint"],
        "judge_backend": judgment["backend"],
        "judge_winner": judgment["winner"],
        "hacking": judgment.get("hacking"),
        "probe_gap": trained["stats"].get("probe_gap"),
        "note": (
            "success is the scripted demo that produced the manifest video. "
            "policy_success is the deterministic PPO rollout of the adopted reward. "
            "The mp4 is captioned so the fallback is visible."
        ),
    }


def _manifest(rows: list[dict]) -> dict:
    return {
        "robot": spec.ROBOT_NAME,
        "mjcf": "robot.xml",
        "skills": [
            {
                "name": row["skill"],
                "policy": spec.policy_filename(row["skill"]),
                "reward_fn": f"rewards/{spec.reward_filename(row['skill'])}",
                "reward_version": row["version"],
                "curve": spec.curve_filename(row["skill"]),
                "video": spec.video_filename(row["skill"]),
                "success": round(float(row["success"]), 4),
            }
            for row in rows
        ],
        "firmware": "firmware/README.md",
    }


def _pack(manifest: dict) -> None:
    pack = spec.SAMPLE_PACK
    if pack.exists():
        shutil.rmtree(pack)
    pack.mkdir(parents=True)
    (pack / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    names = [
        "robot.xml",
        "policy_spec.json",
        "firmware/README.md",
        "rewards/history.json",
    ]
    for skill in spec.SKILLS:
        names.append(spec.policy_filename(skill))
        names.append(spec.video_filename(skill))
        names.append(spec.curve_filename(skill))
        names.append(f"rewards/{spec.reward_filename(skill)}")
        names.append(f"firmware/include/{spec.c_symbol(skill)}_policy.h")
    versions = spec.VERSIONS
    for path in versions.glob("*.py"):
        names.append(str(path.relative_to(spec.ROOT)))
    for name in names:
        src = spec.ROOT / name
        if not src.exists():
            continue
        dest = pack / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
    (pack / "README.md").write_text(
        "Sample RL pack for one robot run.\n\n"
        "The core pipeline can copy this directory onto a run:\n\n"
        "    mkdir -p data/runs/<id>/rl\n"
        "    cp -a rl/sample_pack/. data/runs/<id>/rl/\n\n"
        "manifest.json matches the frozen contract in COORDINATION.md.\n"
        "Walk and play-dead videos are captioned scripted-motion fallbacks when\n"
        "the short PPO burst has not learned the gait yet.\n"
    )


def run(skills: tuple[str, ...] = spec.SKILLS, timesteps: int = 8192, candidates: int = 2, seed: int = 0) -> dict:
    if candidates < 2:
        raise ValueError("the judge's choice question needs at least 2 candidates")
    _sandbox_ok()
    spec.write_policy_spec()
    data = history.load()
    rows = []
    for skill in skills:
        seed_path = spec.VERSIONS / spec.version_filename(skill, 1)
        if not seed_path.exists():
            raise FileNotFoundError(seed_path)
        if history.entry(data, skill, 1) is None:
            history.register(data, skill, 1, seed_path, "seed", None, None, note="hand-written seed reward")
        parent_code = seed_path.read_text()
        feedback = "Seed reward. No judge feedback yet."
        versions = [1]
        while len(versions) < candidates:
            version = history.latest_version(data, skill) + 1
            dest = spec.VERSIONS / spec.version_filename(skill, version)
            proposed = propose(skill, version, parent_code, feedback, dest)
            parent = versions[-1]
            history.register(
                data,
                skill,
                version,
                dest,
                proposed["source"],
                proposed["model"],
                parent,
                note=proposed.get("reason") or "",
            )
            versions.append(version)
            parent_code = dest.read_text()
        trained_by_version = {}
        candidate_payloads = []
        for index, version in enumerate(versions):
            path = spec.VERSIONS / spec.version_filename(skill, version)
            print(f"[rl] {skill} v{version}: PPO x {timesteps}", flush=True)
            trained = train_skill(skill, path, timesteps, version, seed=seed + index)
            trained_by_version[version] = trained
            entry = history.entry(data, skill, version)
            entry["metrics"] = trained["stats"]
            entry["log"] = trained["log_path"]
            entry["checkpoint"] = trained["checkpoint"]
            candidate_payloads.append(
                {
                    "id": f"r{index}",
                    "version": version,
                    "source": entry["source"],
                    "code": path.read_text(),
                    "log": trained["log"],
                    "stats": trained["stats"],
                    "frames": trained["frames"],
                }
            )
        judgment = judge(skill, candidate_payloads)
        winner_id = judgment["winner"]
        print(f"[rl] {skill}: {judgment['backend']} chose {winner_id}", flush=True)
        winner = next(item for item in candidate_payloads if item["id"] == winner_id)
        for item in candidate_payloads:
            entry = history.entry(data, skill, item["version"])
            entry["judge"] = {
                "backend": judgment["backend"],
                "model": judgment.get("model"),
                "winner": winner_id,
                "selected": item["id"] == winner_id,
                "hacking": (judgment.get("hacking") or {}).get(item["id"]),
                "notes": judgment.get("notes"),
            }
        data["skills"][skill]["adopted_version"] = winner["version"]
        adopted = spec.REWARDS / spec.reward_filename(skill)
        shutil.copyfile(spec.VERSIONS / spec.version_filename(skill, winner["version"]), adopted)
        exported = export_checkpoint(
            spec.ROOT / trained_by_version[winner["version"]]["checkpoint"],
            skill,
            spec.ROOT / spec.policy_filename(skill),
        )
        scripted_result = scripted_rollout(skill, adopted, spec.ROOT / spec.video_filename(skill))
        policy_rollout(
            skill,
            adopted,
            spec.ROOT / trained_by_version[winner["version"]]["checkpoint"],
            spec.ROOT / f"{spec.c_symbol(skill)}_policy.mp4",
        )
        curve = _curve(skill, winner["version"], trained_by_version[winner["version"]], scripted_result, judgment)
        curve["onnx"] = exported["onnx"]
        curve["firmware_header"] = exported["header"]
        (spec.ROOT / spec.curve_filename(skill)).write_text(json.dumps(curve, indent=2) + "\n")
        history.save(data)
        rows.append(
            {
                "skill": skill,
                "version": winner["version"],
                "success": scripted_result["success"],
                "policy_success": trained_by_version[winner["version"]]["stats"].get("task_score"),
                "judge": judgment["backend"],
                "source": winner["source"],
            }
        )
    manifest = _manifest(rows)
    (spec.ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    _validate_manifest(manifest)
    _pack(manifest)
    return {"manifest": manifest, "skills": rows}


def _validate_manifest(manifest: dict) -> None:
    required = {"robot", "mjcf", "skills", "firmware"}
    missing = required - set(manifest)
    if missing:
        raise RuntimeError(f"manifest missing {sorted(missing)}")
    if manifest["robot"] != spec.ROBOT_NAME:
        raise RuntimeError("unexpected robot name")
    for skill in manifest["skills"]:
        for key in ("name", "policy", "reward_fn", "reward_version", "curve", "video", "success"):
            if key not in skill:
                raise RuntimeError(f"skill entry missing {key}")
        for rel in (manifest["mjcf"], skill["policy"], skill["reward_fn"], skill["curve"], skill["video"], manifest["firmware"]):
            if not (spec.ROOT / rel).exists():
                raise RuntimeError(f"manifest path does not exist: {rel}")
    names = [skill["name"] for skill in manifest["skills"]]
    for required_name in spec.SKILLS:
        if required_name not in names:
            raise RuntimeError(f"manifest missing skill {required_name}")
