import fs from "node:fs";
import path from "node:path";
import { callLLM, parseJSON, type ChatMessage } from "../llm/router";
import { compileScad } from "./cad";
import type { Analysis } from "./geometry";

export type DesignPart = {
  id: string; name: string; material: string; purpose?: string; params?: Record<string, any>; scad: string;
};
export type Design = {
  kind: "static" | "mechanism" | "robot"; summary: string; assumptions: string[]; parts: DesignPart[];
  print?: { orientation?: string; supports?: boolean; infill_pct?: number };
};
export type BuiltPart = DesignPart & { scadPath: string; stlPath: string; compiled: boolean; log: string; analysis?: Analysis; engine?: string };

const FORMAT = `Return ONLY a JSON object:
{"kind":"static|mechanism|robot","summary":"one sentence","assumptions":["dimension or fit assumptions you made"],
 "parts":[{"id":"snake_case","name":"Human name","material":"PETG|PLA|TPU|ASA","purpose":"what it does",
   "params":{"key_dimension_mm":0},"scad":"complete standalone OpenSCAD source"}],
 "print":{"orientation":"how to place it on the bed","supports":false,"infill_pct":40}}`;

export async function writeDesign(prompt: string, skill: string, context?: string): Promise<{ design: Design; model: string; provider: string }> {
  const messages: ChatMessage[] = [
    { role: "system", content: `${skill}\n\n${FORMAT}` },
    { role: "user", content: `User's problem: ${prompt}${context ? `\n\nDiagnosis notes:\n${context}` : ""}` },
  ];
  const r = await callLLM({ role: "designer", messages, json: true, effort: "low" });
  const design = parseJSON<Design>(r.text);
  if (!Array.isArray(design.parts) || !design.parts.length) throw new Error("designer returned no parts");
  design.parts = design.parts.map((p, i) => ({ ...p, id: String(p.id || `part_${i + 1}`).replace(/[^a-z0-9_-]/gi, "_").toLowerCase() }));
  return { design, model: r.model, provider: r.provider };
}

export async function buildParts(dir: string, parts: DesignPart[]): Promise<BuiltPart[]> {
  fs.mkdirSync(path.join(dir, "parts"), { recursive: true });
  return Promise.all(parts.map(async (p) => {
    const scadPath = path.join(dir, "parts", `${p.id}.scad`);
    const stlPath = path.join(dir, "parts", `${p.id}.stl`);
    fs.writeFileSync(scadPath, p.scad);
    const c = await compileScad(scadPath, stlPath);
    return { ...p, scadPath, stlPath, compiled: c.ok, log: c.log, analysis: c.analysis, engine: c.engine };
  }));
}

/** One repair round: designer sees concrete failures (compile errors / failed checks with measured values). */
export async function repairDesign(prompt: string, skill: string, design: Design, built: BuiltPart[], failures: string[]): Promise<{ design: Design; model: string; provider: string }> {
  const partsReport = built.map((b) => ({
    id: b.id, compiled: b.compiled, compile_log: b.compiled ? undefined : b.log.slice(0, 1200),
    measured: b.analysis ? { dims_mm: b.analysis.dims_mm, min_wall_mm: b.analysis.min_wall_mm, holes: b.analysis.holes.slice(0, 8), volume_mm3: b.analysis.volume_mm3 } : null,
  }));
  const messages: ChatMessage[] = [
    { role: "system", content: `${skill}\n\n${FORMAT}` },
    { role: "user", content: `User's problem: ${prompt}` },
    { role: "assistant", content: JSON.stringify(design) },
    { role: "user", content: `An independent verifier measured your compiled parts and found problems:\n- ${failures.join("\n- ")}\n\nMeasurements: ${JSON.stringify(partsReport)}\n\nFix every problem. Return the complete corrected JSON (all parts, full OpenSCAD source).` },
  ];
  const r = await callLLM({ role: "designer", messages, json: true, effort: "low" });
  const d = parseJSON<Design>(r.text);
  if (!Array.isArray(d.parts) || !d.parts.length) throw new Error("repair returned no parts");
  d.parts = d.parts.map((p, i) => ({ ...p, id: String(p.id || `part_${i + 1}`).replace(/[^a-z0-9_-]/gi, "_").toLowerCase() }));
  return { design: d, model: r.model, provider: r.provider };
}
