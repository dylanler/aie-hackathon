"""Reference policy step for a Raspberry Pi. No hardware required.

Loads the ONNX file for a skill, builds one observation the same way the
simulator does, and prints the residual action plus the joint targets in
radians. Hook the printed targets to your servo driver (PCA9685 or a serial
motor board) at 50 Hz. Calibrate microseconds per radian on the real leg;
this file does not invent that scale.

Run from the repo root:

    python -m rl.firmware.pi_policy_loop --skill walk
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow `python rl/firmware/pi_policy_loop.py` and `python -m`.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rl import spec  # noqa: E402


def neutral_obs(skill: str):
    import numpy as np

    return spec.build_obs(
        projected_gravity=np.array([0.0, 0.0, -1.0]),
        base_ang_vel=np.zeros(3),
        base_lin_vel=np.zeros(3),
        joint_pos_rel=np.zeros(spec.N_JOINTS),
        joint_vel=np.zeros(spec.N_JOINTS),
        prev_action=np.zeros(spec.N_JOINTS),
        command=np.asarray(spec.COMMANDS[skill], dtype=np.float32),
        phase=0.0,
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skill", default="walk", choices=spec.SKILLS)
    parser.add_argument("--onnx", default=None)
    args = parser.parse_args(argv)
    onnx_path = Path(args.onnx) if args.onnx else spec.ROOT / spec.policy_filename(args.skill)
    if not onnx_path.exists():
        raise SystemExit(f"missing {onnx_path}. Run python -m rl export --skill {args.skill}")
    import numpy as np
    import onnxruntime as ort

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    obs = neutral_obs(args.skill).reshape(1, -1)
    action = np.asarray(session.run(None, {"obs": obs})[0][0], dtype=np.float64)
    action = np.clip(action, -1.0, 1.0)
    default = np.asarray(spec.DEFAULT_POSE[args.skill], dtype=np.float64)
    low = -np.ones(spec.N_JOINTS)
    high = np.ones(spec.N_JOINTS)
    # Joint limits live in the MJCF; this reference clip is the normalized action.
    target = default + action * spec.ACTION_SCALE
    print(f"skill={args.skill} control_hz={spec.CTRL_HZ} onnx={onnx_path.name}")
    print("action " + " ".join(f"{v:.4f}" for v in action))
    for name, angle in zip(spec.JOINTS, target):
        print(f"  {name:8s} {angle:.4f} rad")
    del low, high


if __name__ == "__main__":
    main()
