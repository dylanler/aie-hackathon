"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import { Layers } from "lucide-react";
import type { Part } from "../data/types";
import { EASE_OUT, T } from "../ui/motion";

export function PartRail({ parts, selected, hovered, onSelect, onHover }: { parts: Part[]; selected: string | null; hovered: string | null; onSelect: (id: string) => void; onHover: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  if (!parts.length) return null;
  return (
    <motion.div onPointerEnter={() => setOpen(true)} onPointerLeave={() => { setOpen(false); onHover(null); }}
      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0, width: open ? 216 : 48 }} transition={{ duration: T.ui, ease: EASE_OUT }}
      className="glass overflow-hidden rounded-panel p-1">
      <div className="lbl flex h-8 items-center gap-3 px-3 text-text-3"><Layers size={14} strokeWidth={1.75} className="shrink-0" />{open && <span>Parts · {parts.length}</span>}</div>
      {parts.map((p, i) => {
        const active = selected === p.id, hot = hovered === p.id;
        return (
          <button key={p.id} onClick={() => onSelect(p.id)} onPointerEnter={() => onHover(p.id)}
            className={`flex h-10 w-full items-center gap-3 rounded-btn px-2 text-left transition-colors duration-200 ${active ? "bg-raised" : hot ? "bg-raised/60" : ""}`}>
            <span className={`num flex h-6 w-6 shrink-0 items-center justify-center rounded-chip border text-[11px] ${active ? "border-signal/60 text-signal" : "border-line text-text-3"}`}>{String(i + 1).padStart(2, "0")}</span>
            <span className={`min-w-0 flex-1 truncate whitespace-nowrap text-s ${active ? "text-text" : "text-text-2"}`}>{p.name}</span>
            {open && <span className="num shrink-0 text-[11px] text-text-3">{p.material.split(" ")[0]}</span>}
          </button>
        );
      })}
    </motion.div>
  );
}
