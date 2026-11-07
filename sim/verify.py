"""Independent MuJoCo physics verifier for a Thought-to-Reality run.

Usage:
    python -m sim.verify data/runs/<id>          (or: python3 sim/verify.py data/runs/<id>)

Independence: this never reads the designer's reasoning or SCAD. It reads only the
compiled STL(s), run.json/design.json for part ids, material and the *mating context*
(e.g. M4 mounting screws, a striker), finds the mating features itself from the mesh
(through-holes by ray scan, the hook pocket by section scan), builds its own fixture,
and measures. Every number written is a simulator / geometry output.

Checks (all by:"mujoco"):
  fit_penetration      max penetration depth part vs fixture at the nominal pose (mm)
  min_clearance        min gap part vs screws + striker, via mj_geomDistance (mm)
  load_hold            apply design load to the striker; part must stay seated (N, with
                       part displacement + striker escape recorded)
  settle_on_base       drop part 20 mm onto a plate in print orientation; final tilt (deg)
  drop_settle          drop from 300 mm at a tilted angle; comes to rest (s)
Outputs: sim_verdict.json, merged into verdict.json (contract), sim.png, sim.mp4.
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("MUJOCO_GL", "egl")

import numpy as np
import trimesh
import mujoco

MM = 0.001  # model is built in metres; the STL is in mm
DENSITY = {"PETG": 1270, "PLA": 1240, "ABS": 1040, "TPU": 1210, "NYLON": 1140, "ASA": 1070}

# Mating-context defaults. Overridable via design.json -> "mating": {...}
DEFAULTS = {
    "screw_d_mm": 4.0,          # M4 major diameter
    "screw_head_d_mm": 7.0,     # M4 pan head
    "striker_d_mm": 6.0,        # assumed freezer striker pin diameter (no source; override in design.json)
    "load_N": 20.0,             # door-pull load on the latch
    "seat_tol_mm": 0.5,         # max allowed part displacement under load
    "clearance_min_mm": 0.05,   # gap must be >= this (no interference)
    "penetration_tol_mm": 0.05, # allowed numerical penetration at nominal pose
}


# ---------------------------------------------------------------- geometry
def find_through_holes(mesh: trimesh.Trimesh, res=0.25):
    """Mounting holes: enclosed empty regions in a horizontal slice 1 mm above the part's
    bottom face (so holes hidden under an overhang are still found)."""
    from scipy import ndimage
    lo, hi = mesh.bounds
    z = lo[2] + min(1.0, (hi[2] - lo[2]) / 4)
    xs = np.arange(lo[0] + res / 2, hi[0], res)
    ys = np.arange(lo[1] + res / 2, hi[1], res)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    inside = mesh.contains(np.c_[X.ravel(), Y.ravel(), np.full(X.size, z)]).reshape(X.shape)
    lab, n = ndimage.label(~inside)
    holes = []
    for k in range(1, n + 1):
        cells = np.argwhere(lab == k)
        if (cells[:, 0].min() == 0 or cells[:, 1].min() == 0 or
                cells[:, 0].max() == X.shape[0] - 1 or cells[:, 1].max() == X.shape[1] - 1):
            continue  # touches the border: outside, not a hole
        d = 2 * math.sqrt(len(cells) * res * res / math.pi)
        if d < 1.0:
            continue
        holes.append({"x": float(xs[cells[:, 0]].mean()), "y": float(ys[cells[:, 1]].mean()), "d_mm": float(d)})
    return holes


def hole_access(mesh, h, top_z):
    """Is there a straight vertical path for the screw + driver above the hole?
    Returns the height of the first obstruction above the seat (None = clear)."""
    r = h["d_mm"] / 2 * 0.9
    origins, dirs = [], []
    for a in np.linspace(0, 2 * math.pi, 12, endpoint=False):
        for rr in (0.0, r):
            origins.append([h["x"] + rr * math.cos(a), h["y"] + rr * math.sin(a), top_z + 0.05])
            dirs.append([0, 0, 1.0])
    locs, idx, _ = mesh.ray.intersects_location(np.array(origins), np.array(dirs), multiple_hits=False)
    if len(locs) == 0:
        return None
    return float(locs[:, 2].min() - top_z)


def find_hook_pocket(mesh: trimesh.Trimesh, holes, width_mm=None, res=0.25):
    """Largest empty circle in the XZ plane that is free across the whole engagement width
    (every Y slice) and has material directly above and below it: the striker channel
    under a hook. Width = design width if given, else the part's Y extent."""
    from scipy import ndimage
    lo, hi = mesh.bounds
    yc = float(np.mean([h["y"] for h in holes])) if holes else float((lo[1] + hi[1]) / 2)
    if width_mm:
        y_lo, y_hi = yc - width_mm / 2, yc + width_mm / 2
    else:
        y_lo, y_hi = float(lo[1]), float(hi[1])
    xs = np.arange(lo[0] + res / 2, hi[0], res)
    zs = np.arange(lo[2] + res / 2, hi[2], res)
    X, Z = np.meshgrid(xs, zs, indexing="ij")
    inside = np.zeros(X.shape, bool)
    for y in np.linspace(y_lo + 0.1, y_hi - 0.1, max(3, int((y_hi - y_lo) / 0.5))):
        inside |= mesh.contains(np.c_[X.ravel(), np.full(X.size, y), Z.ravel()]).reshape(X.shape)
    above = np.flip(np.cumsum(np.flip(inside, 1), 1), 1) - inside > 0
    below = np.cumsum(inside, 1) - inside > 0
    pocket = (~inside) & above & below
    if not pocket.any():
        return None
    dist = ndimage.distance_transform_edt(~inside) * res
    dist = np.where(pocket, dist, 0)
    i, k = np.unravel_index(np.argmax(dist), dist.shape)
    return {"x": float(xs[i]), "y": yc, "z": float(zs[k]), "r_in_mm": float(dist[i, k]),
            "y_span": [float(y_lo), float(y_hi)]}


def decompose(mesh: trimesh.Trimesh, cache: Path, threshold=0.015):
    cache.mkdir(parents=True, exist_ok=True)
    files = sorted(cache.glob("hull_*.stl"))
    stamp = cache / "source.json"
    key = {"faces": int(len(mesh.faces)), "volume": round(float(mesh.volume), 3), "threshold": threshold, "v": 2}
    if files and stamp.exists() and json.loads(stamp.read_text()) == key:
        return files
    for f in files:
        f.unlink()
    import coacd
    coacd.set_log_level("error")
    parts = coacd.run_coacd(coacd.Mesh(mesh.vertices, mesh.faces), threshold=threshold, resolution=2000,
                            preprocess_mode="off" if mesh.is_watertight else "auto", max_convex_hull=-1, seed=0)
    out = []
    for i, (v, f) in enumerate(parts):
        p = cache / f"hull_{i:03d}.stl"
        trimesh.Trimesh(v, f).export(p)
        out.append(p)
    stamp.write_text(json.dumps(key))
    return out


# ---------------------------------------------------------------- scene
def build_xml(hull_files, ctx, mass_kg, com, mode, part_pos=(0, 0, 0), part_quat=(1, 0, 0, 0)):
    """mode: 'fixture' (door + screws + striker) or 'floor' (part alone on a plate)."""
    assets = "\n".join(f'<mesh name="h{i}" file="{p.resolve()}" scale="{MM} {MM} {MM}"/>'
                       for i, p in enumerate(hull_files))
    vol = ctx["hull_vol_total"]
    part_geoms = "\n".join(
        f'<geom name="part_{i}" type="mesh" mesh="h{i}" rgba="0.95 0.55 0.2 1" mass="{mass_kg * ctx["hull_vols"][i] / vol:.8f}" '
        f'contype="1" conaffinity="2" condim="4" friction="0.5 0.01 0.001" solref="0.002 1" solimp="0.95 0.99 0.0001"/>'
        for i in range(len(hull_files)))
    fixtures = ""
    striker = ""
    if mode == "fixture":
        zlo = ctx["zmin"]
        fixtures += (f'<geom name="door" type="box" pos="0 0 {(zlo - 2) * MM}" size="0.06 0.06 {2 * MM}" '
                     f'rgba="0.82 0.84 0.86 1" contype="2" conaffinity="1"/>')
        for j, h in enumerate(ctx["holes"]):
            r = ctx["screw_d_mm"] / 2
            top = ctx["base_top_mm"]
            fixtures += (f'<geom name="screw_{j}" type="cylinder" pos="{h["x"] * MM} {h["y"] * MM} {(zlo + top) / 2 * MM}" '
                         f'size="{r * MM} {(top - zlo) / 2 * MM}" rgba="0.55 0.57 0.6 1" contype="0" conaffinity="0"/>')
            if h.get("obstruction_above_mm") is not None and h["obstruction_above_mm"] < 25:
                continue  # screw cannot be installed: no head, part is held by the other screw(s)
            fixtures += (f'<geom name="screwhead_{j}" type="cylinder" pos="{h["x"] * MM} {h["y"] * MM} {(top + 1.4) * MM}" '
                         f'size="{ctx["screw_head_d_mm"] / 2 * MM} {1.4 * MM}" rgba="0.55 0.57 0.6 1" contype="2" conaffinity="1"/>')
        if ctx.get("pocket"):
            pk = ctx["pocket"]
            half = (pk["y_span"][1] - pk["y_span"][0]) / 2
            yc = (pk["y_span"][1] + pk["y_span"][0]) / 2
            striker = (f'<body name="striker" pos="{pk["x"] * MM} {yc * MM} {pk["z"] * MM}">'
                       f'<joint name="striker_slide_x" type="slide" axis="1 0 0" damping="0.5"/>'
                       f'<joint name="striker_slide_z" type="slide" axis="0 0 1" damping="0.5"/>'
                       f'<geom name="striker" type="cylinder" euler="90 0 0" size="{ctx["striker_d_mm"] / 2 * MM} {half * MM}" '
                       f'mass="0.02" rgba="0.3 0.45 0.75 1" contype="2" conaffinity="1" condim="4" solref="0.002 1" solimp="0.95 0.99 0.0001"/>'
                       f'</body>')
    else:
        fixtures += '<geom name="floor" type="plane" size="0.3 0.3 0.01" rgba="0.82 0.84 0.86 1" contype="2" conaffinity="1"/>'
    return f"""<mujoco model="t2r_verify">
<compiler angle="degree" autolimits="true"/>
<option timestep="0.0002" gravity="0 0 -9.81" integrator="implicitfast" cone="elliptic">
  <flag filterparent="disable"/></option>
<visual><global offwidth="960" offheight="720"/><quality shadowsize="2048"/>
  <headlight ambient="0.45 0.45 0.45" diffuse="0.5 0.5 0.5"/></visual>
<asset>{assets}</asset>
<worldbody>
<light pos="0.05 -0.1 0.25" dir="-0.2 0.4 -1" diffuse="0.6 0.6 0.6"/>
{fixtures}
<body name="part" pos="{part_pos[0]} {part_pos[1]} {part_pos[2]}" quat="{' '.join(map(str, part_quat))}">
<freejoint name="part_free"/>
{part_geoms}
</body>
{striker}
</worldbody>
</mujoco>"""


def part_geom_ids(m):
    return [i for i in range(m.ngeom) if (m.geom(i).name or "").startswith("part_")]


def geom_dist(m, d, g1, g2, distmax=0.01):
    ft = np.zeros(6)
    return mujoco.mj_geomDistance(m, d, g1, g2, distmax, ft)


# ---------------------------------------------------------------- render
class Cam:
    def __init__(self, m, w=640, h=480):
        try:
            self.r = mujoco.Renderer(m, h, w)
        except Exception as e:  # no GL available
            self.r = None
            self.err = str(e)
        self.cam = mujoco.MjvCamera()
        self.cam.lookat[:] = [0, -0.005, 0.006]
        self.cam.distance = 0.13
        self.cam.azimuth = -125
        self.cam.elevation = -28

    def frame(self, d):
        if self.r is None:
            return None
        self.r.update_scene(d, self.cam)
        return self.r.render()


# ---------------------------------------------------------------- main
def verify(run_dir: Path):
    t0 = time.time()
    run = json.loads((run_dir / "run.json").read_text())
    design = json.loads((run_dir / "design.json").read_text()) if (run_dir / "design.json").exists() else {}
    ctx = dict(DEFAULTS)
    ctx.update(design.get("mating", {}) or {})
    parts = [p for p in run.get("parts", []) if p.get("stl") and (run_dir / p["stl"]).exists()]
    if not parts:
        raise SystemExit("no compiled STL in run")
    part = parts[0]  # static kinds are single-part today; extra parts are noted
    mesh = trimesh.load(run_dir / part["stl"], force="mesh")
    material = (part.get("material") or "PETG").upper()
    mass = float(mesh.volume) * 1e-9 * DENSITY.get(material, 1200)

    holes = find_through_holes(mesh)
    lo, hi = mesh.bounds
    ctx["zmin"] = float(lo[2])
    # top of the base plate at the holes = first material hit from above near each hole rim
    if holes:
        tops = []
        for h in holes:
            r = h["d_mm"] / 2 + 0.75
            zs = np.arange(lo[2] + 0.05, hi[2], 0.05)
            for a in (0, math.pi / 2, math.pi, 1.5 * math.pi):
                col = mesh.contains(np.c_[np.full(zs.size, h["x"] + r * math.cos(a)), np.full(zs.size, h["y"] + r * math.sin(a)), zs])
                if col[0]:
                    gap = np.argmin(col)  # first empty above the base
                    tops.append(float(zs[gap - 1] + 0.025) if gap > 0 else float(hi[2]))
        tops = [t for t in tops if t < lo[2] + 0.5 * (hi[2] - lo[2])] or tops
        ctx["base_top_mm"] = float(np.min(tops)) if tops else float(lo[2] + 3)
        for h in holes:
            h["obstruction_above_mm"] = hole_access(mesh, h, ctx["base_top_mm"])
    ctx["holes"] = holes
    width = None
    for pp in [part.get("params") or {}] + [(dp.get("params") or {}) for dp in design.get("parts", []) if dp.get("id") == part["id"]]:
        width = width or pp.get("overall_width_mm")
    pocket = find_hook_pocket(mesh, holes, width)
    ctx["pocket"] = pocket
    if pocket and ctx["striker_d_mm"] / 2 > pocket["r_in_mm"]:
        ctx["striker_note"] = f"striker Ø{ctx['striker_d_mm']} mm larger than pocket (Ø{2 * pocket['r_in_mm']:.2f} mm)"

    hulls = decompose(mesh, run_dir / "sim" / "hulls")
    hv = [float(trimesh.load(p, force="mesh").convex_hull.volume) for p in hulls]
    ctx["hull_vols"], ctx["hull_vol_total"] = hv, sum(hv)

    checks, info = [], {"holes": holes, "pocket": pocket, "n_convex_hulls": len(hulls),
                        "hull_volume_mm3": round(sum(hv), 1), "mesh_volume_mm3": round(float(mesh.volume), 1),
                        "mass_g": round(mass * 1000, 2), "material": material,
                        "assumptions": {k: ctx[k] for k in DEFAULTS}}
    frames, still = [], None
    has_fixture = bool(holes or pocket)

    # ---------- 0. screw access (pure geometry on the exact STL)
    if holes:
        blocked = [h for h in holes if h["obstruction_above_mm"] is not None and h["obstruction_above_mm"] < 25]
        worst = min([h["obstruction_above_mm"] for h in blocked], default=None)
        checks.append({"name": "screw_access", "pass": not blocked, "value": f"{len(holes) - len(blocked)}/{len(holes)}",
                       "unit": "holes", "by": "mujoco",
                       "detail": ("clear vertical path to every mounting hole" if not blocked else
                                  f"{len(blocked)} hole(s) covered by the part itself {worst:.1f} mm above the seat — screw/driver cannot reach")})

    # ---------- 1+2. fit & load in the fixture scene
    if has_fixture:
        m = mujoco.MjModel.from_xml_string(build_xml(hulls, ctx, mass, None, "fixture"))
        d = mujoco.MjData(m)
        mujoco.mj_forward(m, d)
        pg = part_geom_ids(m)
        fx = {n: m.geom(n).id for n in [m.geom(i).name for i in range(m.ngeom)]
              if n.startswith("screw_") or n == "striker"}
        seat = {n: m.geom(n).id for n in [m.geom(i).name for i in range(m.ngeom)]
                if n.startswith("screwhead_") or n == "door"}
        pen, clr, per = 0.0, 1e9, {}
        for name, g in {**fx, **seat}.items():
            if name.startswith("screw_"):
                continue  # shank-in-hole is sub-hull-error; measured on the exact mesh below
            dmin = min(geom_dist(m, d, p, g) for p in pg) / MM
            per[name] = round(dmin, 3)
            pen = max(pen, -dmin)
            if name in fx:
                clr = min(clr, dmin)
        info["nominal_distance_mm"] = per
        hole_gap = min([(h["d_mm"] - ctx["screw_d_mm"]) / 2 for h in holes], default=None)
        info["hole_radial_clearance_mm"] = None if hole_gap is None else round(hole_gap, 3)
        if hole_gap is not None:
            checks.append({"name": "hole_fit", "pass": hole_gap >= 0, "value": round(hole_gap, 3), "unit": "mm", "by": "mujoco",
                           "detail": f"radial gap, M{ctx['screw_d_mm']:g} screw in measured Ø{min(h['d_mm'] for h in holes):.2f} hole (exact STL section)"})
        if clr > 1e8:
            clr = None
        checks.append({"name": "fit_penetration", "pass": pen <= ctx["penetration_tol_mm"],
                       "value": round(pen, 3), "unit": "mm", "by": "mujoco",
                       "detail": "max penetration vs striker, screw heads, door (mj_geomDistance on CoACD hulls)"})
        if clr is not None:
            checks.append({"name": "min_clearance", "pass": clr >= ctx["clearance_min_mm"],
                           "value": round(clr, 3), "unit": "mm", "by": "mujoco",
                           "detail": f"part vs Ø{ctx['striker_d_mm']:g} mm striker across the full engagement width (mj_geomDistance)"})

        # load scene: if the nominal striker interferes, test retention with the largest striker
        # that fits (best case) so the load result is about holding, not the overlap.
        load_ctx = dict(ctx)
        if pocket and ctx["striker_d_mm"] / 2 > pocket["r_in_mm"] - 0.15:
            load_ctx["striker_d_mm"] = round(2 * (pocket["r_in_mm"] - 0.15), 2)
            info["load_striker_d_mm"] = load_ctx["striker_d_mm"]
        m = mujoco.MjModel.from_xml_string(build_xml(hulls, load_ctx, mass, None, "fixture"))
        d = mujoco.MjData(m)
        mujoco.mj_forward(m, d)
        # load: settle 0.15 s, then ramp the striker pull to load_N over 0.1 s, hold 0.25 s
        cam = Cam(m)
        part_b = m.body("part").id
        p0 = None
        sb = m.body("striker").id if pocket else None
        s0 = None
        max_disp, steps = 0.0, 0
        T_settle, T_ramp, T_hold = 0.15, 0.10, 0.25
        n = int((T_settle + T_ramp + T_hold) / m.opt.timestep)
        fps_every = max(1, int((1 / 60) / m.opt.timestep))
        f_now, f_fail, t_fail = 0.0, None, None
        for k in range(n):
            t = d.time
            if t_fail is not None and t - t_fail > 0.05:
                break  # failed: keep 50 ms of the failure for the video, then stop
            if p0 is not None and f_fail is None and max_disp > ctx["seat_tol_mm"]:
                f_fail, t_fail = f_now, t
            if sb is not None:
                f = 0.0 if t < T_settle else ctx["load_N"] * min(1.0, (t - T_settle) / T_ramp)
                d.xfrc_applied[sb, 2] = f
                f_now = f
            mujoco.mj_step(m, d)
            if p0 is None and t >= T_settle - 1e-9:
                p0 = d.xpos[part_b].copy()
                s0 = d.xpos[sb].copy() if sb is not None else None
            if p0 is not None:
                max_disp = max(max_disp, float(np.linalg.norm(d.xpos[part_b] - p0)) / MM)
            if k % fps_every == 0:
                fr = cam.frame(d)
                if fr is not None:
                    frames.append(fr)
        settle_disp = float(np.linalg.norm(d.xpos[part_b] - np.zeros(3))) / MM
        if sb is not None:
            s_end = d.xpos[sb]
            striker_dz = float(s_end[2] - s0[2]) / MM
            # retained = striker still under the hook (pocket top) and not slid out of the mouth
            retained = bool(s_end[2] / MM < pocket["z"] + pocket["r_in_mm"] + 0.5 and abs(s_end[0] / MM - pocket["x"]) < pocket["r_in_mm"] + 2)
            info["load"] = {"striker_travel_mm": round(striker_dz, 3), "striker_retained": retained,
                            "part_max_disp_under_load_mm": round(max_disp, 3),
                            "part_disp_from_nominal_mm": round(settle_disp, 3),
                            "contacts_at_end": int(d.ncon)}
            ok = retained and f_fail is None
            held = ctx["load_N"] if ok else round(f_fail or 0.0, 2)
            info["load"]["force_at_unseat_N"] = None if f_fail is None else round(f_fail, 2)
            checks.append({"name": "load_hold", "pass": ok, "value": held, "unit": "N", "by": "mujoco",
                           "detail": (f"held {ctx['load_N']:g} N pull on Ø{load_ctx['striker_d_mm']:g} mm striker; part moved {max_disp:.3f} mm"
                                      if ok else f"part unseated (> {ctx['seat_tol_mm']} mm) at {held} N of the {ctx['load_N']:g} N door pull; striker retained={retained}")})
            checks.append({"name": "seated_displacement", "pass": f_fail is None, "value": round(min(max_disp, 99.0), 3) if f_fail is None else f">{ctx['seat_tol_mm']}",
                           "unit": "mm", "by": "mujoco"})
        if frames:
            still = frames[-1]

    # ---------- 3. settle in print orientation and tilted drop
    m2 = mujoco.MjModel.from_xml_string(build_xml(hulls, ctx, mass, None, "floor",
                                                  part_pos=(0, 0, (20 - lo[2]) * MM)))
    d2 = mujoco.MjData(m2)
    b2 = m2.body("part").id
    cam2 = Cam(m2)
    fps_every = max(1, int((1 / 60) / m2.opt.timestep))
    for k in range(int(0.6 / m2.opt.timestep)):
        mujoco.mj_step(m2, d2)
        if k % fps_every == 0:
            fr = cam2.frame(d2)
            if fr is not None:
                frames.append(fr)
    zaxis = d2.xmat[b2].reshape(3, 3)[:, 2]
    tilt = math.degrees(math.acos(max(-1, min(1, zaxis[2]))))
    checks.append({"name": "settle_on_base", "pass": tilt < 2.0, "value": round(tilt, 3), "unit": "deg", "by": "mujoco",
                   "detail": "dropped 20 mm flat; must rest on its base (printable, stable)"})

    q = trimesh.transformations.quaternion_from_euler(math.radians(35), math.radians(20), 0)
    m3 = mujoco.MjModel.from_xml_string(build_xml(hulls, ctx, mass, None, "floor",
                                                  part_pos=(0, 0, 0.3), part_quat=tuple(q)))
    d3 = mujoco.MjData(m3)
    b3 = m3.body("part").id
    rest_t, still_since = None, None
    for k in range(int(3.0 / m3.opt.timestep)):
        mujoco.mj_step(m3, d3)
        v = float(np.linalg.norm(d3.qvel[:6]))
        if d3.time > 0.3 and v < 1e-3:
            still_since = still_since or d3.time
            if d3.time - still_since > 0.2:
                rest_t = still_since
                break
        else:
            still_since = None
    checks.append({"name": "drop_settle", "pass": rest_t is not None, "value": round(rest_t, 3) if rest_t else None,
                   "unit": "s", "by": "mujoco", "detail": "dropped 300 mm tilted 35°/20°; time to come to rest"})
    info["drop_final_z_mm"] = round(float(d3.xpos[b3][2]) / MM, 2)

    # ---------- outputs
    rendered, video = False, False
    try:
        import imageio.v2 as imageio
        if still is None and frames:
            still = frames[-1]
        if still is not None:
            imageio.imwrite(run_dir / "sim.png", still)
            rendered = True
        if frames:
            imageio.mimwrite(run_dir / "sim.mp4", frames, fps=30, macro_block_size=8)
            video = True
    except Exception as e:  # rendering unavailable
        info["render_error"] = str(e)[:200]

    core = [c for c in checks]
    sim_pass = all(c["pass"] for c in core)
    fails = [c["name"] for c in core if not c["pass"]]
    sim = {"pass": sim_pass, "by": "mujoco", "mujoco_version": mujoco.__version__, "part": part["id"],
           "checks": checks, "render": "sim.png" if rendered else None, "video": "sim.mp4" if video else None,
           "notes": ("MuJoCo: all %d physics checks pass" % len(checks)) if sim_pass else ("MuJoCo failed: " + ", ".join(fails)),
           "info": info, "elapsed_s": round(time.time() - t0, 1)}
    if len(parts) > 1:
        sim["notes"] += f" (only part '{part['id']}' simulated of {len(parts)})"
    (run_dir / "sim_verdict.json").write_text(json.dumps(sim, indent=2))

    # merge into verdict.json per contract: replace previous mujoco checks, keep the rest
    vp = run_dir / "verdict.json"
    v = json.loads(vp.read_text()) if vp.exists() else {"pass": True, "checks": []}
    keep = [c for c in v.get("checks", []) if c.get("by") != "mujoco" and not str(c.get("name", "")).startswith("sim:")]
    # Same policy as the core orchestrator: physics gates the verdict only when SIM_GATE=1,
    # otherwise the MuJoCo checks are merged as advisory (still visible, pass/fail kept).
    gate = os.environ.get("SIM_GATE") == "1"
    v["checks"] = keep + [dict(c, advisory=not gate) if not gate else c for c in checks]
    v["sim_gate"] = gate
    gating = [c for c in v["checks"] if not c.get("advisory")]
    v["pass"] = all(c.get("pass") for c in gating)
    v["sim"] = True
    v["sim_verdict"] = "sim_verdict.json"
    v["sim_render"] = sim["render"]
    v["sim_video"] = sim["video"]
    base_note = (v.get("notes") or "").split(" | MuJoCo")[0]
    v["notes"] = (base_note + " | " + sim["notes"]).strip(" |")
    vp.write_text(json.dumps(v, indent=2))
    return sim


def main(argv=None):
    argv = argv or sys.argv[1:]
    if not argv:
        print(__doc__)
        return 2
    sim = verify(Path(argv[0]))
    print(json.dumps({k: sim[k] for k in ("pass", "notes", "render", "video", "elapsed_s")}))
    for c in sim["checks"]:
        print(f"  {'PASS' if c['pass'] else 'FAIL'}  {c['name']:<20} {c['value']} {c.get('unit') or ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
