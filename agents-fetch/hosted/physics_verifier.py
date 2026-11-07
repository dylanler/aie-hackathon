# Physics Verifier — Thought to Reality. Independent second opinion on a design: it never trusts the
# designer's own grade; it re-derives printability/fit checks from the part geometry and cross-checks the
# pipeline's MuJoCo/mesh verdict. Runs as an Agentverse hosted agent (`agent` is injected) or locally via run_local.py.
import json
from uagents import Context

#__PROTOCOL__

PRINTERS = {"bambu-a1": (256, 256, 256), "prusa-mk4": (250, 210, 220), "ender-3": (220, 220, 250)}
MIN_WALL_MM = 1.2


def independent_checks(parts, verdict):
    checks = []
    for p in parts:
        dims = sorted([float(x) for x in (p.get("dims_mm") or [0, 0, 0])], reverse=True)
        fits = [n for n, bed in PRINTERS.items() if all(d <= b for d, b in zip(dims, sorted(bed, reverse=True)))]
        checks.append({"name": f"{p.get('id')}: fits a mainstream printer bed", "pass": bool(fits),
                       "value": ", ".join(fits) or "none", "unit": ""})
        checks.append({"name": f"{p.get('id')}: smallest dimension ≥ {MIN_WALL_MM} mm", "pass": dims[-1] >= MIN_WALL_MM,
                       "value": dims[-1], "unit": "mm"})
        mat = (p.get("material") or "").upper()
        cold = any(w in (p.get("purpose", "") + p.get("name", "")).lower() for w in ["freezer", "cold", "fridge"])
        if cold:
            ok = mat in ("PETG", "ABS", "ASA", "NYLON", "PA", "TPU", "PC")
            checks.append({"name": f"{p.get('id')}: material survives freezer temps", "pass": ok, "value": mat or "?", "unit": ""})
    v = verdict or {}
    for c in v.get("checks", []):
        if c.get("advisory"):
            continue
        n = (c.get("name") or "").lower()
        if any(k in n for k in ["interpenetration", "clearance", "load", "wall", "compiles"]):
            checks.append({"name": "pipeline sim: " + c.get("name", ""), "pass": bool(c.get("pass")),
                           "value": c.get("value"), "unit": c.get("unit", "")})
    return checks


@verify_proto.on_message(VerifyRequest, replies=VerifyResponse)
async def on_verify(ctx: Context, sender: str, req: VerifyRequest):
    try:
        parts = json.loads(req.parts_json or "[]")
        verdict = json.loads(req.verdict_json) if req.verdict_json else {}
    except Exception:
        parts, verdict = [], {}
    checks = independent_checks(parts, verdict)
    failed = [c["name"] for c in checks if not c["pass"]]
    passed = bool(checks) and not failed
    summary = (f"Independent physics check: {len(checks) - len(failed)}/{len(checks)} pass."
               + (" Failing: " + "; ".join(failed[:4]) if failed else " Fit, clearance and printability hold."))
    ctx.logger.info(f"verify {req.run_id}: {summary}")
    await ctx.send(sender, VerifyResponse(request_id=req.request_id, run_id=req.run_id, passed=passed,
                                          summary=summary, checks_json=json.dumps(checks)))


agent.include(verify_proto, publish_manifest=True)
