"""trot reward version 2.
source: local-fallback (GEMINI_API_KEY and META_API_KEY/MODEL_API_KEY unset or unused).
judge feedback seen by the designer: Seed reward. No judge feedback yet.
"""

import math

import numpy as np



def compute_reward(s):
    vel = s["base_lin_vel"]
    cmd = s["command"]
    tracking = math.exp(-((float(vel[0]) - float(cmd[0])) ** 2) / 0.16 - (float(vel[1]) ** 2) / 0.10)
    upright = math.exp(-((float(s["projected_gravity"][2]) + 1.0) ** 2) / 0.08)
    forward = max(float(vel[0]), 0.0)
    duty = float(np.mean(s["foot_contact"]))
    # A trot is not a four-foot shuffle. Flight only counts while moving forward and upright.
    flight = (1.0 - duty) * forward * upright
    yaw = math.exp(-(float(s["base_ang_vel"][2]) ** 2) / 0.20)
    rate = float(np.sum(np.square(s["action"] - s["prev_action"])))
    slip = float(np.dot(s["foot_contact"], s["foot_speed"]))
    slow = max(0.0, float(cmd[0]) - float(vel[0]))
    reward = (
        1.55 * tracking
        + 0.40 * forward * upright
        + 0.35 * flight
        + 0.30 * yaw
        + 0.45 * upright
        - 0.35 * slow * upright
        - 0.03 * rate
        - 0.05 * slip
        - 0.10 * float(s["vertical_speed"] ** 2)
    )
    parts = {"tracking": tracking, "forward": forward, "flight": flight, "upright": upright}
    return float(reward), parts
