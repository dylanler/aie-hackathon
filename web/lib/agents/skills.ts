import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths";

export type HistoryEntry = {
  version: string; parent: string | null; trainPass: number; heldoutPass: number; adopted: boolean;
  diffSummary: string; ts: number; trainN?: number; heldoutN?: number; subqMean?: number | null;
  failures?: { case: string; failed: string[] }[];
  rejectedPatchesSeen?: number; // improver saw this many rolled-back sibling patches (memory of failed attempts)
};

export const skillsDir = () => path.join(repoRoot(), "evals", "skills");
export const historyPath = () => path.join(repoRoot(), "evals", "history.json");

export function readHistory(): HistoryEntry[] {
  try { return JSON.parse(fs.readFileSync(historyPath(), "utf8")); } catch { return []; }
}

/** The currently adopted skill version: last adopted entry in history, else v1. */
export function currentSkill(): { version: string; text: string } {
  const h = readHistory().filter((e) => e.adopted);
  const version = h.length ? h[h.length - 1].version : "v1";
  return { version, text: readSkill(version) };
}

export function readSkill(version: string): string {
  try { return fs.readFileSync(path.join(skillsDir(), `${version}.md`), "utf8"); } catch { return ""; }
}
