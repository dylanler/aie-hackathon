import { OSHCUT_FALLBACK_SHEET, oshCutMaterialToken } from "./materials";
import { clip, quoteRecord, unavailableQuote } from "./quote";
import type { QuoteSummary } from "./types";
import { fabworksLink, VENDORS } from "./vendors";

export const OSHCUT_MCP_URL = "https://app.oshcut.com/api/mcp";

export interface OshCutQuoteRequest {
  filename: string;
  bytes: Uint8Array;
  material?: string;
  /** Smallest part dimension, used to pick a stock thickness. */
  thicknessMm?: number;
  quantity?: number;
  name?: string;
  /** DXF unit hint sent with the cart. Geometry in `bytes` stays as authored. */
  units?: "mm" | "in";
  fetch?: typeof fetch;
  mcpUrl?: string;
}

interface SheetChoice {
  id: number;
  name: string;
  thicknessIn: number;
  assumed: boolean;
}

export async function quoteOshCut(request: OshCutQuoteRequest): Promise<QuoteSummary> {
  const fetchImpl = request.fetch ?? fetch;
  const mcpUrl = request.mcpUrl ?? process.env.OSHCUT_MCP_URL ?? OSHCUT_MCP_URL;
  const alternatives = [fabworksLink()];
  try {
    const sheet = await resolveSheet(fetchImpl, mcpUrl, request.material, request.thicknessMm);
    const file = {
      filename: request.filename.endsWith(".dxf") ? request.filename : `${request.filename}.dxf`,
      content_base64: bytesToBase64(request.bytes),
    };
    const dfmText = await toolCall(fetchImpl, mcpUrl, "check_manufacturability", {
      materialId: sheet.id,
      summary: true,
      units: request.units === "in" ? "in" : "mm",
      file,
    });
    const dfm = parseToolJson(dfmText);
    const manufacturable = dfm.manufacturable !== false && !hasFindings(dfm, "error");
    if (!manufacturable) {
      return unavailableQuote(
        "oshcut",
        `OSH Cut cannot make this blank in ${sheet.name}. ${findingText(dfm)} Download the DXF and revise it. Fabworks is the other sheet-metal option.`,
        alternatives,
        VENDORS.oshCutApp,
      );
    }

    const addedText = await toolCall(fetchImpl, mcpUrl, "add_parts_to_cart", {
      files: [file],
      parts: JSON.stringify([
        {
          file: file.filename,
          qty: request.quantity && request.quantity > 0 ? Math.round(request.quantity) : 1,
          name: request.name ?? file.filename,
          material_sheet_id: sheet.id,
          units: request.units === "in" ? "in" : "mm",
          finishing: "none",
        },
      ]),
    });
    const added = parseToolJson(addedText);
    const orderGuid = typeof added.order_guid === "string" ? added.order_guid : null;
    const cartUrl = typeof added.cart_url === "string" ? added.cart_url : orderGuid ? VENDORS.oshCutCart(orderGuid) : null;
    const partErrors = partMessages(added, "dfm_errors");
    if (!orderGuid || partErrors.length > 0) {
      return unavailableQuote(
        "oshcut",
        partErrors.length > 0
          ? `OSH Cut flagged the part: ${partErrors.join("; ")}. Fabworks can quote the same DXF.`
          : "OSH Cut quote unavailable: the cart was not created. Upload the DXF on their site.",
        alternatives,
        cartUrl ?? VENDORS.oshCutApp,
      );
    }

    const quoteText = await toolCall(fetchImpl, mcpUrl, "quote_cart", {
      order_guid: orderGuid,
      summary: true,
    });
    const quote = parseToolJson(quoteText);
    const leads = Array.isArray(quote.lead_options) ? quote.lead_options.map(readLead).filter((item) => item !== null) : [];
    const standard = leads.find((item) => item.name === "Standard") ?? leads[leads.length - 1];
    if (!standard) {
      return unavailableQuote(
        "oshcut",
        "OSH Cut created a cart but did not return a price. Open the cart to finish the quote. Payment stays on that page.",
        alternatives,
        cartUrl,
      );
    }
    return quoteRecord("oshcut", "quoted", {
      currency: "USD",
      price: standard.totalUsd,
      total: standard.totalUsd,
      leadTime: standard.shipDate ? `${standard.name}, ships ${standard.shipDate}` : standard.name,
      vendorName: "OSH Cut",
      cartId: orderGuid,
      cartUrl,
      checkoutUrl: cartUrl,
      alternatives,
      reason: "Quote only. Shipping, tax, and payment happen on the OSH Cut cart. Nothing was ordered.",
      details: {
        material: sheet.name,
        materialSheetId: sheet.id,
        thicknessAssumed: sheet.assumed,
        manufacturable: true,
        size: typeof dfm.size === "string" ? dfm.size : null,
        pricesValidUntil: typeof quote.prices_valid_until === "string" ? quote.prices_valid_until : null,
        leadOptions: leads,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    return unavailableQuote(
      "oshcut",
      `OSH Cut quote unavailable: ${clip(message)}. The DXF is ready to upload at OSH Cut, and Fabworks is listed as the other sheet-metal shop.`,
      alternatives,
      VENDORS.oshCutApp,
    );
  }
}

async function resolveSheet(
  fetchImpl: typeof fetch,
  mcpUrl: string,
  material: string | undefined,
  thicknessMm: number | undefined,
): Promise<SheetChoice> {
  const token = oshCutMaterialToken(material);
  const targetIn = thicknessMm && thicknessMm > 0 ? thicknessMm / 25.4 : OSHCUT_FALLBACK_SHEET.thicknessIn;
  try {
    const typesText = await toolCall(fetchImpl, mcpUrl, "list_materials", {
      jmespath: `materialTypes[?contains(name, '${token}')].{material_id:material_id,name:name}`,
    });
    const types = JSON.parse(typesText) as Array<{ material_id?: number; name?: string }>;
    const materialId = types.find((item) => typeof item.material_id === "number")?.material_id;
    const materialName = types.find((item) => typeof item.name === "string")?.name;
    if (typeof materialId !== "number") return { ...OSHCUT_FALLBACK_SHEET, id: OSHCUT_FALLBACK_SHEET.materialSheetId, assumed: true };
    const sheetsText = await toolCall(fetchImpl, mcpUrl, "list_materials", {
      jmespath: `materialSheets[?material_id==\`${materialId}\` && enabled==\`1\`].{id:id,thickness:thickness,sheet_name:sheet_name}`,
    });
    const sheets = JSON.parse(sheetsText) as Array<{ id?: number; thickness?: number; sheet_name?: string }>;
    const ranked = sheets
      .filter((sheet) => typeof sheet.id === "number" && typeof sheet.thickness === "number")
      .map((sheet) => ({
        id: sheet.id as number,
        thickness: sheet.thickness as number,
        name: sheet.sheet_name ?? `${sheet.thickness} in`,
        distance: Math.abs((sheet.thickness as number) - targetIn),
      }))
      .sort((a, b) => a.distance - b.distance);
    const best = ranked[0];
    if (!best) return { ...OSHCUT_FALLBACK_SHEET, id: OSHCUT_FALLBACK_SHEET.materialSheetId, assumed: true };
    return {
      id: best.id,
      name: `${materialName ?? token} ${best.name}`,
      thicknessIn: best.thickness,
      assumed: best.distance > 0.02,
    };
  } catch {
    return { id: OSHCUT_FALLBACK_SHEET.materialSheetId, name: OSHCUT_FALLBACK_SHEET.name, thicknessIn: OSHCUT_FALLBACK_SHEET.thicknessIn, assumed: true };
  }
}

async function toolCall(fetchImpl: typeof fetch, mcpUrl: string, name: string, args: Record<string, unknown>): Promise<string> {
  const response = await fetchImpl(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`MCP ${response.status}`);
  }
  const payload = parseMcpPayload(text);
  if (payload.error) {
    throw new Error(clip(typeof payload.error === "string" ? payload.error : JSON.stringify(payload.error)));
  }
  const content = asRecord(payload.result)?.content;
  if (!Array.isArray(content)) throw new Error(`MCP tool ${name} returned no content`);
  const joined = content
    .map((item) => (typeof asRecord(item)?.text === "string" ? (asRecord(item)?.text as string) : ""))
    .join("\n")
    .trim();
  if (!joined) throw new Error(`MCP tool ${name} returned an empty result`);
  return joined;
}

function parseMcpPayload(text: string): { result?: unknown; error?: unknown } {
  const dataLines = [...text.matchAll(/^data:\s*(\{.*\})\s*$/gm)].map((match) => match[1]);
  const raw = dataLines.at(-1) ?? text.trim();
  const parsed = JSON.parse(raw) as { result?: unknown; error?: unknown };
  return parsed;
}

function parseToolJson(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  const record = asRecord(parsed);
  if (!record) throw new Error("OSH Cut returned a non-object result");
  return record;
}

function hasFindings(dfm: Record<string, unknown>, level: "error" | "warning"): boolean {
  const findings = dfm.findings;
  if (!Array.isArray(findings)) return false;
  return findings.some((item) => {
    const record = asRecord(item);
    const severity = typeof record?.severity === "string" ? record.severity : typeof record?.level === "string" ? record.level : "";
    return severity.toLowerCase().includes(level);
  });
}

function findingText(dfm: Record<string, unknown>): string {
  if (typeof dfm.size === "string") return `Size ${dfm.size}.`;
  return "";
}

function partMessages(added: Record<string, unknown>, key: string): string[] {
  if (!Array.isArray(added.parts)) return [];
  const messages: string[] = [];
  for (const part of added.parts) {
    const record = asRecord(part);
    const list = record?.[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item === "string") messages.push(item);
      else if (item && typeof item === "object") messages.push(clip(JSON.stringify(item), 160));
    }
  }
  return messages;
}

function readLead(value: unknown): { name: string; shipDate: string | null; businessDays: number | null; totalUsd: number } | null {
  const record = asRecord(value);
  if (!record || typeof record.total_usd !== "number" || typeof record.name !== "string") return null;
  return {
    name: record.name,
    shipDate: typeof record.ship_date === "string" ? record.ship_date : null,
    businessDays: typeof record.business_days === "number" ? record.business_days : null,
    totalUsd: record.total_usd,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
