import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { callLLM, parseJSON } from "../llm/router";
import { subqPartSatisfies } from "../llm/subq";
import { saveVerdict, similarRuns } from "../db/mongo";
import { evaluate, type CheckResult, type Criterion } from "./checks";
import { writeAcceptanceTests } from "./critic";
import { buildParts, repairDesign, writeDesign, type BuiltPart, type Design } from "./designer";
import { repoRoot, runDir } from "./paths";
import { currentSkill } from "./skills";
import { emit, ensureRun, newRunId, readRun, writeJSON, writeRun, type Stage } from "./store";

export const PRINTERS: { id: string; name: string; bed: [number, number, number] }[] = [
  { id: "bambu-a1", name: "Bambu Lab A1", bed: [256, 256, 256] },
  { id: "prusa-mk4", name: "Prusa MK4", bed: [250, 210, 220] },
  { id: "ender-3", name: "Creality Ender-3", bed: [220, 220, 250] },
  { id: "bambu-a1-mini", name: "Bambu Lab A1 mini", bed: [180, 180, 180] },
];
const DENSITY: Record<string, number> = { PLA: 1.24, PETG: 1.27, TPU: 1.21, ASA: 1.07, ABS: 1.04 };
const s = (v: number[]) => [...v].sort((a, b) => a - b);
const fitsBed = (dims: number[], bed: number[]) => s(dims).every((d, i) => d <= s(bed)[i]);

type Diagnosis = { kind: "static" | "mechanism" | "robot"; object: string; failure: string; dimensions: Record<string, string>; requirements: string[]; assumptions: string[] };

export function startRun(prompt: string, opts: { id?: string; skillVersion?: string } = {}): string {
  const id = opts.id || newRunId();
  ensureRun(id);
  try { fs.unlinkSync(path.join(runDir(id), "events.jsonl")); } catch {}
  writeRun(id, { id, prompt, kind: null, parts: [], verdict: null, rl: null, fab: null, skillVersion: currentSkill().version, status: "running", createdAt: Date.now() });
  void runPipeline(id, prompt).catch((e) => {
    emit({ runId: id, stage: "make", phase: "error", message: `pipeline crashed: ${String(e?.message || e).slice(0, 200)}` });
    const r = readRun(id) || { id, prompt };
    writeRun(id, { ...r, status: "error", error: String(e?.message || e) });
  });
  return id;
}

export async function runPipeline(id: string, prompt: string) {
  const dir = ensureRun(id);
  const skill = currentSkill();
  const run: any = readRun(id) || { id, prompt, createdAt: Date.now() };
  Object.assign(run, { skillVersion: skill.version, status: "running", stages: {} });
  const save = () => writeRun(id, run);
  const stage = async <T>(st: Stage, startMsg: string, fn: () => Promise<T>): Promise<T> => {
    run.stages[st] = { status: "running", startedAt: Date.now() };
    save();
    emit({ runId: id, stage: st, phase: "start", message: startMsg });
    try {
      const out = await fn();
      run.stages[st] = { ...run.stages[st], status: "done", ms: Date.now() - run.stages[st].startedAt };
      save();
      return out;
    } catch (e: any) {
      run.stages[st] = { ...run.stages[st], status: "error", error: String(e?.message || e).slice(0, 300) };
      save();
      emit({ runId: id, stage: st, phase: "error", message: String(e?.message || e).slice(0, 200) });
      throw e;
    }
  };

  // 1. DIAGNOSE — classify, extract dimensions/requirements, never ask the user.
  const diag = await stage("diagnose", "Reading the problem", async () => {
    const past = await similarRuns(prompt);
    const r = await callLLM({
      role: "diagnose", json: true, effort: "low",
      messages: [
        { role: "system", content: `You diagnose household breakages for a 3D-printing repair agent. Never ask questions: assume standard household dimensions and state them. Return JSON {"kind":"static|mechanism|robot","object":"what broke","failure":"what failed and why","dimensions":{"name":"value with mm and whether assumed"},"requirements":["functional requirement"],"assumptions":["..."]}. kind=static for a single rigid part, mechanism for parts that move relative to each other (hinges, latches with springs, gears), robot only if the user wants something that moves by itself.` },
        { role: "user", content: prompt + (past.length ? `\n\n(Similar past fixes in memory: ${past.map((p: any) => p.prompt).join(" | ")})` : "") },
      ],
    });
    const d = parseJSON<Diagnosis>(r.text);
    if (!["static", "mechanism", "robot"].includes(d.kind)) d.kind = "static";
    writeJSON(id, "diagnosis.json", { ...d, model: r.model });
    run.kind = d.kind;
    emit({ runId: id, stage: "diagnose", phase: "done", message: `${d.kind}: ${d.object} — ${d.failure}`.slice(0, 160), data: d, model: r.provider });
    return { d, provider: r.provider };
  });

  // 2. DESIGN — parametric OpenSCAD per part, written under the adopted skill version.
  const context = `kind: ${diag.d.kind}\nobject: ${diag.d.object}\nfailure: ${diag.d.failure}\ndimensions: ${JSON.stringify(diag.d.dimensions)}\nrequirements: ${(diag.d.requirements || []).join("; ")}`;
  let { design, provider: designProvider, model: designModel } = await stage("design", `Designing with skill ${skill.version}`, async () => {
    const out = await writeDesign(prompt, skill.text, context);
    out.design.kind = diag.d.kind;
    persistDesign(id, out.design, out.model, skill.version);
    emit({ runId: id, stage: "design", phase: "artifact", message: `${out.design.parts.length} part(s): ${out.design.parts.map((p) => p.name).join(", ")}`.slice(0, 160), data: { design: "design.json", parts: out.design.parts.map((p) => ({ id: p.id, name: p.name, scad: `parts/${p.id}.scad` })) }, model: out.provider });
    emit({ runId: id, stage: "design", phase: "done", message: out.design.summary?.slice(0, 160) || "design written", model: out.provider });
    return out;
  });

  // 3. CAD — compile every part, measure the mesh, printer-fit.
  const doCad = async (d: Design, label: string) => stage("cad", label, async () => {
    const built = await buildParts(dir, d.parts);
    for (const b of built) {
      emit({ runId: id, stage: "cad", phase: b.compiled ? "artifact" : "progress",
        message: b.compiled ? `${b.name}: ${b.analysis!.dims_mm.join("×")} mm, ${b.analysis!.volume_mm3} mm³` : `${b.name}: compile failed`,
        data: { part: b.id, stl: b.compiled ? `parts/${b.id}.stl` : null, analysis: b.analysis, log: b.compiled ? undefined : b.log.slice(0, 500) } });
    }
    let simVerdict: any = null;
    const verifyPy = path.join(repoRoot(), "sim", "verify.py");
    run.parts = partsManifest(built, d);
    save();
    if (fs.existsSync(verifyPy)) {
      const r = spawnSync("python3", [verifyPy, dir], { cwd: repoRoot(), timeout: 180_000, encoding: "utf8" });
      try { simVerdict = JSON.parse(fs.readFileSync(path.join(dir, "verdict.json"), "utf8")); } catch {}
      emit({ runId: id, stage: "cad", phase: "progress", message: simVerdict ? `MuJoCo verifier: ${simVerdict.pass ? "pass" : "fail"}` : `sim/verify.py exited ${r.status}`, data: simVerdict ? { verdict: "verdict.json" } : { stderr: (r.stderr || "").slice(-400) } });
    }
    emit({ runId: id, stage: "cad", phase: "done", message: `${built.filter((b) => b.compiled).length}/${built.length} parts compiled (${built[0]?.engine})` });
    return { built, simVerdict };
  });
  let cad = await doCad(design, "Compiling OpenSCAD → STL");

  // 4. VERIFY — independent critic writes tests from the prompt only; SubQ Snap second opinion.
  const critic = await stage("verify", "Independent critic writing acceptance tests from your words only", async () => {
    const t = await writeAcceptanceTests(prompt);
    writeJSON(id, "acceptance.json", { written_from: "user prompt only (critic never sees the designer's reasoning or code)", model: t.model, criteria: t.criteria, rationale: t.rationale });
    emit({ runId: id, stage: "verify", phase: "progress", message: `${t.criteria.length} acceptance tests written by ${t.model}`, data: { acceptance: "acceptance.json", criteria: t.criteria }, model: t.provider });
    return t;
  });
  const doVerify = async (built: BuiltPart[], simVerdict: any, round: number) => {
    const checks = evaluate(critic.criteria, built.map((b) => ({ id: b.id, compiled: b.compiled, analysis: b.analysis, params: b.params })));
    const sat = await Promise.all(built.filter((b) => b.compiled).map((b) => subqPartSatisfies(prompt, b.scad, JSON.stringify({ dims_mm: b.analysis!.dims_mm, min_wall_mm: b.analysis!.min_wall_mm, holes: b.analysis!.holes.slice(0, 6) }))));
    const satVals = sat.filter((x): x is number => typeof x === "number");
    const subq = satVals.length ? +Math.min(...satVals).toFixed(3) : null;
    if (subq !== null) emit({ runId: id, stage: "verify", phase: "progress", message: `SubQ Snap: P(part fixes the problem) = ${subq}`, data: { subq_p_satisfies: subq }, model: "subq" });
    const allChecks: CheckResult[] = [...checks, ...(simVerdict?.checks || []).map((c: any) => ({ ...c, name: `sim:${c.name}` }))];
    // SubQ Snap is a second, independent opinion. It is recorded but advisory: it does not gate pass/fail.
    const advisory = subq !== null ? [{ name: "subq_judge_p_satisfies", pass: subq >= 0.5, value: subq, unit: "p", advisory: true }] : [];
    const fit = PRINTERS.find((p) => built.every((b) => b.compiled && fitsBed(b.analysis!.dims_mm, p.bed)));
    const pass = allChecks.every((c) => c.pass);
    const verdict = {
      pass, fits_printer: fit?.id || null,
      checks: [...allChecks.map((c) => ({ name: c.name, pass: c.pass, value: c.value, unit: c.unit })), ...advisory],
      subq_p_satisfies: subq,
      heatmap: simVerdict?.heatmap || null,
      notes: pass ? `All ${allChecks.length} independent checks pass` : `Failed: ${allChecks.filter((c) => !c.pass).map((c) => c.name).join(", ")}`,
      round, critic_model: critic.model, sim: simVerdict ? true : false,
    };
    writeJSON(id, "verdict.json", verdict);
    if (round > 0) writeJSON(id, `verdict.round${round}.json`, verdict);
    void saveVerdict(id, verdict);
    run.verdict = "verdict.json";
    run.verdictSummary = { pass, passed: allChecks.filter((c) => c.pass).length, total: allChecks.length, round };
    save();
    emit({ runId: id, stage: "verify", phase: "done", message: verdict.notes.slice(0, 160), data: { verdict: "verdict.json", pass, checks: verdict.checks } });
    return { verdict, allChecks };
  };
  run.stages.verify.status = "running"; save();
  let v = await doVerify(cad.built, cad.simVerdict, 0);
  run.stages.verify.status = "done"; save();

  // 5. IMPROVE — one repair round if anything failed.
  await stage("improve", v.verdict.pass ? "Nothing to repair" : "Repairing failed checks (1 round)", async () => {
    if (v.verdict.pass) { emit({ runId: id, stage: "improve", phase: "done", message: "Passed first time, no repair needed" }); return; }
    const failures = [
      ...cad.built.filter((b) => !b.compiled).map((b) => `${b.id} does not compile: ${b.log.slice(0, 300)}`),
      ...v.allChecks.filter((c) => !c.pass).map((c) => `${c.name} FAILED (measured ${c.value ?? "n/a"}${c.unit ? " " + c.unit : ""})`),
    ];
    fs.renameSync(path.join(dir, "design.json"), path.join(dir, "design.round0.json"));
    const rep = await repairDesign(prompt, skill.text, design, cad.built, failures);
    rep.design.kind = design.kind;
    design = rep.design;
    persistDesign(id, design, rep.model, skill.version);
    emit({ runId: id, stage: "improve", phase: "progress", message: `Designer revised ${design.parts.length} part(s) against ${failures.length} failure(s)`, model: rep.provider });
    cad = await doCad(design, "Recompiling repaired parts");
    run.stages.improve.status = "running";
    v = await doVerify(cad.built, cad.simVerdict, 1);
    emit({ runId: id, stage: "improve", phase: "done", message: v.verdict.pass ? "Repair fixed every failed check" : `Still failing after repair: ${v.allChecks.filter((c) => !c.pass).map((c) => c.name).join(", ")}`.slice(0, 160) });
  });

  // 6. RL — robots only: point at the RL lane's manifest.
  await stage("rl", diag.d.kind === "robot" ? "Looking for trained gait policies" : "Not a robot, skipping RL", async () => {
    if (diag.d.kind !== "robot") { run.rl = null; emit({ runId: id, stage: "rl", phase: "done", message: "Skipped (static/mechanism part)" }); return; }
    const local = path.join(dir, "rl", "manifest.json");
    const shared = path.join(repoRoot(), "rl", "manifest.json");
    if (!fs.existsSync(local) && fs.existsSync(shared)) {
      // copy the RL lane's manifest and every file it references so /api/runs/:id/files/rl/... serves them
      const src = path.dirname(shared), dst = path.dirname(local);
      fs.mkdirSync(dst, { recursive: true });
      fs.copyFileSync(shared, local);
      try {
        const m = JSON.parse(fs.readFileSync(shared, "utf8"));
        const refs = [m.mjcf, m.firmware, ...(m.skills || []).flatMap((k: any) => [k.policy, k.reward_fn, k.curve, k.video])].filter((x) => typeof x === "string");
        for (const r of refs) {
          const from = path.resolve(src, r);
          if (!from.startsWith(src) || !fs.existsSync(from)) continue;
          fs.mkdirSync(path.dirname(path.join(dst, r)), { recursive: true });
          fs.copyFileSync(from, path.join(dst, r));
        }
      } catch {}
    }
    run.rl = fs.existsSync(local) ? "rl/manifest.json" : null;
    emit({ runId: id, stage: "rl", phase: "done", message: run.rl ? "RL policies attached" : "No RL manifest yet (rl lane)", data: { rl: run.rl } });
  });

  // 7. MAKE — fab routing (fab lane if present) else printer-fit summary.
  await stage("make", "Routing to fabrication", async () => {
    const fabPy = path.join(repoRoot(), "fab", "route.py");
    const fabPath = path.join(dir, "fab.json");
    try { fs.unlinkSync(fabPath); } catch {}
    if (fs.existsSync(fabPy)) spawnSync("python3", [fabPy, dir], { cwd: repoRoot(), timeout: 120_000 });
    let laneManifest: any = null;
    try {
      // fab lane (web/lib/fab): vendor routing + quotes. Its downloads synthesize placeholder box meshes,
      // so we keep our real compiled STLs and only take its manifest plus any DXF cut files.
      const fab: any = await import("../fab");
      const bundle = await fab.routeFabrication(
        run.parts.filter((p: any) => p.compiled).map((p: any) => ({ id: p.id, name: p.name, material: p.material, dims_mm: p.dims_mm, quantity: 1, printable: p.printable, scad: p.scad, stl: p.stl })),
        { quotes: process.env.FAB_LIVE_QUOTES === "1" ? "live" : "skip", preferPrinter: v.verdict.fits_printer },
      );
      for (const f of bundle.files || []) {
        if (!/\.dxf$/i.test(f.relativePath)) continue;
        const dest = path.join(dir, f.relativePath);
        if (!fs.existsSync(dest)) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, f.bytes); }
      }
      laneManifest = bundle.manifest;
    } catch (e: any) {
      console.warn("[make] fab lane unavailable:", e?.message);
    }
    {
      const parts = cad.built.filter((b) => b.compiled).map((b) => {
        const mat = (b.material || "PETG").toUpperCase();
        const grams = +((b.analysis!.volume_mm3 / 1000) * (DENSITY[mat] || 1.25) * 0.6).toFixed(1); // ~60% effective fill w/ walls+infill
        return { part: b.id, name: b.name, stl: `parts/${b.id}.stl`, material: mat, dims_mm: b.analysis!.dims_mm, est_grams: grams,
          fits: PRINTERS.filter((p) => fitsBed(b.analysis!.dims_mm, p.bed)).map((p) => p.id) };
      });
      const fit = v.verdict.fits_printer;
      writeJSON(id, "fab.json", {
        ...(laneManifest || {}),
        route: laneManifest?.route ?? (fit ? "home-print" : "service"),
        printer: fit, printers_checked: PRINTERS.map((p) => ({ id: p.id, name: p.name, bed_mm: p.bed })),
        parts, print: design.print || null,
        note: fit ? `Prints on a ${PRINTERS.find((p) => p.id === fit)!.name}. Download the STL and slice.` : "Too big for common home printers; use a print service quote (no spend without confirmation).",
        core: { route: fit ? "home-print" : "service", printer: fit, parts, note: fit ? `Prints on a ${PRINTERS.find((p) => p.id === fit)!.name}.` : "Needs a print service." },
        source: laneManifest ? "fab lane (web/lib/fab) + core printer-fit" : "core printer-fit (fab lane unavailable)",
      });
    }
    run.fab = "fab.json";
    const fab = JSON.parse(fs.readFileSync(fabPath, "utf8"));
    emit({ runId: id, stage: "make", phase: "artifact", message: fab.note?.slice(0, 160) || "fab.json written", data: { fab: "fab.json", stls: run.parts.map((p: any) => p.stl) } });
    emit({ runId: id, stage: "make", phase: "done", message: v.verdict.pass ? "Ready to print" : "Printable, but some checks still fail — review before printing" });
  });

  run.status = "done";
  run.finishedAt = Date.now();
  save();
  return run;
}

function persistDesign(id: string, d: Design, model: string, skillVersion: string) {
  writeJSON(id, "design.json", { ...d, parts: d.parts.map(({ scad, ...p }) => ({ ...p, scad: `parts/${p.id}.scad` })), model, skillVersion });
}

function partsManifest(built: BuiltPart[], d: Design) {
  return built.map((b) => ({
    id: b.id, name: b.name, scad: `parts/${b.id}.scad`, stl: b.compiled ? `parts/${b.id}.stl` : null,
    material: b.material || "PETG", dims_mm: b.analysis?.dims_mm || null,
    printable: !!(b.compiled && PRINTERS.some((p) => fitsBed(b.analysis!.dims_mm, p.bed))),
    purpose: b.purpose, params: b.params, compiled: b.compiled,
  }));
}
