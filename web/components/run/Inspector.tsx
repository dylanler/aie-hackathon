"use client";
import { Boxes, RotateCcw } from "lucide-react";
import { useRef } from "react";
import type { Part } from "../data/types";
import { HintTip } from "../ui/HintTip";
import { ParamSlider } from "../ui/ParamSlider";

const pretty = (k: string) => {
  const s = k.replace(/_mm$|_deg$/, "").replace(/_/g, " ").replace(/\boverall\b/, "").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function Inspector({ part, values, onChange, onCommit, onReset, explode, onExplode }: {
  part: Part; values: Record<string, number>; onChange: (k: string, v: number) => void; onCommit: (k: string, prev: number, v: number) => void;
  onReset: () => void; explode: boolean; onExplode: () => void;
}) {
  const base = part.params || {};
  const keys = Object.keys(base).filter((k) => typeof base[k] === "number").slice(0, 5);
  const [x, y, z] = part.dims_mm;
  const starts = useRef<Record<string, number>>({});
  return (
    <div className="glass w-full rounded-b-none rounded-t-panel p-4 pb-[max(16px,env(safe-area-inset-bottom))] md:w-[296px] md:rounded-panel md:pb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-m font-medium text-text">{part.name}</div>
          <div className="num mt-0.5 text-s text-text-3">{+x.toFixed(1)} × {+y.toFixed(1)} × {+z.toFixed(1)} mm · {part.material}</div>
        </div>
        <HintTip label={explode ? "Collapse parts" : "Explode parts"} kbd="E" side="left">
          <button aria-label="Explode" onClick={onExplode} className={`flex h-11 w-11 items-center justify-center rounded-btn transition-colors md:h-8 md:w-8 ${explode ? "bg-raised text-signal" : "text-text-3 hover:bg-raised hover:text-text"}`}>
            <Boxes size={16} strokeWidth={1.75} />
          </button>
        </HintTip>
      </div>
      {part.purpose && <p className="mt-3 hidden text-s text-text-2 md:block">{part.purpose}</p>}
      {keys.length > 0 ? (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          {keys.map((k) => {
            const v0 = base[k];
            const unit = /_deg$/.test(k) ? "°" : /pct/.test(k) ? "%" : "mm";
            const min = +(v0 * 0.5).toFixed(1), max = +(v0 * 1.6).toFixed(1);
            const step = v0 < 8 ? 0.1 : 0.5;
            return (
              <div key={k} onPointerDownCapture={() => { starts.current[k] = values[k] ?? v0; }}>
                <ParamSlider label={pretty(k)} unit={unit} value={values[k] ?? v0} min={min} max={max} step={step}
                  onChange={(v) => onChange(k, v)} onCommit={(v) => onCommit(k, starts.current[k] ?? v0, v)} />
              </div>
            );
          })}
          <div className="flex items-center justify-between pt-1">
            <span className="text-s text-text-3">Drag to resize. <span className="text-text-3/80">⇧ fine</span></span>
            <HintTip label="Back to the model's values" side="left">
              <button onClick={onReset} className="flex h-11 items-center gap-1.5 rounded-chip px-2 text-s text-text-3 hover:bg-raised hover:text-text md:h-7"><RotateCcw size={12} />Reset</button>
            </HintTip>
          </div>
        </div>
      ) : (
        <p className="mt-4 border-t border-line pt-4 text-s text-text-3">No parameters on this part.</p>
      )}
    </div>
  );
}
