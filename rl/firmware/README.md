# Loading a mini-dog policy onto an ESP32 or a Raspberry Pi

The policies in this folder are 50 Hz residual joint controllers for the 12-DoF
dog in `rl/robot.xml`. They are not motor drivers. A position servo (the same
kind of PD loop the MJCF uses) has to track the joint target they emit.

Observation layout, joint order, action scale, and default poses are in
`rl/policy_spec.json`. If that file and this document disagree, trust the JSON:
`python -m rl export` rewrites it from `rl/spec.py`.

## Joint order

```
0 FL_abad   1 FL_hip   2 FL_knee
3 FR_abad   4 FR_hip   5 FR_knee
6 RL_abad   7 RL_hip   8 RL_knee
9 RR_abad  10 RR_hip  11 RR_knee
```

Positive hip pitch is the sign used in the MJCF (`axis="0 1 0"`). Center each
servo so that the stand pose in `policy_spec.json` (`default_pose_rad.walk`)
is the mechanical zero you command for walking. The play-dead policy uses a
different default pose (belly-up). Do not share one zero between those skills.

## Observation (50 floats), in order

| slice | name | notes |
|---|---|---|
| 0:3 | projected gravity | body frame. Upright is about `[0, 0, -1]`. |
| 3:6 | gyro | body frame, rad/s. |
| 6:9 | linear velocity | body frame, m/s. |
| 9:21 | joint position relative to the skill default | radians. |
| 21:33 | joint velocity × 0.1 | the 0.1 scale is `joint_vel_scale`. |
| 33:45 | previous action | the last output, in `[-1, 1]`. |
| 45:48 | command | `vx, vy, yaw rate`. Walk uses `[0.20, 0, 0]`, trot `[0.40, 0, 0]`. |
| 48:50 | sin(phase), cos(phase) | phase is `control_time * gait_freq` wrapped to `[0, 1)`. Walk and trot are 2.4 Hz. Rollover is 3.0 Hz. Play-dead uses phase 0. `gait_freq_hz` in `policy_spec.json` is the source of those numbers. |

Clip the vector to `[-10, 10]` before the network. That clip is part of the
trained observation, not an optional safety check.

## Action

The network returns 12 unbounded numbers (the Gaussian mean). Clip them to
`[-1, 1]`, then

```
q_target = default_pose + action * 0.45
```

and clip `q_target` to the MJCF joint ranges (abad ±0.65, hip −1.05 to 1.85,
knee −2.55 to −0.25). Send `q_target` to the servos at 50 Hz. If a tick is
later than about 50 ms, drop torque. Do not integrate a missed tick.

The ONNX file is the deterministic PPO action mean. The shipped
`rl/<skill>.mp4` files are rollouts of that policy. Frames are captioned
**ppo policy rollout**, and the curve field `video_label` says the same thing.
`success` is the task score of that mp4.

| skill | success | clip |
|---|---:|---|
| walk | 0.9522 | upright PPO walk |
| trot | 0.8548 | upright PPO trot |
| rollover | 0.6675 | PPO roll that reaches belly-up and does not hold |
| play-dead | 0.9843 | PPO pose that holds still and belly-up |

`python -m rl replay --skill <name>` plays the checkpoint named in the curve.
`python -m rl replay --skill <name> --controller scripted` writes a separate
open-loop mp4 captioned **open-loop controller**. A future publish uses that
open-loop clip as `<skill>.mp4` only when the policy rollout does not perform
the skill. The files next to this README are the PPO rollouts.

## Raspberry Pi

Dependencies: `onnxruntime` and `numpy` (see `rl/requirements.txt`).

```bash
python -m rl.firmware.pi_policy_loop --skill walk
```

That prints one deterministic action and the 12 target angles for a neutral
upright observation. The real loop is the same call at 50 Hz:

1. Read the IMU. Build projected gravity and gyro in the body frame. The
   simulator's IMU site is on the torso, aligned with the body axes.
2. Read the 12 joint encoders and their rates. Subtract the skill's default pose.
3. Remember the previous clipped action. Advance phase by `1/50 * freq`.
4. Run `session.run(None, {"obs": obs[None, :]})`.
5. Write the 12 targets to the servo hat.

A PCA9685 at 50 Hz is a reasonable hobby-servo bus for a mini dog. Map radians
to pulse width on the bench (a typical 180° hobby servo is roughly 500–2500 µs,
but the linkage ratio is yours). Start with the hips off the ground.

`walk.onnx`, `trot.onnx`, `rollover.onnx`, and `play-dead.onnx` are separate
files. A mode switch picks the file. On a fault, command the play-dead joint
pose (the `DEAD` angles in `rl/spec.py`) and torque off if the IMU is not the
orientation that pose expects.

## ESP32

The network is about 8k multiply-adds (50×64, 64×64, 64×12) with tanh on the
two hidden layers. That fits a float32 loop on an ESP32. ONNX Runtime does not.

`python -m rl export` writes

```
rl/firmware/include/walk_policy.h
rl/firmware/include/trot_policy.h
rl/firmware/include/rollover_policy.h
rl/firmware/include/play_dead_policy.h
```

Each header defines `policy_<skill>(const float* obs, float* action)`. Copy the
header into the firmware tree and call it from the 50 Hz control task. Build
the 50-float observation with the table above before the call, and clip the
12 outputs to `[-1, 1]` before scaling by 0.45.

```c
#include "walk_policy.h"

void control_tick(const float obs[MINI_DOG_WALK_OBS], float q_target[12]) {
    float action[MINI_DOG_WALK_ACT];
    const float default_pose[12] = { /* policy_spec.json default_pose_rad.walk */ };
    policy_walk(obs, action);
    for (int i = 0; i < 12; ++i) {
        float a = action[i];
        if (a > 1.f) a = 1.f;
        if (a < -1.f) a = -1.f;
        q_target[i] = default_pose[i] + a * 0.45f;
    }
}
```

Servo PWM still needs a per-joint calibration. Keep a hardware enable line that
the control task has to refresh. If the task stalls, the servos should go limp
rather than hold the last command.

## What not to do

Do not run the walk policy until the IMU gravity vector matches the training
frame (torso +Z up, +X toward the snout). A flipped gravity vector is read as
"I am upside down" and the residual targets will not be a gait.

Do not send these actions as torques. The MJCF actuators are position servos.
The policy's output is a joint angle residual, not a Newton-metre.
