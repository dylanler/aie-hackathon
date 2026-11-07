"use client";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { EXAMPLE_PROMPTS, startExample, startTyped } from "../data/client";
import { GetsBetter } from "../ui/GetsBetter";
import { KbdKey } from "../ui/HintTip";
import { EASE_OUT } from "../ui/motion";
import { PromptBox } from "../ui/PromptBox";

function Inner() {
  const router = useRouter();
  const q = useSearchParams().get("q") ?? "";
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // typed prompts run live when the full pipeline is available here; otherwise a calm note offers the examples
  const submit = async (prompt: string) => {
    if (EXAMPLE_PROMPTS.includes(prompt)) return example(prompt);
    setBusy(true); setNote(null);
    const to = await startTyped(prompt);
    if (to) return router.push(to);
    setBusy(false);
    setNote("Live runs are resting in this environment. Try one of the examples below — each replays a real recorded run, step by step.");
  };
  // example chips: live run when the backend is fully available, else the recorded real run of that exact prompt
  const example = async (prompt: string) => {
    setBusy(true); setNote(null);
    router.push(await startExample(prompt));
  };
  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center bg-bg px-6">
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(60% 50% at 50% 42%, rgba(255,255,255,0.035), transparent 70%)" }} />
      <header className="absolute inset-x-0 top-0 flex h-14 items-center justify-between px-6">
        <span className="text-s text-text-2">Thought to Reality</span>
        <span className="flex items-center gap-1 text-s text-text-3"><KbdKey>⌘</KbdKey><KbdKey>K</KbdKey></span>
      </header>
      <motion.h1 initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE_OUT }}
        className="mb-8 font-serif text-hero italic text-text">What should exist?</motion.h1>
      <motion.div layoutId="prompt" className="flex w-full justify-center" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.08 }}>
        <PromptBox key={q} onSubmit={submit} onExample={example} busy={busy} initial={q} />
      </motion.div>
      {note && <p role="status" className="mt-3 max-w-[560px] text-center text-s text-text-3">{note}</p>}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2"><GetsBetter variant="quiet" /></div>
    </main>
  );
}

export function Landing() {
  return <Suspense><Inner /></Suspense>;
}
