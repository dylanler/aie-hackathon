"""rollover reward version 2.
source: local-fallback (GEMINI_API_KEY and META_API_KEY/MODEL_API_KEY unset or unused).
judge feedback seen by the designer: Seed reward. No judge feedback yet.
"""

import math

import numpy as np



def compute_reward(s):
    up = float(s["up_z"])
    progress = float(np.clip((1.0 - up) * 0.5, 0.0, 1.0))
    done = float(s["ever_inverted"])
    # Once inverted, further roll rate is no longer useful.
    spin = min(abs(float(s["base_ang_vel"][0])), 5.0) * (1.0 - done)
    still = math.exp(-float(np.sum(np.square(s["joint_vel"]))) / 8.0)
    calm = math.exp(-float(np.sum(np.square(s["base_ang_vel"]))) / 4.0)
    hold = done * still * calm * float(np.clip(-up, 0.0, 1.0))
    rate = float(np.sum(np.square(s["action"] - s["prev_action"])))
    reward = 1.10 * progress + 0.55 * done + 0.06 * spin + 0.50 * hold - 0.02 * rate
    parts = {"progress": progress, "done": done, "hold": hold, "spin": spin}
    return float(reward), parts
