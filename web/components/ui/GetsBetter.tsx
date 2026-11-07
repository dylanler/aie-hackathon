"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { pct, useHistory } from "../data/client";
import type { HistoryEntry } from "../data/types";
import { EASE_OUT, T } from "./motion";

/** The system that gets better: each dot is a design-skill version, scored on held-out prompts it never trained on. */
export function GetsBetter({ variant = "strip" }: { variant?: "strip" | "quiet" }) {
  const { history, current, source } = useHistory();
  const [hover, setHover] = useState<HistoryEntry | null>(null);
  if (!history.length) return null;
  const first = history[0];
  const best = [...history].reverse().find((h) => h.version === current) ?? history[history.length - 1];
  const W = 36 * (history.length - 1);
  const H = 40;
  const y = (h: HistoryEntry) => H - pct(h) * H;
  const adopted = history.map((h, i) => ({ h, i })).filter((x) => x.h.adopted);
  const line = adopted.map((x, k) => `${k ? "L" : "M"}${x.i * 36},${y(x.h)}`).join(" ");
  const n = best.heldoutN;
  const frac = (h: HistoryEntry) => (h.heldoutN ? `${Math.round(pct(h) * h.heldoutN)}/${h.heldoutN}` : `${Math.round(pct(h) * 100)}%`);

  if (variant === "quiet") {
    return (
      <div className="flex items-center gap-3 text-s text-text-3">
        <span className="lbl">skill {best.version}{source === "fixture" ? " · sample" : ""}</span>
        <span className="num">{frac(best)} held-out</span>
        <span className="num text-text-2">↑ from {frac(first)}</span>
      </div>
    );
  }

  return (
    <div className="glass relative flex items-center gap-5 rounded-panel px-4 py-3" onPointerLeave={() => setHover(null)}>
      <div className="w-[132px]">
        <div className="lbl whitespace-nowrap text-text-3">Gets better</div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="num text-l text-text">{Math.round(pct(best) * 100)}%</span>
          <span className="num text-s text-text-3">{n ? `${frac(best)}` : ""}</span>
        </div>
        <div className="mt-0.5 whitespace-nowrap text-s text-text-3">held-out pass{source === "fixture" ? " · sample" : ""}</div>
      </div>
      <svg width={W + 20} height={H + 30} viewBox={`-10 -6 ${W + 20} ${H + 30}`} className="overflow-visible">
        <line x1={-4} x2={W + 4} y1={H} y2={H} stroke="#26262A" />
        <motion.path d={line} fill="none" stroke="#FF5A1F" strokeOpacity={0.5} strokeWidth={1.25}
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: EASE_OUT }} />
        {history.map((h, i) => {
          const isCur = h.version === current;
          return (
            <g key={h.version + i} onPointerEnter={() => setHover(h)} className="cursor-default">
              <rect x={i * 36 - 14} y={-6} width={28} height={H + 30} fill="transparent" />
              {!h.adopted && h.parent && <line x1={i * 36} x2={i * 36} y1={y(h)} y2={H} stroke="#5E5E66" strokeDasharray="1.5 2.5" />}
              <motion.circle
                cx={i * 36} cy={y(h)} r={isCur ? 5 : 4}
                fill={h.adopted ? "#FF5A1F" : "#0B0B0C"} stroke={h.adopted ? "#FF5A1F" : "#9A9AA1"} strokeWidth={1.25}
                initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.15 + i * 0.06, duration: 0.32, ease: EASE_OUT }}
                style={{ transformOrigin: `${i * 36}px ${y(h)}px` }}
              />
              {isCur && <circle cx={i * 36} cy={y(h)} r={9} fill="none" stroke="#FF5A1F" strokeOpacity={0.35} />}
              <text x={i * 36} y={H + 16} textAnchor="middle" fontSize="11" fill={hover === h ? "#EDEDEF" : h.adopted ? "#9A9AA1" : "#5E5E66"}
                className="num" textDecoration={h.adopted ? undefined : "line-through"}>{h.version}</text>
            </g>
          );
        })}
      </svg>
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
              <span>train <span className="text-text-2">{Math.round(hover.trainPass * (hover.trainPass > 1 ? 1 : 100))}{hover.trainPass > 1 ? "" : "%"}</span></span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
