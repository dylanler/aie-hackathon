import fs from "node:fs";
import path from "node:path";
import { runDir, runsDir } from "./paths";
import { saveEvent, saveRun } from "../db/mongo";

export type Stage = "diagnose" | "design" | "cad" | "verify" | "improve" | "rl" | "make";
export type Phase = "start" | "progress" | "artifact" | "done" | "error";
export type RunEvent = { runId: string; stage: Stage; phase: Phase; message: string; data?: any; model?: "gemini-argon" | "muse" | "subq" | string; ts: number };

export function newRunId() {
  return "r_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
export function ensureRun(id: string) { fs.mkdirSync(runDir(id), { recursive: true }); return runDir(id); }

export function emit(ev: Omit<RunEvent, "ts">) {
  const full: RunEvent = { ...ev, ts: Date.now() };
  fs.appendFileSync(path.join(runDir(ev.runId), "events.jsonl"), JSON.stringify(full) + "\n");
  void saveEvent(full);
  return full;
}
export function readEvents(id: string): RunEvent[] {
  try { return fs.readFileSync(path.join(runDir(id), "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
  catch { return []; }
}
export function writeRun(id: string, run: any) {
  fs.writeFileSync(path.join(runDir(id), "run.json"), JSON.stringify(run, null, 2));
  void saveRun(run);
}
export function readRun(id: string): any | null {
  try { return JSON.parse(fs.readFileSync(path.join(runDir(id), "run.json"), "utf8")); } catch { return null; }
}
export function writeJSON(id: string, rel: string, obj: any) {
  const p = path.join(runDir(id), rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}
export function listRuns(): any[] {
  try {
    return fs.readdirSync(runsDir()).map((d) => readRun(d)).filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch { return []; }
}
