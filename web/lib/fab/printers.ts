import type { PrinterFit, PrinterFitCheck, PrinterId, PrinterSpec } from "./types";

/** Mainstream printers from the fabrication lane brief. */
export const PRINTERS: readonly PrinterSpec[] = [
  { id: "bambu-a1", name: "Bambu Lab A1", build_mm: [256, 256, 256] },
  { id: "prusa-mk4", name: "Prusa MK4", build_mm: [250, 210, 220] },
];

const AXIS_PERMUTATIONS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

export function isPrinterId(value: string): value is PrinterId {
  return value === "bambu-a1" || value === "prusa-mk4";
}

function orientationThatFits(
  dims: readonly [number, number, number],
  build: readonly [number, number, number],
): [number, number, number] | null {
  for (const perm of AXIS_PERMUTATIONS) {
    const oriented: [number, number, number] = [dims[perm[0]], dims[perm[1]], dims[perm[2]]];
    if (oriented[0] <= build[0] && oriented[1] <= build[1] && oriented[2] <= build[2]) {
      return oriented;
    }
  }
  return null;
}

export function fitOnPrinter(
  dims: readonly [number, number, number],
  printer: PrinterSpec,
): PrinterFitCheck {
  const orientation = orientationThatFits(dims, printer.build_mm);
  return {
    id: printer.id,
    name: printer.name,
    fits: orientation !== null,
    orientation_mm: orientation,
  };
}

/**
 * A part fits when some 90° orientation sits inside the build volume.
 * `prefer` keeps the verifier's printer when that one also fits.
 */
export function fitPrinters(
  dims: readonly [number, number, number],
  prefer?: string | null,
): PrinterFit {
  const checked = PRINTERS.map((printer) => fitOnPrinter(dims, printer));
  const preferred = prefer && isPrinterId(prefer) ? checked.find((item) => item.id === prefer && item.fits) : undefined;
  const winner = preferred ?? checked.find((item) => item.fits) ?? null;
  if (!winner) {
    return {
      fits: false,
      printerId: null,
      orientation_mm: null,
      checked,
      reason: "Does not fit a Bambu A1 (256 mm cube) or a Prusa MK4 (250 × 210 × 220 mm) in any orientation.",
    };
  }
  const oriented = winner.orientation_mm ?? dims;
  return {
    fits: true,
    printerId: winner.id,
    orientation_mm: [oriented[0], oriented[1], oriented[2]],
    checked,
    reason: `Fits ${winner.name} at ${oriented.map((n) => trim(n)).join(" × ")} mm.`,
  };
}

function trim(value: number): string {
  return Number(value.toFixed(3)).toString();
}
