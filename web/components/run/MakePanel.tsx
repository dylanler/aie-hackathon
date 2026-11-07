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
  const printed = fab.parts.filter((p) => !p.vendor);
  const cut = fab.parts.filter((p) => p.vendor);
  const grams = printed.reduce((a, p) => a + (p.est_grams || 0), 0);
  const materials = Array.from(new Set(printed.map((p) => p.material))).join(", ") || "—";
  const hours = fab.print?.hours ?? (grams ? grams / 6 : undefined);
  const cost = fab.print?.cost_usd ?? (grams ? grams * 0.025 : undefined);
  const quotes = fab.quotes?.length ? fab.quotes : [{ vendor: "Craftcloud", usd: Math.max(6, (cost || 0) * 8), days: 5, note: "estimate" }];
  const fmtH = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min`);

  return (
    <div className="glass w-[320px] rounded-panel p-4">
      <div className="lbl text-text-3">Make</div>
      <div className="mt-1.5 text-m text-text">{fab.note || "Ready to make."}</div>
      <div className="mt-3 border-t border-line pt-2">
        <Row k="Material" v={materials} />
        {hours !== undefined && <Row k="Print time" v={fmtH(hours)} />}
        <Row k="Plates" v={String(fab.print?.plates ?? 1)} />
        {cost !== undefined && <Row k="Filament" v={`$${cost.toFixed(2)}`} />}
        {fab.printer && <Row k="Printer" v={PRINTERS[fab.printer] || fab.printer} />}
      </div>
      {cut.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="lbl mb-1 text-text-3">Cut elsewhere</div>
          {cut.map((p) => (
            <div key={p.part} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate text-s text-text-2">{p.name} <span className="text-text-3">· {p.material}</span></span>
              <span className="num shrink-0 text-s text-text">${p.quote_usd?.toFixed(2)} <span className="text-text-3">{p.vendor}</span></span>
            </div>
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
      <ConfirmSheet open={open} onClose={() => setOpen(false)} title="Order print" confirmLabel="Request quote"
        onConfirm={() => { setOpen(false); toast(`Quote requested from ${quotes[pick].vendor}. Nothing charged.`); }}>
        <div className="text-s text-text-2">{parts.length} part{parts.length === 1 ? "" : "s"} · {materials}</div>
        <div className="mt-3 space-y-1.5">
          {quotes.map((q, i) => (
            <button key={q.vendor} onClick={() => setPick(i)}
              className={`flex w-full items-center justify-between rounded-btn border px-3 py-2.5 text-left transition-colors ${pick === i ? "border-signal/60 bg-raised" : "border-line hover:bg-raised"}`}>
              <span>
                <span className="text-s text-text">{q.vendor}</span>
                <span className="ml-2 text-s text-text-3">{q.note}</span>
              </span>
              <span className="num text-s text-text">${q.usd.toFixed(2)} <span className="text-text-3">{q.days} d</span></span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-s text-text-3">You confirm the price with the vendor. Nothing is charged here.</p>
      </ConfirmSheet>
    </div>
  );
}
