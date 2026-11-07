# The System That Gets Better — evals

The designer agent's behaviour is a versioned **skill** (`skills/vN.md`, its system prompt). The loop in `loop.ts`:

1. Runs the adopted skill on `train/*.json` (10 household-repair prompts) and `heldout/*.json` (8 different prompts), 2 samples each.
2. Every generated part is compiled to STL (OpenSCAD, wasm build) and scored with **binary, machine-checked criteria** — no LLM grades its own work:
   `compiles`, `fits_bed` (256 mm³), `bbox_min/bbox_max` (orientation-agnostic), `min_wall` (morphological opening on a voxel grid),
   `through_hole` Ø±tol (×count) and `hole_spacing` (detected from empty regions in axis projections), `volume_*`.
   A case passes only if every criterion passes.
3. Train failures (criterion + measured value + compile log) go to an improver LLM, which writes skill v(N+1) as general rules.
4. v(N+1) is run on the **held-out** set. It is **adopted only if the held-out pass rate strictly beats the current skill**; otherwise it is rolled back and the next patch starts again from the current skill.
5. Each version is recorded in `history.json` `{version, parent, trainPass, heldoutPass, adopted, diffSummary, ts, subqMean}`; per-case results in `results/vN.json`. SubQ Snap 1.1 gives an independent P(part fixes the problem) per case (`subqMean`, recorded, not used for adoption).

Run: `cd web && npx tsx ../evals/loop.ts 4` (env: `LLM_PROVIDER=muse` to force Muse; `SAMPLES`, `CONCURRENCY`).
The run-time pipeline (`web/lib/agents/orchestrator.ts`) always designs with the latest adopted skill.

`archive/runA/` holds the first run on an easier set (held-out saturated at 100%, which is why the set was made harder).

## Results (real runs, Muse Spark 1.3, Nov 7 2026)
Run B/C (current `history.json`, 20 train trials / 16 held-out trials per version):

| version | parent | train | held-out | decision |
|---|---|---|---|---|
| v1 | — | 70.0% | 68.8% | baseline, adopted |
| v2 | v1 | 90.0% | 43.8% | rolled back |
| v3 | v1 | 95.0% | 56.3% | rolled back |
| v4 | v1 | 80.0% | 50.0% | rolled back |
| v5 | v1 | 95.0% | 62.5% | rolled back |
| v6 | v1 | 80.0% | 68.8% | rolled back (tie; adoption needs a strict gain). The improver saw rolled-back patches + MuJoCo lessons from v6 on |
| v7 | v1 | 90.0% | 43.8% | rolled back |

Every patch raised the train score, and none beat v1 on held-out. That is overfitting, and the gate caught it 6 times out of 6. Noise caveat: with 16 held-out trials, one trial is 6.25 pts, so a 1–2 trial difference is within sampling noise.
Run A (`archive/runA`, easier set): v1 83.3% → v2 100% adopted → v3 tie → rolled back, v4 83.3% → rolled back.
Logs: `logs/runB.log` (v1–v5), `logs/runC.log` (v6–v7; the first v6 attempt died in a sandbox reboot and was re-run).
