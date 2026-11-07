"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { pct, useHistory } from "../data/client";
import type { HistoryEntry } from "../data/types";
import { EASE_OUT, T } from "./motion";

/** The system that gets better: each dot is a design-skill version, scored on held-out prompts it never trained on. */
export function GetsBetter({ variant = "strip" }: { variant?: "strip" | "quiet" }) {
  const { history, current, source } = useHistory();
  const [hover, setHover] = useState<HistoryEntry | null>(null);
  const [runA, setRunA] = useState<HistoryEntry[] | null>(null);
  useEffect(() => {
    let on = true;
    fetch("/static-runs/evals-runA.json", { cache: "force-cache" }).then((x) => (x.ok ? x.json() : null)).then((j) => on && Array.isArray(j) && setRunA(j)).catch(() => {});
    return () => { on = false; };
  }, []);
  if (!history.length) return null;
  const first = history[0];
  const best = [...history].reverse().find((h) => h.version === current) ?? history[history.length - 1];
  const n0 = history.length;
  const W = Math.max(144, 36 * (n0 - 1));
  const step = n0 > 1 ? W / (n0 - 1) : 0;
  const X = (i: number) => (n0 > 1 ? i * step : W / 2);
  const H = 40;
  const y = (h: HistoryEntry) => H - pct(h) * H;
  const adopted = history.map((h, i) => ({ h, i })).filter((x) => x.h.adopted);
  const line = adopted.map((x, k) => `${k ? "L" : "M"}${X(x.i)},${y(x.h)}`).join(" ");
  const n = best.heldoutN;
  const frac = (h: HistoryEntry) => (h.heldoutN ? `${Math.round(pct(h) * h.heldoutN)}/${h.heldoutN}` : `${Math.round(pct(h) * 100)}%`);

  if (variant === "quiet") {
    return (
      <div className="flex items-center gap-3 text-s text-text-3">
        <span className="lbl">skill {best.version}{source === "fixture" ? " · sample" : ""}</span>
        <span className="num">{frac(best)} held-out</span>
        {history.length > 1 && frac(best) !== frac(first) && <span className="num text-text-2">{pct(best) > pct(first) ? "↑" : "↓"} from {frac(first)}</span>}
      </div>
    );
  }

  // Overfit = a patch that raised the train score over its parent. The held-out gate decides; count what it blocked.
  const byV = Object.fromEntries(history.map((h) => [h.version, h]));
  const tr = (h: HistoryEntry) => (h.trainPass > 1 && h.trainN ? h.trainPass / h.trainN : h.trainPass);
  const overfit = history.filter((h) => h.parent && byV[h.parent] && tr(h) > tr(byV[h.parent]));
  const blocked = overfit.filter((h) => !h.adopted).length;
  const adoptedPatches = history.filter((h) => h.parent && h.adopted).length;
  const ty = (h: HistoryEntry) => H - tr(h) * H;
  const earlierWin = runA ? (() => {
    const a = runA.filter((h) => h.adopted);
    return a.length > 1 ? { from: a[0], to: a[a.length - 1] } : null;
  })() : null;

  return (
    <div className="glass relative rounded-panel px-4 py-3" onPointerLeave={() => setHover(null)}>
    <div className="flex items-center gap-5">
      <div className="w-[150px]">
        <div className="lbl whitespace-nowrap text-text-3">Gets better</div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="num text-l text-text">{(pct(best) * 100).toFixed(1)}%</span>
          <span className="num text-s text-text-3">{n ? `${frac(best)}` : ""}</span>
        </div>
        <div className="mt-0.5 whitespace-nowrap text-s text-text-3">held-out · {best.version} {adoptedPatches ? "adopted" : "kept"}{source === "fixture" ? " · sample" : ""}</div>
      </div>
      <svg width={W + 20} height={H + 30} viewBox={`-10 -6 ${W + 20} ${H + 30}`} className="overflow-visible">
        <line x1={-4} x2={W + 4} y1={H} y2={H} stroke="#26262A" />
        <motion.path d={line} fill="none" stroke="#FF5A1F" strokeOpacity={0.5} strokeWidth={1.25}
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: EASE_OUT }} />
        {history.map((h, i) => {
          const isCur = h.version === current;
          return (
            <g key={h.version + i} onPointerEnter={() => setHover(h)} className="cursor-default">
              <rect x={X(i) - 14} y={-6} width={28} height={H + 30} fill="transparent" />
              {<line x1={X(i) - 4} x2={X(i) + 4} y1={ty(h)} y2={ty(h)} stroke="#9A9AA1" strokeWidth={1.25} />}
              {!h.adopted && h.parent && <line x1={X(i)} x2={X(i)} y1={y(h)} y2={H} stroke="#5E5E66" strokeDasharray="1.5 2.5" />}
              <motion.circle
                cx={X(i)} cy={y(h)} r={isCur ? 5 : 4}
                fill={h.adopted ? "#FF5A1F" : "#0B0B0C"} stroke={h.adopted ? "#FF5A1F" : "#9A9AA1"} strokeWidth={1.25}
                initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.15 + i * 0.06, duration: 0.32, ease: EASE_OUT }}
                style={{ transformOrigin: `${X(i)}px ${y(h)}px` }}
              />
              {isCur && <circle cx={X(i)} cy={y(h)} r={9} fill="none" stroke="#FF5A1F" strokeOpacity={0.35} />}
              <text x={X(i)} y={H + 16} textAnchor="middle" fontSize="11" fill={hover === h ? "#EDEDEF" : h.adopted ? "#9A9AA1" : "#5E5E66"}
                className="num" textDecoration={h.adopted ? undefined : "line-through"}>{h.version}</text>
            </g>
          );
        })}
      </svg>
    </div>
    <div className="mt-2 border-t border-line pt-2">
      <div className="num flex items-center gap-3 text-[11px] text-text-3">
        {overfit.length > 0 && <span className="whitespace-nowrap text-[12px] text-text-2">Gate blocked <span className="text-signal">{blocked} of {overfit.length}</span> overfit patches</span>}
        <span className="ml-auto flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-signal" />held-out</span>
        <span className="flex items-center gap-1"><span className="inline-block h-px w-2 bg-text-2" />train</span>
      </div>
      {earlierWin && <div className="num mt-1 whitespace-nowrap text-[11px] text-text-3">earlier run: {earlierWin.from.version} {(pct(earlierWin.from) * 100).toFixed(1)}% → {earlierWin.to.version} {(pct(earlierWin.to) * 100).toFixed(0)}% held-out, adopted</div>}
    </div>
      <AnimatePresence>
        {hover && (
          <motion.div key={hover.version} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: T.micro, ease: EASE_OUT }}
            className="pointer-events-none absolute bottom-full right-0 mb-2 w-[300px] rounded-chip border border-line bg-raised p-3 shadow-float">
            <div className="flex items-center justify-between">
              <span className="num text-s text-text">{hover.version}{hover.parent ? <span className="text-text-3"> ← {hover.parent}</span> : null}</span>
              <span className={`lbl ${hover.adopted ? "text-signal" : "text-text-3"}`}>{hover.adopted ? "adopted" : "rolled back"}</span>
            </div>
            <div className="mt-1.5 line-clamp-4 text-s text-text-2">{hover.diffSummary}</div>
            <div className="num mt-2 flex gap-4 text-[12px] text-text-3">
              <span>held-out <span className="text-text">{frac(hover)}</span></span>
              <span>train <span className="text-text-2">{(tr(hover) * 100).toFixed(1)}%</span></span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
