"""Open-loop joint targets for comparison rollouts.

These are physics rollouts (the servos track the targets). They are a
different video from the shipped skill mp4s, which are PPO policy rollouts
captioned "ppo policy rollout". Videos rendered from this module are labeled
"open-loop controller".

Walk and trot parameters were tuned on robot.xml: a diagonal pair gait that
stays upright and moves forward. Rollover and play-dead share a throw onto
the back; play-dead then holds a still belly-up pose.
"""

from __future__ import annotations

import math

import numpy as np

from rl import spec

LEGS = spec.LEG_ORDER
OFFSETS = {"FL": 0.0, "RR": 0.0, "FR": 0.5, "RL": 0.5}

WALK = {"freq": 1.6, "hip_amp": 0.22, "knee_lift": 0.70}
TROT = {"freq": 2.0, "hip_amp": 0.18, "knee_lift": 1.05}

CROUCH = np.tile([0.15, 1.35, -2.25], 4)
THROW = np.array([0.65, 0.10, -0.45, -0.20, 1.60, -2.40, 0.65, 0.10, -0.45, -0.20, 1.60, -2.40])
TUCK = np.tile([0.0, 1.20, -2.00], 4)
DEAD = np.asarray(spec.DEAD, dtype=np.float64)
STAND = np.asarray(spec.STAND, dtype=np.float64)

VIDEO_SECONDS = {"walk": 5.0, "trot": 4.0, "rollover": 3.2, "play-dead": 4.5}
ROLL_RATE = 7.0


def trot_targets(t: float, freq: float, hip_amp: float, knee_lift: float) -> np.ndarray:
    ctrl = np.zeros(12, dtype=np.float64)
    for i, leg in enumerate(LEGS):
        phase = (t * freq + OFFSETS[leg]) % 1.0
        s = math.sin(2.0 * math.pi * phase)
        swing = max(0.0, s)
        hip = spec.HIP0 - hip_amp * s
        knee = spec.KNEE0 - knee_lift * swing
        ctrl[i * 3 : i * 3 + 3] = (0.0, hip, knee)
    return ctrl


def targets(skill: str, t: float) -> np.ndarray:
    if skill == "walk":
        return trot_targets(t, **WALK)
    if skill == "trot":
        return trot_targets(t, **TROT)
    if skill == "rollover":
        if t < 0.25:
            return CROUCH.copy()
        if t < 0.90:
            return THROW.copy()
        if t < 1.50:
            return TUCK.copy()
        return DEAD.copy()
    if skill == "play-dead":
        # Same throw as rollover, then hold the belly-up pose for the rest of the clip.
        if t < 0.25:
            return CROUCH.copy()
        if t < 0.90:
            return THROW.copy()
        if t < 1.50:
            return TUCK.copy()
        return DEAD.copy()
    raise ValueError(skill)


def initial_qpos_qvel(model, skill: str):
    qpos = np.zeros(model.nq, dtype=np.float64)
    qvel = np.zeros(model.nv, dtype=np.float64)
    qpos[3] = 1.0
    if skill in ("walk", "trot"):
        qpos[2] = spec.SPAWN_Z
        qpos[7:] = STAND
    elif skill in ("rollover", "play-dead"):
        qpos[2] = 0.16
        qpos[7:] = STAND
        qvel[3] = ROLL_RATE
    else:
        raise ValueError(skill)
    return qpos, qvel


def vibration_targets(t: float, center: np.ndarray) -> np.ndarray:
    """A reward-hacking style probe: high-frequency joint chatter, no gait."""
    wave = 0.35 * math.sin(40.0 * t)
    out = center.copy()
    out[1::3] = center[1::3] + wave
    out[2::3] = center[2::3] - 0.5 * wave
    return out
