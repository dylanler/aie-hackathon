// Subquadratic SubQ Snap 1.1: a decision model (judge), not chat. POST /v1/systemone.
const BASE = process.env.SUBQ_API_BASE || "https://api.subq.ai/v1";
export const SUBQ_MODEL = "subq-snap-1.1";

export type SubqQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: string[] };

export async function subqJudge(state: Record<string, string>, questions: Record<string, SubqQuestion>): Promise<Record<string, any>> {
  const key = process.env.SUBQ_API_KEY;
  const r = await fetch(`${BASE}/systemone`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: SUBQ_MODEL, state, questions }),
  });
  if (!r.ok) throw new Error(`subq ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j: any = await r.json();
  return j.answers || {};
}

/** P(yes) that the part satisfies the user's need. Returns null if SubQ is unreachable. */
export async function subqPartSatisfies(prompt: string, scad: string, measured: string): Promise<number | null> {
  try {
    const a = await subqJudge(
      { user_request: prompt, openscad_source: scad.slice(0, 60_000), measured_geometry: measured },
      { satisfies: { type: "noul", instructions: "Would this 3D-printable part, as written and measured, actually satisfy the user's request and physically fix their problem?" } },
    );
    return typeof a.satisfies?.noul === "number" ? a.satisfies.noul : null;
  } catch {
    return null;
  }
}
