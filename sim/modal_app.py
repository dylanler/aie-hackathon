"""MuJoCo physics verifier as a Modal web endpoint (for deploys without Python, e.g. Vercel).

Deploy:   modal deploy sim/modal_app.py        (needs a Modal token: `modal token set ...`)
Then set SIM_URL=<the printed https://...modal.run URL> on the web deploy. web/lib/sim-remote.ts POSTs
{run, design, files: {"parts/x.stl": base64}} to /verify and gets {sim_verdict, sim_png?} back.
The checks are exactly sim/verify.py's; this file only moves bytes in and out.
"""
import base64
import json
import tempfile
from pathlib import Path

import modal

HERE = Path(__file__).parent

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("libgl1", "libosmesa6", "libglib2.0-0")
    .pip_install("mujoco>=3.2", "trimesh", "coacd", "numpy", "scipy", "rtree", "imageio", "fastapi[standard]")
    .add_local_file(str(HERE / "verify.py"), "/root/verify.py")
)

app = modal.App("t2r-sim-verify", image=image)


@app.function(cpu=2.0, memory=4096, timeout=300)
@modal.fastapi_endpoint(method="POST", label="t2r-sim-verify")
def verify(body: dict):
    import os
    import sys

    os.environ.setdefault("MUJOCO_GL", "osmesa")
    sys.path.insert(0, "/root")
    import verify as v  # sim/verify.py

    run = body.get("run") or {}
    design = body.get("design") or {}
    files = body.get("files") or {}
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        (root / "run.json").write_text(json.dumps(run))
        (root / "design.json").write_text(json.dumps(design))
        for rel, b64 in files.items():
            p = (root / rel).resolve()
            if not str(p).startswith(str(root.resolve())):
                continue
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(base64.b64decode(b64))
        try:
            v.verify(root)
        except Exception as e:  # report, never fake a pass
            return {"sim_verdict": None, "error": f"verifier crashed: {e}"[:300]}
        sv = root / "sim_verdict.json"
        if not sv.exists():
            return {"sim_verdict": None, "error": "verifier produced no sim_verdict.json"}
        out = {"sim_verdict": json.loads(sv.read_text())}
        png = root / "sim.png"
        if png.exists():
            out["sim_png"] = base64.b64encode(png.read_bytes()).decode()
        return out
