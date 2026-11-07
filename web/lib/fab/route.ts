import { quoteCraftcloud } from "./craftcloud";
import { partDownloads } from "./downloads";
import { classifyMaterial } from "./materials";
import { flatPatternMm } from "./mesh";
import { quoteOshCut } from "./oshcut";
import { fitPrinters, PRINTERS } from "./printers";
import { unavailableQuote } from "./quote";
import type { DownloadFile, FabBundle, FabPartInput, FabPartResult, FabRoute, QuoteSummary } from "./types";
import { FAB_MANIFEST_VERSION } from "./types";
import { craftcloudUploadLink, fabworksLink, ponokoLink, sendCutSendLink, VENDORS } from "./vendors";

export interface RouteOptions {
  /** `skip` leaves every third-party quote unavailable and still builds files. */
  quotes?: "live" | "skip";
  /** Verifier hint (`fits_printer`) applied when that printer also fits. */
  preferPrinter?: string | null;
  currency?: "USD" | "EUR" | "GBP" | "CAD" | "AUD" | "CHF" | "NOK" | "JPY" | "ILS";
  countryCode?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  pollIntervalMs?: number;
  pollAttempts?: number;
  craftcloudApiKey?: string;
}

export async function routeFabrication(parts: readonly FabPartInput[], options: RouteOptions = {}): Promise<FabBundle> {
  const results: FabPartResult[] = [];
  const files: DownloadFile[] = [];
  for (const part of parts) {
    const routed = await routePart(part, options);
    results.push(routed.part);
    files.push(...routed.files);
  }
  const quoted = results.reduce((sum, part) => sum + part.quotes.filter((quote) => quote.status === "quoted").length, 0);
  const quoteUnavailable = results.reduce(
    (sum, part) => sum + part.quotes.filter((quote) => quote.status === "unavailable").length,
    0,
  );
  return {
    manifest: {
      version: FAB_MANIFEST_VERSION,
      generatedAt: (options.now ?? (() => new Date()))().toISOString(),
      source: "thought-to-reality/fab",
      printers: PRINTERS.map((printer) => ({ ...printer, build_mm: [...printer.build_mm] })),
      parts: results,
      summary: {
        partCount: results.length,
        printableHere: results.filter((part) => part.fitsPrinter.fits && part.route === "fdm-download").length,
        quoted,
        quoteUnavailable,
        downloadCount: files.length,
      },
      orderPlaced: false,
      autoPay: false,
    },
    files,
  };
}

export async function routePart(
  part: FabPartInput,
  options: RouteOptions = {},
): Promise<{ part: FabPartResult; files: DownloadFile[] }> {
  validatePart(part);
  const family = classifyMaterial(part.material, part.printable);
  const geometry = fitPrinters(part.dims_mm, options.preferPrinter);
  const route = chooseRoute(family, geometry.fits);
  const formats = formatsFor(route);
  const files = partDownloads(part, formats);
  const fitsPrinter = family === "plastic" || family === "other"
    ? geometry
    : {
        ...geometry,
        fits: false,
        printerId: null,
        orientation_mm: null,
        reason: family === "metal"
          ? "Sheet metal is not an FDM print. It is routed to OSH Cut, with Fabworks as the other shop."
          : "Wood is not an FDM print. It is routed to a sheet-goods vendor with a DXF.",
      };
  const quotes = await quotesFor(part, route, files, options);
  const vendorLinks = linksFor(route, quotes);
  return {
    files,
    part: {
      id: part.id,
      name: part.name,
      material: part.material?.trim() || "unspecified",
      materialFamily: family,
      dims_mm: [...part.dims_mm],
      quantity: part.quantity && part.quantity > 0 ? Math.round(part.quantity) : 1,
      scad: part.scad,
      route,
      fitsPrinter,
      downloads: files.map((file) => ({
        format: file.format,
        path: file.relativePath,
        bytes: file.bytes.byteLength,
        mediaType: file.mediaType,
        role: file.role,
      })),
      quotes,
      vendorLinks,
      notes: noteFor(route, fitsPrinter.reason),
    },
  };
}

function chooseRoute(family: ReturnType<typeof classifyMaterial>, fits: boolean): FabRoute {
  if (family === "metal") return "sheet-metal";
  if (family === "wood") return "wood-sheet";
  if (fits) return "fdm-download";
  return "oversized";
}

function formatsFor(route: FabRoute): Array<"stl" | "3mf" | "dxf"> {
  if (route === "fdm-download") return ["stl", "3mf"];
  if (route === "oversized") return ["stl", "3mf", "dxf"];
  return ["dxf"];
}

async function quotesFor(
  part: FabPartInput,
  route: FabRoute,
  files: readonly DownloadFile[],
  options: RouteOptions,
): Promise<QuoteSummary[]> {
  if (route === "sheet-metal") {
    if (options.quotes === "skip") {
      return [unavailableQuote("oshcut", "OSH Cut quote skipped for this run. The DXF is ready to upload.", [fabworksLink()], VENDORS.oshCutApp)];
    }
    const dxf = files.find((file) => file.format === "dxf");
    if (!dxf) {
      return [unavailableQuote("oshcut", "OSH Cut quote unavailable: no DXF was produced.", [fabworksLink()], VENDORS.oshCutApp)];
    }
    const flat = flatPatternMm(part.dims_mm);
    return [
      await quoteOshCut({
        filename: dxf.filename,
        bytes: dxf.bytes,
        material: part.material,
        thicknessMm: flat.thickness,
        quantity: part.quantity,
        name: part.name,
        units: "mm",
        fetch: options.fetch,
      }),
    ];
  }
  if (route === "wood-sheet") {
    return [
      unavailableQuote(
        "ponoko",
        "No public quote API for this wood blank. Upload the DXF at Ponoko for plywood, MDF, or solid sheet. SendCutSend is the fallback for flat goods. Nothing is ordered here.",
        [sendCutSendLink()],
        VENDORS.ponoko,
      ),
    ];
  }
  if (options.quotes === "skip") {
    return [
      unavailableQuote(
        "craftcloud",
        "Craftcloud quote skipped for this run. STL and 3MF downloads are ready.",
        undefined,
        VENDORS.craftcloudUpload,
      ),
    ];
  }
  return [
    await quoteCraftcloud({
      modelId: part.modelId,
      modelUrl: part.modelUrl,
      fileName: `${part.id}.stl`,
      quantity: part.quantity,
      material: part.material,
      currency: options.currency,
      countryCode: options.countryCode,
      fetch: options.fetch,
      apiKey: options.craftcloudApiKey,
      pollAttempts: options.pollAttempts,
      pollIntervalMs: options.pollIntervalMs,
    }),
  ];
}

function linksFor(route: FabRoute, quotes: readonly QuoteSummary[]): FabPartResult["vendorLinks"] {
  const fromQuotes = quotes.flatMap((quote) => {
    const links = [...(quote.alternatives ?? [])];
    if (quote.checkoutUrl) {
      links.unshift({ vendor: quote.vendor, url: quote.checkoutUrl, note: quote.reason ?? "Human checkout. No payment is taken here." });
    }
    return links;
  });
  if (route === "sheet-metal") fromQuotes.push(fabworksLink());
  if (route === "wood-sheet") fromQuotes.push(ponokoLink(), sendCutSendLink());
  if (route === "oversized") fromQuotes.push(craftcloudUploadLink(), sendCutSendLink());
  const seen = new Set<string>();
  return fromQuotes.filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function noteFor(route: FabRoute, fitReason: string): string {
  if (route === "fdm-download") return `${fitReason} Download the STL or 3MF, or open the Craftcloud offer if a quote came back.`;
  if (route === "oversized") return `${fitReason} STL, 3MF, and a DXF flat pattern are ready. A print service can make the solid; a laser shop can cut the outline.`;
  if (route === "sheet-metal") return `${fitReason} The DXF is the file to upload. The cart link is for a person to check out.`;
  return `${fitReason} The DXF is the file to upload.`;
}

function validatePart(part: FabPartInput): void {
  if (!part.id?.trim() || !part.name?.trim()) {
    throw new Error("Each part needs an id and a name.");
  }
  if (!Array.isArray(part.dims_mm) || part.dims_mm.length !== 3 || part.dims_mm.some((value) => !(value > 0))) {
    throw new Error(`Part ${part.id} needs positive dims_mm [x, y, z].`);
  }
}
