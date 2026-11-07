"use client";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createRun } from "../data/client";
import { GetsBetter } from "../ui/GetsBetter";
import { KbdKey } from "../ui/HintTip";
import { EASE_OUT } from "../ui/motion";
import { PromptBox } from "../ui/PromptBox";

function Inner() {
  const router = useRouter();
  const q = useSearchParams().get("q") ?? "";
  const [busy, setBusy] = useState(false);
  const submit = async (prompt: string) => {
    setBusy(true);
    const { id } = await createRun(prompt);
    router.push(`/runs/${encodeURIComponent(id)}`);
  };
  // example chips open recorded pipeline runs so the demo never waits on a model; typed prompts run live
  const example = (prompt: string) => {
    if (/freezer/i.test(prompt)) return router.push("/runs/demo-freezer-latch");
    if (/dog/i.test(prompt)) return router.push("/runs/demo-robot-dog");
    submit(prompt);
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
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2"><GetsBetter variant="quiet" /></div>
    </main>
  );
}

export function Landing() {
  return <Suspense><Inner /></Suspense>;
}
