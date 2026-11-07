"""Commands:

    python -m rl demo
    python -m rl train --skill walk --timesteps 8192
    python -m rl eureka --skill walk --candidates 2 --timesteps 4096
    python -m rl judge --skill walk
    python -m rl export --skill walk
    python -m rl replay --skill walk --controller scripted
    python -m rl replay --skill play-dead --controller scripted
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


def _cmd_export(args: argparse.Namespace) -> None:
    from rl.export_onnx import export_checkpoint

    for skill in _skills(args.skill):
        checkpoint = spec.CHECKPOINTS / f"{spec.c_symbol(skill)}_v{args.version}.zip"
        if not checkpoint.exists():
            matches = sorted(spec.CHECKPOINTS.glob(f"{spec.c_symbol(skill)}_v*.zip"))
            if not matches:
                raise SystemExit(f"no checkpoint for {skill}. Train first.")
            checkpoint = matches[-1]
        result = export_checkpoint(checkpoint, skill, spec.ROOT / spec.policy_filename(skill))
        print(json.dumps({"skill": skill, **result}, indent=2))


def _cmd_replay(args: argparse.Namespace) -> None:
    from rl.replay import policy_rollout, scripted_rollout

    for skill in _skills(args.skill):
        reward = spec.REWARDS / spec.reward_filename(skill)
        out = spec.ROOT / (args.out or spec.video_filename(skill))
        if len(_skills(args.skill)) > 1 and args.out:
            raise SystemExit("--out can only be used with a single skill")
        if args.controller == "scripted":
            result = scripted_rollout(skill, reward, out, seconds=args.seconds)
        else:
            checkpoint = spec.CHECKPOINTS / f"{spec.c_symbol(skill)}_v{args.version}.zip"
            if not checkpoint.exists():
                matches = sorted(spec.CHECKPOINTS.glob(f"{spec.c_symbol(skill)}_v*.zip"))
                if not matches:
                    raise SystemExit(f"no checkpoint for {skill}")
                checkpoint = matches[-1]
            if args.out is None:
                out = spec.ROOT / f"{spec.c_symbol(skill)}_policy.mp4"
            result = policy_rollout(skill, reward, checkpoint, out, seconds=args.seconds)
        printable = {k: v for k, v in result.items() if k != "metrics"}
        printable["task_score"] = result["success"]
        print(json.dumps(printable, indent=2))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m rl")
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

    judge = sub.add_parser("judge", help="judge logged candidates with SubQ Snap or the local judge")
    judge.add_argument("--skill", default="all")
    judge.set_defaults(func=_cmd_judge)

    export = sub.add_parser("export", help="write ONNX and an ESP32 C header from a checkpoint")
    export.add_argument("--skill", default="all")
    export.add_argument("--version", type=int, default=1)
    export.set_defaults(func=_cmd_export)

    replay = sub.add_parser("replay", help="write an mp4 from the scripted controller or a policy")
    replay.add_argument("--skill", default="walk")
    replay.add_argument("--controller", choices=("scripted", "policy"), default="scripted")
    replay.add_argument("--out", default=None)
    replay.add_argument("--seconds", type=float, default=None)
    replay.add_argument("--version", type=int, default=1)
    replay.set_defaults(func=_cmd_replay)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main(sys.argv[1:])
