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
reward prefers joint vibration over the scripted skill is flagged. Nothing
prints key material.

## Layout

| path | what it is |
|---|---|
| `robot.xml` | MJCF |
| `manifest.json` | frozen contract: robot, mjcf, skills[], firmware |
| `walk.onnx`, `trot.onnx`, `rollover.onnx`, `play-dead.onnx` | deterministic PPO means |
| `walk.mp4`, `play-dead.mp4`, … | demo videos |
| `*_policy.mp4` | the PPO checkpoint, not the scripted clip |
| `*_curve.json` | training curve, both success numbers, judge backend |
| `rewards/*.py` | adopted reward |
| `rewards/versions/` | every version |
| `rewards/history.json` | source, parent, metrics, judge |
| `firmware/README.md` | ESP32 header and Raspberry Pi ONNX loop |
| `sample_pack/` | directory the core pipeline can copy to `data/runs/<id>/rl/` |

## Videos

`success` in `manifest.json` matches the captioned mp4. When the deterministic
PPO rollout actually performs the skill, that rollout is `skill.mp4` and the
frames are captioned **ppo policy rollout**. `video_source` in the curve is
`ppo-policy`. When it does not, the mp4 stays the open-loop clip, captioned
**scripted motion fallback**, and `policy_success` is still the PPO rollout.
Standing still is not counted as a walk or a trot.

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
# Full loop: 2 reward versions per skill, short PPO, judge, ONNX, mp4s, manifest.
python -m rl demo --timesteps 8192 --candidates 2

# One skill, one reward file (rewards/walk.py), SB3 PPO.
python -m rl train --skill walk --timesteps 8192

# Design N candidates, train each, judge, adopt, export, render.
python -m rl eureka --skill walk --candidates 2 --timesteps 4096
python -m rl eureka --skill all --candidates 2 --timesteps 8192

# Re-judge the logs and frames already on disk (SubQ if SUBQ_API_KEY is set).
python -m rl judge --skill walk

# ONNX + rl/firmware/include/<skill>_policy.h from the newest checkpoint.
python -m rl export --skill walk

# Replay.
python -m rl replay --skill walk --controller scripted --out rl/walk.mp4
python -m rl replay --skill play-dead --controller scripted --out rl/play-dead.mp4
python -m rl replay --skill walk --controller policy
python -m rl replay --skill trot --controller scripted
python -m rl replay --skill rollover --controller scripted

# Continue the adopted checkpoint, or train the next local reward, then
# publish a policy mp4 only if the rollout does the skill.
python -m rl upgrade --skill play-dead --timesteps 8192 --resume
python -m rl upgrade --skill walk --timesteps 65536
```

`python -m rl demo` is the command that wrote the artifacts currently in this
directory.

## Sample pack

```bash
mkdir -p data/runs/<id>/rl
cp -a rl/sample_pack/. data/runs/<id>/rl/
```

`sample_pack/manifest.json` is the same contract the core pipeline reads.
