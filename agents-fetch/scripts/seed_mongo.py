"""Create t2r collections + Atlas Vector Search index and seed from data/runs/* and evals/.
Usage: MONGODB_URI=... python agents-fetch/scripts/seed_mongo.py   (never commit the URI)"""
import json, os, sys, time, glob, datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pymongo import MongoClient
from pymongo.operations import SearchIndexModel
from t2r_common.embed import hash_embed, part_text, EMBED_DIMS

ROOT = Path(__file__).resolve().parents[2]
uri = os.environ.get("MONGODB_URI")
if not uri:
    sys.exit("MONGODB_URI not set")
db = MongoClient(uri, serverSelectionTimeoutMS=10000)[os.environ.get("MONGODB_DB", "t2r")]
now = datetime.datetime.now(datetime.timezone.utc)

for name in ["runs", "events", "verdicts", "skills", "evals", "parts"]:
    if name not in db.list_collection_names():
        db.create_collection(name)
db.runs.create_index("id", unique=True)
db.events.create_index([("runId", 1), ("ts", 1)])
db.verdicts.create_index("runId", unique=True)
db.skills.create_index("version", unique=True)
db.parts.create_index([("runId", 1), ("partId", 1)], unique=True)

def load(p):
    try:
        return json.loads(Path(p).read_text())
    except Exception:
        return None

for rd in sorted(glob.glob(str(ROOT / "data/runs/*"))):
    run = load(Path(rd) / "run.json")
    if not run:
        continue
    rid = run["id"]
    db.runs.replace_one({"id": rid}, {**run, "updatedAt": now}, upsert=True)
    v = load(Path(rd) / "verdict.json")
    if v:
        db.verdicts.replace_one({"runId": rid}, {"runId": rid, **v, "updatedAt": now}, upsert=True)
    ev_path = Path(rd) / "events.jsonl"
    if ev_path.exists():
        db.events.delete_many({"runId": rid})
        evs = [json.loads(l) for l in ev_path.read_text().splitlines() if l.strip()]
        if evs:
            db.events.insert_many(evs)
    for p in run.get("parts", []):
        t = part_text(p, run.get("prompt", ""))
        db.parts.replace_one({"runId": rid, "partId": p["id"]}, {
            "runId": rid, "partId": p["id"], "prompt": run.get("prompt"), "name": p.get("name"), "purpose": p.get("purpose"),
            "material": p.get("material"), "dims_mm": p.get("dims_mm"), "scad": p.get("scad"), "stl": p.get("stl"),
            "kind": run.get("kind"), "status": run.get("status"), "skillVersion": run.get("skillVersion"),
            "pass": (v or {}).get("pass"), "text": t, "embedding": hash_embed(t), "updatedAt": now}, upsert=True)
    print("seeded run", rid)

for sk in sorted(glob.glob(str(ROOT / "evals/skills/v*.md"))):
    ver = Path(sk).stem
    db.skills.replace_one({"version": ver}, {"version": ver, "text": Path(sk).read_text(), "source": "evals/skills", "updatedAt": now}, upsert=True)
    print("seeded skill", ver)

hist = load(ROOT / "evals/history.json")
if hist:
    pts = hist if isinstance(hist, list) else hist.get("history", hist.get("points", [hist]))
    db.evals.delete_many({"source": "evals/history.json"})
    if pts:
        db.evals.insert_many([{**p, "source": "evals/history.json"} for p in pts if isinstance(p, dict)])
    print("seeded evals", len(pts))

# Atlas Vector Search index on parts.embedding
existing = [i["name"] for i in db.parts.list_search_indexes()]
if "parts_vec" not in existing:
    db.parts.create_search_index(SearchIndexModel(name="parts_vec", type="vectorSearch", definition={"fields": [
        {"type": "vector", "path": "embedding", "numDimensions": EMBED_DIMS, "similarity": "cosine"},
        {"type": "filter", "path": "kind"}]}))
    print("created vector index parts_vec")
for i in db.parts.list_search_indexes():
    print("search index", i["name"], i.get("status"), i.get("queryable"))
print({c: db[c].count_documents({}) for c in ["runs", "events", "verdicts", "skills", "evals", "parts"]})
