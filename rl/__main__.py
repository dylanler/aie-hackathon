"""Commands. `python -m rl` with no arguments prints this help.

Replay the shipped PPO policy (checkpoint named in the curve):

    python -m rl replay --skill walk
    python -m rl replay --skill trot
    python -m rl replay --skill rollover
    python -m rl replay --skill play-dead

Open-loop comparison, written to rl/<skill>_openloop.mp4:

    python -m rl replay --skill rollover --controller scripted

Train-screen files for Hark (does not edit web/):

    python -m rl handoff
    python -m rl handoff --pack /tmp/rl-public --webm

Local judge: if GEMINI_API_KEY, META_API_KEY / MODEL_API_KEY, and SUBQ_API_KEY
are unset, the local designer writes the reward and the local judge ranks
candidates. Curves then say judge_backend=local-fallback. That is not a
Gemini, Muse, or SubQ verdict. No key value is printed.
"""

from __future__ import annotations

import argparse
import json
import sys

from rl import spec


def _skills(text: str) -> tuple[str, ...]:
    if text == "all":
        return spec.SKILLS
    skills = tuple(part.strip() for part in text.split(",") if part.strip())
    unknown = [skill for skill in skills if skill not in spec.SKILLS]
    if unknown:
        raise SystemExit(f"unknown skill(s): {', '.join(unknown)}. Choose from {', '.join(spec.SKILLS)}")
    return skills


def _cmd_demo(args: argparse.Namespace) -> None:
    from rl.eureka import run

    result = run(skills=spec.SKILLS, timesteps=args.timesteps, candidates=args.candidates, seed=args.seed)
    print(json.dumps(result, indent=2))


def _cmd_train(args: argparse.Namespace) -> None:
    from rl.train import train_skill

    for skill in _skills(args.skill):
        path = spec.REWARDS / spec.reward_filename(skill)
        result = train_skill(skill, path, args.timesteps, version=args.version, seed=args.seed)
        printable = {k: v for k, v in result.items() if k not in ("frames", "log")}
        print(json.dumps(printable, indent=2, default=str))


def _cmd_eureka(args: argparse.Namespace) -> None:
    from rl.eureka import run

    result = run(skills=_skills(args.skill), timesteps=args.timesteps, candidates=args.candidates, seed=args.seed)
    print(json.dumps(result, indent=2))


def _cmd_judge(args: argparse.Namespace) -> None:
    """Re-judge the logged candidates for a skill without training again."""
    from rl import history
    from rl.judge import judge
    from rl.video import resize

    data = history.load()
    for skill in _skills(args.skill):
        versions = history.versions(data, skill)
        if len(versions) < 2:
            raise SystemExit(f"{skill} has fewer than 2 logged reward versions. Run: python -m rl eureka --skill {skill}")
        payloads = []
        for index, entry in enumerate(versions):
            log_path = spec.ROOT / entry.get("log", "")
            log = log_path.read_text() if log_path.exists() else ""
            stats = entry.get("metrics") or {}
            frame_dir = spec.FRAMES / f"{spec.c_symbol(skill)}_v{entry['version']}"
            frames = [resize(np_image(path)) for path in sorted(frame_dir.glob("*.png"))[:2]]
            payloads.append(
                {
                    "id": f"r{index}",
                    "version": entry["version"],
                    "source": entry.get("source"),
                    "code": (spec.ROOT / entry["path"]).read_text(),
                    "log": log,
                    "stats": stats,
                    "frames": frames,
                }
            )
        result = judge(skill, payloads)
        public = {k: v for k, v in result.items() if k != "raw"}
        print(json.dumps({"skill": skill, **public}, indent=2, default=str))


def np_image(path):
    import numpy as np
    from PIL import Image as ImageCls

    return np.asarray(ImageCls.open(path).convert("RGB"))


def _cmd_upgrade(args: argparse.Namespace) -> None:
    from rl.eureka import upgrade

    result = upgrade(skills=_skills(args.skill), timesteps=args.timesteps, seed=args.seed, resume=args.resume)
    print(json.dumps(result, indent=2))


def _resolve_checkpoint(skill: str, version: int | None):
    if version is None:
        try:
            return spec.adopted_checkpoint(skill)
        except FileNotFoundError as exc:
            raise SystemExit(
                f"No PPO checkpoint for {skill}. Train one with: python -m rl train --skill {skill}"
            ) from exc
    path = spec.CHECKPOINTS / f"{spec.c_symbol(skill)}_v{version}.zip"
    if path.exists():
        return path
    matches = sorted(spec.CHECKPOINTS.glob(f"{spec.c_symbol(skill)}_v*.zip"))
    available = ", ".join(item.name for item in matches) if matches else "none"
    try:
        adopted = spec.adopted_checkpoint(skill).name
    except FileNotFoundError:
        adopted = "none"
    raise SystemExit(
        f"No checkpoint {path.name} for {skill}. On disk: {available}. "
        f"The published clip uses {adopted}. Omit --version to replay that one."
    )


def _cmd_export(args: argparse.Namespace) -> None:
    from rl.export_onnx import export_checkpoint

    for skill in _skills(args.skill):
        checkpoint = _resolve_checkpoint(skill, args.version)
        result = export_checkpoint(checkpoint, skill, spec.ROOT / spec.policy_filename(skill))
        print(json.dumps({"skill": skill, "checkpoint": checkpoint.name, **result}, indent=2))


def _cmd_replay(args: argparse.Namespace) -> None:
    from rl.replay import policy_rollout, scripted_rollout

    skills = _skills(args.skill)
    if len(skills) > 1 and args.out:
        raise SystemExit("--out can only be used with a single skill")
    for skill in skills:
        reward = spec.REWARDS / spec.reward_filename(skill)
        if args.controller == "scripted":
            out = spec.ROOT / (args.out or f"{spec.c_symbol(skill)}_openloop.mp4")
            print(
                f"[rl] {skill}: open-loop controller -> {out.name}. "
                f"The shipped clip is {spec.video_filename(skill)}, a PPO policy rollout.",
                flush=True,
            )
            result = scripted_rollout(skill, reward, out, seconds=args.seconds)
        else:
            checkpoint = _resolve_checkpoint(skill, args.version)
            out = spec.ROOT / (args.out or f"{spec.c_symbol(skill)}_policy.mp4")
            print(
                f"[rl] {skill}: PPO policy rollout from {checkpoint.name} -> {out.name}. "
                f"Shipped mp4 is {spec.video_filename(skill)}.",
                flush=True,
            )
            result = policy_rollout(skill, reward, checkpoint, out, seconds=args.seconds)
        printable = {k: v for k, v in result.items() if k != "metrics"}
        printable["task_score"] = result["success"]
        printable["checkpoint"] = None if args.controller == "scripted" else str(checkpoint)
        print(json.dumps(printable, indent=2))


def _cmd_handoff(args: argparse.Namespace) -> None:
    from rl.handoff import main as handoff_main

    forwarded = []
    if args.pack:
        forwarded.extend(["--pack", args.pack])
    if args.webm:
        forwarded.append("--webm")
    if args.sync_sample_pack:
        forwarded.append("--sync-sample-pack")
    if args.check:
        forwarded.append("--check")
    if args.json:
        forwarded.append("--json")
    handoff_main(forwarded)


def _cmd_status(_args: argparse.Namespace) -> None:
    from rl.handoff import print_status

    print_status()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="python -m rl",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description="12-DoF mini-dog RL lane. Shipped clips are PPO policy rollouts.",
        epilog=(
            "examples:\n"
            "  python -m rl replay --skill walk\n"
            "  python -m rl replay --skill trot\n"
            "  python -m rl replay --skill rollover\n"
            "  python -m rl replay --skill play-dead\n"
            "  python -m rl replay --skill walk --controller scripted\n"
            "  python -m rl handoff\n"
            "  python -m rl handoff --pack /tmp/rl-public --webm\n"
            "  python -m rl status\n"
            "\n"
            "Missing GEMINI_API_KEY, META_API_KEY / MODEL_API_KEY, or SUBQ_API_KEY is the\n"
            "local-fallback path: a local designer and a local task-metric judge.\n"
            "The curve field judge_backend then reads local-fallback. That is not a\n"
            "SubQ or Gemini verdict. Key values are never printed."
        ),
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    demo = sub.add_parser("demo", help="design, train, judge, export, and render every skill")
    demo.add_argument("--timesteps", type=int, default=8192)
    demo.add_argument("--candidates", type=int, default=2)
    demo.add_argument("--seed", type=int, default=0)
    demo.set_defaults(func=_cmd_demo)

    train = sub.add_parser("train", help="PPO burst for one adopted reward file")
    train.add_argument("--skill", default="walk")
    train.add_argument("--timesteps", type=int, default=8192)
    train.add_argument("--version", type=int, default=1)
    train.add_argument("--seed", type=int, default=0)
    train.set_defaults(func=_cmd_train)

    eureka = sub.add_parser("eureka", help="reward candidates, PPO, SubQ or local judge")
    eureka.add_argument("--skill", default="all")
    eureka.add_argument("--timesteps", type=int, default=8192)
    eureka.add_argument("--candidates", type=int, default=2)
    eureka.add_argument("--seed", type=int, default=0)
    eureka.set_defaults(func=_cmd_eureka)

    upgrade = sub.add_parser("upgrade", help="train longer and publish a policy clip when the rollout does the skill")
    upgrade.add_argument("--skill", default="all")
    upgrade.add_argument("--timesteps", type=int, default=65536)
    upgrade.add_argument("--seed", type=int, default=0)
    upgrade.add_argument("--resume", action="store_true", help="continue the adopted checkpoint instead of a new reward")
    upgrade.set_defaults(func=_cmd_upgrade)

    judge = sub.add_parser("judge", help="judge logged candidates with SubQ Snap or the local judge")
    judge.add_argument("--skill", default="all")
    judge.set_defaults(func=_cmd_judge)

    export = sub.add_parser("export", help="write ONNX and an ESP32 C header from the adopted checkpoint")
    export.add_argument("--skill", default="all")
    export.add_argument("--version", type=int, default=None, help="checkpoint version; default is the curve's policy_checkpoint")
    export.set_defaults(func=_cmd_export)

    replay = sub.add_parser("replay", help="roll out the adopted PPO policy, or the open-loop controller")
    replay.add_argument("--skill", default="walk", help="walk, trot, rollover, play-dead, all, or a comma list")
    replay.add_argument("--controller", choices=("policy", "scripted"), default="policy", help="policy is the shipped PPO rollout")
    replay.add_argument("--out", default=None, help="mp4 path. Default: <skill>_policy.mp4 or <skill>_openloop.mp4")
    replay.add_argument("--seconds", type=float, default=None)
    replay.add_argument("--version", type=int, default=None, help="checkpoint version; default is the curve's policy_checkpoint")
    replay.set_defaults(func=_cmd_replay)

    handoff = sub.add_parser("handoff", help="list or package the mp4s, manifest, and curves for the Train screen")
    handoff.add_argument("--pack", default=None, help="directory to write. Refuses anything under web/")
    handoff.add_argument("--webm", action="store_true", help="with --pack, also transcode each mp4 to vp9 webm")
    handoff.add_argument("--sync-sample-pack", action="store_true", help="copy published artifacts into rl/sample_pack")
    handoff.add_argument("--check", action="store_true", help="exit 1 when labels, success, or sample_pack drift")
    handoff.add_argument("--json", action="store_true")
    handoff.set_defaults(func=_cmd_handoff)

    status = sub.add_parser("status", help="shipped scores, captions, checkpoints, and which API keys are set")
    status.set_defaults(func=_cmd_status)

    if argv is None:
        argv = sys.argv[1:]
    if not argv:
        parser.print_help()
        return
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main(sys.argv[1:])
