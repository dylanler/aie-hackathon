import { NextResponse } from "next/server";
import { readRun } from "@/lib/agents/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  let run = null;
  try { run = readRun(params.id); } catch {}
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(run);
}
