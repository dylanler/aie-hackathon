import { callLLM, parseJSON } from "../llm/router";
import type { Criterion } from "./checks";

const VOCAB = `Allowed criterion types (machine-checkable on the compiled STL):
{"type":"compiles"} | {"type":"fits_bed","bed_mm":[256,256,256]} | {"type":"bbox_max","mm":[x,y,z]} | {"type":"bbox_min","mm":[x,y,z]}
| {"type":"min_wall","mm":n} | {"type":"through_hole","d":n,"tol":n,"count":n} | {"type":"volume_min","mm3":n} | {"type":"volume_max","mm3":n}
| {"type":"parts_min","n":n}
bbox criteria are orientation-agnostic (sorted dimensions). through_hole is a hole that goes all the way through along one axis.`;

/**
 * Independent critic. Sees ONLY the user's prompt — never the designer's reasoning, parameters or code —
 * and writes the acceptance tests the part must pass. Routed to a different provider than the designer.
 */
export async function writeAcceptanceTests(prompt: string): Promise<{ criteria: Criterion[]; rationale: string[]; model: string; provider: string }> {
  const r = await callLLM({
    role: "critic",
    json: true,
    effort: "low",
    messages: [
      { role: "system", content: `You are a skeptical mechanical QA engineer. Another engineer (whom you cannot see) will 3D-print a part to fix the user's problem. Write acceptance tests that a correct part MUST pass. Be realistic about household part sizes: give generous ranges, never exact sizes you cannot know. Always include compiles, fits_bed and a min_wall (>=1.2 mm for PETG/PLA load-bearing parts). Only add through_hole if the request clearly needs a screw/pin/axle hole, with its plausible diameter and tol>=1.0.\n${VOCAB}\nReturn JSON {"criteria":[...],"rationale":["one line per criterion"]}` },
      { role: "user", content: prompt },
    ],
  });
  const j = parseJSON<{ criteria: Criterion[]; rationale?: string[] }>(r.text);
  const allowed = new Set(["compiles", "fits_bed", "bbox_max", "bbox_min", "min_wall", "through_hole", "volume_min", "volume_max", "parts_min"]);
  const criteria = (j.criteria || []).filter((c: any) => c && allowed.has(c.type));
  if (!criteria.some((c) => c.type === "compiles")) criteria.unshift({ type: "compiles" });
  if (!criteria.some((c) => c.type === "fits_bed")) criteria.push({ type: "fits_bed", bed_mm: [256, 256, 256] });
  return { criteria, rationale: j.rationale || [], model: r.model, provider: r.provider };
}
