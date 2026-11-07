"""Eureka loop: design a reward, train a short PPO burst, ask SubQ to judge.

Gemini 4 Argon writes the candidate. Muse is the fallback designer. If neither
key is set, a local designer still writes a real new reward file so the rest
of the loop can run. SubQ Snap 1.1 is the judge when SUBQ_API_KEY is set.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from rl import history, spec
from rl.designers import propose
from rl.export_onnx import export_checkpoint
from rl.judge import judge
from rl.reward_api import RewardRejected, validate_source
from rl.train import train_skill


def _sandbox_ok() -> None:
    try:
        validate_source("import os\n\ndef compute_reward(s):\n    return 0.0, {}\n")
    except RewardRejected:
        return
    raise RuntimeError("reward loader accepted 'import os'")


def _demonstrated(skill: str, metrics: dict) -> bool:
    """True when a policy rollout is actually doing the skill, not just scoring.

    Walk and trot task_score treats a still stand as mostly successful, because
    upright time dominates. The published clip has to move, or roll, or hold
    the belly-up pose.
    """
    metrics = metrics or {}
    if skill == "play-dead":
        return (
            float(metrics.get("inverted_fraction", 0.0)) >= 0.75
            and float(metrics.get("still_fraction", 0.0)) >= 0.5
        )
    if skill == "rollover":
        return float(metrics.get("inverted_reached", 0.0)) >= 0.75 or float(metrics.get("inverted_fraction", 0.0)) >= 0.2
    if skill in ("walk", "trot"):
        target = float(spec.COMMANDS[skill][0])
        # Open-loop trot on this MJCF tops out near 0.24 m/s inside the residual, below the 0.40 command.
        floor = 0.08 if skill == "walk" else max(0.12, 0.35 * target)
        return (
            float(metrics.get("mean_vx", 0.0)) >= floor
            and float(metrics.get("upright_fraction", 0.0)) >= 0.75
            and float(metrics.get("fell", 1.0)) < 0.5
        )
    return False


def _clean_metrics(metrics: dict | None) -> dict:
    if not metrics:
        return {}
    keep = (
        "steps",
        "mean_vx",
        "upright_fraction",
        "inverted_fraction",
        "still_fraction",
        "fell",
        "inverted_reached",
        "min_up_z",
        "mean_reward",
    )
    cleaned = {}
    for key in keep:
        value = metrics.get(key)
        if isinstance(value, (int, float)):
            cleaned[key] = round(float(value), 6)
    return cleaned


def publish_clip(skill: str, reward_path: Path, checkpoint: Path) -> dict:
    """Write the manifest mp4 from the policy when it does the skill, else the open-loop clip."""
    from rl.replay import policy_rollout, scripted_rollout, scripted_task_score

    policy_path = spec.ROOT / f"{spec.c_symbol(skill)}_policy.mp4"
    main_path = spec.ROOT / spec.video_filename(skill)
    policy = policy_rollout(skill, reward_path, checkpoint, policy_path)
    metrics = dict(policy.get("metrics") or {})
    if _demonstrated(skill, metrics):
        shutil.copy2(policy_path, main_path)
        return {
            "source": "ppo-policy",
            "label": "ppo policy rollout",
            "success": float(policy["success"]),
            "policy_success": float(policy["success"]),
            "scripted_success": float(scripted_task_score(skill, reward_path)),
            "policy_metrics": metrics,
            "video": str(main_path),
        }
    scripted = scripted_rollout(skill, reward_path, main_path)
    return {
        "source": "scripted-fallback",
        "label": "scripted motion fallback",
        "success": float(scripted["success"]),
        "policy_success": float(policy["success"]),
        "scripted_success": float(scripted["success"]),
        "policy_metrics": metrics,
        "video": str(main_path),
    }


def _curve(skill: str, version: int, trained: dict, published: dict, judgment: dict, episodes=None, timesteps=None) -> dict:
    episodes = list(trained["episodes"] if episodes is None else episodes)
    series = [ep.get("ep_return", 0.0) for ep in episodes]
    source = published["source"]
    if source == "ppo-policy":
        note = (
            "success and policy_success are the deterministic PPO rollout written to the manifest mp4. "
            "scripted_success is the open-loop controller on the same robot, not the published clip. "
            f"Judge backend: {judgment.get('backend')}."
        )
    else:
        note = (
            "success is the scripted demo that produced the manifest video. "
            "policy_success is the deterministic PPO rollout of the adopted reward. "
            "The mp4 is captioned so the fallback is visible. "
            f"Judge backend: {judgment.get('backend')}."
        )
    return {
        "skill": skill,
        "reward_version": version,
        "algorithm": "PPO",
        "backend": trained["backend"],
        "device": trained["device"],
        "runtime_reason": (trained.get("runtime") or {}).get("reason", ""),
        "timesteps": timesteps if timesteps is not None else trained["stats"].get("timesteps"),
        "episodes": episodes,
        "series": series,
        "policy_success": published["policy_success"],
        "scripted_success": published["scripted_success"],
        "success": published["success"],
        "video_source": source,
        "video_label": published["label"],
        "policy_checkpoint": trained["checkpoint"],
        "judge_backend": judgment["backend"],
        "judge_winner": judgment["winner"],
        "judge_notes": judgment.get("notes"),
        "hacking": judgment.get("hacking"),
        "probe_gap": trained["stats"].get("probe_gap"),
        "policy_metrics": _clean_metrics(published.get("policy_metrics")),
        "note": note,
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
        "A skill mp4 is a PPO policy rollout when that policy performs the skill.\n"
        "Otherwise the mp4 is the open-loop clip, captioned scripted motion fallback.\n"
        "success in manifest.json matches the published mp4.\n"
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
        winner_train = trained_by_version[winner["version"]]
        exported = export_checkpoint(
            spec.ROOT / winner_train["checkpoint"],
            skill,
            spec.ROOT / spec.policy_filename(skill),
        )
        published = publish_clip(skill, adopted, spec.ROOT / winner_train["checkpoint"])
        curve = _curve(skill, winner["version"], winner_train, published, judgment)
        curve["onnx"] = exported["onnx"]
        curve["firmware_header"] = exported["header"]
        (spec.ROOT / spec.curve_filename(skill)).write_text(json.dumps(curve, indent=2) + "\n")
        history.save(data)
        rows.append(
            {
                "skill": skill,
                "version": winner["version"],
                "success": published["success"],
                "policy_success": published["policy_success"],
                "video_source": published["source"],
                "judge": judgment["backend"],
                "source": winner["source"],
            }
        )
    manifest = _manifest(rows)
    (spec.ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    _validate_manifest(manifest)
    _pack(manifest)
    return {"manifest": manifest, "skills": rows}


def _load_curve(skill: str) -> dict:
    path = spec.ROOT / spec.curve_filename(skill)
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def _frames_from_disk(skill: str, version: int) -> list:
    frame_dir = spec.FRAMES / f"{spec.c_symbol(skill)}_v{version}"
    if not frame_dir.exists():
        return []
    import numpy as np
    from PIL import Image

    frames = []
    for path in sorted(frame_dir.glob("*.png"))[:4]:
        frames.append(np.asarray(Image.open(path).convert("RGB")))
    return frames


def _payload_from_history(data: dict, skill: str, version: int, cand_id: str) -> dict:
    entry = history.entry(data, skill, version)
    if entry is None:
        raise FileNotFoundError(f"no history for {skill} v{version}")
    log_path = spec.ROOT / entry.get("log", "")
    code_path = spec.ROOT / entry["path"]
    return {
        "id": cand_id,
        "version": version,
        "source": entry.get("source"),
        "code": code_path.read_text() if code_path.exists() else "",
        "log": log_path.read_text() if log_path.exists() else "",
        "stats": entry.get("metrics") or {},
        "frames": _frames_from_disk(skill, version),
    }


def _stamp_judge(data: dict, skill: str, payloads: list[dict], judgment: dict) -> None:
    winner_id = judgment["winner"]
    for item in payloads:
        entry = history.entry(data, skill, item["version"])
        if entry is None:
            continue
        entry["judge"] = {
            "backend": judgment["backend"],
            "model": judgment.get("model"),
            "winner": winner_id,
            "selected": item["id"] == winner_id,
            "hacking": (judgment.get("hacking") or {}).get(item["id"]),
            "notes": judgment.get("notes"),
        }


def _continue_episodes(old_curve: dict, trained: dict) -> tuple[list, int]:
    old_eps = list(old_curve.get("episodes") or [])
    new_eps = [dict(ep) for ep in trained["episodes"]]
    old_total = int(old_curve.get("timesteps") or 0)
    if new_eps and old_total and int(new_eps[0].get("timestep") or 0) < old_total:
        for ep in new_eps:
            ep["timestep"] = int(ep.get("timestep") or 0) + old_total
    episodes = old_eps + new_eps
    timesteps = old_total + int(trained["stats"].get("timesteps") or 0)
    return episodes, timesteps


def _write_manifest_skill(skill: str, version: int, success: float) -> dict:
    path = spec.ROOT / "manifest.json"
    manifest = json.loads(path.read_text())
    found = False
    for row in manifest["skills"]:
        if row["name"] != skill:
            continue
        row["reward_version"] = int(version)
        row["reward_fn"] = f"rewards/{spec.reward_filename(skill)}"
        row["success"] = round(float(success), 4)
        row["policy"] = spec.policy_filename(skill)
        row["curve"] = spec.curve_filename(skill)
        row["video"] = spec.video_filename(skill)
        found = True
    if not found:
        raise RuntimeError(f"manifest has no skill {skill}")
    path.write_text(json.dumps(manifest, indent=2) + "\n")
    _validate_manifest(manifest)
    _pack(manifest)
    return manifest


def upgrade(skills: tuple[str, ...] = spec.SKILLS, timesteps: int = 65536, seed: int = 0, resume: bool = False) -> dict:
    """Train the adopted reward further, or a new local candidate, then publish an honest clip.

    SubQ Snap is used when SUBQ_API_KEY is set. Otherwise the local judge runs
    and the curve says so. A policy clip replaces the scripted mp4 only when
    the rollout meets the skill. Other skills in the manifest are left as they are.
    """
    if timesteps < 0:
        raise ValueError("timesteps must be >= 0")
    _sandbox_ok()
    spec.write_policy_spec()
    data = history.load()
    rows = []
    for skill in skills:
        bucket = data.setdefault("skills", {}).setdefault(skill, {"adopted_version": None, "versions": []})
        adopted_version = bucket.get("adopted_version")
        if not adopted_version:
            raise RuntimeError(f"{skill} has no adopted reward. Run python -m rl eureka --skill {skill} first.")
        old_curve = _load_curve(skill)
        trained = None
        trained_version = None
        if resume or timesteps <= 0:
            version = int(adopted_version)
            reward_path = spec.REWARDS / spec.reward_filename(skill)
            if timesteps > 0:
                print(f"[rl] {skill} v{version}: continue PPO x {timesteps}", flush=True)
                trained = train_skill(skill, reward_path, timesteps, version, seed=seed, resume=True)
                trained_version = version
                entry = history.entry(data, skill, version)
                entry["metrics"] = trained["stats"]
                entry["log"] = trained["log_path"]
                entry["checkpoint"] = trained["checkpoint"]
            logged = history.versions(data, skill)
            if len(logged) >= 2:
                pair = logged[-2:]
                payloads = [_payload_from_history(data, skill, item["version"], f"r{i}") for i, item in enumerate(pair)]
                judgment = judge(skill, payloads)
                _stamp_judge(data, skill, payloads, judgment)
                winner = next(item for item in payloads if item["id"] == judgment["winner"])
                version = int(winner["version"])
            else:
                judgment = {
                    "backend": "local-fallback",
                    "model": None,
                    "winner": "r0",
                    "hacking": {},
                    "notes": "SUBQ_API_KEY is unset. Only one reward version is logged, so no choice was made.",
                }
            data["skills"][skill]["adopted_version"] = version
            adopted_code = spec.VERSIONS / spec.version_filename(skill, version)
            if adopted_code.exists():
                shutil.copyfile(adopted_code, spec.REWARDS / spec.reward_filename(skill))
        else:
            parent = history.entry(data, skill, int(adopted_version))
            parent_code = (spec.ROOT / parent["path"]).read_text()
            feedback = ((parent.get("judge") or {}).get("notes")) or "Previous reward. No API judge notes."
            version = history.latest_version(data, skill) + 1
            dest = spec.VERSIONS / spec.version_filename(skill, version)
            proposed = propose(skill, version, parent_code, feedback, dest)
            history.register(
                data,
                skill,
                version,
                dest,
                proposed["source"],
                proposed["model"],
                int(adopted_version),
                note=proposed.get("reason") or "",
            )
            print(f"[rl] {skill} v{version}: PPO x {timesteps} ({proposed['source']})", flush=True)
            trained = train_skill(skill, dest, timesteps, version, seed=seed, resume=False)
            trained_version = version
            entry = history.entry(data, skill, version)
            entry["metrics"] = trained["stats"]
            entry["log"] = trained["log_path"]
            entry["checkpoint"] = trained["checkpoint"]
            payloads = [
                _payload_from_history(data, skill, int(adopted_version), "r0"),
                {
                    "id": "r1",
                    "version": version,
                    "source": entry["source"],
                    "code": dest.read_text(),
                    "log": trained["log"],
                    "stats": trained["stats"],
                    "frames": trained["frames"],
                },
            ]
            judgment = judge(skill, payloads)
            _stamp_judge(data, skill, payloads, judgment)
            winner = next(item for item in payloads if item["id"] == judgment["winner"])
            version = int(winner["version"])
            data["skills"][skill]["adopted_version"] = version
            shutil.copyfile(spec.VERSIONS / spec.version_filename(skill, version), spec.REWARDS / spec.reward_filename(skill))
            print(f"[rl] {skill}: {judgment['backend']} chose v{version}", flush=True)

        reward_path = spec.REWARDS / spec.reward_filename(skill)
        checkpoint = spec.CHECKPOINTS / f"{spec.c_symbol(skill)}_v{version}.zip"
        if not checkpoint.exists():
            raise FileNotFoundError(checkpoint)
        exported = export_checkpoint(checkpoint, skill, spec.ROOT / spec.policy_filename(skill))
        published = publish_clip(skill, reward_path, checkpoint)
        print(
            f"[rl] {skill}: video={published['source']} success={published['success']:.4f} "
            f"policy={published['policy_success']:.4f}",
            flush=True,
        )
        if trained is not None and trained_version == version:
            if resume:
                episodes, total_steps = _continue_episodes(old_curve, trained)
                curve_train = dict(trained)
                curve_train["checkpoint"] = str(checkpoint.relative_to(spec.ROOT))
            else:
                episodes = trained["episodes"]
                total_steps = trained["stats"].get("timesteps")
                curve_train = trained
        else:
            episodes = list(old_curve.get("episodes") or [])
            total_steps = old_curve.get("timesteps")
            curve_train = {
                "episodes": episodes,
                "backend": old_curve.get("backend", "stable-baselines3"),
                "device": old_curve.get("device", "cpu"),
                "runtime": {"reason": old_curve.get("runtime_reason", "")},
                "stats": {"timesteps": total_steps, "probe_gap": old_curve.get("probe_gap")},
                "checkpoint": old_curve.get("policy_checkpoint") or str(checkpoint.relative_to(spec.ROOT)),
            }
            if trained is not None and trained_version != version:
                curve_train["stats"]["probe_gap"] = (history.entry(data, skill, version).get("metrics") or {}).get("probe_gap")
        curve = _curve(skill, version, curve_train, published, judgment, episodes=episodes, timesteps=total_steps)
        curve["onnx"] = exported["onnx"]
        curve["firmware_header"] = exported["header"]
        (spec.ROOT / spec.curve_filename(skill)).write_text(json.dumps(curve, indent=2) + "\n")
        history.save(data)
        _write_manifest_skill(skill, version, published["success"])
        rows.append(
            {
                "skill": skill,
                "version": version,
                "success": published["success"],
                "policy_success": published["policy_success"],
                "scripted_success": published["scripted_success"],
                "video_source": published["source"],
                "judge": judgment["backend"],
                "policy_metrics": _clean_metrics(published.get("policy_metrics")),
            }
        )
    return {"skills": rows}


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
