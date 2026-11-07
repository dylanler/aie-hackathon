import { boxTriangles, flatPatternMm, polygonDxf, rectangleDxf, stlBytes, threeMfBytes } from "./mesh";
import type { DownloadFile, FabPartInput } from "./types";

export function safePartId(id: string): string {
  const clean = id.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!clean || clean === "." || clean === "..") {
    throw new Error(`Part id "${id}" cannot be used as a filename.`);
  }
  return clean;
}

export function partDownloads(
  part: FabPartInput,
  formats: Array<"stl" | "3mf" | "dxf">,
): DownloadFile[] {
  const id = safePartId(part.id);
  const triangles = boxTriangles(part.dims_mm);
  const files: DownloadFile[] = [];
  if (formats.includes("stl")) {
    const bytes = stlBytes(triangles, id);
    files.push(file(id, "stl", "model/stl", "print", bytes));
  }
  if (formats.includes("3mf")) {
    const bytes = threeMfBytes(triangles);
    files.push(file(id, "3mf", "model/3mf", "print", bytes));
  }
  if (formats.includes("dxf")) {
    const text = dxfForPart(part);
    files.push(file(id, "dxf", "application/dxf", "flat-pattern", new TextEncoder().encode(text)));
  }
  return files;
}

export function dxfForPart(part: FabPartInput): string {
  if (part.outline_mm && part.outline_mm.length >= 3) {
    return polygonDxf(part.outline_mm, "mm");
  }
  const flat = flatPatternMm(part.dims_mm);
  return rectangleDxf(flat.width, flat.height, "mm");
}

function file(
  id: string,
  format: "stl" | "3mf" | "dxf",
  mediaType: string,
  role: "print" | "flat-pattern",
  bytes: Uint8Array,
): DownloadFile {
  const filename = `${id}.${format}`;
  return {
    partId: id,
    format,
    filename,
    relativePath: `parts/${filename}`,
    mediaType,
    role,
    bytes,
  };
}
