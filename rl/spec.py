"""Shared constants for the 12-DoF mini dog.

The observation layout here is the contract between the Gymnasium env,
the exported ONNX policy, the C header for an ESP32, and firmware/README.md.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ROBOT_XML = ROOT / "robot.xml"
REWARDS = ROOT / "rewards"
VERSIONS = REWARDS / "versions"
LOGS = ROOT / "logs"
FRAMES = ROOT / "frames"
CHECKPOINTS = ROOT / "checkpoints"
FIRMWARE = ROOT / "firmware"
SAMPLE_PACK = ROOT / "sample_pack"

ROBOT_NAME = "mini-dog-12dof"
CTRL_HZ = 50
SIM_TIMESTEP = 0.002
DECIMATION = 10
CTRL_DT = SIM_TIMESTEP * DECIMATION  # 0.02 s
ACTION_SCALE = 0.45
JOINT_VEL_SCALE = 0.1
OBS_CLIP = 10.0

JOINTS = (
    "FL_abad", "FL_hip", "FL_knee",
    "FR_abad", "FR_hip", "FR_knee",
    "RL_abad", "RL_hip", "RL_knee",
    "RR_abad", "RR_hip", "RR_knee",
)
LEG_ORDER = ("FL", "FR", "RL", "RR")
N_JOINTS = len(JOINTS)
assert N_JOINTS == 12

# Tuned on this MJCF. hip = HIP0 - hip_amp * sin(phase), knee lifts during swing.
HIP0 = 0.8
KNEE0 = -1.5
STAND = [0.0, HIP0, KNEE0] * 4
DEAD = [0.35, 0.9, -1.8, -0.35, 0.9, -1.8, 0.35, 0.9, -1.8, -0.35, 0.9, -1.8]
SPAWN_Z = 0.132

SKILLS = ("walk", "trot", "rollover", "play-dead")

COMMANDS = {
    "walk": (0.20, 0.0, 0.0),
    "trot": (0.40, 0.0, 0.0),
    "rollover": (0.0, 0.0, 0.0),
    "play-dead": (0.0, 0.0, 0.0),
}
GAIT_FREQ = {"walk": 1.6, "trot": 2.0, "rollover": 0.0, "play-dead": 0.0}
EPISODE_STEPS = {"walk": 250, "trot": 200, "rollover": 160, "play-dead": 200}
DEFAULT_POSE = {
    "walk": STAND,
    "trot": STAND,
    "rollover": STAND,
    "play-dead": DEAD,
}

# Observation vector, length 50.
# [0:3] projected gravity, body frame (~[0,0,-1] upright)
# [3:6] gyro, body frame
# [6:9] linear velocity, body frame
# [9:21] joint position relative to the skill's default pose
# [21:33] joint velocity * JOINT_VEL_SCALE
# [33:45] previous action in [-1, 1]
# [45:48] command (vx, vy, yaw rate)
# [48:50] sin(phase), cos(phase)
OBS_SLICES = {
    "projected_gravity": [0, 3],
    "base_ang_vel": [3, 6],
    "base_lin_vel": [6, 9],
    "joint_pos_rel": [9, 21],
    "joint_vel_scaled": [21, 33],
    "prev_action": [33, 45],
    "command": [45, 48],
    "phase_sincos": [48, 50],
}
OBS_DIM = 50


def reward_filename(skill: str) -> str:
    return {"walk": "walk.py", "trot": "trot.py", "rollover": "rollover.py", "play-dead": "play_dead.py"}[skill]


def version_filename(skill: str, version: int) -> str:
    stem = {"walk": "walk", "trot": "trot", "rollover": "rollover", "play-dead": "play_dead"}[skill]
    return f"{stem}_v{version}.py"


def policy_filename(skill: str) -> str:
    return f"{skill}.onnx"


def video_filename(skill: str) -> str:
    return f"{skill}.mp4"


def curve_filename(skill: str) -> str:
    return f"{skill}_curve.json"


def c_symbol(skill: str) -> str:
    return skill.replace("-", "_")


def build_obs(projected_gravity, base_ang_vel, base_lin_vel, joint_pos_rel, joint_vel, prev_action, command, phase):
    import numpy as np

    phase = float(phase)
    obs = np.concatenate(
        [
            np.asarray(projected_gravity, dtype=np.float32).reshape(3),
            np.asarray(base_ang_vel, dtype=np.float32).reshape(3),
            np.asarray(base_lin_vel, dtype=np.float32).reshape(3),
            np.asarray(joint_pos_rel, dtype=np.float32).reshape(N_JOINTS),
            np.asarray(joint_vel, dtype=np.float32).reshape(N_JOINTS) * JOINT_VEL_SCALE,
            np.asarray(prev_action, dtype=np.float32).reshape(N_JOINTS),
            np.asarray(command, dtype=np.float32).reshape(3),
            np.array([math.sin(2 * math.pi * phase), math.cos(2 * math.pi * phase)], dtype=np.float32),
        ]
    )
    return np.clip(obs, -OBS_CLIP, OBS_CLIP).astype(np.float32)


def policy_spec() -> dict:
    return {
        "robot": ROBOT_NAME,
        "mjcf": "robot.xml",
        "control_hz": CTRL_HZ,
        "sim_timestep": SIM_TIMESTEP,
        "decimation": DECIMATION,
        "action_scale_rad": ACTION_SCALE,
        "joint_vel_scale": JOINT_VEL_SCALE,
        "obs_clip": OBS_CLIP,
        "obs_dim": OBS_DIM,
        "act_dim": N_JOINTS,
        "joints": list(JOINTS),
        "obs_slices": OBS_SLICES,
        "action": "residual joint target, radians: q_target = default_pose + action * action_scale_rad, then clipped to joint limits",
        "default_pose_rad": {skill: list(DEFAULT_POSE[skill]) for skill in SKILLS},
        "commands": {skill: list(COMMANDS[skill]) for skill in SKILLS},
        "network": "MLP 50-64-64-12, tanh hidden activations, deterministic mean action",
        "onnx": {skill: policy_filename(skill) for skill in SKILLS},
    }


def write_policy_spec(path: Path | None = None) -> Path:
    path = path or (ROOT / "policy_spec.json")
    path.write_text(json.dumps(policy_spec(), indent=2) + "\n")
    return path
