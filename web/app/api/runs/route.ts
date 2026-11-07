import { NextResponse } from "next/server";
import { startRun } from "@/lib/agents/orchestrator";
import { listRuns } from "@/lib/agents/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/runs {prompt} → {id}. Pipeline runs in-process, fire and forget.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt || "").trim();
  if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });
  const id = startRun(prompt.slice(0, 4000));
  return NextResponse.json({ id });
}

// GET /api/runs → recent run manifests
export async function GET() {
  return NextResponse.json(listRuns().slice(0, 50));
}
