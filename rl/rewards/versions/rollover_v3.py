"""rollover reward version 3.
source: local-fallback (GEMINI_API_KEY and META_API_KEY/MODEL_API_KEY unset or unused).
judge feedback seen by the designer: SUBQ_API_KEY is unset. SubQ was not called. Winner is the candidate with the higher task score, a positive scripted-vs-vibration gap, and a lower hacking flag.
"""

import math

import numpy as np



def compute_reward(s):
    # A and B alternate at the rollover phase clock. On this MJCF that
    # alternation rolls the body from a stand. Both poses fit in the residual.
    pose_a = np.array([0.45, 0.35, -1.05, -0.45, 1.25, -1.95, 0.45, 0.35, -1.05, -0.45, 1.25, -1.95])
    pose_b = np.array([0.45, 1.25, -1.95, -0.45, 0.35, -1.05, 0.45, 1.25, -1.95, -0.45, 0.35, -1.05])
    pose_dead = np.array([0.35, 0.9, -1.8, -0.35, 0.9, -1.8, 0.35, 0.9, -1.8, -0.35, 0.9, -1.8])
    up = float(s["up_z"])
    if up < -0.25:
        ref = pose_dead
    elif float(s["phase"]) < 0.5:
        ref = pose_a
    else:
        ref = pose_b
    err = float(np.sum(np.square(s["joint_pos"] - ref)))
    pose = math.exp(-err / 0.08)
    default = np.array([0.0, 0.8, -1.5, 0.0, 0.8, -1.5, 0.0, 0.8, -1.5, 0.0, 0.8, -1.5])
    desired = np.clip((ref - default) / 0.45, -1.0, 1.0)
    act = math.exp(-float(np.sum(np.square(s["action"] - desired))) / 0.15)
    rolled = min(abs(float(s["roll"])) / math.pi, 1.0)
    hold = math.exp(-float(np.sum(np.square(s["joint_vel"]))) / 6.0) if up < -0.25 else 0.0
    calm = math.exp(-float(np.sum(np.square(s["base_ang_vel"]))) / 4.0) if up < -0.25 else 0.0
    rate = float(np.sum(np.square(s["action"] - s["prev_action"])))
    reward = 2.60 * act + 1.00 * pose + 1.30 * rolled + 0.70 * hold + 0.30 * calm - 0.03 * rate
    parts = {"act": act, "pose": pose, "rolled": rolled, "hold": hold, "desired": desired}
    return float(reward), parts
