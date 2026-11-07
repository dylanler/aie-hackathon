/**
 * fab.json contract for the core pipeline.
 * The run manifest points at this file (`fab: "fab.json"`). Quotes never
 * include a placed order or a payment.
 */

export const FAB_MANIFEST_VERSION = 1 as const;

export type MaterialFamily = "plastic" | "metal" | "wood" | "other";

export type FabRoute = "fdm-download" | "oversized" | "sheet-metal" | "wood-sheet";

export type QuoteVendor = "craftcloud" | "oshcut" | "fabworks" | "ponoko" | "sendcutsend";

export type QuoteStatus = "quoted" | "unavailable" | "skipped";

export type PrinterId = "bambu-a1" | "prusa-mk4";

export type DownloadFormat = "stl" | "3mf" | "dxf";

export interface PrinterSpec {
  id: PrinterId;
  name: string;
  /** Build volume in millimeters, X × Y × Z. */
  build_mm: [number, number, number];
}

export interface PrinterFitCheck {
  id: PrinterId;
  name: string;
  fits: boolean;
  /** Part axes assigned to the printer X, Y, Z when it fits. */
  orientation_mm: [number, number, number] | null;
}

export interface PrinterFit {
  fits: boolean;
  printerId: PrinterId | null;
  orientation_mm: [number, number, number] | null;
  checked: PrinterFitCheck[];
  reason: string;
}

export interface DownloadRef {
  format: DownloadFormat;
  /** Path relative to the run directory, for example `parts/latch.stl`. */
  path: string;
  bytes: number;
  mediaType: string;
  role: "print" | "flat-pattern";
}

export interface VendorLink {
  vendor: string;
  url: string;
  note: string;
}

export interface QuoteSummary {
  status: QuoteStatus;
  vendor: QuoteVendor;
  reason?: string;
  currency?: string;
  /** Production price, before shipping. */
  price?: number | null;
  priceInclVat?: number | null;
  shipping?: number | null;
  total?: number | null;
  leadTime?: string | null;
  productionDays?: [number, number] | null;
  vendorName?: string | null;
  quoteId?: string | null;
  priceId?: string | null;
  offerId?: string | null;
  cartId?: string | null;
  modelId?: string | null;
  cartUrl?: string | null;
  /** Human checkout. Paying happens on this page, never in this library. */
  checkoutUrl?: string | null;
  requiresHumanCheckout: true;
  autoPay: false;
  orderPlaced: false;
  alternatives?: VendorLink[];
  details?: Record<string, unknown>;
}

export interface FabPartInput {
  id: string;
  name: string;
  material?: string;
  /** Axis-aligned size in millimeters. */
  dims_mm: [number, number, number];
  quantity?: number;
  /** From the run manifest. Metal and wood are routed by material either way. */
  printable?: boolean;
  scad?: string;
  /** Existing STL path or URL hint. Bytes are passed separately when present. */
  stl?: string;
  /** Public URL Craftcloud can fetch. Local files are not uploaded. */
  modelUrl?: string;
  /** Craftcloud model id, when the mesh is already in their catalog. */
  modelId?: string;
  /** Closed outline in millimeters. A rectangle is used when this is omitted. */
  outline_mm?: Array<[number, number]>;
}

export interface FabPartResult {
  id: string;
  name: string;
  material: string;
  materialFamily: MaterialFamily;
  dims_mm: [number, number, number];
  quantity: number;
  scad?: string;
  route: FabRoute;
  fitsPrinter: PrinterFit;
  downloads: DownloadRef[];
  quotes: QuoteSummary[];
  vendorLinks: VendorLink[];
  notes: string;
}

export interface FabManifest {
  version: typeof FAB_MANIFEST_VERSION;
  generatedAt: string;
  source: "thought-to-reality/fab";
  printers: PrinterSpec[];
  parts: FabPartResult[];
  summary: {
    partCount: number;
    printableHere: number;
    quoted: number;
    quoteUnavailable: number;
    downloadCount: number;
  };
  orderPlaced: false;
  autoPay: false;
}

export interface DownloadFile {
  partId: string;
  format: DownloadFormat;
  filename: string;
  relativePath: string;
  mediaType: string;
  role: "print" | "flat-pattern";
  bytes: Uint8Array;
}

export interface FabBundle {
  manifest: FabManifest;
  files: DownloadFile[];
}
