Sample RL pack for one robot run.

The core pipeline can copy this directory onto a run:

    mkdir -p data/runs/<id>/rl
    cp -a rl/sample_pack/. data/runs/<id>/rl/

manifest.json matches the frozen contract in COORDINATION.md.
success is the task score of the mp4 next to it.

The skill mp4s in this pack are the published clips. Read `behavior` in each curve
for what that clip does. `video_label` is the caption burned into the frames.

| skill | success | video_label | behavior |
|---|---:|---|---|
| walk | 0.9522 | ppo policy rollout | PPO policy rollout. Walks upright (mean_vx 0.083862 m/s, upright_fraction 1, fell 0). success 0.9522 is the task score of this mp4. The open-loop controller scored 0.9731 on the same robot and is a different video. |
| trot | 0.8548 | ppo policy rollout | PPO policy rollout. Trots upright (mean_vx 0.191325 m/s, upright_fraction 0.985, fell 0). success 0.8548 is the task score of this mp4. The open-loop controller scored 0.8930 on the same robot and is a different video. |
| rollover | 0.6675 | ppo policy rollout | PPO policy rollout. Reaches belly-up (inverted_reached 1, min_up_z -0.999266) but does not hold (inverted_fraction 0.05). success 0.6675 is the task score of this mp4. The open-loop controller scored 0.8644 on the same robot and is a different video. |
| play-dead | 0.9843 | ppo policy rollout | PPO policy rollout. Holds a still belly-up pose (inverted_fraction 1, still_fraction 0.965). success 0.9843 is the task score of this mp4. The open-loop controller scored 0.6944 on the same robot and is a different video. |

Judge backend on these curves is whatever `judge_backend` says.
local-fallback means SUBQ_API_KEY was unset and SubQ was not called.
That ranking is not a SubQ verdict, and it is not a Gemini or Muse verdict.

List or package the Train-screen copies (mp4s, manifest, curves) with:

    python -m rl handoff
    python -m rl handoff --pack /tmp/rl-public
