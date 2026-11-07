// "The System That Gets Better": self-improvement loop over the designer's system skill.
//   cd web && NODE_USE_ENV_PROXY=1 npx tsx ../evals/loop.ts [iterations=3]
// 1. Evaluate the adopted skill vN on evals/train (+ evals/heldout) with binary, machine-checked criteria.
// 2. Collect train failures (criterion, measured value, compile log) → an LLM proposes skill v(N+1).
// 3. Evaluate v(N+1) on the held-out set. Adopt ONLY if held-out pass rate strictly improves; else roll back.
// Every version, its scores and the decision go to evals/history.json (+ MongoDB if MONGODB_URI is set).
import fs from "node:fs";
import path from "node:path";
import { evaluate, criterionLabel, type Criterion } from "../web/lib/agents/checks";
import { buildParts, writeDesign } from "../web/lib/agents/designer";
import { repoRoot } from "../web/lib/agents/paths";
import { historyPath, readHistory, readSkill, skillsDir, type HistoryEntry } from "../web/lib/agents/skills";
import { callLLM, parseJSON } from "../web/lib/llm/router";
import { subqPartSatisfies } from "../web/lib/llm/subq";
import { saveEvalResult, saveSkillVersion } from "../web/lib/db/mongo";

type Case = { id: string; prompt: string; criteria: Criterion[] };
type CaseResult = { case: string; sample: number; pass: boolean; failed: string[]; measured: any; compileLog?: string; subq: number | null; ms: number; model?: string; error?: string };

const ROOT = repoRoot();
const EV = path.join(ROOT, "evals");
const SAMPLES = Number(process.env.SAMPLES || 2);
const CONC = Number(process.env.CONCURRENCY || 8);

const loadCases = (set: string): Case[] =>
  fs.readdirSync(path.join(EV, set)).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(fs.readFileSync(path.join(EV, set, f), "utf8")));

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

async function runCase(version: string, skill: string, c: Case, sample: number, set: string): Promise<CaseResult> {
  const t0 = Date.now();
  const dir = path.join(EV, ".work", version, set, `${c.id}.s${sample}`);
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    const { design, model } = await writeDesign(c.prompt, skill);
    const built = await buildParts(dir, design.parts);
    const checks = evaluate(c.criteria, built.map((b) => ({ id: b.id, compiled: b.compiled, analysis: b.analysis, params: b.params })));
    const failed = checks.filter((x) => !x.pass).map((x) => `${x.name} (measured ${x.value ?? "n/a"}${x.unit ? " " + x.unit : ""}${x.expected ? "; " + x.expected : ""})`);
    const ok = built.filter((b) => b.compiled);
    let subq: number | null = null;
    if (ok.length) subq = await subqPartSatisfies(c.prompt, ok.map((b) => b.scad).join("\n\n"), JSON.stringify(ok.map((b) => ({ dims_mm: b.analysis!.dims_mm, min_wall_mm: b.analysis!.min_wall_mm, holes: b.analysis!.holes.slice(0, 6) }))));
    return {
      case: c.id, sample, pass: failed.length === 0, failed, model, subq, ms: Date.now() - t0,
      measured: built.map((b) => ({ part: b.id, compiled: b.compiled, dims_mm: b.analysis?.dims_mm, min_wall_mm: b.analysis?.min_wall_mm, holes: b.analysis?.holes.slice(0, 6), params: b.params })),
      compileLog: built.filter((b) => !b.compiled).map((b) => `${b.id}: ${b.log.slice(0, 400)}`).join("\n") || undefined,
    };
  } catch (e: any) {
    return { case: c.id, sample, pass: false, failed: [`designer error: ${String(e?.message || e).slice(0, 200)}`], measured: null, subq: null, ms: Date.now() - t0, error: String(e?.message || e) };
  }
}

async function evalSet(version: string, skill: string, set: "train" | "heldout") {
  const cases = loadCases(set);
  const jobs = cases.flatMap((c) => Array.from({ length: SAMPLES }, (_, s) => ({ c, s })));
  const results = await pool(jobs, CONC, ({ c, s }) => runCase(version, skill, c, s, set));
  const pass = results.filter((r) => r.pass).length / results.length;
  const sq = results.map((r) => r.subq).filter((x): x is number => typeof x === "number");
  console.log(`  ${version} ${set}: ${results.filter((r) => r.pass).length}/${results.length} = ${(pass * 100).toFixed(1)}%`);
  for (const r of results.filter((r) => !r.pass)) console.log(`    ✗ ${r.case}#${r.sample}: ${r.failed.join(" | ").slice(0, 220)}`);
  return { pass: +pass.toFixed(4), n: results.length, results, subqMean: sq.length ? +(sq.reduce((a, b) => a + b, 0) / sq.length).toFixed(3) : null };
}

function saveResults(version: string, data: any) {
  fs.mkdirSync(path.join(EV, "results"), { recursive: true });
  fs.writeFileSync(path.join(EV, "results", `${version}.json`), JSON.stringify(data, null, 1));
}
function writeHistory(h: HistoryEntry[]) { fs.writeFileSync(historyPath(), JSON.stringify(h, null, 2)); }
const loadResults = (v: string) => { try { return JSON.parse(fs.readFileSync(path.join(EV, "results", `${v}.json`), "utf8")); } catch { return null; } };

async function proposePatch(parentVersion: string, parentSkill: string, failures: CaseResult[], newVersion: string): Promise<{ text: string; diffSummary: string }> {
  const report = failures.slice(0, 24).map((f) => ({ case: f.case, failed: f.failed, measured: f.measured, compile_log: f.compileLog?.slice(0, 500) }));
  const r = await callLLM({
    role: "improver", json: true, effort: "medium",
    messages: [
      { role: "system", content: `You improve the system "skill" (instructions) given to an AI that writes OpenSCAD for 3D-printed household repair parts. You get the current skill and machine-measured failures from a training set. Write the next version of the skill. Rules: fix the ROOT CAUSES with GENERAL design rules (they must transfer to unseen household parts that are scored on a hidden held-out set); never mention specific training cases or their exact dimensions; keep everything in the current skill that still helps; be concise (under 450 words). Return JSON {"skill":"full markdown of the new skill, starting with '# Designer skill ${newVersion}'","diffSummary":"one sentence: what changed and why"}` },
      { role: "user", content: `CURRENT SKILL (${parentVersion}):\n${parentSkill}\n\nTRAIN FAILURES (criterion → measured):\n${JSON.stringify(report, null, 1)}` },
    ],
  });
  const j = parseJSON<{ skill: string; diffSummary: string }>(r.text);
  if (!j.skill || j.skill.length < 50) throw new Error("improver returned empty skill");
  return { text: j.skill.trim() + "\n", diffSummary: (j.diffSummary || "").slice(0, 300) };
}

async function main() {
  const iterations = Number(process.argv[2] || 3);
  const history = readHistory();
  console.log(`self-improvement loop: ${iterations} iteration(s), samples=${SAMPLES}, provider=${process.env.LLM_PROVIDER || (process.env.GEMINI_API_KEY ? "gemini→muse" : "muse")}`);

  // Baseline
  if (!history.length) {
    const skill = readSkill("v1");
    console.log("baseline v1");
    const tr = await evalSet("v1", skill, "train");
    const ho = await evalSet("v1", skill, "heldout");
    saveResults("v1", { version: "v1", train: tr, heldout: ho });
    const e: HistoryEntry = { version: "v1", parent: null, trainPass: tr.pass, heldoutPass: ho.pass, trainN: tr.n, heldoutN: ho.n, adopted: true, diffSummary: "baseline hand-written skill", ts: Date.now(), subqMean: ho.subqMean,
      failures: tr.results.filter((r) => !r.pass).map((r) => ({ case: r.case, failed: r.failed })) };
    history.push(e); writeHistory(history); void saveEvalResult(e); void saveSkillVersion("v1", skill, e);
  }

  for (let it = 0; it < iterations; it++) {
    const current = history.filter((h) => h.adopted).at(-1)!;
    const curSkill = readSkill(current.version);
    const maxN = Math.max(...fs.readdirSync(skillsDir()).filter((f) => /^v\d+\.md$/.test(f)).map((f) => +f.slice(1, -3)));
    const next = `v${maxN + 1}`;
    const curRes = loadResults(current.version);
    const failures: CaseResult[] = (curRes?.train?.results || []).filter((r: CaseResult) => !r.pass);
    if (!failures.length) { console.log(`${current.version} passes all train cases; nothing to learn from.`); break; }
    console.log(`\n${next} ← patch of ${current.version} from ${failures.length} train failures`);
    let patch;
    try { patch = await proposePatch(current.version, curSkill, failures, next); }
    catch (e: any) { console.log("  improver failed:", e?.message); continue; }
    fs.writeFileSync(path.join(skillsDir(), `${next}.md`), patch.text);
    console.log(`  diff: ${patch.diffSummary}`);
    const tr = await evalSet(next, patch.text, "train");
    const ho = await evalSet(next, patch.text, "heldout");
    saveResults(next, { version: next, parent: current.version, train: tr, heldout: ho });
    const adopted = ho.pass > current.heldoutPass;
    const e: HistoryEntry = { version: next, parent: current.version, trainPass: tr.pass, heldoutPass: ho.pass, trainN: tr.n, heldoutN: ho.n, adopted, diffSummary: patch.diffSummary, ts: Date.now(), subqMean: ho.subqMean,
      failures: tr.results.filter((r) => !r.pass).map((r) => ({ case: r.case, failed: r.failed })) };
    history.push(e); writeHistory(history); void saveEvalResult(e); void saveSkillVersion(next, patch.text, e);
    console.log(`  held-out ${(current.heldoutPass * 100).toFixed(1)}% → ${(ho.pass * 100).toFixed(1)}%: ${adopted ? "ADOPTED" : `ROLLED BACK to ${current.version}`}`);
  }
  const cur = history.filter((h) => h.adopted).at(-1)!;
  console.log(`\ncurrent skill: ${cur.version} (train ${(cur.trainPass * 100).toFixed(1)}%, held-out ${(cur.heldoutPass * 100).toFixed(1)}%)`);
  setTimeout(() => process.exit(0), 500);
}

main().catch((e) => { console.error(e); process.exit(1); });
