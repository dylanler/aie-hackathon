"use client";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, Minus } from "lucide-react";
import type { StepState } from "../data/types";
import { EASE_OUT, T } from "./motion";

function Ring({ state }: { state: StepState }) {
  const r = 6, c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex h-4 w-4 items-center justify-center">
      <AnimatePresence initial={false}>
        {state === "done" ? (
          <motion.span key="ok" className="absolute inset-0 flex items-center justify-center" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: T.ui, ease: EASE_OUT }}>
            <Check size={13} strokeWidth={2.25} className="text-ok" />
          </motion.span>
        ) : state === "error" ? (
          <motion.span key="err" className="absolute inset-0 flex items-center justify-center" initial={{ scale: 0.4 }} animate={{ scale: 1 }}><X size={13} strokeWidth={2.25} className="text-err" /></motion.span>
        ) : state === "skipped" ? (
          <motion.span key="skip" className="absolute inset-0 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Minus size={13} className="text-text-3" /></motion.span>
        ) : (
          <motion.svg key="ring" className="absolute inset-0" width="16" height="16" viewBox="0 0 16 16" exit={{ scale: 0.4, opacity: 0 }} transition={{ duration: T.micro }}>
            <circle cx="8" cy="8" r={r} fill="none" stroke="#26262A" strokeWidth="1.5" />
            {state === "running" && (
              <motion.circle
                cx="8" cy="8" r={r} fill="none" stroke="#FF5A1F" strokeWidth="1.5" strokeLinecap="round"
                strokeDasharray={c} initial={{ strokeDashoffset: c * 0.75 }}
                style={{ transformOrigin: "8px 8px" }}
                animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }}
              />
            )}
          </motion.svg>
        )}
      </AnimatePresence>
    </span>
  );
}

export function StepPill({ label, state, active, onClick }: { label: string; state: StepState; active: boolean; onClick?: () => void }) {
  const dim = state === "idle" || state === "skipped";
  return (
    <button
      onClick={onClick}
      className={`group relative flex h-8 items-center gap-2 rounded-full px-3 text-s transition-colors duration-200 ease-out ${
        active ? "bg-raised text-text" : dim ? "text-text-3 hover:text-text-2" : "text-text-2 hover:text-text"
      }`}
    >
      {active && <motion.span layoutId="pill-active" className="absolute inset-0 rounded-full border border-line bg-raised" transition={{ duration: T.panel, ease: EASE_OUT }} />}
      <span className="relative flex items-center gap-2"><Ring state={state} />{label}</span>
    </button>
  );
}
