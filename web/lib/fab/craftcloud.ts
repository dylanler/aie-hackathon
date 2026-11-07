import { craftcloudMaterial } from "./materials";
import { clip, quoteRecord, unavailableQuote } from "./quote";
import type { QuoteSummary } from "./types";
import { VENDORS } from "./vendors";

export const CRAFTCLOUD_API_BASE = "https://api.craftcloud3d.com";
export const CRAFTCLOUD_CUSTOMER_API = "https://customer-api.craftcloud3d.com";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "NOK", "JPY", "ILS"] as const;
export type CraftcloudCurrency = (typeof CURRENCIES)[number];

export class CraftcloudOrderBlockedError extends Error {
  constructor(message = "Refusing to call Craftcloud /v5/order or /v5/payment. Finish checkout on the offer link.") {
    super(message);
    this.name = "CraftcloudOrderBlockedError";
  }
}

/**
 * Hard stop. This lane quotes through price → offer → cart and never places
 * an order, even when a caller passes a confirmation flag.
 */
export function placeCraftcloudOrder(_request?: { confirm?: boolean; confirmation?: string }): never {
  throw new CraftcloudOrderBlockedError();
}

export function assertQuoteOnlyUrl(url: string): void {
  const path = new URL(url, CRAFTCLOUD_API_BASE).pathname.replace(/\/+$/, "");
  if (path === "/v5/order" || path.startsWith("/v5/order/") || path.startsWith("/v5/payment")) {
    throw new CraftcloudOrderBlockedError();
  }
}

export interface CraftcloudQuoteRequest {
  modelId?: string;
  modelUrl?: string;
  fileName?: string;
  quantity?: number;
  material?: string;
  materialConfigId?: string;
  currency?: CraftcloudCurrency;
  countryCode?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  customerApiUrl?: string;
  apiKey?: string;
  pollAttempts?: number;
  pollIntervalMs?: number;
}

interface PriceQuote {
  quoteId: string;
  vendorId: string;
  price: number;
  priceInclVat: number;
  currency: string;
  productionTimeFast: number;
  productionTimeSlow: number;
}

interface PriceShipping {
  shippingId: string;
  vendorId: string;
  name: string;
  price: number;
  type?: string;
}

export async function quoteCraftcloud(request: CraftcloudQuoteRequest): Promise<QuoteSummary> {
  const currency = request.currency ?? "USD";
  const countryCode = (request.countryCode ?? "US").toUpperCase();
  const quantity = request.quantity && request.quantity > 0 ? Math.round(request.quantity) : 1;
  if (!CURRENCIES.includes(currency)) {
    return unavailableQuote("craftcloud", `Craftcloud quote unavailable: currency ${currency} is not supported.`);
  }
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return unavailableQuote("craftcloud", "Craftcloud quote unavailable: countryCode must be an ISO alpha-2 code.");
  }

  const fetchImpl = request.fetch ?? fetch;
  const baseUrl = (request.baseUrl ?? process.env.CRAFTCLOUD_BASE_URL ?? CRAFTCLOUD_API_BASE).replace(/\/$/, "");
  const customerApi = (request.customerApiUrl ?? process.env.CRAFTCLOUD_CUSTOMER_API ?? CRAFTCLOUD_CUSTOMER_API).replace(/\/$/, "");
  const material = craftcloudMaterial(request.material);
  const materialConfigId = request.materialConfigId ?? material.materialConfigId;

  try {
    const model = await resolveModel(request, customerApi, fetchImpl, request.apiKey);
    if (!model.modelId) {
      return unavailableQuote(
        "craftcloud",
        "Craftcloud quote unavailable: no modelId or public modelUrl. STL and 3MF downloads are ready; upload one at Craftcloud or pass modelUrl. No API key is required once the mesh is reachable.",
        undefined,
        VENDORS.craftcloudUpload,
      );
    }

    const created = await requestJson(fetchImpl, `${baseUrl}/v5/price`, {
      method: "POST",
      apiKey: request.apiKey,
      body: {
        currency,
        countryCode,
        models: [{ modelId: model.modelId, quantity }],
        materialConfigIds: [materialConfigId],
        topMaterialConfigsOnly: true,
      },
    });
    const priceId = stringField(created.body, "priceId");
    if (!created.ok || !priceId) {
      return unavailableQuote("craftcloud", `Craftcloud quote unavailable: price request failed (${created.status}). ${errorText(created.body)}`);
    }

    const priced = await pollPrice(fetchImpl, baseUrl, priceId, request.apiKey, request.pollAttempts ?? 6, request.pollIntervalMs ?? 1200);
    const picked = pickQuote(priced.body);
    if (!picked) {
      return unavailableQuote(
        "craftcloud",
        `Craftcloud quote unavailable: no shop returned a price for ${material.label}. Downloads are still ready.`,
        undefined,
        model.configurationId ? VENDORS.craftcloudConfiguration(model.configurationId) : VENDORS.craftcloudUpload,
      );
    }

    const cart = await requestJson(fetchImpl, `${baseUrl}/v5/cart`, {
      method: "POST",
      apiKey: request.apiKey,
      body: {
        currency,
        shippingIds: [picked.shipping.shippingId],
        quotes: [{ id: picked.quote.quoteId }],
        customerReference: "thought-to-reality",
        note: "Quote only. Do not place this order from the API.",
      },
    });
    const cartId = stringField(cart.body, "cartId");
    if (!cart.ok || !cartId) {
      return unavailableQuote("craftcloud", `Craftcloud quote unavailable: cart was not created (${cart.status}). ${errorText(cart.body)}`);
    }

    const offer = await requestJson(fetchImpl, `${baseUrl}/v5/offer`, {
      method: "POST",
      apiKey: request.apiKey,
      body: { cartId, expires: true },
    });
    const offerId = stringField(offer.body, "offerId");
    if (!offer.ok || !offerId) {
      return unavailableQuote("craftcloud", `Craftcloud quote unavailable: offer was not created (${offer.status}). ${errorText(offer.body)}`);
    }

    const amounts = readAmounts(cart.body);
    const checkoutUrl = VENDORS.craftcloudOffer(offerId);
    return quoteRecord("craftcloud", "quoted", {
      currency: amounts.currency ?? picked.quote.currency,
      price: amounts.production ?? picked.quote.price,
      priceInclVat: amounts.gross ?? picked.quote.priceInclVat,
      shipping: amounts.shipping ?? picked.shipping.price,
      total: amounts.total ?? picked.quote.price + picked.shipping.price,
      leadTime: readLead(cart.body, picked.quote.vendorId),
      productionDays: [picked.quote.productionTimeFast, picked.quote.productionTimeSlow],
      vendorName: picked.quote.vendorId,
      quoteId: picked.quote.quoteId,
      priceId,
      offerId,
      cartId,
      modelId: model.modelId,
      cartUrl: model.configurationId ? VENDORS.craftcloudConfiguration(model.configurationId) : checkoutUrl,
      checkoutUrl,
      reason: `Quote only. Open the offer to pay ${picked.quote.vendorId}. This library does not call /v5/order.`,
      details: {
        material: material.label,
        materialConfigId,
        shippingName: picked.shipping.name,
        fileName: request.fileName ?? null,
      },
    });
  } catch (error) {
    if (error instanceof CraftcloudOrderBlockedError) throw error;
    const message = error instanceof Error ? error.message : "request failed";
    return unavailableQuote("craftcloud", `Craftcloud quote unavailable: ${clip(message)}. STL and 3MF downloads are still ready.`);
  }
}

async function resolveModel(
  request: CraftcloudQuoteRequest,
  customerApi: string,
  fetchImpl: typeof fetch,
  apiKey: string | undefined,
): Promise<{ modelId: string | null; configurationId: string | null }> {
  if (request.modelId) return { modelId: request.modelId, configurationId: null };
  if (!request.modelUrl) return { modelId: null, configurationId: null };
  const created = await requestJson(fetchImpl, `${customerApi}/configuration`, {
    method: "POST",
    apiKey,
    body: {
      items: [{ modelUrl: request.modelUrl, quantity: 1 }],
    },
  });
  const configurationId = stringField(created.body, "configurationId");
  if (!created.ok || !configurationId) {
    throw new Error(`configuration was not created (${created.status}). ${errorText(created.body)}`);
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const read = await requestJson(fetchImpl, `${customerApi}/configuration/${configurationId}`, { method: "GET", apiKey });
    const modelId = firstModelId(read.body);
    const parsing = firstParsing(read.body);
    if (modelId && !parsing) return { modelId, configurationId };
    if (attempt < 4) await delay(400);
  }
  const last = await requestJson(fetchImpl, `${customerApi}/configuration/${configurationId}`, { method: "GET", apiKey });
  return { modelId: firstModelId(last.body), configurationId };
}

async function pollPrice(
  fetchImpl: typeof fetch,
  baseUrl: string,
  priceId: string,
  apiKey: string | undefined,
  attempts: number,
  intervalMs: number,
): Promise<{ body: unknown }> {
  let last: { body: unknown } = { body: null };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await requestJson(fetchImpl, `${baseUrl}/v5/price/${priceId}`, { method: "GET", apiKey });
    const body = asRecord(last.body);
    const quotes = Array.isArray(body?.quotes) ? body.quotes : [];
    if (body?.allComplete === true || (quotes.length > 0 && attempt >= 1)) return last;
    if (attempt < attempts - 1) await delay(intervalMs);
  }
  return last;
}

function pickQuote(body: unknown): { quote: PriceQuote; shipping: PriceShipping } | null {
  const record = asRecord(body);
  const quotes = (Array.isArray(record?.quotes) ? record.quotes : [])
    .map(readQuote)
    .filter((item): item is PriceQuote => item !== null);
  const shippings = (Array.isArray(record?.shippings) ? record.shippings : [])
    .map(readShipping)
    .filter((item): item is PriceShipping => item !== null);
  const byVendor = new Map<string, PriceShipping[]>();
  for (const shipping of shippings) {
    const list = byVendor.get(shipping.vendorId) ?? [];
    list.push(shipping);
    byVendor.set(shipping.vendorId, list);
  }
  const usable = quotes.filter((quote) => (byVendor.get(quote.vendorId) ?? []).length > 0);
  usable.sort((a, b) => a.price - b.price);
  const quote = usable[0];
  if (!quote) return null;
  const options = [...(byVendor.get(quote.vendorId) ?? [])];
  options.sort((a, b) => shippingRank(a) - shippingRank(b) || a.price - b.price);
  return { quote, shipping: options[0] };
}

function shippingRank(shipping: PriceShipping): number {
  return shipping.type === "standard" ? 0 : 1;
}

function readQuote(value: unknown): PriceQuote | null {
  const record = asRecord(value);
  if (!record) return null;
  const quoteId = stringField(record, "quoteId");
  const vendorId = stringField(record, "vendorId");
  if (!quoteId || !vendorId || typeof record.price !== "number") return null;
  return {
    quoteId,
    vendorId,
    price: record.price,
    priceInclVat: typeof record.priceInclVat === "number" ? record.priceInclVat : record.price,
    currency: typeof record.currency === "string" ? record.currency : "USD",
    productionTimeFast: typeof record.productionTimeFast === "number" ? record.productionTimeFast : 0,
    productionTimeSlow: typeof record.productionTimeSlow === "number" ? record.productionTimeSlow : 0,
  };
}

function readShipping(value: unknown): PriceShipping | null {
  const record = asRecord(value);
  if (!record) return null;
  const shippingId = stringField(record, "shippingId");
  const vendorId = stringField(record, "vendorId");
  if (!shippingId || !vendorId) return null;
  const price = typeof record.price === "number" ? record.price : 0;
  return {
    shippingId,
    vendorId,
    name: typeof record.name === "string" ? record.name : "shipping",
    price,
    type: typeof record.type === "string" ? record.type : undefined,
  };
}

function readAmounts(body: unknown): { production?: number; shipping?: number; total?: number; gross?: number; currency?: string } {
  const total = asRecord(asRecord(asRecord(body)?.amounts)?.total);
  if (!total) return {};
  return {
    production: numberField(total, "undiscountedNetProductionPrice"),
    shipping: numberField(total, "undiscountedNetShippingPrice"),
    total: numberField(total, "totalNetPrice"),
    gross: numberField(total, "totalGrossPrice"),
    currency: stringField(total, "currency") ?? undefined,
  };
}

function readLead(body: unknown, vendorId: string): string | null {
  const est = asRecord(asRecord(body)?.estDeliveryTime);
  const value = est?.[vendorId];
  return typeof value === "string" ? value : null;
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  options: { method: "GET" | "POST"; body?: unknown; apiKey?: string },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  assertQuoteOnlyUrl(url);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const apiKey = options.apiKey ?? process.env.CRAFTCLOUD_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetchImpl(url, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: clip(text) };
    }
  }
  return { ok: response.ok, status: response.status, body };
}

function firstModelId(body: unknown): string | null {
  const items = asRecord(body)?.items;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const modelId = stringField(item, "modelId");
    if (modelId) return modelId;
  }
  return null;
}

function firstParsing(body: unknown): boolean {
  const items = asRecord(body)?.items;
  if (!Array.isArray(items) || items.length === 0) return true;
  return items.some((item) => asRecord(item)?.isParsing === true);
}

function errorText(body: unknown): string {
  const record = asRecord(body);
  const message = record?.message ?? record?.error;
  return typeof message === "string" ? clip(message) : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(value: unknown, key: string): string | null {
  const record = asRecord(value);
  const field = record?.[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function numberField(value: unknown, key: string): number | undefined {
  const record = asRecord(value);
  const field = record?.[key];
  return typeof field === "number" ? field : undefined;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
