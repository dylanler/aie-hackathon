import type { Fab, Run, RunEvent, Verdict } from "@/components/data/types";

export const freezerRun: Run = {
  id: "demo-freezer-latch",
  prompt: "My freezer door won't stay shut",
  kind: "static",
  skillVersion: "v5",
  parts: [
    {
      id: "latch_clip", name: "Latch clip", stl: null, material: "PETG", shape: "latch",
      dims_mm: [32, 20, 14], printable: true,
      purpose: "Screws to the frame and snaps over the striker pin",
      params: { length_mm: 32, width_mm: 20, base_mm: 4, hook_mm: 10 },
    },
    {
      id: "shim", name: "Hinge shim", stl: null, material: "PETG", shape: "shim",
      dims_mm: [24, 18, 1.6], printable: true,
      purpose: "Re-squares the door so the gasket seals",
      params: { thickness_mm: 1.6 },
    },
  ],
  verdict: "verdict.json", rl: null, fab: "fab.json",
};

export const freezerVerdict: Verdict = {
  pass: true, fits_printer: "bambu-a1", critic_model: "gemini-argon",
  checks: [
    { name: "Compiles to a closed mesh", pass: true, value: "2/2" },
    { name: "No interpenetration", pass: true, value: 0.0, unit: "mm³" },
    { name: "Clearance to striker", pass: true, value: 0.4, unit: "mm" },
    { name: "Holds door closed", pass: true, value: 35, unit: "N" },
    { name: "Wall thickness", pass: true, value: 2.5, unit: "mm" },
    { name: "Fits printer bed", pass: true, value: "256 mm", unit: "" },
  ],
  heatmap: null,
  notes: "Hook clears the striker by 0.4 mm and holds 35 N.",
};

export const freezerFab: Fab = {
  route: "home-print", printer: "bambu-a1",
  parts: [
    { part: "latch_clip", name: "Latch clip", material: "PETG", dims_mm: [32, 20, 14], est_grams: 2.8, fits: ["bambu-a1", "prusa-mk4"] },
    { part: "shim", name: "Hinge shim", material: "PETG", dims_mm: [24, 18, 1.6], est_grams: 0.7, fits: ["bambu-a1", "prusa-mk4"] },
  ],
  print: { orientation: "Flat, hook up", supports: false, infill_pct: 50, hours: 0.6, plates: 1, cost_usd: 0.09 },
  quotes: [
    { vendor: "Craftcloud", usd: 7.8, days: 4, note: "PETG, shipped" },
    { vendor: "JLC3DP", usd: 5.2, days: 7, note: "PETG, shipped" },
  ],
  note: "Prints on a Bambu Lab A1 in 36 minutes.",
};

const t = (stage: RunEvent["stage"], phase: RunEvent["phase"], message: string, model?: string, data?: any) =>
  ({ runId: "demo-freezer-latch", stage, phase, message, model, data, ts: 0 }) as RunEvent;

/** Replayed with the delays (ms after previous event). */
export const freezerEvents: [number, RunEvent][] = [
  [300, t("diagnose", "start", "Reading the problem", "gemini-argon")],
  [900, t("diagnose", "progress", "Likely a snapped latch hook, not the gasket", "gemini-argon")],
  [900, t("diagnose", "done", "Snapped latch hook. The door can't catch the striker.", "gemini-argon", {
    kind: "static", object: "Freezer door latch", failure: "Retaining hook snapped from cold fatigue",
    assumptions: ["Striker pin Ø6 mm", "Two M4 screws, 24 mm apart", "PETG for -20 °C toughness"],
  })],
  [500, t("design", "start", "Designing with skill v5", "muse")],
  [1100, t("design", "progress", "Ramped lip so the door snaps, not slams", "muse")],
  [800, t("design", "artifact", "2 parts: latch clip, hinge shim", "muse")],
  [400, t("cad", "start", "Compiling OpenSCAD to STL")],
  [900, t("cad", "done", "2/2 parts compiled")],
  [300, t("design", "done", "Latch clip with a ramped snap lip", "muse")],
  [500, t("verify", "start", "Independent checks, written from your words only", "gemini-argon")],
  [900, t("verify", "progress", "MuJoCo: closing the door 50 times", "gemini-argon")],
  [900, t("verify", "progress", "SubQ judge: P(fixes the problem) = 0.91", "subq")],
  [600, t("verify", "done", "Fits. 0.4 mm clearance, holds 35 N", "gemini-argon")],
  [300, t("improve", "done", "Nothing to repair")],
  [300, t("rl", "done", "Static part. Nothing to train.")],
  [400, t("make", "start", "Routing to fabrication")],
  [700, t("make", "done", "Prints on a Bambu Lab A1 in 36 min", undefined)],
];
