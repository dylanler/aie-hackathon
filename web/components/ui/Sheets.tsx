"use client";
import { AnimatePresence, motion } from "framer-motion";
import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { EASE_OUT, T } from "./motion";

export function BottomSheet({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ duration: T.panel, ease: EASE_OUT }}
      className={`glass rounded-panel ${className}`}>
      {children}
    </motion.div>
  );
}

export function ConfirmSheet({ open, onClose, title, children, confirmLabel, onConfirm }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: T.ui }} onClick={onClose}>
          <motion.div role="dialog" aria-modal initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ duration: T.panel, ease: EASE_OUT }}
            onClick={(e) => e.stopPropagation()} className="w-full max-w-[440px] rounded-panel border border-line bg-surface p-5 shadow-float">
            <div className="text-l font-medium">{title}</div>
            <div className="mt-4">{children}</div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="h-9 rounded-btn px-4 text-s text-text-2 hover:bg-raised hover:text-text">Cancel</button>
              <button onClick={onConfirm} className="h-9 rounded-btn bg-signal px-4 text-s font-medium text-black hover:brightness-110">{confirmLabel}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
