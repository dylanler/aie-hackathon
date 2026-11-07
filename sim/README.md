# sim/ — independent MuJoCo physics verifier (lane:cad-sim)

```bash
pip install -r sim/requirements.txt          # mujoco trimesh coacd scipy rtree imageio imageio-ffmpeg
MUJOCO_GL=egl python -m sim.verify data/runs/<id>   # or: python3 sim/verify.py data/runs/<id>
```

Reads only the compiled STL + run.json/design.json (part id, material, width, optional `"mating"` overrides).
It never reads the designer's SCAD or reasoning. It finds the mating features itself on the exact mesh
(mounting holes from a horizontal section, the striker channel from XZ sections across the full width),
decomposes the part with CoACD (cached in `data/runs/<id>/sim/hulls/`), builds a fixture
(door plate, M4 screws, striker on slide joints) and runs:

| check | how |
|---|---|
| `screw_access` | vertical ray from each hole seat: is the hole covered by the part itself? |
| `hole_fit` | radial gap, screw vs measured hole diameter (exact STL section) |
| `fit_penetration` / `min_clearance` | `mj_geomDistance` part hulls vs striker, screw heads, door |
| `load_hold` / `seated_displacement` | ramp the design load (default 20 N) on the striker; force at which the part moves > 0.5 mm |
| `settle_on_base` | drop 20 mm flat, final tilt (print stability) |
| `drop_settle` | drop 300 mm tilted, time to rest |

Writes `sim_verdict.json` (checks with `by:"mujoco"`), merges them into `verdict.json` (advisory unless `SIM_GATE=1`,
matching the orchestrator), `sim.png`, `sim.mp4` (EGL offscreen; skipped with `info.render_error` if no GL).

Assumed mating context (override in design.json `"mating"`): M4 screws Ø4.0, head Ø7, striker Ø6 mm, load 20 N.
