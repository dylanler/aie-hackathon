"""Rollover reward v1, seed.

Pay for turning the body off its feet and for having been inverted at least
once. Spin only helps before the roll completes, so a policy cannot farm
reward by spinning forever after it is already on its back.
"""

import math

import numpy as np


def compute_reward(s):
    up = float(s["up_z"])
    # 0 upright, 1 belly-up.
    progress = float(np.clip((1.0 - up) * 0.5, 0.0, 1.0))
    spin = abs(float(s["base_ang_vel"][0]))
    spin_term = min(spin, 4.0) * (1.0 - float(s["ever_inverted"]))
    still = math.exp(-float(np.sum(np.square(s["joint_vel"]))) / 12.0)
    hold = still * float(s["ever_inverted"])
    rate = float(np.sum(np.square(s["action"] - s["prev_action"])))
    reward = 1.30 * progress + 0.08 * spin_term + 0.35 * hold - 0.01 * rate
    parts = {"progress": progress, "spin": spin_term, "hold": hold}
    return float(reward), parts
