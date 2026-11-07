import fs from "node:fs";
import { NextResponse } from "next/server";
import { startRun } from "@/lib/agents/orchestrator";
import { runsDir } from "@/lib/agents/paths";
import { listRuns } from "@/lib/agents/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The live pipeline needs a model key and a writable runs dir. Without them (e.g. a static Vercel deploy),
 *  answer 503 so the UI replays the recorded golden run from /static-runs instead. */
function liveReady(): string | null {
  if (process.env.DEMO_ONLY === "1") return "demo-only deploy";
  if (!process.env.GEMINI_API_KEY && !process.env.META_API_KEY && !process.env.MODEL_API_KEY) return "no model API key configured";
  try {
    fs.mkdirSync(runsDir(), { recursive: true });
    fs.accessSync(runsDir(), fs.constants.W_OK);
  } catch { return "runs directory is not writable"; }
  return null;
}

// POST /api/runs {prompt} → {id}. Pipeline runs in-process, fire and forget.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt || "").trim();
  if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });
  const why = liveReady();
  if (why) return NextResponse.json({ error: why, fallback: "static-replay" }, { status: 503 });
  try {
    const id = startRun(prompt.slice(0, 4000));
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e).slice(0, 200), fallback: "static-replay" }, { status: 503 });
  }
}

// GET /api/runs → recent run manifests
export async function GET() {
  try { return NextResponse.json(listRuns().slice(0, 50)); } catch { return NextResponse.json([]); }
}
