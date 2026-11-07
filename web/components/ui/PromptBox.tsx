"use client";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, ImagePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HintTip, KbdKey } from "./HintTip";
import { EASE_OUT, T } from "./motion";

import { EXAMPLE_PROMPTS as EXAMPLES } from "../data/client";

export function PromptBox({ onSubmit, onExample, busy, initial = "" }: { onSubmit: (prompt: string, photo?: File) => void; onExample?: (prompt: string) => void; busy?: boolean; initial?: string }) {
  const [value, setValue] = useState(initial);
  const [idle, setIdle] = useState(false);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [over, setOver] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);

  useEffect(() => { ta.current?.focus(); }, []);
  useEffect(() => {
    setIdle(false);
    if (value) return;
    const t = setTimeout(() => setIdle(true), 800);
    return () => clearTimeout(t);
  }, [value]);
  useEffect(() => {
    const el = ta.current; if (!el) return;
    el.style.height = "0px"; el.style.height = Math.min(160, el.scrollHeight) + "px";
  }, [value]);

  const go = (v = value) => { if (v.trim() && !busy) onSubmit(v.trim(), photo?.file); };
  const take = (f?: File | null) => { if (f && f.type.startsWith("image/")) setPhoto({ file: f, url: URL.createObjectURL(f) }); };

  return (
    <div className="w-full max-w-[640px]">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
        className={`group relative rounded-prompt border bg-surface transition-colors duration-200 ease-out focus-within:border-[#3a3a40] ${over ? "border-signal" : "border-line"}`}
      >
        <AnimatePresence>
          {photo && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: T.ui, ease: EASE_OUT }} className="px-4 pt-4">
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="" className="h-16 w-16 rounded-btn object-cover" />
                <button aria-label="Remove photo" onClick={() => setPhoto(null)} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-raised text-text-2 hover:text-text"><X size={11} /></button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <textarea
          ref={ta} rows={1} value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }}
          placeholder="Describe a problem, or a thing"
          className="block w-full bg-transparent px-5 pb-2 pt-5 text-l text-text placeholder:text-text-3 focus:outline-none"
          aria-label="What should exist?"
        />
        <div className="flex items-center justify-between px-3 pb-3">
          <HintTip label="Add a photo of it" side="bottom">
            <button aria-label="Add photo" onClick={() => fileIn.current?.click()} className="flex h-8 w-8 items-center justify-center rounded-btn text-text-3 transition-colors hover:bg-raised hover:text-text-2">
              <ImagePlus size={16} strokeWidth={1.75} />
            </button>
          </HintTip>
          <input ref={fileIn} type="file" accept="image/*" hidden onChange={(e) => take(e.target.files?.[0])} />
          <div className="flex items-center gap-3">
            <span className={`flex items-center gap-1.5 text-s text-text-3 transition-opacity duration-200 ${value ? "opacity-100" : "opacity-0"}`}><KbdKey>⏎</KbdKey> to make it</span>
            <button
              aria-label="Make it" onClick={() => go()} disabled={!value.trim() || busy}
              className={`flex h-8 w-8 items-center justify-center rounded-btn transition-all duration-200 ease-out ${value.trim() ? "bg-signal text-black" : "bg-raised text-text-3"} ${busy ? "animate-pulse" : ""}`}
            >
              <ArrowUp size={16} strokeWidth={2.25} />
            </button>
          </div>
        </div>
      </div>
      <div className="-mx-20 mt-4 flex h-8 justify-center gap-2">
        <AnimatePresence>
          {idle && !value && EXAMPLES.map((ex, i) => (
            <motion.button
              key={ex} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: T.panel, ease: EASE_OUT, delay: i * 0.06 }}
              onClick={() => { setValue(ex); if (onExample) onExample(ex); else go(ex); }}
              className="h-8 rounded-full border border-line px-3 text-s text-text-3 transition-colors duration-200 hover:border-[#3a3a40] hover:text-text"
            >
              {ex}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
