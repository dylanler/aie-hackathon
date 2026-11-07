import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Physics capability for the MuJoCo verifier (sim/verify.py).
 *  - "local":  python3 + mujoco importable and sim/verify.py present (dev box, Modal, Docker)
 *  - "remote": SIM_URL is set → POST the run's run.json + design.json + STLs, get sim_verdict.json back
 *  - "unavailable": neither (e.g. Vercel: no Python). Physics is reported as unavailable, never as a pass.
 */
export type PhysicsMode = "local" | "remote" | "unavailable";

let localCache: boolean | null = null;
export function physicsLocal(verifyPy: string): boolean {
  if (process.env.SIM_DISABLE === "1") return false;
  if (localCache !== null) return localCache && fs.existsSync(verifyPy);
  try {
    localCache = fs.existsSync(verifyPy) &&
      spawnSync("python3", ["-c", "import mujoco, trimesh"], { stdio: "ignore", timeout: 20_000 }).status === 0;
  } catch { localCache = false; }
  return localCache;
}

export function physicsMode(verifyPy: string): PhysicsMode {
  if (process.env.SIM_DISABLE === "1") return "unavailable";
  if (physicsLocal(verifyPy)) return "local";
  if (process.env.SIM_URL) return "remote";
  return "unavailable";
}

/** POST the run to SIM_URL (sim/modal_app.py /verify). Writes sim_verdict.json (+ sim.png) into dir on success. */
export async function verifyRemote(dir: string, timeoutMs = 240_000): Promise<{ verdict: any | null; error?: string }> {
  const url = process.env.SIM_URL;
  if (!url) return { verdict: null, error: "SIM_URL not set" };
  try {
    const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
    const design = fs.existsSync(path.join(dir, "design.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "design.json"), "utf8")) : {};
    const files: Record<string, string> = {};
    for (const p of run.parts || []) {
      if (!p.stl) continue;
      const f = path.join(dir, p.stl);
      if (fs.existsSync(f)) files[p.stl] = fs.readFileSync(f).toString("base64");
    }
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    const endpoint = /\/verify\/?$/.test(url) ? url : url.replace(/\/$/, "") + "/verify";
    const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run, design, files }), signal: c.signal })
      .finally(() => clearTimeout(t));
    if (!r.ok) return { verdict: null, error: `SIM_URL answered ${r.status}` };
    const j = await r.json();
    const verdict = j?.sim_verdict || null;
    if (!verdict) return { verdict: null, error: j?.error || "no sim_verdict in response" };
    fs.writeFileSync(path.join(dir, "sim_verdict.json"), JSON.stringify(verdict, null, 2));
    if (typeof j.sim_png === "string") try { fs.writeFileSync(path.join(dir, "sim.png"), Buffer.from(j.sim_png, "base64")); } catch {}
    return { verdict };
  } catch (e: any) {
    return { verdict: null, error: String(e?.message || e).slice(0, 200) };
  }
}
