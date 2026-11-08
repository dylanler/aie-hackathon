"""Local reward designer used when Gemini and Muse are unreachable.

The functions below are real reward programs, written out as version files.
They are the fallback, not a stand-in that pretends an API responded.
"""

from __future__ import annotations

import math
import re

_FEEDBACK_LIMIT = 400


def _header(skill: str, version: int, feedback: str) -> str:
    note = (feedback or "none").replace('"""', "'").replace("\n", " ")[:_FEEDBACK_LIMIT]
    return (
        f'"""{skill} reward version {version}.\n'
        f"source: local-fallback (GEMINI_API_KEY and META_API_KEY/MODEL_API_KEY unset or unused).\n"
        f"judge feedback seen by the designer: {note}\n"
        f'"""\n\n'
        "import math\n\nimport numpy as np\n\n\n"
    )


def _walk(version: int, feedback: str) -> str:
    # v2 puts more weight on actually moving, and taxes vertical bounce and trunk spin.
    return _header("walk", version, feedback) + '''
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
'''


def _trot(version: int, feedback: str) -> str:
    return _header("trot", version, feedback) + '''
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
'''


def _rollover(version: int, feedback: str) -> str:
    return _header("rollover", version, feedback) + '''
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
'''


def _play_dead(version: int, feedback: str) -> str:
    return _header("play-dead", version, feedback) + '''
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
'''


_BUILDERS = {
    "walk": _walk,
    "trot": _trot,
    "rollover": _rollover,
    "play-dead": _play_dead,
}


def _scale_floats(source: str, factor: float) -> str:
    """Deterministic later-version edit: scale decimal literals, leave 0/1 alone."""

    def repl(match: re.Match) -> str:
        text = match.group(0)
        value = float(text)
        if value in (0.0, 1.0, -1.0) or abs(value) >= 10:
            return text
        return f"{value * factor:.4f}"

    return re.sub(r"(?<![\w.])-?\d+\.\d+(?![\w.])", repl, source)


def _gait(version: int, feedback: str, skill: str, hip_amp: float, knee_lift: float) -> str:
    """Track a diagonal gait the ±0.45 rad residual can actually reach."""
    return _header(skill, version, feedback) + f'''
def compute_reward(s):
    phase = float(s["phase"])
    hip0 = 0.8
    knee0 = -1.5
    hip_amp = {hip_amp}
    knee_lift = {knee_lift}
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
    parts = {{"act": act, "pose": pose, "tracking": tracking, "forward": forward, "upright": upright, "desired": desired}}
    return float(reward), parts
'''


def _rollover_v3(version: int, feedback: str) -> str:
    return _header("rollover", version, feedback) + '''
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
'''


def generate(skill: str, version: int, parent_code: str, feedback: str) -> str:
    del parent_code
    if version >= 3 and skill == "walk":
        return _gait(version, feedback, "walk", 0.25, 0.30)
    if version >= 3 and skill == "trot":
        return _gait(version, feedback, "trot", 0.28, 0.45)
    if version >= 3 and skill == "rollover":
        return _rollover_v3(version, feedback)
    base = _BUILDERS[skill](version, feedback)
    if version <= 2:
        return base
    factor = 1.0 + 0.05 * math.sin(version)
    return _scale_floats(base, factor)
