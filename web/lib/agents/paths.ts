import fs from "node:fs";
import path from "node:path";

/** Repo root = nearest ancestor of cwd holding COORDINATION.md (works from web/ and from repo root). */
export function repoRoot(): string {
  if (process.env.REPO_ROOT) return process.env.REPO_ROOT;
  let d = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, "COORDINATION.md"))) return d;
    d = path.dirname(d);
  }
  return path.resolve(process.cwd(), "..");
}
export const runsDir = () => process.env.RUNS_DIR || path.join(repoRoot(), "data", "runs");
export const runDir = (id: string) => path.join(runsDir(), id);
export const webDir = () => path.join(repoRoot(), "web");
