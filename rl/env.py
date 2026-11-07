"""Gymnasium env for the 12-DoF mini dog.

Actions are residual joint-position targets. A position servo in the MJCF
tracks them. One env step is DECIMATION physics steps (50 Hz).
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np

import os

os.environ.setdefault("MUJOCO_GL", "egl")

import mujoco
import gymnasium

from rl import spec
from rl.reward_api import load_reward, smoke_call


class MiniDogEnv(gymnasium.Env):
    metadata = {"render_modes": ["rgb_array"]}

    def __init__(self, skill: str = "walk", reward_path: str | Path | None = None, render_mode: str | None = None):
        super().__init__()
        if skill not in spec.SKILLS:
            raise ValueError(f"unknown skill {skill}")
        self.skill = skill
        self.render_mode = render_mode
        self.model = mujoco.MjModel.from_xml_path(str(spec.ROBOT_XML))
        self.data = mujoco.MjData(self.model)
        if self.model.nu != spec.N_JOINTS:
            raise RuntimeError(f"expected 12 actuators, found {self.model.nu}")
        if abs(self.model.opt.timestep * spec.DECIMATION - spec.CTRL_DT) > 1e-9:
            raise RuntimeError("XML timestep does not match CTRL_DT")
        self.torso_id = self.model.body("torso").id
        self.ctrl_low = self.model.actuator_ctrlrange[:, 0].astype(np.float64)
        self.ctrl_high = self.model.actuator_ctrlrange[:, 1].astype(np.float64)
        self.default_pose = np.asarray(spec.DEFAULT_POSE[skill], dtype=np.float64)
        self.command = np.asarray(spec.COMMANDS[skill], dtype=np.float64)
        self.freq = float(spec.GAIT_FREQ[skill])
        self.max_steps = int(spec.EPISODE_STEPS[skill])
        self.action_scale = float(spec.ACTION_SCALE)
        self.foot_site_ids = [self.model.site(f"{leg}_foot").id for leg in spec.LEG_ORDER]
        self.touch_slices = [self._sensor_slice(f"{leg}_touch") for leg in spec.LEG_ORDER]
        self.gyro_slice = self._sensor_slice("imu_gyro")
        self.lin_slice = self._sensor_slice("imu_lin")
        self.torso_geom = self.model.geom("torso_col").id
        reward_path = Path(reward_path) if reward_path else spec.REWARDS / spec.reward_filename(skill)
        self.reward_path = reward_path
        self.reward_fn = load_reward(reward_path)
        smoke_call(self.reward_fn)

        self.observation_space = gymnasium.spaces.Box(-spec.OBS_CLIP, spec.OBS_CLIP, (spec.OBS_DIM,), np.float32)
        self.action_space = gymnasium.spaces.Box(-1.0, 1.0, (spec.N_JOINTS,), np.float32)

        self.prev_action = np.zeros(spec.N_JOINTS, dtype=np.float64)
        self.action = np.zeros(spec.N_JOINTS, dtype=np.float64)
        self.step_count = 0
        self.ever_inverted = 0.0
        self._prev_height = spec.SPAWN_Z
        self._metrics = {}
        self._renderer = None
        self.reward_errors = 0
        self._reset_metrics()

    def _sensor_slice(self, name: str) -> slice:
        sid = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_SENSOR, name)
        adr = int(self.model.sensor_adr[sid])
        dim = int(self.model.sensor_dim[sid])
        return slice(adr, adr + dim)

    def _reset_metrics(self) -> None:
        self._metrics = {
            "upright_steps": 0,
            "inverted_steps": 0,
            "still_steps": 0,
            "steps": 0,
            "vx_sum": 0.0,
            "reward_sum": 0.0,
            "jitter_sum": 0.0,
            "min_up_z": 1.0,
            "max_up_z": -1.0,
            "min_height": 10.0,
            "fell": 0.0,
        }

    def _write_stand(self, eval_mode: bool) -> None:
        self.data.qpos[:] = 0
        self.data.qvel[:] = 0
        self.data.qpos[3] = 1.0
        pose = self.default_pose.copy()
        if self.skill == "play-dead":
            self.data.qpos[2] = 0.055
            # 180 deg about +X: belly up, the pose the play-dead policy is asked to hold.
            self.data.qpos[3:7] = np.array([0.0, 1.0, 0.0, 0.0])
        else:
            self.data.qpos[2] = spec.SPAWN_Z
        if not eval_mode:
            pose = pose + self.np_random.uniform(-0.02, 0.02, size=spec.N_JOINTS)
            self.data.qpos[2] += float(self.np_random.uniform(-0.004, 0.008))
            if self.skill == "rollover" and float(self.np_random.random()) < 0.45:
                self.data.qvel[3] = float(self.np_random.uniform(3.0, 8.0))
        self.data.qpos[7:] = np.clip(pose, self.ctrl_low, self.ctrl_high)
        self.data.ctrl[:] = self.data.qpos[7:]
        self.ever_inverted = 1.0 if self.skill == "play-dead" else 0.0

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        eval_mode = bool(options and options.get("eval"))
        mujoco.mj_resetData(self.model, self.data)
        self._write_stand(eval_mode)
        mujoco.mj_forward(self.model, self.data)
        self.prev_action[:] = 0
        self.action[:] = 0
        self.step_count = 0
        self.reward_errors = 0
        self._prev_height = float(self.data.xpos[self.torso_id, 2])
        self._reset_metrics()
        return self._obs(), {}

    def set_state(self, qpos, qvel) -> None:
        self.data.time = 0.0
        self.data.qpos[:] = qpos
        self.data.qvel[:] = qvel
        self.data.ctrl[:] = np.clip(qpos[7:], self.ctrl_low, self.ctrl_high)
        mujoco.mj_forward(self.model, self.data)
        self.prev_action[:] = 0
        self.action[:] = 0
        self.step_count = 0
        self.ever_inverted = 0.0
        self._prev_height = float(self.data.xpos[self.torso_id, 2])
        self._reset_metrics()

    def _rotation(self) -> np.ndarray:
        return self.data.xmat[self.torso_id].reshape(3, 3)

    def _state_dict(self) -> dict:
        R = self._rotation()
        up = R[:, 2]
        projected = -R[2, :].copy()
        height = float(self.data.xpos[self.torso_id, 2])
        vertical_speed = (height - self._prev_height) / spec.CTRL_DT
        self._prev_height = height
        roll = math.atan2(float(R[2, 1]), float(R[2, 2]))
        pitch = math.atan2(float(-R[2, 0]), math.sqrt(float(R[2, 1] ** 2 + R[2, 2] ** 2)))
        if float(up[2]) < -0.55:
            self.ever_inverted = 1.0
        joint_pos = self.data.qpos[7:].copy()
        joint_vel = self.data.qvel[6:].copy()
        gyro = self.data.sensordata[self.gyro_slice].copy()
        lin = self.data.sensordata[self.lin_slice].copy()
        touch = np.array([float(self.data.sensordata[s][0]) for s in self.touch_slices], dtype=np.float64)
        contact = (touch > 0.5).astype(np.float64)
        foot_speed = np.zeros(4, dtype=np.float64)
        for i, sid in enumerate(self.foot_site_ids):
            vel = np.zeros(6)
            mujoco.mj_objectVelocity(self.model, self.data, mujoco.mjtObj.mjOBJ_SITE, sid, vel, 0)
            foot_speed[i] = float(np.linalg.norm(vel[3:5]))
        torso_contact = 0.0
        for i in range(self.data.ncon):
            c = self.data.contact[i]
            if c.geom1 == self.torso_geom or c.geom2 == self.torso_geom:
                torso_contact = 1.0
                break
        phase = (self.data.time * self.freq) % 1.0 if self.freq else 0.0
        return {
            "base_lin_vel": lin,
            "base_ang_vel": gyro,
            "projected_gravity": projected,
            "torso_height": height,
            "up_z": float(up[2]),
            "roll": roll,
            "pitch": pitch,
            "joint_pos": joint_pos,
            "joint_vel": joint_vel,
            "default_pose": self.default_pose.copy(),
            "action": self.action.copy(),
            "prev_action": self.prev_action.copy(),
            "torque": self.data.actuator_force.copy(),
            "command": self.command.copy(),
            "foot_contact": contact,
            "foot_speed": foot_speed,
            "phase": phase,
            "vertical_speed": float(vertical_speed),
            "ever_inverted": float(self.ever_inverted),
            "torso_contact": torso_contact,
        }

    def _obs(self) -> np.ndarray:
        s = self._state_dict()
        # _state_dict updates vertical speed history; calling it twice per step
        # would zero that estimate. Cache the latest state for the reward.
        self._latest = s
        return spec.build_obs(
            s["projected_gravity"],
            s["base_ang_vel"],
            s["base_lin_vel"],
            s["joint_pos"] - self.default_pose,
            s["joint_vel"],
            s["prev_action"],
            s["command"],
            s["phase"],
        )

    def _reward(self, state: dict) -> float:
        try:
            value, _parts = self.reward_fn(state)
            value = float(value)
            if not math.isfinite(value):
                raise ValueError("non-finite reward")
            return float(np.clip(value, -20.0, 20.0))
        except Exception:
            self.reward_errors += 1
            return -1.0

    def _accumulate(self, state: dict, reward: float, jitter: float) -> None:
        m = self._metrics
        m["steps"] += 1
        m["reward_sum"] += reward
        m["vx_sum"] += float(state["base_lin_vel"][0])
        m["jitter_sum"] += jitter
        up = float(state["up_z"])
        m["min_up_z"] = min(m["min_up_z"], up)
        m["max_up_z"] = max(m["max_up_z"], up)
        m["min_height"] = min(m["min_height"], float(state["torso_height"]))
        if up > 0.75:
            m["upright_steps"] += 1
        if up < -0.6:
            m["inverted_steps"] += 1
        joint_speed = float(np.linalg.norm(state["joint_vel"]))
        ang_speed = float(np.linalg.norm(state["base_ang_vel"]))
        if joint_speed < 1.5 and ang_speed < 1.2:
            m["still_steps"] += 1
        if self.skill in ("walk", "trot") and (up < 0.3 or state["torso_height"] < 0.06):
            m["fell"] = 1.0

    def metrics(self) -> dict:
        m = self._metrics
        n = max(1, m["steps"])
        inverted_reached = 1.0 if m["min_up_z"] < -0.75 else float(np.clip(-m["min_up_z"], 0.0, 1.0))
        return {
            "steps": m["steps"],
            "mean_reward": m["reward_sum"] / n,
            "ep_return": m["reward_sum"],
            "mean_vx": m["vx_sum"] / n,
            "upright_fraction": m["upright_steps"] / n,
            "inverted_fraction": m["inverted_steps"] / n,
            "still_fraction": m["still_steps"] / n,
            "min_up_z": m["min_up_z"],
            "max_up_z": m["max_up_z"],
            "min_height": m["min_height"],
            "fell": m["fell"],
            "inverted_reached": inverted_reached,
            "action_jitter": m["jitter_sum"] / n,
            "reward_errors": self.reward_errors,
        }

    def task_score(self) -> float:
        m = self.metrics()
        if self.skill in ("walk", "trot"):
            target = float(self.command[0])
            tracking = math.exp(-((m["mean_vx"] - target) ** 2) / 0.12)
            score = 0.55 * m["upright_fraction"] + 0.45 * tracking - 0.4 * m["fell"]
            return float(np.clip(score, 0.0, 1.0))
        if self.skill == "play-dead":
            score = 0.55 * m["inverted_fraction"] + 0.45 * m["still_fraction"]
            return float(np.clip(score, 0.0, 1.0))
        return float(np.clip(0.65 * m["inverted_reached"] + 0.35 * m["inverted_fraction"], 0.0, 1.0))

    def step(self, action):
        action = np.clip(np.asarray(action, dtype=np.float64), -1.0, 1.0)
        jitter = float(np.sum(np.square(action - self.prev_action)))
        self.action = action
        target = self.default_pose + action * self.action_scale
        self.data.ctrl[:] = np.clip(target, self.ctrl_low, self.ctrl_high)
        for _ in range(spec.DECIMATION):
            mujoco.mj_step(self.model, self.data)
        finite = bool(np.isfinite(self.data.qpos).all() and np.isfinite(self.data.qvel).all())
        if not finite:
            state = self._latest if getattr(self, "_latest", None) else self._state_dict()
            reward = -1.0
            terminated = True
            truncated = False
            self.step_count += 1
            self._metrics["fell"] = 1.0
            info = {"metrics": self.metrics(), "task_score": self.task_score(), "reward_errors": self.reward_errors}
            obs = spec.build_obs(
                state["projected_gravity"], state["base_ang_vel"], state["base_lin_vel"],
                state["joint_pos"] - self.default_pose, state["joint_vel"], self.prev_action,
                state["command"], state["phase"],
            )
            return obs, reward, terminated, truncated, info
        state = self._state_dict()
        self._latest = state
        reward = self._reward(state)
        self._accumulate(state, reward, jitter)
        self.prev_action = action.copy()
        self.step_count += 1
        fell = False
        if self.skill in ("walk", "trot"):
            fell = state["up_z"] < 0.28 or state["torso_height"] < 0.055
        terminated = bool(fell)
        truncated = bool(self.step_count >= self.max_steps and not terminated)
        obs = spec.build_obs(
            state["projected_gravity"],
            state["base_ang_vel"],
            state["base_lin_vel"],
            state["joint_pos"] - self.default_pose,
            state["joint_vel"],
            self.prev_action,
            state["command"],
            state["phase"],
        )
        info = {
            "metrics": self.metrics(),
            "task_score": self.task_score(),
            "reward_errors": self.reward_errors,
        }
        return obs, reward, terminated, truncated, info

    def apply_targets(self, targets) -> None:
        """One control step toward absolute joint targets. Used by scripted probes."""
        targets = np.clip(np.asarray(targets, dtype=np.float64), self.ctrl_low, self.ctrl_high)
        residual = (targets - self.default_pose) / self.action_scale
        action = np.clip(residual, -1.0, 1.0)
        jitter = float(np.sum(np.square(action - self.prev_action)))
        self.action = action
        self.data.ctrl[:] = targets
        for _ in range(spec.DECIMATION):
            mujoco.mj_step(self.model, self.data)
        state = self._state_dict()
        self._latest = state
        reward = self._reward(state)
        self._accumulate(state, reward, jitter)
        self.prev_action = action.copy()
        self.step_count += 1

    def close(self):
        if self._renderer is not None:
            self._renderer.close()
            self._renderer = None
