import type { Analysis } from "./geometry";

// Machine-checkable acceptance criteria. Shared by the run-time critic and the eval harness.
export type Criterion =
  | { type: "compiles" }
  | { type: "watertight" }
  | { type: "fits_bed"; bed_mm?: [number, number, number] }
  | { type: "bbox_max"; mm: [number, number, number] } // orientation-agnostic (sorted dims)
  | { type: "bbox_min"; mm: [number, number, number] }
  | { type: "min_wall"; mm: number }
  | { type: "through_hole"; d: number; tol?: number; count?: number }
  | { type: "volume_max"; mm3: number }
  | { type: "volume_min"; mm3: number }
  | { type: "parts_min"; n: number }
  | { type: "declared_param_min"; name: string; min: number; unit?: string };

export type PartMeasure = { id: string; compiled: boolean; analysis?: Analysis; params?: Record<string, any> };
export type CheckResult = { name: string; pass: boolean; value: number | string | null; unit?: string; expected?: string; part?: string };

const sorted = (v: number[]) => [...v].sort((a, b) => a - b);
export const DEFAULT_BED: [number, number, number] = [256, 256, 256]; // Bambu Lab X1/P1 class

export function criterionLabel(c: Criterion): string {
  switch (c.type) {
    case "compiles": return "OpenSCAD compiles";
    case "watertight": return "mesh is watertight";
    case "fits_bed": return `fits ${(c.bed_mm || DEFAULT_BED).join("×")} mm bed`;
    case "bbox_max": return `size ≤ ${c.mm.join("×")} mm`;
    case "bbox_min": return `size ≥ ${c.mm.join("×")} mm`;
    case "min_wall": return `wall ≥ ${c.mm} mm`;
    case "through_hole": return `${c.count && c.count > 1 ? c.count + "× " : ""}through-hole Ø${c.d}±${c.tol ?? 0.6} mm`;
    case "volume_max": return `volume ≤ ${c.mm3} mm³`;
    case "volume_min": return `volume ≥ ${c.mm3} mm³`;
    case "parts_min": return `≥ ${c.n} parts`;
    case "declared_param_min": return `${c.name} ≥ ${c.min}${c.unit ? " " + c.unit : ""} (declared)`;
  }
}

/** Evaluate criteria against measured parts. Size/hole/wall criteria pass if ANY part satisfies them
 *  (multi-part designs); compiles/watertight/fits_bed must hold for EVERY part. */
export function evaluate(criteria: Criterion[], parts: PartMeasure[]): CheckResult[] {
  const out: CheckResult[] = [];
  const compiled = parts.filter((p) => p.compiled && p.analysis);
  const any = (f: (a: Analysis, p: PartMeasure) => boolean) => compiled.some((p) => f(p.analysis!, p));
  for (const c of criteria) {
    const name = criterionLabel(c);
    switch (c.type) {
      case "compiles":
        out.push({ name, pass: parts.length > 0 && parts.every((p) => p.compiled), value: `${compiled.length}/${parts.length}` });
        break;
      case "watertight":
        out.push({ name, pass: compiled.length > 0 && compiled.every((p) => p.analysis!.watertight), value: compiled.filter((p) => p.analysis!.watertight).length });
        break;
      case "fits_bed": {
        const bed = sorted(c.bed_mm || DEFAULT_BED);
        const worst = Math.max(0, ...compiled.map((p) => sorted(p.analysis!.dims_mm).at(-1)!));
        out.push({ name, pass: compiled.length > 0 && compiled.length === parts.length && compiled.every((p) => sorted(p.analysis!.dims_mm).every((d, i) => d <= bed[i])), value: +worst.toFixed(1), unit: "mm" });
        break;
      }
      case "bbox_max": {
        const lim = sorted(c.mm);
        const best = compiled.map((p) => sorted(p.analysis!.dims_mm));
        out.push({ name, pass: best.some((d) => d.every((x, i) => x <= lim[i] + 0.01)), value: best[0] ? best[0].join("×") : null, unit: "mm" });
        break;
      }
      case "bbox_min": {
        const lim = sorted(c.mm);
        const best = compiled.map((p) => sorted(p.analysis!.dims_mm));
        out.push({ name, pass: best.some((d) => d.every((x, i) => x >= lim[i] - 0.01)), value: best[0] ? best[0].join("×") : null, unit: "mm" });
        break;
      }
      case "min_wall": {
        const vals = compiled.map((p) => p.analysis!.min_wall_mm ?? 0);
        const worst = vals.length ? Math.min(...vals) : null;
        out.push({ name, pass: worst !== null && worst >= c.mm - 0.05, value: worst, unit: "mm" });
        break;
      }
      case "through_hole": {
        const tol = c.tol ?? 0.6, need = c.count ?? 1;
        let best = 0, closest: number | null = null;
        for (const p of compiled) {
          const hs = p.analysis!.holes;
          for (const h of hs) if (closest === null || Math.abs(h.d_mm - c.d) < Math.abs(closest - c.d)) closest = h.d_mm;
          for (const ax of ["x", "y", "z"]) best = Math.max(best, hs.filter((h) => h.axis === ax && Math.abs(h.d_mm - c.d) <= tol).length);
        }
        out.push({ name, pass: best >= need, value: closest, unit: "mm", expected: `${need} match(es), found ${best}` });
        break;
      }
      case "volume_max":
        out.push({ name, pass: any((a) => a.volume_mm3 <= c.mm3), value: compiled[0]?.analysis!.volume_mm3 ?? null, unit: "mm3" });
        break;
      case "volume_min":
        out.push({ name, pass: any((a) => a.volume_mm3 >= c.mm3), value: compiled[0]?.analysis!.volume_mm3 ?? null, unit: "mm3" });
        break;
      case "parts_min":
        out.push({ name, pass: parts.length >= c.n, value: parts.length });
        break;
      case "declared_param_min": {
        const v = parts.map((p) => Number(p.params?.[c.name])).find((x) => Number.isFinite(x));
        out.push({ name, pass: v !== undefined && v >= c.min, value: v ?? null, unit: c.unit });
        break;
      }
    }
  }
  return out;
}
