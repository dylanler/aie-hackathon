import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { repoRoot, runsDir } from "@/lib/agents/paths";
import { physicsMode } from "@/lib/sim-remote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health → which pipeline capabilities are live here. The UI runs example chips live only when
 *  `live` is true; otherwise it replays the recorded real run of that prompt. DEMO_ONLY=1 forces replay. */
export async function GET() {
  const forced = process.env.DEMO_ONLY === "1";
  const llm = {
    gemini: !!process.env.GEMINI_API_KEY && process.env.DISABLE_GEMINI !== "1",
    muse: !!(process.env.META_API_KEY || process.env.MODEL_API_KEY),
    subq: !!process.env.SUBQ_API_KEY,
  };
  let writable = false;
  try { fs.mkdirSync(runsDir(), { recursive: true }); fs.accessSync(runsDir(), fs.constants.W_OK); writable = true; } catch {}
  let compile = false;
  try {
    const web = path.join(repoRoot(), "web");
    compile = fs.existsSync(path.join(web, "lib", "agents", "scad-compile.mjs")) &&
      [process.cwd(), web].some((d) => fs.existsSync(path.join(d, "node_modules", "openscad-wasm-prebuilt")));
  } catch {}
  let physics: string = "unavailable";
  try { physics = physicsMode(path.join(repoRoot(), "sim", "verify.py")); } catch {}
  const physicsOk = physics !== "unavailable";
  const live = !forced && (llm.gemini || llm.muse) && writable && compile && physicsOk;
  return NextResponse.json({
    live, forcedReplay: forced,
    capabilities: { llm: llm.gemini || llm.muse, models: llm, compile, physics, storage: writable, mongo: !!process.env.MONGODB_URI },
    reason: live ? null : forced ? "demo-only deploy" : !(llm.gemini || llm.muse) ? "no model API key" : !writable ? "runs directory not writable" : !compile ? "OpenSCAD compiler missing" : "physics verifier unavailable",
  }, { headers: { "cache-control": "no-store" } });
}
