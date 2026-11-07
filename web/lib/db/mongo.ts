// MongoDB Atlas memory: runs, verdicts, skill versions, eval history.
// No-op unless MONGODB_URI is set, so the app works offline/without Atlas.
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
  return c ? c.db(process.env.MONGODB_DB || "thought_to_reality") : null;
}

export const mongoEnabled = () => !!process.env.MONGODB_URI;

export async function saveRun(run: any) {
  try { const d = await db(); if (d) await d.collection("runs").replaceOne({ id: run.id }, { ...run, updatedAt: new Date() }, { upsert: true }); }
  catch (e: any) { console.warn("[mongo] saveRun:", e?.message); }
}
export async function saveEvent(ev: any) {
  try { const d = await db(); if (d) await d.collection("events").insertOne({ ...ev }); }
  catch (e: any) { console.warn("[mongo] saveEvent:", e?.message); }
}
export async function saveVerdict(runId: string, verdict: any) {
  try { const d = await db(); if (d) await d.collection("verdicts").replaceOne({ runId }, { runId, ...verdict, updatedAt: new Date() }, { upsert: true }); }
  catch (e: any) { console.warn("[mongo] saveVerdict:", e?.message); }
}
export async function saveSkillVersion(version: string, text: string, meta: any) {
  try { const d = await db(); if (d) await d.collection("skills").replaceOne({ version }, { version, text, ...meta, updatedAt: new Date() }, { upsert: true }); }
  catch (e: any) { console.warn("[mongo] saveSkillVersion:", e?.message); }
}
export async function saveEvalResult(entry: any) {
  try { const d = await db(); if (d) await d.collection("eval_history").insertOne({ ...entry }); }
  catch (e: any) { console.warn("[mongo] saveEvalResult:", e?.message); }
}
/** Past fixes for similar prompts (keyword match; swap for $vectorSearch once an index exists). */
export async function similarRuns(prompt: string, limit = 3): Promise<any[]> {
  try {
    const d = await db(); if (!d) return [];
    const words = prompt.toLowerCase().match(/[a-z]{5,}/g)?.slice(0, 6) || [];
    if (!words.length) return [];
    return await d.collection("runs").find({ status: "done", prompt: { $regex: words.join("|"), $options: "i" } }).sort({ updatedAt: -1 }).limit(limit).project({ id: 1, prompt: 1, parts: 1, verdictSummary: 1 }).toArray();
  } catch { return []; }
}
