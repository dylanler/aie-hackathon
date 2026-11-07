Sample RL pack for one robot run.

The core pipeline can copy this directory onto a run:

    mkdir -p data/runs/<id>/rl
    cp -a rl/sample_pack/. data/runs/<id>/rl/

manifest.json matches the frozen contract in COORDINATION.md.
Walk and play-dead videos are captioned scripted-motion fallbacks when
the short PPO burst has not learned the gait yet.
