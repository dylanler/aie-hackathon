"""List and package the RL files the Train screen should refresh.

Hark owns web/. This module never writes under web/. It prints the copy list
and, with --pack, writes a directory of the four mp4s, manifest.json, and the
four curves. --webm also transcodes those mp4s for the player that asks for
<video> webm first.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from rl import spec
from rl.labels import PUBLIC_RL_FILES, sample_pack_readme

SAMPLE_PACK_COPIES = PUBLIC_RL_FILES + (
    "firmware/README.md",
)


def key_status() -> dict[str, str]:
    """Presence only. Values are never read into the report."""

    def flag(name: str) -> str:
        return "set" if os.environ.get(name, "").strip() else "unset"

    return {
        "GEMINI_API_KEY": flag("GEMINI_API_KEY"),
        "META_API_KEY": flag("META_API_KEY"),
        "MODEL_API_KEY": flag("MODEL_API_KEY"),
        "SUBQ_API_KEY": flag("SUBQ_API_KEY"),
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def shipped_rows() -> list[dict]:
    manifest = _load_json(spec.ROOT / "manifest.json")
    rows = []
    for skill in manifest["skills"]:
        curve_path = spec.ROOT / skill["curve"]
        video_path = spec.ROOT / skill["video"]
        curve = _load_json(curve_path)
        rounded = round(float(curve.get("success", 0.0)), 4)
        rows.append(
            {
                "name": skill["name"],
                "video": skill["video"],
                "curve": skill["curve"],
                "manifest_success": skill["success"],
                "curve_success": curve.get("success"),
                "success_matches": rounded == float(skill["success"]),
                "policy_success": curve.get("policy_success"),
                "scripted_success": curve.get("scripted_success"),
                "video_source": curve.get("video_source"),
                "video_label": curve.get("video_label"),
                "behavior": curve.get("behavior"),
                "judge_backend": curve.get("judge_backend"),
                "judge_notes": curve.get("judge_notes"),
                "reward_version": skill.get("reward_version"),
                "policy_checkpoint": curve.get("policy_checkpoint"),
                "video_bytes": video_path.stat().st_size if video_path.exists() else None,
                "video_sha256": _sha256(video_path) if video_path.exists() else None,
            }
        )
    return rows


def sample_pack_drift() -> list[str]:
    """Relative paths whose sample_pack copy differs from rl/."""
    drifted = []
    for rel in SAMPLE_PACK_COPIES:
        src = spec.ROOT / rel
        dest = spec.SAMPLE_PACK / rel
        if not src.exists():
            drifted.append(f"{rel} (missing in rl/)")
            continue
        if not dest.exists() or src.read_bytes() != dest.read_bytes():
            drifted.append(rel)
    readme = spec.SAMPLE_PACK / "README.md"
    if not readme.exists() or readme.read_text() != sample_pack_readme():
        drifted.append("README.md")
    return drifted


def sync_sample_pack() -> list[str]:
    """Copy published artifacts into rl/sample_pack. Returns paths that changed."""
    changed = []
    for rel in SAMPLE_PACK_COPIES:
        src = spec.ROOT / rel
        dest = spec.SAMPLE_PACK / rel
        if not src.exists():
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and dest.read_bytes() == src.read_bytes():
            continue
        shutil.copy2(src, dest)
        changed.append(rel)
    readme = spec.SAMPLE_PACK / "README.md"
    body = sample_pack_readme()
    if not readme.exists() or readme.read_text() != body:
        readme.write_text(body)
        changed.append("README.md")
    return changed


def _reject_web(dest: Path) -> None:
    resolved = dest.resolve()
    web = (spec.ROOT.parent / "web").resolve()
    if resolved == web or web in resolved.parents:
        raise SystemExit(
            f"Refusing to write {resolved}. web/ is Hark's tree. "
            "Pack into a directory under rl/ or /tmp, then copy after review."
        )


def _transcode_webm(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-c:v",
        "libvpx-vp9",
        "-b:v",
        "0",
        "-crf",
        "33",
        "-an",
        "-row-mt",
        "1",
        str(dest),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True)
    except FileNotFoundError as exc:
        raise SystemExit("ffmpeg is not on PATH, so --webm cannot transcode the mp4s.") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"").decode("utf-8", errors="replace")[-500:]
        raise SystemExit(f"ffmpeg failed for {src.name}: {detail}") from exc


def pack(dest: Path, webm: bool = False) -> list[str]:
    """Copy the Train-screen files. Does not touch web/."""
    _reject_web(dest)
    dest.mkdir(parents=True, exist_ok=True)
    written = []
    for rel in PUBLIC_RL_FILES:
        src = spec.ROOT / rel
        if not src.exists():
            raise SystemExit(f"missing {src}. The published set is incomplete.")
        target = dest / rel
        shutil.copy2(src, target)
        written.append(rel)
        if webm and rel.endswith(".mp4"):
            webm_name = rel[:-4] + ".webm"
            _transcode_webm(src, dest / webm_name)
            written.append(webm_name)
    labels = dest / "LABELS.md"
    labels.write_text(labels_markdown())
    written.append("LABELS.md")
    return written


def labels_markdown() -> str:
    rows = shipped_rows()
    lines = [
        "# Train screen refresh",
        "",
        "Copy these files onto `web/public/rl/` after this branch merges.",
        "This pack was written by `python -m rl handoff`. It does not edit `web/`.",
        "",
        "The player asks for `<skill>.webm` before `<skill>.mp4`.",
        "The webms already in `web/public/rl/` are the previous open-loop clips.",
        "Replace or delete them when you copy the mp4s, or pass `--webm` to this pack",
        "and copy those webms too. Otherwise the Train screen keeps the old picture",
        "under the new caption.",
        "",
        "Overlay text comes from each curve's `video_label` (`MuJoCo · ppo policy rollout`).",
        "The percent on each skill pill is `Math.round(manifest.success * 100)`.",
        "`judge_backend` is `local-fallback`: the sheet should say Local judge.",
        "That is not a SubQ verdict.",
        "",
        "| skill | manifest success | pill | video_label | behavior |",
        "|---|---:|---:|---|---|",
    ]
    for row in rows:
        pill = int(round(float(row["manifest_success"]) * 100))
        behavior = str(row.get("behavior") or "").replace("|", "/")
        lines.append(
            f"| {row['name']} | {row['manifest_success']} | {pill}% | {row.get('video_label')} | {behavior} |"
        )
    lines.extend(
        [
            "",
            "Rollover's success stays 0.6675. The policy reaches belly-up and does not hold that pose.",
            "",
            "Files:",
            "",
        ]
    )
    for rel in PUBLIC_RL_FILES:
        lines.append(f"- `{rel}`")
    lines.append("")
    return "\n".join(lines)


def report_text() -> str:
    keys = key_status()
    rows = shipped_rows()
    drift = sample_pack_drift()
    lines = [
        "Shipped clips are PPO policy rollouts. success is the task score of each mp4.",
        "",
        "API keys (presence only): "
        + ", ".join(f"{name}={state}" for name, state in keys.items()),
    ]
    if all(state == "unset" for state in keys.values()):
        lines.append(
            "All four are unset. The local designer writes rewards and the local judge ranks them. "
            "Curves say judge_backend=local-fallback. That is not a Gemini, Muse, or SubQ verdict."
        )
    lines.append("")
    lines.append(f"{'skill':<12} {'success':>8} {'label':<22} checkpoint")
    for row in rows:
        flag = "" if row["success_matches"] else "  SUCCESS MISMATCH"
        lines.append(
            f"{row['name']:<12} {row['manifest_success']:>8} {str(row.get('video_label') or ''):<22} "
            f"{row.get('policy_checkpoint')}{flag}"
        )
        if row.get("behavior"):
            lines.append(f"  {row['behavior']}")
    lines.append("")
    lines.append("Files for web/public/rl/ (copy these; do not edit web/ from the RL lane):")
    for rel in PUBLIC_RL_FILES:
        path = spec.ROOT / rel
        if path.exists():
            lines.append(f"  rl/{rel}  ({path.stat().st_size} bytes)")
        else:
            lines.append(f"  rl/{rel}  MISSING")
    lines.append("")
    lines.append("The Train player prefers <skill>.webm. Existing webms in web/public/rl/ are older clips.")
    lines.append("Package a drop directory with: python -m rl handoff --pack /tmp/rl-public --webm")
    lines.append("List only: python -m rl handoff")
    if drift:
        lines.append("")
        lines.append("sample_pack is behind rl/ for: " + ", ".join(drift))
        lines.append("Refresh it with: python -m rl handoff --sync-sample-pack")
    else:
        lines.append("")
        lines.append("sample_pack matches the published mp4s, curves, manifest, and firmware README.")
    lines.append("")
    lines.append("Replay the adopted policy (the checkpoint named in the curve):")
    for name in spec.SKILLS:
        lines.append(f"  python -m rl replay --skill {name}")
    lines.append("Open-loop comparison, written beside the shipped clip: python -m rl replay --skill walk --controller scripted")
    return "\n".join(lines) + "\n"


def problems() -> list[str]:
    found = []
    for row in shipped_rows():
        if not row["success_matches"]:
            found.append(
                f"{row['name']}: manifest success {row['manifest_success']} != "
                f"round(curve success, 4) from {row['curve_success']}"
            )
        if row.get("video_source") != "ppo-policy" or row.get("video_label") != "ppo policy rollout":
            found.append(
                f"{row['name']}: video_source={row.get('video_source')} video_label={row.get('video_label')}"
            )
        if not row.get("behavior"):
            found.append(f"{row['name']}: curve has no behavior line")
        video = spec.ROOT / row["video"]
        if not video.exists():
            found.append(f"{row['name']}: missing {row['video']}")
    found.extend(f"sample_pack drift: {rel}" for rel in sample_pack_drift())
    return found


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="python -m rl handoff",
        description="List or package the mp4s, manifest, and curves for the Train screen.",
    )
    parser.add_argument("--pack", default=None, help="directory to write. Refuses anything under web/.")
    parser.add_argument("--webm", action="store_true", help="with --pack, also transcode each mp4 to vp9 webm")
    parser.add_argument("--sync-sample-pack", action="store_true", help="copy published artifacts into rl/sample_pack")
    parser.add_argument("--check", action="store_true", help="exit 1 if labels, success, or sample_pack drift")
    parser.add_argument("--json", action="store_true", help="print the shipped rows as JSON")
    args = parser.parse_args(argv)
    if args.sync_sample_pack:
        changed = sync_sample_pack()
        print("sample_pack updated: " + (", ".join(changed) if changed else "already in sync"))
    if args.pack:
        written = pack(Path(args.pack), webm=args.webm)
        print(f"wrote {len(written)} files to {args.pack}")
        for name in written:
            print(f"  {name}")
    if args.json:
        print(json.dumps({"keys": key_status(), "skills": shipped_rows(), "drift": sample_pack_drift()}, indent=2))
    else:
        print(report_text(), end="")
    if args.check:
        found = problems()
        if found:
            print("handoff check failed:", file=sys.stderr)
            for item in found:
                print(f"  {item}", file=sys.stderr)
            raise SystemExit(1)


def print_status() -> None:
    print(report_text(), end="")
