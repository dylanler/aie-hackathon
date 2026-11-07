"""Prompt shared by the Gemini and Muse reward designers."""

from __future__ import annotations

SKILL_GOAL = {
    "walk": (
        "Walk forward near 0.20 m/s in a stable diagonal gait. Stay upright "
        "(projected_gravity[2] near -1, torso_height near 0.13). Do not reward "
        "vibration, hopping in place, or falling."
    ),
    "trot": (
        "Trot or run forward near 0.40 m/s with a flight phase and a steady trunk. "
        "A slow shuffle should score worse than a clear trot. Do not reward vibration."
    ),
    "rollover": (
        "Roll from a stand onto the back. up_z goes from about +1 to about -1 "
        "(ever_inverted flips to 1). Reward completing the roll, not spinning forever."
    ),
    "play-dead": (
        "End lying still on the back: low torso_height, up_z near -1, tiny joint "
        "velocity and action. Standing back up must be penalized."
    ),
}


def build(skill: str, version: int, parent_code: str, feedback: str) -> str:
    goal = SKILL_GOAL[skill]
    feedback = (feedback or "No judge feedback yet.").strip()[:2000]
    parent = (parent_code or "").strip()[:8000]
    return f"""Write one Python reward for a 12-DoF mini quadruped MuJoCo env.
Skill: {skill}
New version: {version}
Goal: {goal}

Return ONLY a python block. Define compute_reward(s) -> tuple[float, dict].
You may import math and numpy as np. No other imports. No file IO, no classes required.
Use only these keys in s (numpy arrays unless noted):
  base_lin_vel (3,), base_ang_vel (3,), projected_gravity (3,),
  torso_height float, up_z float (+1 upright, -1 belly-up),
  roll float, pitch float,
  joint_pos (12,), joint_vel (12,), default_pose (12,),
  action (12,) in [-1, 1], prev_action (12,), torque (12,),
  command (3,) = vx, vy, yaw rate,
  foot_contact (4,) 0/1 in order FL FR RL RR, foot_speed (4,),
  phase float in [0, 1), vertical_speed float, ever_inverted float 0/1,
  torso_contact float 0/1.
Return a finite float and a small dict of component floats.
Do not reward raw action energy or joint speed by themselves. A reward hack is
a high number while the skill fails (vibrating, flipping, freezing when the
skill is to walk).

Judge feedback on the parent reward:
{feedback}

Parent reward:
```python
{parent}
```
"""
