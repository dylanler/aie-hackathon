// MongoDB Atlas memory: runs, events, verdicts, skill versions, eval history, parts (+ vector search).
// No-op unless MONGODB_URI is set, so the app works offline/without Atlas.
// Collections (db "t2r" by default, override MONGODB_DB): runs, events, verdicts, skills, evals, parts.
// `parts.embedding` = 256-dim hashing embedding (./embed.ts), Atlas Vector Search index "parts_vec".
import { hashEmbed, partText } from "./embed";

let clientP: Promise<any> | null = null;

async function db() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  if (!clientP) {
    clientP = (async () => {
      const { MongoClient } = await import("mongodb");
      const c = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
      await c.connect();
      return c;
    })().catch((e) => { console.warn("[mongo] connect failed:", e?.message); clientP = null; return null; });
  }
  const c = await clientP;
  return c ? c.db(process.env.MONGODB_DB || "t2r") : null;
}

export const mongoEnabled = () => !!process.env.MONGODB_URI;

/** Upserts the run manifest and (re)indexes its parts for similar-fix retrieval. */
export async function saveRun(run: any) {
  try {
    const d = await db(); if (!d || !run?.id) return;
    await d.collection("runs").replaceOne({ id: run.id }, { ...run, updatedAt: new Date() }, { upsert: true });
    for (const p of run.parts || []) {
      const text = partText(p, run.prompt);
      await d.collection("parts").replaceOne(
        { runId: run.id, partId: p.id },
        { runId: run.id, partId: p.id, prompt: run.prompt, name: p.name, purpose: p.purpose, material: p.material,
          dims_mm: p.dims_mm, scad: p.scad, stl: p.stl, kind: run.kind, status: run.status, skillVersion: run.skillVersion,
          text, embedding: hashEmbed(text), updatedAt: new Date() },
        { upsert: true });
    }
  } catch (e: any) { console.warn("[mongo] saveRun:", e?.message); }
}
export async function appendEvent(ev: any) {
  try { const d = await db(); if (d) await d.collection("events").insertOne({ ...ev }); }
  catch (e: any) { console.warn("[mongo] appendEvent:", e?.message); }
}
export const saveEvent = appendEvent; // back-compat (web/lib/agents/store.ts)

export async function saveVerdict(runId: string, verdict: any) {
  try {
    const d = await db(); if (!d) return;
    await d.collection("verdicts").replaceOne({ runId }, { runId, ...verdict, updatedAt: new Date() }, { upsert: true });
    await d.collection("parts").updateMany({ runId }, { $set: { pass: !!verdict?.pass } });
  } catch (e: any) { console.warn("[mongo] saveVerdict:", e?.message); }
}
export async function saveSkillVersion(version: string, text: string, meta: any = {}) {
  try { const d = await db(); if (d) await d.collection("skills").replaceOne({ version }, { version, text, ...meta, updatedAt: new Date() }, { upsert: true }); }
  catch (e: any) { console.warn("[mongo] saveSkillVersion:", e?.message); }
}
export async function saveEvalPoint(entry: any) {
  try { const d = await db(); if (d) await d.collection("evals").insertOne({ ...entry, ts: entry?.ts ?? Date.now() }); }
  catch (e: any) { console.warn("[mongo] saveEvalPoint:", e?.message); }
}
export const saveEvalResult = saveEvalPoint; // back-compat

/** Past fixed parts similar to `text`, via Atlas $vectorSearch (falls back to keyword match). */
export async function similarFixes(text: string, limit = 3): Promise<any[]> {
  try {
    const d = await db(); if (!d) return [];
    const project = { _id: 0, runId: 1, partId: 1, prompt: 1, name: 1, purpose: 1, material: 1, dims_mm: 1, pass: 1, skillVersion: 1 };
    try {
      const hits = await d.collection("parts").aggregate([
        { $vectorSearch: { index: "parts_vec", path: "embedding", queryVector: hashEmbed(text), numCandidates: 100, limit } },
        { $project: { ...project, score: { $meta: "vectorSearchScore" } } },
      ]).toArray();
      if (hits.length) return hits;
    } catch (e: any) { console.warn("[mongo] vectorSearch:", e?.message); }
    const words = text.toLowerCase().match(/[a-z]{5,}/g)?.slice(0, 6) || [];
    if (!words.length) return [];
    return await d.collection("parts").find({ text: { $regex: words.join("|"), $options: "i" } }).project(project).limit(limit).toArray();
  } catch { return []; }
}

/** Back-compat for web/lib/agents/orchestrator.ts: similar past runs (deduped by run). */
export async function similarRuns(prompt: string, limit = 3): Promise<any[]> {
  const hits = await similarFixes(prompt, limit * 2);
  const seen = new Set<string>(); const out: any[] = [];
  for (const h of hits) { if (seen.has(h.runId)) continue; seen.add(h.runId); out.push({ id: h.runId, prompt: h.prompt, parts: [h], verdictSummary: h.pass === undefined ? undefined : (h.pass ? "pass" : "fail"), score: h.score }); }
  return out.slice(0, limit);
}
