"""Deploy both agents as Agentverse Hosted Agents (discoverable in ASI:One).
- snapshots the latest stored run (MongoDB, else data/runs) into agents-fetch/snapshot/<id>/ for public download links
- inlines the shared protocol, bakes APP_URL / verifier address / snapshot into the code
- creates (or reuses) hosted agents, uploads code, starts them; writes agents-fetch/deployed.json
Env: AGENTVERSE_API_KEY, optional MONGODB_URI, APP_URL (public URL of the Next.js app, if deployed)."""
import json, os, shutil, sys, time
from pathlib import Path
import requests

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
AV = "https://agentverse.ai/v1/hosting/agents"
H = {"Authorization": f"Bearer {os.environ.get('AGENTVERSE_API_KEY', '')}", "Content-Type": "application/json"}
REPO_RAW = "https://raw.githubusercontent.com/dylanler/aie-hackathon/main"
STATE = HERE / "deployed.json"
state = json.loads(STATE.read_text()) if STATE.exists() else {}


def latest_run():
    uri = os.environ.get("MONGODB_URI")
    if uri:
        from pymongo import MongoClient
        db = MongoClient(uri, serverSelectionTimeoutMS=8000)[os.environ.get("MONGODB_DB", "t2r")]
        runs = list(db.runs.find({}, {"_id": 0}))
        def rank(r):
            v = db.verdicts.find_one({"runId": r["id"]}) or {}
            return (r.get("status") == "done", bool(v.get("pass")), r.get("createdAt", 0))
        if runs:
            run = max(runs, key=rank)
            v = db.verdicts.find_one({"runId": run["id"]}, {"_id": 0, "updatedAt": 0}) or {}
            return run, v
    runs = [json.loads(p.read_text()) for p in ROOT.glob("data/runs/*/run.json")]
    run = max(runs, key=lambda r: (r.get("status") == "done", r.get("createdAt", 0)))
    vp = ROOT / "data/runs" / run["id"] / "verdict.json"
    return run, (json.loads(vp.read_text()) if vp.exists() else {})


def snapshot():
    run, verdict = latest_run()
    rid = run["id"]; dst = HERE / "snapshot" / rid
    for p in run.get("parts", []):
        for k in ("stl", "scad"):
            src = ROOT / "data/runs" / rid / (p.get(k) or "_none")
            if src.is_file():
                (dst / p[k]).parent.mkdir(parents=True, exist_ok=True); shutil.copy(src, dst / p[k])
    slim = {k: run.get(k) for k in ("id", "prompt", "kind", "parts", "skillVersion", "status", "verdictSummary")}
    for p in slim.get("parts") or []:
        p.pop("params", None)
    verdict = {k: verdict.get(k) for k in ("pass", "fits_printer", "checks", "notes") if k in verdict}
    (dst).mkdir(parents=True, exist_ok=True)
    (dst / "run.json").write_text(json.dumps(slim, indent=2, default=str))
    (dst / "verdict.json").write_text(json.dumps(verdict, indent=2, default=str))
    return {"run": slim, "verdict": verdict}, f"{REPO_RAW}/agents-fetch/snapshot/{rid}"


def render(fname, **subs):
    proto = (HERE / "hosted/verify_protocol.py").read_text()
    code = (HERE / "hosted" / fname).read_text().replace("#__PROTOCOL__", proto)
    for k, v in subs.items():
        code = code.replace(f"__{k}__", v)
    return code


def ensure(key, name):
    if state.get(key):
        return state[key]
    r = requests.post(AV, headers=H, json={"name": name}); r.raise_for_status()
    state[key] = r.json()["address"]; STATE.write_text(json.dumps(state, indent=2))
    return state[key]


def upload_and_start(addr, code):
    requests.post(f"{AV}/{addr}/stop", headers=H)
    r = requests.put(f"{AV}/{addr}/code", headers=H,
                     json={"code": json.dumps([{"language": "python", "name": "agent.py", "value": code}])})
    print("upload", addr[:16], r.status_code, r.text[:200])
    r = requests.post(f"{AV}/{addr}/start", headers=H)
    print("start", addr[:16], r.status_code, r.text[:200])


if __name__ == "__main__":
    snap, files_base = snapshot()
    ver = ensure("physics_verifier", "T2R Physics Verifier")
    upload_and_start(ver, render("physics_verifier.py"))
    main = ensure("t2r_agent", "Thought to Reality")
    code = render("t2r_agent.py", APP_URL=os.environ.get("APP_URL", ""), VERIFIER_ADDRESS=ver, FILES_BASE=files_base,
                  SNAPSHOT=json.dumps(snap, default=str).replace("'''", "\\'\\'\\'"))
    upload_and_start(main, code)
    state["snapshot_run"] = snap["run"]["id"]; state["deployed_at"] = time.strftime("%Y-%m-%d %H:%M:%S %Z")
    STATE.write_text(json.dumps(state, indent=2)); print(json.dumps(state, indent=2))
