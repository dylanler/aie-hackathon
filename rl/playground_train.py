"""MuJoCo Playground hook.

This is called only when `runtime.probe()` sees a JAX GPU and an installed
playground package. It does not train a stock Go1 and label it as this dog.
A custom 12-DoF MJX PPO env is not bundled here; if the package is present
but this robot is not registered, training falls back to stable-baselines3.
"""

from __future__ import annotations

from pathlib import Path


class PlaygroundUnavailable(RuntimeError):
    pass


def train(skill: str, reward_path: Path, timesteps: int, version: int, seed: int) -> dict:
    del skill, reward_path, timesteps, version, seed
    try:
        import jax  # noqa: F401
        import mujoco_playground  # noqa: F401
    except Exception as exc:
        try:
            import playground  # noqa: F401
        except Exception as exc2:
            raise PlaygroundUnavailable(f"{type(exc).__name__}; {type(exc2).__name__}") from exc2
    raise PlaygroundUnavailable(
        "MuJoCo Playground is installed, but mini-dog-12dof is not a registry env. "
        "Refusing to train a different robot under this MJCF's name. "
        "Use the stable-baselines3 path, which loads rl/robot.xml directly."
    )
