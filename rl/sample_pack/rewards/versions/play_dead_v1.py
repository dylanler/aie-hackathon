"""Play-dead reward v1, seed.

The dog should be low, inverted (or at least not standing), and nearly still.
Standing back up is the failure mode this reward pushes against.
"""

import math

import numpy as np


def compute_reward(s):
    up = float(s["up_z"])
    inverted = float(np.clip(-up, 0.0, 1.0))
    low = math.exp(-((float(s["torso_height"]) - 0.05) ** 2) / 0.004)
    still = math.exp(-float(np.sum(np.square(s["joint_vel"]))) / 2.5)
    calm = math.exp(-float(np.sum(np.square(s["base_ang_vel"]))) / 1.5)
    effort = float(np.sum(np.square(s["action"])))
    standing_penalty = float(np.clip(up, 0.0, 1.0))
    reward = 0.70 * inverted + 0.45 * low + 0.40 * still + 0.25 * calm - 0.08 * effort - 0.50 * standing_penalty
    parts = {"inverted": inverted, "low": low, "still": still, "calm": calm, "effort": effort}
    return float(reward), parts
