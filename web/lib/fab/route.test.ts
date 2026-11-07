import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertQuoteOnlyUrl, CraftcloudOrderBlockedError, placeCraftcloudOrder, quoteCraftcloud } from "./craftcloud";
import { fitPrinters } from "./printers";
import { boxTriangles, signedMeshVolume, stlBytes, threeMfBytes } from "./mesh";
import { quoteOshCut } from "./oshcut";
import { routeFabrication } from "./route";
import { DEMO_PARTS } from "./build-demo";

describe("printer fit", () => {
  it("fits a latch on a Bambu A1 and a Prusa MK4", () => {
    const fit = fitPrinters([60, 22, 14]);
    assert.equal(fit.fits, true);
    assert.equal(fit.printerId, "bambu-a1");
    assert.equal(fit.checked.filter((item) => item.fits).length, 2);
  });

  it("rejects a panel larger than both beds", () => {
    const fit = fitPrinters([320, 180, 4]);
    assert.equal(fit.fits, false);
    assert.equal(fit.printerId, null);
  });

  it("rotates a part onto the Prusa bed", () => {
    const fit = fitPrinters([220, 210, 250], "prusa-mk4");
    assert.equal(fit.fits, true);
    assert.equal(fit.printerId, "prusa-mk4");
  });
});

describe("meshes", () => {
  it("builds a closed box and printable files", () => {
    const triangles = boxTriangles([60, 22, 14]);
    assert.equal(triangles.length, 12);
    assert.ok(Math.abs(signedMeshVolume(triangles) - 60 * 22 * 14) < 1e-6);
    const stl = stlBytes(triangles, "latch");
    assert.equal(stl.byteLength, 84 + 12 * 50);
    assert.equal(new DataView(stl.buffer).getUint32(80, true), 12);
    const threemf = threeMfBytes(triangles);
    assert.equal(String.fromCharCode(threemf[0], threemf[1]), "PK");
    assert.match(new TextDecoder().decode(threemf), /<vertex /);
    assert.match(new TextDecoder().decode(threemf), /unit="millimeter"/);
  });
});

describe("routing without vendor calls", () => {
  it("still emits downloads and an unavailable quote", async () => {
    const bundle = await routeFabrication(DEMO_PARTS, { quotes: "skip", now: () => new Date("2026-11-07T12:00:00.000Z") });
    assert.equal(bundle.manifest.orderPlaced, false);
    assert.equal(bundle.manifest.autoPay, false);
    assert.equal(bundle.manifest.summary.partCount, 4);
    assert.equal(bundle.manifest.summary.quoted, 0);
    const latch = bundle.manifest.parts[0];
    assert.equal(latch.route, "fdm-download");
    assert.equal(latch.fitsPrinter.printerId, "bambu-a1");
    assert.deepEqual(latch.downloads.map((item) => item.format), ["stl", "3mf"]);
    assert.equal(latch.quotes[0].status, "unavailable");
    assert.equal(latch.quotes[0].orderPlaced, false);
    const cover = bundle.manifest.parts[1];
    assert.equal(cover.route, "oversized");
    assert.ok(cover.downloads.some((item) => item.format === "dxf"));
    const bracket = bundle.manifest.parts[2];
    assert.equal(bracket.route, "sheet-metal");
    assert.equal(bracket.fitsPrinter.fits, false);
    assert.ok(bracket.vendorLinks.some((link) => link.vendor === "Fabworks"));
    const shelf = bundle.manifest.parts[3];
    assert.equal(shelf.route, "wood-sheet");
    assert.equal(shelf.quotes[0].vendor, "ponoko");
    assert.equal(bundle.files.length, bundle.manifest.summary.downloadCount);
    assert.ok(bundle.files.every((file) => file.bytes.byteLength > 0));
    for (const part of bundle.manifest.parts) {
      const urls = part.vendorLinks.map((link) => link.url);
      assert.equal(new Set(urls).size, urls.length);
    }
  });
});

describe("Craftcloud quote flow", () => {
  it("refuses order and payment urls", () => {
    assert.throws(() => assertQuoteOnlyUrl("https://api.craftcloud3d.com/v5/order"), CraftcloudOrderBlockedError);
    assert.throws(() => assertQuoteOnlyUrl("https://api.craftcloud3d.com/v5/payment/stripe"), CraftcloudOrderBlockedError);
    assert.throws(() => placeCraftcloudOrder({ confirm: true, confirmation: "yes" }), CraftcloudOrderBlockedError);
    assert.doesNotThrow(() => assertQuoteOnlyUrl("https://api.craftcloud3d.com/v5/price"));
  });

  it("walks price, cart, and offer and never orders", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const path = new URL(url).pathname;
      let body: unknown = {};
      if (path.endsWith("/configuration") && init?.method === "POST") body = { configurationId: "cfg-1" };
      else if (path.endsWith("/configuration/cfg-1")) {
        body = { configurationId: "cfg-1", items: [{ modelId: "model-1", isParsing: false }] };
      } else if (path.endsWith("/v5/price") && init?.method === "POST") body = { priceId: "11111111-1111-4111-8111-111111111111" };
      else if (path.includes("/v5/price/")) {
        body = {
          allComplete: true,
          quotes: [
            {
              quoteId: "q-cheap",
              vendorId: "shop",
              price: 10,
              priceInclVat: 11,
              currency: "USD",
              productionTimeFast: 3,
              productionTimeSlow: 5,
            },
          ],
          shippings: [{ shippingId: "20106a2d-1fc5-4a04-8393-6139e5803dfd", vendorId: "shop", name: "Ground", price: 4, type: "standard" }],
        };
      } else if (path.endsWith("/v5/cart")) {
        body = {
          cartId: "cart-1",
          estDeliveryTime: { shop: "5-8" },
          amounts: { total: { undiscountedNetProductionPrice: 10, undiscountedNetShippingPrice: 4, totalNetPrice: 14, totalGrossPrice: 15, currency: "USD" } },
        };
      } else if (path.endsWith("/v5/offer")) body = { offerId: "offer-1" };
      else body = { message: "unexpected" };
      return new Response(JSON.stringify(body), { status: 201, headers: { "Content-Type": "application/json" } });
    };
    const quote = await quoteCraftcloud({
      modelUrl: "https://example.com/latch.stl",
      material: "PETG",
      fetch: fetchImpl,
      pollIntervalMs: 0,
    });
    assert.equal(quote.status, "quoted");
    assert.equal(quote.total, 14);
    assert.equal(quote.offerId, "offer-1");
    assert.equal(quote.checkoutUrl, "https://craftcloud3d.com/en/offer/offer-1");
    assert.equal(quote.orderPlaced, false);
    assert.equal(quote.autoPay, false);
    assert.ok(calls.some((call) => call.startsWith("POST") && call.includes("/v5/price")));
    assert.ok(calls.some((call) => call.includes("/v5/cart")));
    assert.ok(calls.some((call) => call.includes("/v5/offer")));
    assert.equal(calls.some((call) => call.includes("/v5/order") || call.includes("/v5/payment")), false);
  });

  it("stays unavailable when the mesh is only local", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response("{}", { status: 500 });
    };
    const quote = await quoteCraftcloud({ material: "PLA", fetch: fetchImpl });
    assert.equal(quote.status, "unavailable");
    assert.equal(called, false);
    assert.match(quote.reason ?? "", /modelUrl/);
  });
});

describe("OSH Cut quote flow", () => {
  it("checks manufacturability, carts, and quotes without paying", async () => {
    const tools: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { params: { name: string } };
      tools.push(payload.params.name);
      const bodies: Record<string, unknown> = {
        list_materials: payload.params.name === "list_materials" ? [{ material_id: 3, name: "Aluminum 5052 H32", id: 15, thickness: 0.125, sheet_name: "0.125 in" }] : [],
        check_manufacturability: { manufacturable: true, size: "101.600 mm x 50.800 mm", findings: [] },
        add_parts_to_cart: { cart_url: "https://app.oshcut.com/cart/O-demo", order_guid: "O-demo", parts: [{ dfm_errors: [] }] },
        quote_cart: { complete: true, lead_options: [{ name: "Standard", ship_date: "2026-11-11", business_days: 2, total_usd: 11.65 }] },
      };
      const text = JSON.stringify(bodies[payload.params.name]);
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } })}\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };
    const quote = await quoteOshCut({
      filename: "bracket.dxf",
      bytes: new TextEncoder().encode("0\nEOF\n"),
      material: "Aluminum 5052",
      thicknessMm: 3.175,
      fetch: fetchImpl,
    });
    assert.equal(quote.status, "quoted");
    assert.equal(quote.total, 11.65);
    assert.equal(quote.checkoutUrl, "https://app.oshcut.com/cart/O-demo");
    assert.equal(quote.orderPlaced, false);
    assert.deepEqual(tools, ["list_materials", "list_materials", "check_manufacturability", "add_parts_to_cart", "quote_cart"]);
    assert.ok(quote.alternatives?.some((link) => link.vendor === "Fabworks"));
  });
});
