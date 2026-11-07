import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeMesh, parseSTL, type Analysis } from "./geometry";
import { webDir } from "./paths";

export type CompileResult = { ok: boolean; log: string; ms: number; engine: "openscad-cli" | "openscad-wasm"; analysis?: Analysis };

let hasCli: boolean | null = null;
function openscadCli(): boolean {
  if (hasCli === null) hasCli = spawnSync("openscad", ["--version"], { stdio: "ignore" }).status === 0;
  return hasCli;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => { p.kill("SIGKILL"); out += "\n[timeout]"; }, timeoutMs);
    p.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? 1, out }); });
    p.on("error", (e) => { clearTimeout(t); resolve({ code: 1, out: String(e) }); });
  });
}

// CGAL compiles are CPU-bound: cap concurrent compiles at the core count so a busy eval run
// doesn't turn into timeouts (a timeout would be scored as a designer failure).
const SLOTS = Math.max(1, Number(process.env.CAD_CONCURRENCY || os.cpus().length || 2));
let active = 0;
const waiters: (() => void)[] = [];
async function acquire() { if (active < SLOTS) { active++; return; } await new Promise<void>((r) => waiters.push(r)); active++; }
function release() { active--; const w = waiters.shift(); if (w) w(); }

/** Compile a .scad file to STL and analyse the mesh. */
export async function compileScad(scadPath: string, stlPath: string, timeoutMs = 240_000): Promise<CompileResult> {
  await acquire();
  try { return await compileInner(scadPath, stlPath, timeoutMs); } finally { release(); }
}

async function compileInner(scadPath: string, stlPath: string, timeoutMs: number): Promise<CompileResult> {
  const t0 = Date.now();
  fs.mkdirSync(path.dirname(stlPath), { recursive: true });
  try { fs.unlinkSync(stlPath); } catch {}
  let engine: CompileResult["engine"];
  let r;
  if (openscadCli()) {
    engine = "openscad-cli";
    r = await run("openscad", ["--enable=manifold", "-o", stlPath, scadPath], path.dirname(scadPath), timeoutMs);
  } else {
    engine = "openscad-wasm";
    r = await run(process.execPath, [path.join(webDir(), "lib", "agents", "scad-compile.mjs"), scadPath, stlPath], webDir(), timeoutMs);
  }
  const ok = r.code === 0 && fs.existsSync(stlPath) && fs.statSync(stlPath).size > 84;
  const log = r.out.split("\n").filter((l) => /error|warning|assert|undefined|timeout/i.test(l)).slice(0, 30).join("\n");
  let analysis: Analysis | undefined;
  if (ok) analysis = analyzeMesh(parseSTL(fs.readFileSync(stlPath)));
  const valid = ok && !!analysis && analysis.triangles > 0 && analysis.volume_mm3 > 0.5;
  return { ok: valid, log: valid ? log : log || r.out.slice(-1500) || "empty geometry", ms: Date.now() - t0, engine, analysis };
}
