import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { readHistory, readSkill, skillsDir } from "@/lib/agents/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/evals → self-improvement history + skill versions (for the "System That Gets Better" screen)
export async function GET() {
  let history: ReturnType<typeof readHistory> = [];
  try { history = readHistory(); } catch {}
  let versions: string[] = [];
  try { versions = fs.readdirSync(skillsDir()).filter((f) => /^v\d+\.md$/.test(f)).map((f) => f.replace(".md", "")).sort((a, b) => +a.slice(1) - +b.slice(1)); } catch {}
  const adopted = history.filter((h) => h.adopted).at(-1)?.version || "v1";
  return NextResponse.json({ current: adopted, history, skills: versions.map((v) => { try { return { version: v, text: readSkill(v) }; } catch { return { version: v, text: "" }; } }) });
}
