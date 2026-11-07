"""Walk reward v1, seed.

Track the commanded planar velocity, stay upright near standing height, and
penalize action chatter and foot slip. Later versions are judged against this
one; a higher return alone is not enough to win.
"""

import math

import numpy as np


def compute_reward(s):
    vel = s["base_lin_vel"]
    cmd = s["command"]
    tracking = math.exp(-((vel[0] - cmd[0]) ** 2 + (vel[1] - cmd[1]) ** 2) / 0.25)
    yaw = math.exp(-((s["base_ang_vel"][2] - cmd[2]) ** 2) / 0.25)
    upright = math.exp(-((s["projected_gravity"][2] + 1.0) ** 2) / 0.12)
    height = math.exp(-((s["torso_height"] - 0.13) ** 2) / 0.008)
    rate = float(np.sum(np.square(s["action"] - s["prev_action"])))
    slip = float(np.dot(s["foot_contact"], s["foot_speed"]))
    vertical = float(s["vertical_speed"] ** 2)
    reward = (
        1.15 * tracking
        + 0.35 * yaw
        + 0.55 * upright
        + 0.30 * height
        + 0.04
        - 0.02 * rate
        - 0.04 * slip
        - 0.05 * vertical
        - 0.15 * float(s["torso_contact"])
    )
    parts = {
        "tracking": tracking,
        "yaw": yaw,
        "upright": upright,
        "height": height,
        "rate": rate,
        "slip": slip,
    }
    return float(reward), parts
