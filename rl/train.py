"""Short PPO bursts.

Selects MuJoCo Playground when a JAX GPU and the playground package are both
available. Otherwise trains with stable-baselines3 on CPU, which is the path
that produces the checked-in artifacts on a machine without a GPU.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from rl import runtime, scripted, spec
from rl.env import MiniDogEnv
from rl.video import Recorder, resize, sample_frames, save_png

PROBE_SECONDS = 2.0


def _bad_targets(skill: str, t: float, center: np.ndarray) -> np.ndarray:
    if skill in ("walk", "trot"):
        return scripted.vibration_targets(t, center)
    return scripted.STAND.copy()


def _probe(env: MiniDogEnv, target_fn, seconds: float, qpos=None, qvel=None) -> float:
    if qpos is None:
        env.reset(seed=0, options={"eval": True})
    else:
        env.set_state(qpos, qvel)
    steps = max(1, int(seconds / spec.CTRL_DT))
    for _ in range(steps):
        env.apply_targets(target_fn(env.data.time))
    return float(env.metrics()["mean_reward"])


def _evaluate(env: MiniDogEnv, model, seed: int) -> tuple[dict, list]:
    obs, _ = env.reset(seed=seed, options={"eval": True})
    recorder = Recorder(env.model)
    frames = []
    done = False
    info = {}
    while not done:
        action, _ = model.predict(obs, deterministic=True)
        obs, _reward, terminated, truncated, info = env.step(action)
        done = bool(terminated or truncated)
        if env.step_count % 4 == 0 or done:
            frames.append(recorder.frame(env.data, env.skill))
    recorder.close()
    stats = dict(info.get("metrics") or env.metrics())
    stats["task_score"] = float(info.get("task_score", env.task_score()))
    return stats, frames


def _sb3(skill: str, reward_path: Path, timesteps: int, version: int, seed: int) -> dict:
    import torch
    from stable_baselines3 import PPO
    from stable_baselines3.common.callbacks import BaseCallback

    torch.set_num_threads(4)
    env = MiniDogEnv(skill, reward_path)
    n_steps = 512 if timesteps >= 512 else max(32, int(timesteps))
    batch = 128 if n_steps >= 128 else n_steps

    class _Curve(BaseCallback):
        def __init__(self):
            super().__init__()
            self.episodes = []
            self._ret = 0.0
            self._len = 0

        def _on_step(self) -> bool:
            self._ret += float(self.locals["rewards"][0])
            self._len += 1
            if bool(self.locals["dones"][0]):
                info = self.locals["infos"][0]
                self.episodes.append(
                    {
                        "timestep": int(self.num_timesteps),
                        "ep_return": round(self._ret, 4),
                        "ep_len": self._len,
                        "task_score": info.get("task_score"),
                    }
                )
                self._ret = 0.0
                self._len = 0
            return True

    callback = _Curve()
    model = PPO(
        "MlpPolicy",
        env,
        learning_rate=3e-4,
        n_steps=n_steps,
        batch_size=batch,
        n_epochs=4,
        gamma=0.99,
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=0.002,
        vf_coef=0.5,
        max_grad_norm=0.5,
        seed=seed,
        device="cpu",
        verbose=0,
        policy_kwargs={"net_arch": [64, 64], "log_std_init": -1.0},
    )
    model.learn(total_timesteps=int(timesteps), callback=callback, progress_bar=False)
    if callback._len:
        callback.episodes.append(
            {
                "timestep": int(callback.num_timesteps),
                "ep_return": round(callback._ret, 4),
                "ep_len": callback._len,
                "partial": True,
            }
        )
    spec.CHECKPOINTS.mkdir(parents=True, exist_ok=True)
    checkpoint = spec.CHECKPOINTS / f"{spec.c_symbol(skill)}_v{version}.zip"
    model.save(str(checkpoint))
    env.close()

    eval_env = MiniDogEnv(skill, reward_path)
    stats, frames = _evaluate(eval_env, model, seed)
    qpos, qvel = scripted.initial_qpos_qvel(eval_env.model, skill)
    scripted_reward = _probe(
        eval_env,
        lambda t: scripted.targets(skill, t),
        PROBE_SECONDS,
        qpos=qpos,
        qvel=qvel,
    )
    # Play-dead's env reset already lies on its back, so a reset-based "bad"
    # probe would start in the goal pose and look like a hack. Compare against
    # an upright stand instead.
    if skill == "play-dead":
        stand_qpos = np.zeros(eval_env.model.nq)
        stand_qvel = np.zeros(eval_env.model.nv)
        stand_qpos[3] = 1.0
        stand_qpos[2] = spec.SPAWN_Z
        stand_qpos[7:] = scripted.STAND
        bad_reward = _probe(
            eval_env,
            lambda t: scripted.STAND.copy(),
            PROBE_SECONDS,
            qpos=stand_qpos,
            qvel=stand_qvel,
        )
    else:
        bad_reward = _probe(
            eval_env,
            lambda t: _bad_targets(skill, t, eval_env.default_pose),
            PROBE_SECONDS,
        )
    eval_env.close()
    stats.update(
        {
            "probe_scripted_reward": scripted_reward,
            "probe_bad_reward": bad_reward,
            "probe_gap": scripted_reward - bad_reward,
            "timesteps": int(timesteps),
            "backend": "stable-baselines3",
            "device": "cpu",
            "version": version,
        }
    )
    picked = sample_frames(frames, 4)
    frame_dir = spec.FRAMES / f"{spec.c_symbol(skill)}_v{version}"
    for index, frame in enumerate(picked):
        save_png(frame_dir / f"f{index}.png", resize(frame))
    lines = [
        f"skill={skill} version={version} timesteps={timesteps}",
        "backend=stable-baselines3 device=cpu algorithm=PPO",
        f"reward_fn={reward_path}",
        f"checkpoint={checkpoint}",
    ]
    for ep in callback.episodes:
        lines.append("EPISODE " + json.dumps(ep))
    lines.append("EVAL " + json.dumps({k: _jsonable(v) for k, v in stats.items()}))
    lines.append(
        f"PROBE scripted_mean_reward={scripted_reward:.6f} bad_mean_reward={bad_reward:.6f} "
        f"gap={scripted_reward - bad_reward:.6f}"
    )
    if stats.get("probe_gap", 0.0) < 0:
        lines.append("PROBE note: the bad behavior outscored the scripted skill. Treat the return as suspect.")
    log = "\n".join(lines) + "\n"
    spec.LOGS.mkdir(parents=True, exist_ok=True)
    log_path = spec.LOGS / f"{spec.c_symbol(skill)}_v{version}.log"
    log_path.write_text(log)
    (spec.LOGS / f"{spec.c_symbol(skill)}_v{version}.json").write_text(json.dumps(stats, indent=2, default=_jsonable) + "\n")
    return {
        "stats": {k: _jsonable(v) for k, v in stats.items()},
        "episodes": callback.episodes,
        "frames": [resize(frame) for frame in picked],
        "log": log,
        "log_path": str(log_path.relative_to(spec.ROOT)),
        "checkpoint": str(checkpoint.relative_to(spec.ROOT)),
        "backend": "stable-baselines3",
        "device": "cpu",
    }


def _jsonable(value):
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    if isinstance(value, float):
        return round(value, 6)
    return value


def train_skill(skill: str, reward_path: Path, timesteps: int, version: int, seed: int = 0) -> dict:
    info = runtime.probe()
    if info["selected"] == "mujoco-playground":
        try:
            from rl.playground_train import train as playground_train

            result = playground_train(skill, Path(reward_path), timesteps, version, seed)
            result["runtime"] = info
            return result
        except Exception as exc:
            info = dict(info)
            info["selected"] = "stable-baselines3"
            info["device"] = "cpu"
            info["reason"] = f"Playground was selected but did not run ({type(exc).__name__}: {exc}). Using stable-baselines3."
    result = _sb3(skill, Path(reward_path), timesteps, version, seed)
    result["runtime"] = info
    return result
