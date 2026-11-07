import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { routeFabrication, type RouteOptions } from "./route";
import type { FabBundle, FabPartInput } from "./types";

/** Writes `fab.json` plus the STL, 3MF, and DXF files the manifest points at. */
export async function writeFabRun(runDir: string, parts: readonly FabPartInput[], options: RouteOptions = {}): Promise<FabBundle> {
  const bundle = await routeFabrication(parts, options);
  await mkdir(join(runDir, "parts"), { recursive: true });
  for (const file of bundle.files) {
    const dest = join(runDir, file.relativePath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, file.bytes);
  }
  await writeFile(join(runDir, "fab.json"), `${JSON.stringify(bundle.manifest, null, 2)}\n`);
  return bundle;
}
