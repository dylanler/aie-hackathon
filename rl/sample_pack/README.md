Sample RL pack for one robot run.

The core pipeline can copy this directory onto a run:

    mkdir -p data/runs/<id>/rl
    cp -a rl/sample_pack/. data/runs/<id>/rl/

manifest.json matches the frozen contract in COORDINATION.md.
A skill mp4 is a PPO policy rollout when that policy performs the skill.
Otherwise the mp4 is the open-loop clip, captioned scripted motion fallback.
success in manifest.json matches the published mp4.
