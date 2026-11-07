import type { HistoryEntry } from "@/components/data/types";

/** Placeholder history used only when /api/evals is unreachable. */
export const historyFixture: HistoryEntry[] = [
  { version: "v1", parent: null, trainPass: 0.33, heldoutPass: 4 / 15, heldoutN: 15, adopted: true, diffSummary: "Baseline design skill", ts: 0 },
  { version: "v2", parent: "v1", trainPass: 0.5, heldoutPass: 7 / 15, heldoutN: 15, adopted: true, diffSummary: "Add 0.4 mm clearance to every mating face", ts: 0 },
  { version: "v3", parent: "v2", trainPass: 0.62, heldoutPass: 6 / 15, heldoutN: 15, adopted: false, diffSummary: "Thinner walls to cut print time. Broke the load test, rolled back", ts: 0 },
  { version: "v4", parent: "v2", trainPass: 0.71, heldoutPass: 10 / 15, heldoutN: 15, adopted: true, diffSummary: "Fillet hooks; measure screws before modelling holes", ts: 0 },
  { version: "v5", parent: "v4", trainPass: 0.8, heldoutPass: 12 / 15, heldoutN: 15, adopted: true, diffSummary: "Snap fits get a ramped lead-in", ts: 0 },
];
