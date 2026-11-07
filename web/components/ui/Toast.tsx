"use client";
import { AnimatePresence, motion } from "framer-motion";
import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";
import { EASE_OUT, T } from "./motion";

type ToastT = { id: number; text: string; undo?: () => void };
const Ctx = createContext<(text: string, undo?: () => void) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastT[]>([]);
  const n = useRef(0);
  const push = useCallback((text: string, undo?: () => void) => {
    const id = ++n.current;
    setToasts((p) => [...p.slice(-2), { id, text, undo }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 5000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: T.ui, ease: EASE_OUT }}
              className="pointer-events-auto flex h-10 max-w-[calc(100vw-24px)] items-center gap-4 rounded-full border border-line bg-raised pl-4 pr-2 text-s shadow-float">
              <span className="truncate text-text">{t.text}</span>
              {t.undo && (
                <button onClick={() => { t.undo!(); setToasts((p) => p.filter((x) => x.id !== t.id)); }} className="h-7 rounded-full px-3 text-text-2 hover:bg-surface hover:text-text">Undo</button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
