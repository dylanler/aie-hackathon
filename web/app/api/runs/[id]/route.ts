import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { runDir } from "@/lib/agents/paths";
import { readRun } from "@/lib/agents/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(params.id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  let run: any = null;
  try { run = readRun(params.id); } catch {}
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  // a run orphaned by a server restart stays "running" forever: after 10 min with no new events report it as an error
  if (run.status === "running") {
    try {
      const idle = Date.now() - fs.statSync(path.join(runDir(params.id), "events.jsonl")).mtimeMs;
      if (idle > 10 * 60 * 1000) run = { ...run, status: "error", error: run.error || "Run stopped: no progress for 10 min." };
    } catch {}
  }
  return NextResponse.json(run);
}
