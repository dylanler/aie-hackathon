"use client";
import { motion } from "framer-motion";
import { STEPS, type StepKey, type StepState } from "../data/types";
import { StepPill } from "./StepPill";
import { HintTip } from "./HintTip";
import { EASE_OUT } from "./motion";

const hints: Record<StepKey, string> = {
  diagnose: "What's actually wrong",
  design: "The part and its parameters",
  verify: "Physics checks the design",
  train: "Teach it to move",
  make: "Print it or order it",
};

export function PlanStrip({ steps, active, onSelect, kind }: { steps: Record<StepKey, StepState>; active: StepKey; onSelect: (k: StepKey) => void; kind?: string }) {
  return (
    <motion.nav initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.03 } } }} className="glass flex items-center gap-0.5 rounded-full p-1">
      {STEPS.map((s, i) => (
        <motion.div key={s.key} className="flex items-center" variants={{ h: { opacity: 0, y: -4 }, s: { opacity: 1, y: 0 } }} transition={{ duration: 0.32, ease: EASE_OUT }}>
          {i > 0 && <span className="mx-0.5 h-px w-3 bg-line" />}
          <HintTip label={s.key === "train" && kind && kind !== "robot" ? "Static part. Nothing to train." : hints[s.key]} kbd={String(i + 1)}>
            <StepPill label={s.label} state={steps[s.key]} active={active === s.key} onClick={() => onSelect(s.key)} />
          </HintTip>
        </motion.div>
      ))}
    </motion.nav>
  );
}
