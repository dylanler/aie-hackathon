"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { KbdKey } from "./HintTip";
import { EASE_OUT, T } from "./motion";

export type Cmd = { id: string; label: string; kbd?: string; run: () => void };

export function CommandPalette({ commands }: { commands: Cmd[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); setQ(""); setI(0); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 10); }, [open]);
  const list = useMemo(() => commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())), [commands, q]);
  const pick = (c?: Cmd) => { if (!c) return; setOpen(false); c.run(); };
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] flex justify-center bg-black/40 pt-[18vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: T.micro }} onClick={() => setOpen(false)}>
          <motion.div initial={{ y: -6, opacity: 0, scale: 0.99 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: T.ui, ease: EASE_OUT }}
            onClick={(e) => e.stopPropagation()} className="h-fit w-[520px] overflow-hidden rounded-panel border border-line bg-surface shadow-float">
            <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} placeholder="Type a command"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(list.length - 1, x + 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
                if (e.key === "Enter") pick(list[i]);
              }}
              className="h-12 w-full border-b border-line bg-transparent px-4 text-m text-text placeholder:text-text-3 focus:outline-none" />
            <ul className="max-h-[320px] overflow-auto p-1.5">
              {list.map((c, k) => (
                <li key={c.id}>
                  <button onPointerEnter={() => setI(k)} onClick={() => pick(c)}
                    className={`flex h-9 w-full items-center justify-between rounded-chip px-3 text-s ${k === i ? "bg-raised text-text" : "text-text-2"}`}>
                    {c.label}{c.kbd && <KbdKey>{c.kbd}</KbdKey>}
                  </button>
                </li>
              ))}
              {!list.length && <li className="px-3 py-2 text-s text-text-3">Nothing matches</li>}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
