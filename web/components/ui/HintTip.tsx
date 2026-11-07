"use client";
import { AnimatePresence, motion } from "framer-motion";
import { ReactNode, useRef, useState } from "react";
import { EASE_OUT, T } from "./motion";

export function KbdKey({ children }: { children: ReactNode }) {
  return (
    <kbd className="num inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line bg-surface px-1 text-[11px] leading-none text-text-2">
      {children}
    </kbd>
  );
}

type Side = "top" | "bottom" | "left" | "right";
const pos: Record<Side, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};
const rise: Record<Side, object> = { top: { y: 4 }, bottom: { y: -4 }, left: { x: 4 }, right: { x: -4 } };

/** One line, ≤6 words, optional key. Appears after 400ms hover. */
export function HintTip({ label, kbd, side = "bottom", children, className = "" }: { label: ReactNode; kbd?: string; side?: Side; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), 400); };
  const hide = () => { clearTimeout(timer.current); setOpen(false); };
  return (
    <span className={`relative inline-flex ${className}`} onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide} onPointerDown={hide}>
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, ...rise[side] }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: T.micro, ease: EASE_OUT }}
            className={`pointer-events-none absolute z-50 flex items-center gap-2 whitespace-nowrap rounded-chip border border-line bg-raised px-2 py-1 text-s text-text shadow-float ${pos[side]}`}
          >
            {label}
            {kbd && <KbdKey>{kbd}</KbdKey>}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
