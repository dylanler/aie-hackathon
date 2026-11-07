"""Pick a trainer. MuJoCo Playground / JAX when a GPU is actually usable,
otherwise stable-baselines3 on CPU. Never raises just because a GPU is missing.
"""

from __future__ import annotations

import importlib.util


def probe() -> dict:
    info = {
        "selected": "stable-baselines3",
        "device": "cpu",
        "jax": False,
        "gpu": False,
        "playground": False,
        "reason": "",
    }
    if importlib.util.find_spec("jax") is None:
        info["reason"] = "jax is not installed, so training uses stable-baselines3 PPO on CPU."
        return info
    info["jax"] = True
    try:
        import jax
    except Exception as exc:
        info["reason"] = f"jax failed to import ({type(exc).__name__}); using stable-baselines3 PPO on CPU."
        return info
    gpu_devices = []
    try:
        for device in jax.devices():
            platform = str(getattr(device, "platform", "")).lower()
            if platform in {"gpu", "cuda"}:
                gpu_devices.append(str(device))
    except Exception:
        gpu_devices = []
    info["gpu"] = bool(gpu_devices)
    playground_spec = importlib.util.find_spec("mujoco_playground") or importlib.util.find_spec("playground")
    info["playground"] = playground_spec is not None
    if not gpu_devices:
        info["reason"] = "jax has no GPU device; using stable-baselines3 PPO on CPU."
        return info
    if playground_spec is None:
        info["reason"] = "a JAX GPU is visible but mujoco playground is not installed; using stable-baselines3 PPO on CPU."
        return info
    info["selected"] = "mujoco-playground"
    info["device"] = "gpu"
    info["reason"] = "JAX GPU and MuJoCo Playground are both importable."
    return info


def use_playground() -> bool:
    return probe()["selected"] == "mujoco-playground"
