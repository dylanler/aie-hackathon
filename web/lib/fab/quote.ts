import type { QuoteStatus, QuoteSummary, QuoteVendor, VendorLink } from "./types";

/** Every quote record refuses payment. Callers cannot flip these flags. */
export function quoteRecord(
  vendor: QuoteVendor,
  status: QuoteStatus,
  extra: Omit<QuoteSummary, "vendor" | "status" | "requiresHumanCheckout" | "autoPay" | "orderPlaced"> = {},
): QuoteSummary {
  return {
    ...extra,
    vendor,
    status,
    requiresHumanCheckout: true,
    autoPay: false,
    orderPlaced: false,
  };
}

export function unavailableQuote(vendor: QuoteVendor, reason: string, alternatives?: VendorLink[], checkoutUrl?: string | null): QuoteSummary {
  return quoteRecord(vendor, "unavailable", {
    reason: clip(reason),
    alternatives,
    checkoutUrl: checkoutUrl ?? null,
    cartUrl: checkoutUrl ?? null,
  });
}

export function clip(text: string, max = 360): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}
