"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { useState } from "react";
import type { Verdict } from "../data/types";
import { EASE_OUT, T } from "./motion";

const fmt = (v: number | string, unit?: string) => (typeof v === "number" ? `${unit === "p" ? v.toFixed(2) : +v.toFixed(2)}${unit ? " " + unit.replace("mm3", "mm³") : ""}` : `${v}${unit ? " " + unit : ""}`);

export function verdictLine(v: Verdict) {
  const hard = v.checks.filter((c) => !c.advisory);
  const clear = v.checks.find((c) => /clearance/i.test(c.name));
  const inter = v.checks.find((c) => /interpenetration|interference/i.test(c.name));
  if (v.pass) return clear ? `Fits · ${fmt(clear.value, clear.unit)} clearance` : `Passes · ${hard.filter((c) => c.pass).length}/${hard.length} checks`;
  if (inter && !inter.pass) return `Blocked · interference ${fmt(inter.value, inter.unit)}`;
  const failed = hard.filter((c) => !c.pass);
  return `Blocked · ${failed.length} check${failed.length > 1 ? "s" : ""} failed`;
}

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const [open, setOpen] = useState(false);
  const ok = verdict.pass;
  return (
    <div className="relative" onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)}>
      <motion.div
        initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: T.panel, ease: EASE_OUT }}
        className={`glass flex h-10 cursor-default items-center gap-2.5 rounded-full pl-3 pr-4 text-m ${ok ? "text-text" : "text-text"}`}
      >
        <span className={`flex h-5 w-5 items-center justify-center rounded-full ${ok ? "bg-ok/15 text-ok" : "bg-err/15 text-err"}`}>
          {ok ? <Check size={12} strokeWidth={2.5} /> : <X size={12} strokeWidth={2.5} />}
        </span>
        <span className="num text-[14px]">{verdictLine(verdict)}</span>
      </motion.div>
      <AnimatePresence>
        {open && (
          <div className="absolute left-1/2 top-full z-40 -translate-x-1/2 pt-2">
          <motion.ul
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: T.ui, ease: EASE_OUT }}
            className="glass w-[340px] rounded-panel p-2"
          >
            {verdict.checks.map((c, i) => (
              <motion.li key={c.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                className="flex items-center justify-between gap-3 rounded-chip px-2 py-1.5 text-s">
                <span className="flex min-w-0 items-center gap-2 text-text-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.advisory ? "border border-text-3" : c.pass ? "bg-ok" : "bg-err"}`} />
                  <span className="truncate">{c.name === "subq_judge_p_satisfies" ? "SubQ judge, P(fixes it)" : c.name.replace(/_/g, " ")}{c.advisory && <span className="text-text-3"> · advisory</span>}</span>
                </span>
                <span className={`num shrink-0 ${c.pass || c.advisory ? "text-text" : "text-err"}`}>{fmt(c.value, c.unit)}</span>
              </motion.li>
            ))}
            {verdict.critic_model && <li className="lbl px-2 pb-1 pt-2 text-text-3">checked by {verdict.critic_model}</li>}
          </motion.ul>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
