"""walk reward version 2.
source: local-fallback (GEMINI_API_KEY and META_API_KEY/MODEL_API_KEY unset or unused).
judge feedback seen by the designer: Seed reward. No judge feedback yet.
"""

import math

import numpy as np



def compute_reward(s):
    vel = s["base_lin_vel"]
    cmd = s["command"]
    vx_err = float(vel[0] - cmd[0])
    vy_err = float(vel[1] - cmd[1])
    tracking = math.exp(-(vx_err ** 2) / 0.18 - (vy_err ** 2) / 0.12)
    yaw = math.exp(-((float(s["base_ang_vel"][2]) - float(cmd[2])) ** 2) / 0.20)
    upright = math.exp(-((float(s["projected_gravity"][2]) + 1.0) ** 2) / 0.08)
    height = math.exp(-((float(s["torso_height"]) - 0.13) ** 2) / 0.006)
    forward = max(float(vel[0]), 0.0) * upright
    trunk = float(s["base_ang_vel"][0] ** 2 + s["base_ang_vel"][1] ** 2)
    rate = float(np.sum(np.square(s["action"] - s["prev_action"])))
    slip = float(np.dot(s["foot_contact"], s["foot_speed"]))
    reward = (
        1.70 * tracking
        + 0.55 * forward
        + 0.40 * yaw
        + 0.65 * upright
        + 0.25 * height
        - 0.03 * rate
        - 0.06 * slip
        - 0.12 * float(s["vertical_speed"] ** 2)
        - 0.08 * trunk
        - 0.25 * float(s["torso_contact"])
    )
    parts = {"tracking": tracking, "forward": forward, "upright": upright, "yaw": yaw, "slip": slip}
    return float(reward), parts
