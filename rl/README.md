# rl — 12-DoF mini dog

Original quadruped (`robot.xml`): 12 actuated hinge joints, capsule and sphere
colliders only (MJX has no mesh-mesh collision), plus a visual body, head,
ears, snout, and tail that do not participate in contact. Not derived from
Menagerie, Unitree, or ANYmal models.

Skills: `walk`, `trot`, `rollover`, `play-dead`.

The reward loop is Eureka-shaped.

1. **Gemini 4 Argon** writes a candidate reward via the native API
   `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent`
   with header `x-goog-api-key`. AQ. keys are not sent as `Authorization: Bearer`.
2. If Gemini is unavailable, **Meta Muse** (`muse-spark-1.3`, then `muse-wonder-1.0`)
   writes it via `POST https://api.meta.ai/v1/chat/completions` with
   `Authorization: Bearer` and `META_API_KEY` or `MODEL_API_KEY`.
3. A short **PPO** burst trains each candidate. A JAX GPU with MuJoCo Playground
   installed is selected when both are visible (`rl/runtime.py`). This machine
   path is **stable-baselines3 on CPU**, and that path is what produces checkpoints.
   It does not wait on Modal.
4. **SubQ Snap 1.1** judges the candidates. `POST https://api.subq.ai/v1/systemone`
   with `Authorization: Bearer $SUBQ_API_KEY`. This is the Decisions API, not
   chat completions. The state carries every candidate's reward source and the
   full training log. Up to four PNG frames are attached. Questions:
   - `best` — `choice` — which reward to adopt
   - `gait` — `score` — how well the rollout matches the skill
   - `hacking_<id>` — `noul` — whether that reward is being hacked
5. The winner is copied to `rewards/<skill>.py`. Older versions stay in
   `rewards/versions/` and `rewards/history.json`.

If `GEMINI_API_KEY`, `META_API_KEY` / `MODEL_API_KEY`, or `SUBQ_API_KEY` are
unset, the same loop still runs. A local designer writes the next reward file
and a local judge ranks candidates from task metrics (forward speed, upright
time, rollover, stillness) rather than from the raw return. A candidate whose
reward prefers joint vibration over the scripted skill is flagged. The curve
field `judge_backend` is then `local-fallback`, and `judge_notes` says SubQ
was not called. That ranking is not a SubQ verdict, and it is not a Gemini or
Muse verdict. Nothing prints key material. `python -m rl status` shows whether
each variable is set, never the value.

## Layout

| path | what it is |
|---|---|
| `robot.xml` | MJCF |
| `manifest.json` | frozen contract: robot, mjcf, skills[], firmware |
| `walk.onnx`, `trot.onnx`, `rollover.onnx`, `play-dead.onnx` | deterministic PPO means |
| `walk.mp4`, `trot.mp4`, `rollover.mp4`, `play-dead.mp4` | shipped PPO policy rollouts |
| `walk.webm`, `trot.webm`, `rollover.webm`, `play-dead.webm` | same PPO rollouts as the mp4s, VP9, no audio. The Train player asks for these first |
| `*_policy.mp4` | same PPO rollout, replayed beside the shipped file |
| `*_openloop.mp4` | open-loop controller, written only when you ask for it |
| `*_curve.json` | training curve, success, `behavior`, `video_label`, judge backend |
| `rewards/*.py` | adopted reward |
| `rewards/versions/` | every version |
| `rewards/history.json` | source, parent, metrics, judge |
| `firmware/README.md` | ESP32 header and Raspberry Pi ONNX loop |
| `sample_pack/` | directory the core pipeline can copy to `data/runs/<id>/rl/` |

## Shipped clips

`success` in `manifest.json` is the task score of the captioned mp4, rounded
to 4 decimals. All four shipped mp4s are deterministic PPO policy rollouts.
Frames are captioned **ppo policy rollout**. Each curve has `video_source`
`ppo-policy` and `video_label` `ppo policy rollout`. `behavior` is the short
description of that same clip.

| skill | reward | success | what the mp4 shows |
|---|---|---:|---|
| walk | v5 | 0.9522 | upright walk, mean_vx 0.083862 m/s, fell 0 |
| trot | v3 | 0.8548 | upright trot, mean_vx 0.191325 m/s, upright_fraction 0.985, fell 0 |
| rollover | v5 | 0.6675 | reaches belly-up (inverted_reached 1, min_up_z -0.999266) and does not hold (inverted_fraction 0.05) |
| play-dead | v2 | 0.9843 | holds a still belly-up pose (inverted_fraction 1, still_fraction 0.965) |

Rollover's 0.6675 is the policy rollout. The open-loop controller on the same
robot scores 0.8644 and is a different video. Walk's open-loop score is
0.9731, trot's is 0.8930, and play-dead's is 0.6944. Those numbers live in
`scripted_success`. They are not `success`.

Standing still is not counted as a walk or a trot. A future publish writes an
open-loop clip, captioned **open-loop controller**, only when that policy
rollout does not perform the skill. The files in this directory are the PPO case.

## Setup

From the repo root. A CPU wheel of PyTorch is enough. The CUDA wheel is not required.

```bash
python3 -m venv rl/.venv
source rl/.venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r rl/requirements.txt
export MUJOCO_GL=egl          # osmesa also works headless; glfw if you have a display
# optional, not required to produce the demo videos:
# export GEMINI_API_KEY=...
# export GEMINI_MODEL=gemini-4-argon
# export META_API_KEY=...     # or MODEL_API_KEY
# export META_MODEL=muse-spark-1.3
# export SUBQ_API_KEY=...
```

## Commands

```bash
python -m rl            # help, including the replay and handoff examples

# What shipped, which keys are set (never the values), and whether sample_pack matches.
python -m rl status

# Replay the adopted PPO policy. The checkpoint comes from the curve
# (walk_v5, trot_v3, rollover_v5, play_dead_v2), not from v1.
python -m rl replay --skill walk
python -m rl replay --skill trot
python -m rl replay --skill rollover
python -m rl replay --skill play-dead

# Open-loop comparison. Writes rl/<skill>_openloop.mp4 and leaves the shipped mp4 in place.
python -m rl replay --skill rollover --controller scripted

# Files Hark copies onto web/public/rl/ after merge: four mp4s, four webms, manifest, four curves.
# This command does not write under web/. The webms are already built, so ffmpeg is not required.
python -m rl handoff
python -m rl handoff --pack /tmp/rl-public
# --webm transcodes only when a prebuilt <skill>.webm is missing.
python -m rl handoff --pack /tmp/rl-public --webm
python -m rl handoff --sync-sample-pack --check

# Full loop: 2 reward versions per skill, short PPO, judge, ONNX, mp4s, manifest.
python -m rl demo --timesteps 8192 --candidates 2

# One skill, one reward file (rewards/walk.py), SB3 PPO.
python -m rl train --skill walk --timesteps 8192

# Design N candidates, train each, judge, adopt, export, render.
python -m rl eureka --skill walk --candidates 2 --timesteps 4096
python -m rl eureka --skill all --candidates 2 --timesteps 8192

# Re-judge the logs and frames already on disk (SubQ if SUBQ_API_KEY is set).
python -m rl judge --skill walk

# ONNX + rl/firmware/include/<skill>_policy.h from the adopted checkpoint.
python -m rl export --skill walk

# Continue the adopted checkpoint, or train the next local reward, then
# publish a policy mp4 when the rollout performs the skill.
python -m rl upgrade --skill play-dead --timesteps 8192 --resume
python -m rl upgrade --skill walk --timesteps 65536
```

`python -m rl demo` is the command that first wrote this directory. The mp4s
that ship now are later PPO rollouts of those adopted rewards. Replay reads
`policy_checkpoint` in the curve, so it follows the shipped policy even when
older zips such as `walk_v1.zip` are still in `checkpoints/`.

## Train screen handoff

Hark owns `web/`. The RL lane does not edit it. After this branch merges, the
Train screen still has the previous curves (`video_label` from that older
publish) until someone copies the new files. The player requests `<skill>.webm`
before `<skill>.mp4`. The webms already in `web/public/rl/` are the older
scripted/open-loop clips. Replace them with `walk.webm`, `trot.webm`,
`rollover.webm`, and `play-dead.webm` from this directory. Those files are VP9
transcodes of the shipped PPO mp4s (no audio): the same trained-policy videos,
captioned **ppo policy rollout**. Leaving the old webms in place keeps the
previous picture on screen under the new caption.

```bash
python -m rl handoff
python -m rl handoff --pack /tmp/rl-public
```

The pack is `manifest.json`, `walk.mp4`, `trot.mp4`, `rollover.mp4`,
`play-dead.mp4`, `walk.webm`, `trot.webm`, `rollover.webm`, `play-dead.webm`,
and the four `*_curve.json` files, plus `LABELS.md`. ffmpeg is not required.
`--webm` transcodes a webm only when the prebuilt file is missing.

`LABELS.md` is the sheet for the Train labels: pill percents are
`round(success * 100)` (walk 95, trot 85, rollover 67, play-dead 98), the
overlay reads `video_label` (`ppo policy rollout`), and the judge line is the
local judge. Rollover stays 67% because the policy reaches belly-up and does
not hold it.

## Sample pack

```bash
mkdir -p data/runs/<id>/rl
cp -a rl/sample_pack/. data/runs/<id>/rl/
python -m rl handoff --sync-sample-pack
```

`sample_pack/manifest.json` is the same contract the core pipeline reads.
The sample pack also carries the four PPO webms, because `python -m rl handoff`
keeps `sample_pack/` aligned with the published Train files. Those webms are
the same trained clips Hark should copy over the older ones in `web/public/rl/`.
`python -m rl handoff --check` exits 1 if those published files drift from
`rl/`.
