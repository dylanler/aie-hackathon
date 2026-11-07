import type { Fab, RLManifest, Run, RunEvent, Verdict } from "@/components/data/types";

export const dogRun: Run = {
  id: "demo-robot-dog",
  prompt: "A mini robot dog that can play dead",
  kind: "robot",
  skillVersion: "v5",
  parts: [
    { id: "chassis", name: "Chassis", material: "PLA", shape: "chassis", dims_mm: [140, 70, 40], printable: true, params: { length_mm: 140, width_mm: 70, height_mm: 40 } },
    { id: "head", name: "Head", material: "PLA", shape: "head", dims_mm: [50, 44, 40], printable: true },
    { id: "thigh", name: "Thigh ×4", material: "PLA", shape: "thigh", dims_mm: [60, 18, 14], printable: true, params: { leg_mm: 60 } },
    { id: "shin", name: "Shin ×4", material: "Aluminum 6061", shape: "shin", dims_mm: [64, 12, 3], printable: false },
    { id: "deck", name: "Top deck", material: "Birch ply 3 mm", shape: "deck", dims_mm: [130, 64, 3], printable: false },
  ],
  verdict: "verdict.json", rl: "rl/manifest.json", fab: "fab.json",
};

export const dogVerdict: Verdict = {
  pass: true, fits_printer: "bambu-a1", critic_model: "gemini-argon",
  checks: [
    { name: "No interpenetration", pass: true, value: 0.0, unit: "mm³" },
    { name: "Joint clearance", pass: true, value: 0.6, unit: "mm" },
    { name: "Stands under own weight", pass: true, value: 1.8, unit: "kg" },
    { name: "Servo torque margin", pass: true, value: 1.4, unit: "×" },
    { name: "Fits printer bed", pass: true, value: "256 mm", unit: "" },
  ],
  heatmap: null, notes: "All joints clear. Stands and rolls without collisions.",
};

const curve = (n: number, end: number, noise: number, seed: number) => {
  let s = seed; const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280 - 0.5);
  return Array.from({ length: n }, (_, i) => { const x = i / (n - 1); return +(end * (1 - Math.exp(-4 * x)) + r() * noise).toFixed(3); });
};

export const dogRL: RLManifest = {
  robot: "mini-dog-12dof", mjcf: "robot.xml", judge: "subq-snap-1.1",
  skills: [
    { name: "walk", reward_version: 4, curve: curve(48, 0.92, 0.06, 3), video: null, success: 0.92, candidates: 4 },
    { name: "trot", reward_version: 3, curve: curve(48, 0.81, 0.08, 7), video: null, success: 0.81, candidates: 4 },
    { name: "rollover", reward_version: 2, curve: curve(48, 0.74, 0.1, 11), video: null, success: 0.74, candidates: 4 },
    { name: "play dead", reward_version: 4, curve: curve(48, 0.96, 0.04, 5), video: null, success: 0.96, candidates: 4 },
  ],
  firmware: "firmware/README.md",
};

export const dogFab: Fab = {
  route: "mixed", printer: "bambu-a1",
  parts: [
    { part: "chassis", name: "Chassis", material: "PLA", dims_mm: [140, 70, 40], est_grams: 64, process: "FDM" },
    { part: "head", name: "Head", material: "PLA", dims_mm: [50, 44, 40], est_grams: 18, process: "FDM" },
    { part: "thigh", name: "Thigh ×4", material: "PLA", dims_mm: [60, 18, 14], est_grams: 22, process: "FDM" },
    { part: "shin", name: "Shin ×4", material: "Aluminum 6061", dims_mm: [64, 12, 3], process: "Laser cut", vendor: "SendCutSend", quote_usd: 31.6, lead_days: 5 },
    { part: "deck", name: "Top deck", material: "Birch ply 3 mm", dims_mm: [130, 64, 3], process: "Laser cut", vendor: "SendCutSend", quote_usd: 9.4, lead_days: 5 },
  ],
  print: { orientation: "Chassis upside down", supports: true, infill_pct: 25, hours: 7.4, plates: 2, cost_usd: 2.1 },
  quotes: [
    { vendor: "Craftcloud", usd: 38.5, days: 5, note: "PLA, shipped" },
    { vendor: "Xometry", usd: 46.0, days: 6, note: "Shins, 6061" },
  ],
  note: "Print 3 parts at home. Cut 2 in metal and wood.",
};

const t = (stage: RunEvent["stage"], phase: RunEvent["phase"], message: string, model?: string, data?: Record<string, unknown>) =>
  ({ runId: "demo-robot-dog", stage, phase, message, model, data, ts: 0 }) as RunEvent;

export const dogEvents: [number, RunEvent][] = [
  [300, t("diagnose", "start", "Reading the idea", "gemini-argon")],
  [900, t("diagnose", "done", "A 12-DOF quadruped, palm-sized, with four learned skills.", "gemini-argon", {
    kind: "robot", object: "Mini robot dog", failure: "New product, four behaviours",
    assumptions: ["12 × SG90 micro servos", "ESP32 controller", "Under 400 g"],
  })],
  [500, t("design", "start", "Designing with the adopted skill", "muse")],
  [1100, t("design", "artifact", "5 parts: chassis, head, thigh, shin, deck", "muse")],
  [700, t("cad", "done", "5/5 parts compiled")],
  [300, t("design", "done", "Chassis with 12 servo pockets", "muse")],
  [500, t("verify", "start", "Building MJCF assembly", "gemini-argon")],
  [900, t("verify", "done", "Fits. 0.6 mm joint clearance", "gemini-argon")],
  [400, t("rl", "start", "4 reward candidates per skill", "muse")],
  [900, t("rl", "progress", "Judge picked one reward per skill", "subq")],
  [900, t("rl", "progress", "PPO on MuJoCo: walk, trot, rollover, play dead", undefined)],
  [500, t("rl", "done", "4 skills trained", undefined)],
  [400, t("make", "done", "Print 3 parts, cut 2", undefined)],
];
