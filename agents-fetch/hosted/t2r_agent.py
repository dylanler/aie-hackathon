# Thought to Reality — Fetch.ai uAgent (Agent Chat Protocol). Say what should exist ("my freezer door won't close");
# the agent runs the Thought-to-Reality pipeline (diagnose → design OpenSCAD → compile → verify → improve → make),
# hands the design to the Physics Verifier agent for an independent check (agent-to-agent), and replies in ASI:One
# with the design summary, verdict, skill version and download links.
# Hosted on Agentverse (`agent` injected) or run locally via run_local.py (which also enables a MongoDB fallback).
import asyncio, json, os, time
from datetime import datetime, timezone
from uuid import uuid4

import requests
from uagents import Context
from uagents_core.contrib.protocols.chat import (ChatAcknowledgement, ChatMessage, EndSessionContent,
                                                 StartSessionContent, TextContent, chat_protocol_spec)
from uagents import Protocol

#__PROTOCOL__

APP_URL = os.environ.get("APP_URL") or "__APP_URL__"
VERIFIER = os.environ.get("VERIFIER_ADDRESS") or "__VERIFIER_ADDRESS__"
FILES_BASE = "__FILES_BASE__"   # public raw-GitHub base for the snapshot run's files
SNAPSHOT = json.loads(r'''__SNAPSHOT__''')  # latest stored run (from MongoDB) baked in at deploy time
POLL_S = 75

chat_proto = Protocol(spec=chat_protocol_spec)


def _now():
    return datetime.now(timezone.utc)


def _text(t, end=True):
    content = [TextContent(type="text", text=t)]
    if end:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=_now(), msg_id=uuid4(), content=content)


async def run_pipeline(prompt):
    """POST {APP_URL}/api/runs then poll GET /api/runs/:id. Returns (run, verdict, files_base) or None."""
    if not APP_URL or APP_URL.startswith("__"):
        return None
    try:
        r = requests.post(f"{APP_URL}/api/runs", json={"prompt": prompt}, timeout=10)
        rid = r.json()["id"]
    except Exception:
        return None
    t0 = time.time(); run = None
    while time.time() - t0 < POLL_S:
        await asyncio.sleep(4)
        try:
            run = requests.get(f"{APP_URL}/api/runs/{rid}", timeout=10).json()
        except Exception:
            continue
        if run.get("status") in ("done", "error", "failed"):
            break
    if not run:
        return None
    verdict = {}
    try:
        verdict = requests.get(f"{APP_URL}/api/runs/{rid}/files/verdict.json", timeout=10).json()
    except Exception:
        pass
    return run, verdict, f"{APP_URL}/api/runs/{rid}/files"


def stored_run():
    """Latest stored run: MongoDB (local mode, if pymongo + MONGODB_URI) else the deploy-time snapshot."""
    uri = os.environ.get("MONGODB_URI")
    if uri:
        try:
            from pymongo import MongoClient
            db = MongoClient(uri, serverSelectionTimeoutMS=5000)[os.environ.get("MONGODB_DB", "t2r")]
            run = db.runs.find_one({"status": "done"}, sort=[("updatedAt", -1)], projection={"_id": 0}) \
                or db.runs.find_one({}, sort=[("updatedAt", -1)], projection={"_id": 0})
            if run:
                v = db.verdicts.find_one({"runId": run["id"]}, projection={"_id": 0}) or {}
                return run, v, FILES_BASE.rsplit("/", 1)[0] + "/" + run["id"]
        except Exception:
            pass
    if SNAPSHOT:
        return SNAPSHOT["run"], SNAPSHOT.get("verdict", {}), FILES_BASE
    return None


def describe(run, verdict, files_base, live, verifier_summary=None):
    parts = run.get("parts", [])
    lines = [("Here is the fix I designed:" if live else
              "The live pipeline is offline right now, so here is the most recent stored run for a similar problem:"),
             f"• Problem: {run.get('prompt')}", f"• Kind: {run.get('kind', 'static')}"]
    for p in parts:
        d = "×".join(str(x) for x in p.get("dims_mm", []))
        lines.append(f"• Part: {p.get('name')} — {p.get('material', '?')}, {d} mm. {p.get('purpose', '')}".rstrip())
    checks = verdict.get("checks", [])
    hard = [c for c in checks if not c.get("advisory")]
    ok = sum(1 for c in hard if c.get("pass"))
    clear = next((c for c in checks if "clearance" in c.get("name", "").lower()), None)
    lines.append(f"• Pipeline verdict: {'PASS' if verdict.get('pass') else 'NOT YET'} ({ok}/{len(hard)} checks)"
                 + (f"; fits {verdict['fits_printer']}" if verdict.get("fits_printer") else "")
                 + (f"; min clearance {clear['value']} {clear.get('unit', '')}" if clear else "")
                 + (f". {verdict['notes']}" if verdict.get("notes") else ""))
    if verifier_summary:
        lines.append(f"• Physics Verifier agent (independent): {verifier_summary}")
    lines.append(f"• Design skill version: {run.get('skillVersion', '?')} (skills are only adopted when held-out evals improve)")
    for p in parts:
        for key in ("stl", "scad"):
            if p.get(key):
                lines.append(f"• Download {key.upper()}: {files_base}/{p[key]}")
    lines.append("Print in PETG at 0.2 mm, 40% infill. Ask me for a print-service quote or a different fix anytime.")
    return "\n".join(lines)


@chat_proto.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(timestamp=_now(), acknowledged_msg_id=msg.msg_id))
    text = "".join(c.text for c in msg.content if isinstance(c, TextContent)).strip()
    if not text:
        return  # session start / end markers only
    ctx.logger.info(f"chat from {sender}: {text[:120]}")
    res = await run_pipeline(text); live = res is not None
    if not live:
        res = stored_run()
    if not res:
        await ctx.send(sender, _text("I couldn't reach the design pipeline or any stored run. Please try again shortly."))
        return
    run, verdict, files_base = res
    rid = str(uuid4())
    pending = {"sender": sender, "run": run, "verdict": verdict, "files_base": files_base, "live": live, "ts": time.time()}
    if VERIFIER and not VERIFIER.startswith("__"):
        ctx.storage.set(f"pending:{rid}", json.dumps(pending, default=str))
        ids = json.loads(ctx.storage.get("pending_ids") or "[]"); ids.append(rid)
        ctx.storage.set("pending_ids", json.dumps(ids[-50:]))
        await ctx.send(sender, _text("Design ready — handing it to the Physics Verifier agent for an independent check…", end=False))
        await ctx.send(VERIFIER, VerifyRequest(request_id=rid, run_id=run.get("id", ""), prompt=run.get("prompt", ""),
                                              parts_json=json.dumps(run.get("parts", []), default=str),
                                              verdict_json=json.dumps(verdict, default=str)))
    else:
        await ctx.send(sender, _text(describe(run, verdict, files_base, live)))


@verify_proto.on_message(VerifyResponse)
async def on_verified(ctx: Context, sender: str, resp: VerifyResponse):
    key = f"pending:{resp.request_id}"
    raw = ctx.storage.get(key)
    if not raw:
        return
    ctx.storage.set(key, "")
    p = json.loads(raw)
    await ctx.send(p["sender"], _text(describe(p["run"], p["verdict"], p["files_base"], p["live"], resp.summary)))


@agent.on_interval(period=10.0)
async def flush_stale(ctx: Context):
    """If the verifier hasn't answered in 30 s, reply without it so the user is never left hanging."""
    ids = json.loads(ctx.storage.get("pending_ids") or "[]"); keep = []
    for rid in ids:
        k = f"pending:{rid}"
        raw = ctx.storage.get(k)
        if not raw:
            continue
        keep.append(rid)
        p = json.loads(raw)
        if time.time() - p["ts"] > 30:
            ctx.storage.set(k, "")
            await ctx.send(p["sender"], _text(describe(p["run"], p["verdict"], p["files_base"], p["live"],
                                                       "no answer within 30 s; showing the pipeline verdict only.")))
    ctx.storage.set("pending_ids", json.dumps(keep))


@chat_proto.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


agent.include(chat_proto, publish_manifest=True)
agent.include(verify_proto, publish_manifest=True)
