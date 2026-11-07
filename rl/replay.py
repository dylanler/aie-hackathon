"""Roll out a skill to an mp4.

--controller scripted  open-loop gait or trick, labeled on the frames
--controller policy    deterministic ONNX/SB3 policy from a checkpoint
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from rl import scripted, spec
from rl.env import MiniDogEnv
from rl.video import Recorder, caption, write_mp4


def _record(env: MiniDogEnv, skill: str, label: str, seconds: float, target_fn, qpos, qvel, fps: int = 30) -> tuple[list, dict, float]:
    env.set_state(qpos, qvel)
    recorder = Recorder(env.model)
    frames = []
    next_t = 0.0
    steps = max(1, int(round(seconds / spec.CTRL_DT)))
    try:
        for _ in range(steps):
            target_fn(env)
            if env.data.time + 1e-9 >= next_t:
                frames.append(caption(recorder.frame(env.data, skill), f"{skill} · {label}"))
                next_t += 1.0 / fps
    finally:
        recorder.close()
    return frames, env.metrics(), float(env.task_score())


def scripted_rollout(skill: str, reward_path: Path, out: Path, seconds: float | None = None) -> dict:
    env = MiniDogEnv(skill, reward_path)
    qpos, qvel = scripted.initial_qpos_qvel(env.model, skill)
    seconds = float(seconds if seconds is not None else scripted.VIDEO_SECONDS[skill])

    def apply(env_: MiniDogEnv) -> None:
        env_.apply_targets(scripted.targets(skill, env_.data.time))

    frames, metrics, score = _record(env, skill, "scripted motion fallback", seconds, apply, qpos, qvel)
    env.close()
    write_mp4(out, frames, fps=30)
    return {"video": str(out), "frames": len(frames), "metrics": metrics, "success": score, "source": "scripted-fallback"}


def policy_rollout(skill: str, reward_path: Path, checkpoint: Path, out: Path, seconds: float | None = None) -> dict:
    from stable_baselines3 import PPO

    env = MiniDogEnv(skill, reward_path)
    model = PPO.load(str(checkpoint), device="cpu")
    obs, _ = env.reset(seed=0, options={"eval": True})
    recorder = Recorder(env.model)
    frames = []
    next_t = 0.0
    seconds = float(seconds if seconds is not None else scripted.VIDEO_SECONDS[skill])
    limit = max(1, int(round(seconds / spec.CTRL_DT)))
    done = False
    info = {}
    try:
        for _ in range(limit):
            if not done:
                action, _ = model.predict(obs, deterministic=True)
                obs, _reward, terminated, truncated, info = env.step(action)
                done = bool(terminated or truncated)
            if env.data.time + 1e-9 >= next_t:
                frames.append(caption(recorder.frame(env.data, skill), f"{skill} · ppo policy rollout"))
                next_t += 1.0 / 30
            if done and env.data.time >= seconds:
                break
    finally:
        recorder.close()
        env.close()
    write_mp4(out, frames, fps=30)
    metrics = dict(info.get("metrics") or {})
    score = float(info.get("task_score", 0.0))
    return {"video": str(out), "frames": len(frames), "metrics": metrics, "success": score, "source": "ppo"}
