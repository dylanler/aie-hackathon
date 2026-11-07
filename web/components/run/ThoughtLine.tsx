"use client";
import { AnimatePresence, motion } from "framer-motion";
import type { RunEvent } from "../data/types";
import { modelName } from "../data/types";
import { EASE_OUT, T } from "../ui/motion";

export function ThoughtLine({ events }: { events: RunEvent[] }) {
  const shown = events.map((e, idx) => ({ ...e, idx })).filter((e) => e.message && !/^muse \d{3}|api_key/i.test(e.message)).slice(-3);
  return (
    <div className="pointer-events-none flex w-[calc(100vw-32px)] flex-col gap-1 md:w-[460px]">
      <AnimatePresence initial={false}>
        {shown.map((e, i) => {
          const age = shown.length - 1 - i;
          const m = modelName(e.model);
          return (
            <motion.div key={e.idx} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: age === 0 ? 1 : age === 1 ? 0.55 : 0.28, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: T.ui, ease: EASE_OUT }} className="flex items-center gap-2 text-s">
              <span className={`h-1 w-1 shrink-0 rounded-full ${e.phase === "error" ? "bg-err" : age === 0 ? "bg-signal" : "bg-text-3"}`} />
              <span className="truncate text-text-3">{e.message.replace(/^(static|mechanism|robot): /, "")}</span>
              {m && <span className="num shrink-0 rounded-[4px] border border-line px-1.5 py-px text-[10px] uppercase tracking-[0.06em] text-text-3">{m}</span>}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
