"""Trot reward v1, seed.

Same pose terms as walk, with a higher weight on forward speed so a slow walk
does not look as good as a trot when the command is faster.
"""

import math

import numpy as np


def compute_reward(s):
    vel = s["base_lin_vel"]
    cmd = s["command"]
    tracking = math.exp(-((vel[0] - cmd[0]) ** 2) / 0.20 - (vel[1] ** 2) / 0.15)
    yaw = math.exp(-((s["base_ang_vel"][2] - cmd[2]) ** 2) / 0.25)
    upright = math.exp(-((s["projected_gravity"][2] + 1.0) ** 2) / 0.10)
    height = math.exp(-((s["torso_height"] - 0.13) ** 2) / 0.008)
    rate = float(np.sum(np.square(s["action"] - s["prev_action"])))
    slip = float(np.dot(s["foot_contact"], s["foot_speed"]))
    airborne = float(1.0 - np.mean(s["foot_contact"]))
    forward = max(float(vel[0]), 0.0)
    reward = (
        1.40 * tracking
        + 0.25 * forward
        + 0.15 * airborne * forward
        + 0.30 * yaw
        + 0.50 * upright
        + 0.20 * height
        - 0.025 * rate
        - 0.04 * slip
        - 0.08 * float(s["vertical_speed"] ** 2)
    )
    parts = {"tracking": tracking, "forward": forward, "upright": upright, "airborne": airborne, "rate": rate}
    return float(reward), parts
