"""walk reward version 5.
source: local-fallback (GEMINI_API_KEY and META_API_KEY/MODEL_API_KEY unset or unused).
judge feedback seen by the designer: SUBQ_API_KEY is unset. SubQ was not called. Winner is the candidate with the higher task score, a positive scripted-vs-vibration gap, and a lower hacking flag.
"""

import math

import numpy as np



def compute_reward(s):
    phase = float(s["phase"])
    hip0 = 0.8
    knee0 = -1.5
    hip_amp = 0.25
    knee_lift = 0.3
    offsets = (0.0, 0.5, 0.5, 0.0)  # FL, FR, RL, RR
    ref = np.zeros(12, dtype=np.float64)
    for i, off in enumerate(offsets):
        leg_phase = (phase + off) % 1.0
        ang = math.sin(2.0 * math.pi * leg_phase)
        swing = max(0.0, ang)
        ref[i * 3 + 1] = hip0 - hip_amp * ang
        ref[i * 3 + 2] = knee0 - knee_lift * swing
    err = float(np.sum(np.square(s["joint_pos"] - ref)))
    pose = math.exp(-err / 0.06)
    default = np.array([0.0, 0.8, -1.5, 0.0, 0.8, -1.5, 0.0, 0.8, -1.5, 0.0, 0.8, -1.5])
    desired = np.clip((ref - default) / 0.45, -1.0, 1.0)
    act = math.exp(-float(np.sum(np.square(s["action"] - desired))) / 0.12)
    upright = math.exp(-((float(s["projected_gravity"][2]) + 1.0) ** 2) / 0.08)
    vel = s["base_lin_vel"]
    cmd = float(s["command"][0])
    forward = max(float(vel[0]), 0.0)
    tracking = math.exp(-((float(vel[0]) - cmd) ** 2) / 0.12 - (float(vel[1]) ** 2) / 0.08)
    rate = float(np.sum(np.square(s["action"] - s["prev_action"])))
    reward = (
        3.00 * act * upright
        + 1.20 * pose * upright
        + 0.80 * tracking * upright
        + 0.60 * forward * upright
        + 0.20 * upright
        - 0.03 * rate
        - 0.30 * float(s["torso_contact"])
    )
    parts = {"act": act, "pose": pose, "tracking": tracking, "forward": forward, "upright": upright, "desired": desired}
    return float(reward), parts
