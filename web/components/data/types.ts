/* eslint-disable @typescript-eslint/no-explicit-any */
export type Stage = "diagnose" | "design" | "cad" | "verify" | "improve" | "rl" | "make";
export type Phase = "start" | "progress" | "artifact" | "done" | "error";
export type RunEvent = { runId: string; stage: Stage; phase: Phase; message: string; data?: any; model?: string; ts: number };

export type Part = {
  id: string; name: string; scad?: string; stl?: string | null; material: string;
  dims_mm: [number, number, number]; printable: boolean; purpose?: string;
  params?: Record<string, number>; shape?: string;
};
export type Run = {
  id: string; prompt: string; kind: "static" | "mechanism" | "robot"; status?: string;
  parts: Part[]; verdict?: string | null; rl?: string | null; fab?: string | null; skillVersion?: string;
  createdAt?: number;
};
export type Check = { name: string; pass: boolean; value: number | string; unit?: string };
export type Verdict = { pass: boolean; fits_printer?: string; checks: Check[]; heatmap?: string | null; notes?: string; critic_model?: string };
export type RLSkill = { name: string; policy?: string; reward_fn?: string; reward_version: number; curve?: string | number[]; video?: string | null; success: number; candidates?: number };
export type RLManifest = { robot: string; mjcf?: string; skills: RLSkill[]; firmware?: string; judge?: string };
export type FabPart = { part: string; name: string; stl?: string; material: string; dims_mm: number[]; est_grams?: number; fits?: string[]; process?: string; vendor?: string; quote_usd?: number; lead_days?: number };
export type Fab = {
  route: string; printer?: string; parts: FabPart[]; note?: string;
  print?: { orientation?: string; supports?: boolean; infill_pct?: number; hours?: number; plates?: number; cost_usd?: number };
  quotes?: { vendor: string; usd: number; days?: number; note?: string }[];
};
export type HistoryEntry = {
  version: string; parent: string | null; trainPass: number; heldoutPass: number; adopted: boolean;
  diffSummary: string; ts: number; trainN?: number; heldoutN?: number;
};

export type StepKey = "diagnose" | "design" | "verify" | "train" | "make";
export type StepState = "idle" | "running" | "done" | "error" | "skipped";
export const STEPS: { key: StepKey; label: string; stages: Stage[] }[] = [
  { key: "diagnose", label: "Diagnose", stages: ["diagnose"] },
  { key: "design", label: "Design", stages: ["design", "cad"] },
  { key: "verify", label: "Verify", stages: ["verify", "improve"] },
  { key: "train", label: "Train", stages: ["rl"] },
  { key: "make", label: "Make", stages: ["make"] },
];
export const stepOf = (s: Stage): StepKey => STEPS.find((x) => x.stages.includes(s))!.key;

export const modelName = (m?: string) => {
  if (!m) return null;
  const k = m.toLowerCase();
  if (k.includes("gemini")) return "Gemini Argon";
  if (k.includes("subq")) return "SubQ";
  if (k.includes("muse")) return "Muse";
  return m;
};
