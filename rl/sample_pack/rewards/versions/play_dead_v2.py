"""play-dead reward version 2.
source: local-fallback (GEMINI_API_KEY and META_API_KEY/MODEL_API_KEY unset or unused).
judge feedback seen by the designer: Seed reward. No judge feedback yet.
"""

import math

import numpy as np



def compute_reward(s):
    up = float(s["up_z"])
    inverted = float(np.clip(-up, 0.0, 1.0))
    low = math.exp(-((float(s["torso_height"]) - 0.045) ** 2) / 0.003)
    joint_energy = float(np.sum(np.square(s["joint_vel"])))
    still = math.exp(-joint_energy / 1.2)
    calm = math.exp(-float(np.sum(np.square(s["base_ang_vel"]))) / 0.8)
    effort = float(np.sum(np.square(s["action"])))
    # Getting up ends the trick.
    standing = float(np.clip(up, 0.0, 1.0))
    reward = (
        0.80 * inverted
        + 0.50 * low
        + 0.55 * still
        + 0.30 * calm
        - 0.12 * effort
        - 0.90 * standing
        - 0.15 * float(s["torso_contact"] == 0.0 and up > 0.4)
    )
    parts = {"inverted": inverted, "low": low, "still": still, "standing": standing}
    return float(reward), parts
