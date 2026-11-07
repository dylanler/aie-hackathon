import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFabRun } from "./manifest";
import type { FabPartInput } from "./types";

/** Sample parts a reviewer can route without the rest of the pipeline. */
export const DEMO_PARTS: readonly FabPartInput[] = [
  {
    id: "latch",
    name: "Door latch clip",
    material: "PETG",
    dims_mm: [60, 22, 14],
    quantity: 1,
    printable: true,
    scad: "parts/latch.scad",
  },
  {
    id: "cover",
    name: "Freezer cover panel",
    material: "PLA",
    dims_mm: [320, 180, 4],
    quantity: 1,
    printable: true,
  },
  {
    id: "bracket",
    name: "Aluminum Z-bracket blank",
    material: "Aluminum 5052",
    dims_mm: [101.6, 50.8, 3.175],
    quantity: 1,
    printable: false,
  },
  {
    id: "shelf",
    name: "Birch shelf",
    material: "Birch plywood",
    dims_mm: [400, 200, 12],
    quantity: 1,
    printable: false,
  },
];

async function main(): Promise<void> {
  const demoDir = join(dirname(fileURLToPath(import.meta.url)), "../../../fab/demo");
  await mkdir(demoDir, { recursive: true });
  await writeFile(join(demoDir, "input.json"), `${JSON.stringify(DEMO_PARTS, null, 2)}\n`);
  const quotes = process.env.FAB_LIVE_QUOTES === "0" ? "skip" : "live";
  const bundle = await writeFabRun(demoDir, DEMO_PARTS, { quotes, countryCode: "US", currency: "USD" });
  const lines = bundle.manifest.parts.map((part) => {
    const quote = part.quotes.map((item) => `${item.vendor}:${item.status}${item.total != null ? ` $${item.total}` : ""}`).join(", ");
    return `${part.id} ${part.route} printer=${part.fitsPrinter.fits ? part.fitsPrinter.printerId : "no"} quotes=${quote}`;
  });
  process.stdout.write(`${lines.join("\n")}\n`);
  process.stdout.write(`wrote ${demoDir}/fab.json (${bundle.files.length} files, orders=${bundle.manifest.orderPlaced})\n`);
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "demo failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
