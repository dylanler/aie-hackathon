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


def generate(skill: str, version: int, parent_code: str, feedback: str) -> str:
    del parent_code
    base = _BUILDERS[skill](version, feedback)
    if version <= 2:
        return base
    factor = 1.0 + 0.05 * math.sin(version)
    return _scale_floats(base, factor)
