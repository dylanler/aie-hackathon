"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AnimatePresence, motion } from "framer-motion";
import { Lock, Unlock } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRun } from "../data/client";
import { useSearchParams } from "next/navigation";
import type { Part, StepKey } from "../data/types";
import { STEPS } from "../data/types";
import type { Gait, Mode } from "../three/Canvas3D";
import { CommandPalette, type Cmd } from "../ui/CommandPalette";
import { GetsBetter } from "../ui/GetsBetter";
import { HintTip, KbdKey } from "../ui/HintTip";
import { EASE_OUT, T } from "../ui/motion";
import { PlanStrip } from "../ui/PlanStrip";
import { useToast } from "../ui/Toast";
import { VerdictChip } from "../ui/VerdictChip";
import { Inspector } from "./Inspector";
import { MakePanel } from "./MakePanel";
import { PartRail } from "./PartRail";
import { ThoughtLine } from "./ThoughtLine";
import { TrainSheet } from "./TrainSheet";

const Canvas3D = dynamic(() => import("../three/Canvas3D"), { ssr: false });

const modeFor = (k: StepKey, hasParts: boolean): Mode => (!hasParts ? "sketch" : k === "verify" ? "fit" : k === "train" ? "train" : k === "diagnose" ? "sketch" : "model");

const panel = { initial: { opacity: 0, x: 8 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 8 }, transition: { duration: T.panel, ease: EASE_OUT } };

export function RunView({ id, initialView }: { id: string; initialView?: StepKey }) {
  const sp = useSearchParams();
  const r = useRun(id, { instant: sp.get("instant") === "1" });
  const router = useRouter();
  const toast = useToast();
  const [manual, setManual] = useState<StepKey | null>(initialView ?? null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, Record<string, number>>>({});
  const [explode, setExplode] = useState(false);
  const [locked, setLocked] = useState(false);
  const [gait, setGait] = useState<Gait>("walk");
  const [paused, setPaused] = useState(false);
  const [curves, setCurves] = useState<Record<string, number[]>>({});
  const [curveMeta, setCurveMeta] = useState<Record<string, { judge?: string; candidates?: number; videoLabel?: string; policySuccess?: number }>>({});

  const parts = useMemo(() => r.run?.parts ?? [], [r.run?.parts]);
  const robot = r.run?.kind === "robot";

  // follow the pipeline until the user takes over
  const auto: StepKey = useMemo(() => {
    if (r.finished) return robot ? "train" : "verify";
    const running = [...STEPS].reverse().find((s) => r.steps[s.key] === "running");
    const done = [...STEPS].reverse().find((s) => r.steps[s.key] === "done");
    const k = running?.key ?? done?.key ?? "diagnose";
    if (k === "design" && !(r.run?.parts?.length)) return "diagnose"; // keep the diagnosis up until there is geometry
    return k === "make" ? "verify" : k;
  }, [r.steps, r.finished, robot, r.run?.parts?.length]);
  const view = manual ?? auto;
  const mode = modeFor(view, parts.length > 0);
  const part = parts.find((p) => p.id === selected) ?? parts[0];
  const skillNow = r.rl?.skills.find((s) => s.name === gait) ?? r.rl?.skills[0];
  const video = skillNow?.video ? r.asset(skillNow.video) : null;

  useEffect(() => {
    if (!r.rl) return;
    r.rl.skills.forEach((s) => {
      if (Array.isArray(s.curve)) setCurves((c) => ({ ...c, [s.name]: s.curve as number[] }));
      else if (typeof s.curve === "string" && r.asset(s.curve))
        fetch(r.asset(s.curve)!).then((x) => x.json()).then((j) => {
          const eps: any[] = Array.isArray(j) ? j : Array.isArray(j.episodes) ? j.episodes : [];
          const scored = eps.filter((p) => typeof p === "number" || typeof p?.task_score === "number");
          const raw: number[] = scored.length ? scored.map((p) => (typeof p === "number" ? p : p.task_score)) : (j.series ?? j.reward ?? j.rewards ?? []);
          if (!Array.isArray(j)) setCurveMeta((m) => ({ ...m, [s.name]: {
            judge: j.judge_backend, candidates: j.hacking ? Object.keys(j.hacking).length : undefined,
            videoLabel: j.video_label, policySuccess: typeof j.policy_success === "number" ? j.policy_success : undefined,
          } }));
          // smooth + downsample to ~60 points for a calm line
          const n = Math.max(1, Math.floor(raw.length / 60));
          const arr = raw.length ? Array.from({ length: Math.ceil(raw.length / n) }, (_, i) => { const w = raw.slice(Math.max(0, i * n - n * 2), i * n + n); return w.reduce((a, b) => a + b, 0) / w.length; }) : [];
          const hi = Math.max(1, ...arr.map(Math.abs));
          setCurves((c) => ({ ...c, [s.name]: arr.map((v) => v / hi) }));
        }).catch(() => {});
    });
  }, [r.rl, r.asset]);

  const urlFor = useCallback((p: Part) => (p.stl ? r.asset(p.stl) : null), [r]);

  const setParam = (pid: string, k: string, v: number) => setParams((s) => ({ ...s, [pid]: { ...(s[pid] || parts.find((x) => x.id === pid)?.params || {}), [k]: v } }));

  const download = useCallback(async () => {
    if (parts.some((p) => p.stl && r.asset(p.stl))) {
      parts.filter((p) => p.stl).forEach((p) => { const a = document.createElement("a"); a.href = r.asset(p.stl!)!; a.download = p.stl!.split("/").pop()!; a.click(); });
      toast(`Downloading ${parts.filter((p) => p.stl).length} STL file${parts.length > 1 ? "s" : ""}`);
      return;
    }
    const [{ STLExporter }, { geometryFor }, THREE] = await Promise.all([import("three/examples/jsm/exporters/STLExporter.js"), import("../three/shapes"), import("three")]);
    const ex = new STLExporter();
    parts.forEach((p) => {
      const mesh = new THREE.Mesh(geometryFor(p, params[p.id] || p.params || {}));
      const blob = new Blob([ex.parse(mesh, { binary: true }) as unknown as BlobPart], { type: "model/stl" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${p.id}.stl`; a.click();
    });
    toast(`Downloading ${parts.length} STL file${parts.length > 1 ? "s" : ""}`);
  }, [r, parts, params, toast]);

  const select = useCallback((k: StepKey) => { setManual(k); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 5) select(STEPS[n - 1].key);
      if (e.key === "e") setExplode((x) => !x);
      if (e.key === "l") setLocked((x) => !x);
      if (e.key === " " && view === "train") { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, view]);

  const commands: Cmd[] = [
    ...STEPS.map((s, i) => ({ id: s.key, label: `Go to ${s.label}`, kbd: String(i + 1), run: () => select(s.key) })),
    { id: "explode", label: explode ? "Collapse parts" : "Explode parts", kbd: "E", run: () => setExplode((x) => !x) },
    { id: "lock", label: locked ? "Unlock camera" : "Lock camera", kbd: "L", run: () => setLocked((x) => !x) },
    { id: "dl", label: "Download STL files", run: download },
    { id: "new", label: "New prompt", run: () => router.push("/") },
  ];

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg">
      <div className="absolute inset-0">
        <Canvas3D parts={parts} kind={r.run?.kind} mode={mode} params={params} explode={explode} hovered={hovered} onHover={setHovered}
          failing={r.verdict ? !r.verdict.pass : false} urlFor={urlFor} gait={(skillNow?.name ?? gait).replace("-", " ") as Gait} hideRobot={view === "train" && !!video} paused={paused || view !== "train"} locked={locked}
          onUserOrbit={() => setLocked(true)} showContext />
      </div>

      {/* top bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex h-14 items-center justify-between px-6">
        <Link href="/" className="pointer-events-auto text-s text-text-2 transition-colors hover:text-text">Thought to Reality</Link>
        <div className="pointer-events-none absolute inset-x-0 flex justify-center"><motion.div initial={{ opacity: 0, y: 12, scale: 1.04 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: T.panel, ease: EASE_OUT }} className="glass pointer-events-auto flex h-9 max-w-[520px] items-center gap-2 rounded-full px-4">
          <HintTip label="Start over with a new prompt" side="bottom">
            <button onClick={() => router.push(`/?q=${encodeURIComponent(r.run?.prompt || "")}`)} className="max-w-[460px] truncate text-s text-text">{r.run?.prompt ?? "…"}</button>
          </HintTip>
        </motion.div></div>
        <div className="pointer-events-auto relative flex items-center gap-3">
          {r.source && (
            <HintTip label={r.recorded ? "Recorded pipeline run, replayed" : r.source === "api" ? "Streaming from the pipeline" : r.source === "static" ? "Recorded pipeline run" : "Sample run, API offline"} side="bottom">
              <span className="flex items-center gap-1.5 text-s text-text-3">
                <span className={`h-1.5 w-1.5 rounded-full ${r.source === "api" ? (r.finished || r.recorded ? "bg-ok" : "bg-signal") : "bg-text-3"}`} />
                <span className="lbl">{r.source === "fixture" ? "sample" : r.recorded ? "replay" : r.finished ? "done" : "live"}</span>
              </span>
            </HintTip>
          )}
          <HintTip label={locked ? "Camera follows steps" : "Hold this view"} kbd="L" side="bottom">
            <button aria-label="Lock camera" onClick={() => setLocked((x) => !x)} className={`flex h-8 w-8 items-center justify-center rounded-btn transition-colors hover:bg-raised ${locked ? "text-signal" : "text-text-3"}`}>
              {locked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>
          </HintTip>
          <HintTip label="Commands" side="bottom"><span className="flex gap-1"><KbdKey>⌘</KbdKey><KbdKey>K</KbdKey></span></HintTip>
        </div>
      </header>

      {/* plan strip */}
      <div className="absolute left-1/2 top-[68px] -translate-x-1/2">
        <PlanStrip steps={r.steps} active={view} onSelect={select} kind={r.run?.kind} />
      </div>

      {/* fit verdict */}
      <AnimatePresence>
        {view === "verify" && r.verdict && (
          <motion.div key="verdict" {...panel} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="absolute inset-x-0 top-[128px] mx-auto flex w-fit flex-col items-center gap-2.5">
            <VerdictChip verdict={r.verdict} />
            <div className="font-serif text-[17px] italic text-text-2">Designed by one model. Checked by physics.</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* left rail */}
      {mode !== "sketch" && view !== "train" && (
        <div className="absolute left-6 top-1/2 -translate-y-1/2">
          <PartRail parts={parts} selected={part?.id ?? null} hovered={hovered} onSelect={(pid) => { setSelected(pid); setManual("design"); }} onHover={setHovered} />
        </div>
      )}

      {/* diagnosis */}
      <AnimatePresence>
        {view === "diagnose" && (
          <motion.div key="dx" {...panel} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="absolute inset-x-0 top-[34%] mx-auto w-[560px] text-center">
            {r.diagnosis ? (
              <>
                <div className="lbl text-text-3">{r.diagnosis.object}</div>
                <div className="mx-auto mt-3 max-w-[520px] text-l text-text">{r.diagnosis.failure}</div>
                {r.diagnosis.assumptions?.length > 0 && (
                  <div className="mt-5 flex flex-wrap justify-center gap-1.5">
                    {(r.diagnosis.assumptions as string[]).slice(0, 4).map((a, i) => (
                      <HintTip key={a} label="Assumed. Edit in Design." side="bottom">
                        <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.03, duration: T.ui, ease: EASE_OUT }}
                          className="num max-w-[260px] truncate rounded-chip border border-line bg-surface/60 px-2 py-1 text-[12px] text-text-2">{a}</motion.span>
                      </HintTip>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-m text-text-3">Reading the problem</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* right panel */}
      <div className="absolute right-6 top-[128px]">
        <AnimatePresence initial={false}>
          {view === "design" && part && (
            <motion.div key={"insp" + part.id} {...panel}>
              <Inspector part={part} values={params[part.id] || part.params || {}} explode={explode} onExplode={() => setExplode((x) => !x)}
                onChange={(k, v) => setParam(part.id, k, v)}
                onCommit={(k, prev, v) => { if (prev !== v) toast(`${k.replace(/_mm$/, "").replace(/_/g, " ")} ${v.toFixed(1)} mm`, () => setParam(part.id, k, prev)); }}
                onReset={() => setParams((s) => ({ ...s, [part.id]: { ...(part.params || {}) } }))} />
            </motion.div>
          )}
          {view === "make" && r.fab && (
            <motion.div key="make" {...panel}><MakePanel fab={r.fab} parts={parts} onDownload={download} /></motion.div>
          )}
          {view === "make" && !r.fab && r.steps.make !== "done" && (
            <motion.div key="make-wait" {...panel} className="glass w-[296px] rounded-panel p-4 text-s text-text-3">Routing to fabrication</motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* heatmap legend */}
      {view === "verify" && mode === "fit" && (
        <div className="absolute right-6 top-[128px] flex items-center gap-2 rounded-full px-1 text-s text-text-3">
          <span className="lbl">clearance</span>
          <span className="h-1.5 w-20 rounded-full" style={{ background: "linear-gradient(90deg,#3DD68C,#F5B544,#F2555A)" }} />
          <span className="lbl">contact</span>
        </div>
      )}

      {/* policy video from the RL lane, when there is one */}
      <AnimatePresence>
        {view === "train" && video && (
          <motion.div key={"vid" + gait} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: T.panel, ease: EASE_OUT }}
            className="absolute inset-x-0 top-[128px] bottom-[236px] mx-auto flex w-fit items-center">
            <div className="relative h-full">
              <video autoPlay loop muted playsInline className="h-full max-w-[880px] rounded-panel border border-line bg-surface object-contain"
                ref={(v) => { if (!v) return; if (paused) v.pause(); else v.play().catch(() => {}); }}>
                <source src={video.replace(/\.mp4$/, ".webm")} type="video/webm" />
                <source src={video} type="video/mp4" />
              </video>
              <span className="lbl absolute left-3 top-3 rounded-chip bg-black/60 px-1.5 py-0.5 text-text-2">MuJoCo · {curveMeta[skillNow?.name ?? ""]?.videoLabel ?? "policy rollout"}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* train */}
      <AnimatePresence>
        {view === "train" && (
          robot && r.rl ? (
            <motion.div key="train" className="absolute inset-x-0 bottom-6 mx-auto w-fit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <TrainSheet rl={r.rl} gait={gait} onGait={setGait} paused={paused} onPause={() => setPaused((p) => !p)} curves={curves} meta={curveMeta} />
            </motion.div>
          ) : (
            <motion.div key="notrain" className="absolute inset-x-0 top-[40%] text-center text-m text-text-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {robot ? "Training starts after Verify." : "Static part. Nothing to train."}
            </motion.div>
          )
        )}
      </AnimatePresence>

      {/* bottom */}
      {view !== "train" && (
        <>
          <div className="absolute bottom-6 left-6"><ThoughtLine events={r.events} /></div>
          <div className="absolute bottom-6 right-6"><GetsBetter /></div>
        </>
      )}
      {view === "train" && <div className="absolute left-6 top-[128px]"><ThoughtLine events={r.events.filter((e) => e.stage === "rl")} /></div>}

      <CommandPalette commands={commands} />
    </main>
  );
}
