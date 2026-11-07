import type { MaterialFamily } from "./types";

const METAL = /\b(alumin(?:um|ium)|steel|stainless|brass|copper|titan(?:ium)?|bronze|metal)\b/i;
const WOOD = /\b(wood|plywood|ply|mdf|birch|walnut|bamboo|oak|maple|hardboard|veneer)\b/i;
const PLASTIC = /\b(petg|pla|abs|asa|tpu|nylon|pa12|resin|polycarbonate|pc|filament|plastic)\b/i;

export function classifyMaterial(material: string | undefined, printable?: boolean): MaterialFamily {
  const label = material ?? "";
  if (METAL.test(label)) return "metal";
  if (WOOD.test(label)) return "wood";
  if (PLASTIC.test(label)) return "plastic";
  if (printable === false) return "other";
  return "plastic";
}

export interface CraftcloudMaterial {
  materialConfigId: string;
  label: string;
}

/**
 * Standard-finish config ids from the public Craftcloud material catalog
 * (customer-api.craftcloud3d.com/material-catalog), black unless noted.
 */
export const CRAFTCLOUD_MATERIALS: Record<"petg" | "pla" | "abs" | "asa", CraftcloudMaterial> = {
  petg: { materialConfigId: "26d219f7-8e2b-5a80-894d-a7aaa9acb1ed", label: "PETG Standard (Black)" },
  pla: { materialConfigId: "dbd0f115-04e7-5704-887a-c6e7aedfd97d", label: "PLA Standard (Black)" },
  abs: { materialConfigId: "29f62d8a-8882-5624-acab-03ef7d601690", label: "ABS Standard (Black)" },
  asa: { materialConfigId: "b7bf2503-8f20-51b8-bb86-14bde1243fd2", label: "ASA Standard (Black)" },
};

export function craftcloudMaterial(material: string | undefined): CraftcloudMaterial {
  const label = (material ?? "").toLowerCase();
  if (label.includes("asa")) return CRAFTCLOUD_MATERIALS.asa;
  if (label.includes("abs")) return CRAFTCLOUD_MATERIALS.abs;
  if (label.includes("pla")) return CRAFTCLOUD_MATERIALS.pla;
  return CRAFTCLOUD_MATERIALS.petg;
}

/** Keyword passed to OSH Cut's material list. Chosen from a fixed set. */
export function oshCutMaterialToken(material: string | undefined): string {
  const label = material ?? "";
  if (/6061/i.test(label)) return "6061";
  if (/304|stainless/i.test(label)) return "304";
  if (/brass/i.test(label)) return "Brass";
  if (/copper/i.test(label)) return "Copper";
  if (/steel/i.test(label)) return "Steel";
  return "5052";
}

export const OSHCUT_FALLBACK_SHEET = {
  materialSheetId: 15,
  name: "Aluminum 5052 H32, 0.125 in",
  thicknessIn: 0.125,
};
