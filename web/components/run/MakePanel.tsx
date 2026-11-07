"use client";
import { Download } from "lucide-react";
import { useState } from "react";
import type { Fab, Part } from "../data/types";
import { ConfirmSheet } from "../ui/Sheets";
import { useToast } from "../ui/Toast";
import { HintTip } from "../ui/HintTip";

const PRINTERS: Record<string, string> = { "bambu-a1": "Bambu Lab A1", "prusa-mk4": "Prusa MK4", "ender-3": "Ender-3", "bambu-a1-mini": "Bambu A1 mini" };

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-s text-text-3">{k}</span>
      <span className="num text-s text-text">{v}</span>
    </div>
  );
}

export function MakePanel({ fab, parts, onDownload }: { fab: Fab; parts: Part[]; onDownload: () => void }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(0);
  const toast = useToast();
  const isPrint = (p: Fab["parts"][number]) => !p.vendor && (!p.route || p.route.startsWith("fdm") || p.route === "home-print") && (p.materialFamily ?? "plastic") === "plastic";
  const printed = fab.parts.filter(isPrint);
  // parts routed to a shop: fixture shape (vendor + quote_usd) or fab-lane shape (quotes[] with status)
  const cut = fab.parts.filter((p) => !isPrint(p)).map((p) => {
    const q = p.quotes?.find((x) => x.status === "quoted") ?? p.quotes?.[0];
    return {
      key: p.part ?? p.id ?? p.name, name: p.name, material: p.material,
      vendor: p.vendor ?? q?.vendorName ?? q?.vendor ?? "—",
      usd: p.quote_usd ?? q?.total ?? q?.price, url: q?.checkoutUrl ?? q?.cartUrl,
    };
  });
  const grams = printed.reduce((a, p) => a + (p.est_grams || 0), 0);
  const materials = Array.from(new Set(printed.map((p) => p.material))).join(", ") || "—";
  const hours = fab.print?.hours ?? (grams ? grams / 6 : undefined);
  const cost = fab.print?.cost_usd ?? (grams ? grams * 0.025 : undefined);
  // print-service options: explicit quotes, else the fab lane's vendor links, else Craftcloud upload (no price yet)
  const laneQuotes = fab.parts.flatMap((p) => (isPrint(p) ? p.quotes ?? [] : [])).map((q) => ({
    vendor: q.vendorName ?? (q.vendor === "craftcloud" ? "Craftcloud" : q.vendor ?? "Print service"),
    usd: q.total ?? q.price, days: undefined as number | undefined, note: q.status === "quoted" ? q.leadTime ?? "" : "upload to get a price", url: q.checkoutUrl ?? q.cartUrl,
  }));
  const quotes: { vendor: string; usd?: number; days?: number; note?: string; url?: string }[] = fab.quotes?.length ? fab.quotes : laneQuotes.length ? laneQuotes
    : [{ vendor: "Craftcloud", usd: undefined, days: undefined, note: "upload to get a price", url: "https://craftcloud3d.com/en/upload" }];
  const fmtH = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min`);

  return (
    <div className="glass w-[320px] rounded-panel p-4">
      <div className="lbl text-text-3">Make</div>
      <div className="mt-1.5 text-m text-text">{fab.note || "Ready to make."}</div>
      <div className="mt-3 border-t border-line pt-2">
        <Row k="Material" v={materials} />
        {hours !== undefined && <Row k="Print time" v={(fab.print?.hours ? "" : "≈ ") + fmtH(hours)} />}
        <Row k="Plates" v={String(fab.print?.plates ?? 1)} />
        {cost !== undefined && <Row k="Filament" v={`${fab.print?.cost_usd ? "" : "≈ "}$${cost.toFixed(2)}`} />}
        {fab.printer && <Row k="Printer" v={PRINTERS[fab.printer] || fab.printer} />}
      </div>
      {cut.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="lbl mb-1 text-text-3">Cut elsewhere</div>
          {cut.map((p) => (
            <a key={p.key} href={p.url} target="_blank" rel="noreferrer" className="-mx-2 flex items-baseline justify-between gap-3 rounded-chip px-2 py-1.5 transition-colors hover:bg-raised">
              <span className="min-w-0 truncate text-s text-text-2">{p.name} <span className="text-text-3">· {p.material}</span></span>
              <span className="num shrink-0 text-s text-text">{p.usd !== undefined ? `$${p.usd.toFixed(2)}` : "link"} <span className="text-text-3">{p.vendor}</span></span>
            </a>
          ))}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <button onClick={() => setOpen(true)} className="h-9 flex-1 rounded-btn bg-signal text-s font-medium text-black transition hover:brightness-110">Order print</button>
        <HintTip label="STL files for your slicer" side="top">
          <button onClick={onDownload} className="flex h-9 items-center gap-1.5 rounded-btn border border-line px-3 text-s text-text-2 transition-colors hover:bg-raised hover:text-text">
            <Download size={14} strokeWidth={1.75} />Download
          </button>
        </HintTip>
      </div>
      <ConfirmSheet open={open} onClose={() => setOpen(false)} title="Order print" confirmLabel={quotes[pick]?.url ? "Open checkout" : "Request quote"}
        onConfirm={() => { setOpen(false); const q = quotes[pick]; if (q.url) window.open(q.url, "_blank", "noopener"); toast(`${q.url ? "Opened" : "Quote saved for"} ${q.vendor}. Nothing charged.`); }}>
        <div className="text-s text-text-2">{parts.length} part{parts.length === 1 ? "" : "s"} · {materials}</div>
        <div className="mt-3 space-y-1.5">
          {quotes.map((q, i) => (
            <button key={q.vendor} onClick={() => setPick(i)}
              className={`flex w-full items-center justify-between rounded-btn border px-3 py-2.5 text-left transition-colors ${pick === i ? "border-signal/60 bg-raised" : "border-line hover:bg-raised"}`}>
              <span className="min-w-0">
                <span className="block text-s text-text">{q.vendor}</span>
                {q.note && <span className="block truncate text-s text-text-3">{q.note}</span>}
              </span>
              <span className="num shrink-0 whitespace-nowrap text-s text-text">{q.usd !== undefined ? `$${q.usd.toFixed(2)}` : "—"}{q.days ? <span className="text-text-3"> · {q.days} d</span> : null}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-s text-text-3">You check out on the vendor&apos;s site. Nothing is charged here.</p>
      </ConfirmSheet>
    </div>
  );
}
