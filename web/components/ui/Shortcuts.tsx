"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { KbdKey } from "./HintTip";
import { EASE_OUT, T } from "./motion";

const ROWS: [string[], string][] = [
  [["⏎"], "Run the prompt"],
  [["←", "→"], "Previous / next stage"],
  [["1", "–", "5"], "Jump to a stage"],
  [["E"], "Explode parts"],
  [["L"], "Hold the camera"],
  [["Space"], "Pause training"],
  [["⌘", "Z"], "Undo last change"],
  [["⌘", "K"], "Commands"],
  [["?"], "This list"],
];

/** "?" opens a quiet list of keyboard shortcuts. Esc or a click closes it. */
export function Shortcuts() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "?") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: T.micro }} onClick={() => setOpen(false)}>
          <motion.div role="dialog" aria-label="Keyboard shortcuts" initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: T.ui, ease: EASE_OUT }} onClick={(e) => e.stopPropagation()}
            className="w-[min(340px,calc(100vw-32px))] rounded-panel border border-line bg-surface p-4 shadow-float">
            <div className="lbl mb-2 text-text-3">Keyboard</div>
            <ul>
              {ROWS.map(([keys, label]) => (
                <li key={label} className="flex h-8 items-center justify-between text-s text-text-2">
                  {label}
                  <span className="flex gap-1">{keys.map((k) => (k === "–" ? <span key={k} className="text-text-3">–</span> : <KbdKey key={k}>{k}</KbdKey>))}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
