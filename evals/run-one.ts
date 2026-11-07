// Run the full pipeline once from the CLI: cd web && npx tsx ../evals/run-one.ts <runId> "<prompt>"
import { runPipeline } from "../web/lib/agents/orchestrator";
import { ensureRun, writeRun } from "../web/lib/agents/store";
import fs from "node:fs";
import path from "node:path";
import { runDir } from "../web/lib/agents/paths";

const id = process.argv[2] || "demo-freezer-latch";
const prompt = process.argv[3] || "My freezer door won't stay shut — the latch clip snapped. Make me a replacement clip.";
const dir = ensureRun(id);
for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
writeRun(id, { id, prompt, status: "running", createdAt: Date.now() });
const t0 = Date.now();
runPipeline(id, prompt)
  .then((r) => console.log("DONE", runDir(id), ((Date.now() - t0) / 1000).toFixed(0) + "s", JSON.stringify(r.verdictSummary)))
  .catch((e) => { console.error("FAIL", e); process.exit(1); });
