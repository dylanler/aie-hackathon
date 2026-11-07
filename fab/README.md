# Fabrication routing

Quotes and download files for a finished part. This lane never calls Craftcloud `POST /v5/order` or a payment endpoint, and it never checks out an OSH Cut cart.

`web/lib/fab` is the TypeScript API. A run directory receives `fab.json` plus `parts/*.stl`, `parts/*.3mf`, and `parts/*.dxf`.

```bash
npx --yes tsx web/lib/fab/build-demo.ts
```

`FAB_LIVE_QUOTES=0` skips the network and still writes the files. With live quotes on, a metal DXF is sent to OSH Cut for a cart link. Craftcloud pricing runs only when a part has a public `modelUrl` or an existing `modelId`. A local STL stays downloadable and the quote is marked unavailable.

Printers: Bambu A1 (256 mm cube), Prusa MK4 (250 × 210 × 220 mm). Sheet metal goes to OSH Cut, with Fabworks linked for a person. Wood and other oversized blanks export a DXF and point at Ponoko or SendCutSend.
