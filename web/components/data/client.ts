"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import type { Fab, HistoryEntry, RLManifest, Run, RunEvent, StepKey, StepState, Verdict } from "./types";
import { STEPS, stepOf } from "./types";
import { freezerEvents, freezerFab, freezerRun, freezerVerdict } from "@/fixtures/freezer-latch";
import { dogEvents, dogFab, dogRL, dogRun, dogVerdict } from "@/fixtures/robot-dog";
import { historyFixture } from "@/fixtures/evals-history";

export type Source = "api" | "static" | "fixture";

type Fixture = { run: Run; verdict: Verdict; fab: Fab; rl: RLManifest | null; events: [number, RunEvent][] };
export const FIXTURES: Record<string, Fixture> = {
  "demo-freezer-latch": { run: freezerRun, verdict: freezerVerdict, fab: freezerFab, rl: null, events: freezerEvents },
  "demo-robot-dog": { run: dogRun, verdict: dogVerdict, fab: dogFab, rl: dogRL, events: dogEvents },
};
export const fixtureFor = (prompt: string) => (/dog|robot|walk|legs?/i.test(prompt) ? "demo-robot-dog" : "demo-freezer-latch");

async function getJSON<T>(url: string, ms = 2500): Promise<T | null> {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; } finally { clearTimeout(timer); }
}

export const fileUrl = (runId: string, rel: string) => `/api/runs/${encodeURIComponent(runId)}/files/${rel ? rel.split("/").map(encodeURIComponent).join("/") : ""}`;

/** POST /api/runs → id. Falls back to a fixture id when the API is not reachable. */
export async function createRun(prompt: string): Promise<{ id: string; source: Source }> {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 4000);
  try {
    const r = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }), signal: c.signal });
    if (r.ok) { const j = await r.json(); if (j?.id) return { id: j.id, source: "api" }; }
  } catch {} finally { clearTimeout(timer); }
  return { id: fixtureFor(prompt), source: "fixture" };
}

export type RunState = {
  source: Source | null;
  run: Run | null;
  events: RunEvent[];
  steps: Record<StepKey, StepState>;
  verdict: Verdict | null;
  fab: Fab | null;
  rl: RLManifest | null;
  diagnosis: any;
  finished: boolean;
  /** URL for a file in this run (STL, mp4, curve), or null when none is served. */
  asset: (rel: string) => string | null;
  /** a finished run being replayed at reading pace */
  recorded: boolean;
};

function stepsFrom(events: RunEvent[], kind?: string, finished?: boolean): Record<StepKey, StepState> {
  const s: Record<StepKey, StepState> = { diagnose: "idle", design: "idle", verify: "idle", train: "idle", make: "idle" };
  for (const e of events) {
    const k = stepOf(e.stage);
    if (e.phase === "start" || e.phase === "progress" || e.phase === "artifact") { if (s[k] !== "done" || e.phase === "start") s[k] = "running"; }
    if (e.phase === "done") s[k] = "done";
    if (e.phase === "error") s[k] = "error";
  }
  // design spans design+cad; verify spans verify+improve: "done" only when the last event of that step is done
  for (const st of STEPS) {
    const last = [...events].reverse().find((e) => st.stages.includes(e.stage));
    if (last && last.phase !== "done" && last.phase !== "error") s[st.key] = "running";
  }
  if (kind && kind !== "robot" && (s.train === "done" || finished)) s.train = "skipped";
  if (finished) for (const k of Object.keys(s) as StepKey[]) if (s[k] === "running") s[k] = "done";
  return s;
}

const STATIC_BASE = (id: string) => `/static-runs/${encodeURIComponent(id)}/`;

export function useRun(id: string, opts: { instant?: boolean } = {}): RunState {
  const [source, setSource] = useState<Source | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [fab, setFab] = useState<Fab | null>(null);
  const [rl, setRl] = useState<RLManifest | null>(null);
  const [finished, setFinished] = useState(false);
  const [assetBase, setAssetBase] = useState<string>("");
  const [recorded, setRecorded] = useState(false);
  const instant = !!opts.instant;

  useEffect(() => {
    const alive = { current: true };
    setSource(null); setRun(null); setEvents([]); setVerdict(null); setFab(null); setRl(null); setFinished(false); setRecorded(false);
    let es: EventSource | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, f: () => void) => timers.push(setTimeout(() => alive.current && f(), ms));

    /** Replay a finished run at a readable pace, revealing artifacts as their events arrive. */
    const pacedReplay = (evs: RunEvent[], full: Run, art: { verdict: Verdict | null; fab: Fab | null; rl: RLManifest | null }) => {
      setRun({ ...full, parts: [] });
      let at = 250;
      let partsShown = false;
      evs.forEach((ev) => {
        const gap = instant ? 0 : ev.phase === "done" && ev.stage === "diagnose" ? 1700 : ev.phase === "done" && ev.stage === "verify" ? 1100 : ev.stage === "rl" || ev.stage === "improve" ? 260 : 520;
        at += gap;
        later(at, () => {
          setEvents((p) => [...p, { ...ev, ts: ev.ts || Date.now() }]);
          if (!partsShown && (ev.stage === "cad" && (ev.phase === "artifact" || ev.phase === "done"))) { partsShown = true; setRun(full); }
          if (ev.stage === "verify" && ev.phase === "done") setVerdict(art.verdict);
          if (ev.stage === "rl" && ev.phase === "start") setRl(art.rl);
          if (ev.stage === "make") setFab(art.fab);
        });
      });
      later(at + 250, () => { setRun(full); setVerdict(art.verdict); setFab(art.fab); setRl(art.rl); setFinished(true); });
    };

    const replayFixture = async (fx: Fixture) => {
      setSource("fixture");
      let rlReal: RLManifest | null = null;
      if (fx.run.kind === "robot") {
        rlReal = await getJSON<RLManifest>("/rl/manifest.json", 8000);
        if (rlReal) { setAssetBase("/rl/"); rlReal = { ...rlReal, judge: rlReal.judge || "subq-snap-1.1" }; }
      }
      if (!alive.current) return;
      pacedReplay(fx.events.map(([, e]) => e), fx.run, { verdict: fx.verdict, fab: fx.fab, rl: rlReal ?? fx.rl });
    };

    const loadDone = async (r: Run, base: string) => {
      setRecorded(true);
      const [txt, v, f, rlm] = await Promise.all([
        fetch(base + "events.jsonl", { cache: "no-store" }).then((x) => (x.ok ? x.text() : "")).catch(() => ""),
        r.verdict ? getJSON<Verdict>(base + r.verdict, 15000) : Promise.resolve(null),
        r.fab ? getJSON<Fab>(base + r.fab, 15000) : Promise.resolve(null),
        r.rl ? getJSON<RLManifest>(base + r.rl, 15000) : Promise.resolve(null),
      ]);
      if (!alive.current) return;
      const evs = txt.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) as RunEvent; } catch { return null; } }).filter(Boolean) as RunEvent[];
      pacedReplay(evs, r, { verdict: v, fab: f, rl: rlm });
    };

    (async () => {
      const r = await getJSON<Run>(`/api/runs/${encodeURIComponent(id)}`, 15000);
      if (!alive.current) return;
      if (!r) {
        const sr = await getJSON<Run>(STATIC_BASE(id) + "run.json", 5000);
        if (!alive.current) return;
        if (sr) { setSource("static"); setAssetBase(STATIC_BASE(id)); loadDone(sr, STATIC_BASE(id)); return; }
        replayFixture(FIXTURES[id] || FIXTURES["demo-freezer-latch"]);
        return;
      }
      setSource("api");
      const base = fileUrl(id, "");
      setAssetBase(base);
      if (r.status === "done" || r.status === "error") { loadDone(r, base); return; }
      setRun(r);
      const loadArtifacts = (nr: Run) => {
        if (nr.verdict) getJSON<Verdict>(base + nr.verdict, 15000).then((v) => alive.current && v && setVerdict(v));
        if (nr.fab) getJSON<Fab>(base + nr.fab, 15000).then((v) => alive.current && v && setFab(v));
        if (nr.rl) getJSON<RLManifest>(base + nr.rl, 15000).then((v) => alive.current && v && setRl(v));
      };
      try {
        es = new EventSource(`/api/runs/${encodeURIComponent(id)}/stream`);
        es.onmessage = (m) => {
          try {
            const ev = JSON.parse(m.data) as RunEvent;
            setEvents((p) => [...p, ev]);
            if (ev.phase === "done" || ev.phase === "artifact") {
              getJSON<Run>(`/api/runs/${encodeURIComponent(id)}`, 15000).then((nr) => { if (nr && alive.current) { setRun(nr); loadArtifacts(nr); } });
            }
          } catch {}
        };
        es.addEventListener("end", (m: MessageEvent) => {
          try { const nr = JSON.parse(m.data) as Run; setRun(nr); loadArtifacts(nr); } catch {}
          setFinished(true); es?.close();
        });
      } catch {}
    })();

    return () => { alive.current = false; es?.close(); timers.forEach(clearTimeout); };
  }, [id, instant]);

  const steps = useMemo(() => stepsFrom(events, run?.kind, finished), [events, run?.kind, finished]);
  const diagnosis = useMemo(() => events.find((e) => e.stage === "diagnose" && e.phase === "done")?.data ?? null, [events]);
  const asset = useMemo(() => (rel: string) => (assetBase ? assetBase + rel.split("/").map(encodeURIComponent).join("/") : null), [assetBase]);
  return { source, run, events, steps, verdict, fab, rl, diagnosis, finished, asset, recorded };
}

/** Held-out history of design-skill versions. API first, fixture fallback. */
export function useHistory(): { history: HistoryEntry[]; current: string | null; source: Source | null } {
  const [state, setState] = useState<{ history: HistoryEntry[]; current: string | null; source: Source | null }>({ history: [], current: null, source: null });
  useEffect(() => {
    let on = true;
    getJSON<{ current: string; history: HistoryEntry[] }>("/api/evals", 15000).then((j) => {
      if (!on) return;
      if (j && Array.isArray(j.history) && j.history.length) { setState({ history: j.history, current: j.current, source: "api" }); return; }
      getJSON<HistoryEntry[]>("/static-runs/evals-history.json", 5000).then((h) => {
        if (!on) return;
        if (h && h.length) { setState({ history: h, current: [...h].reverse().find((x) => x.adopted)?.version ?? null, source: "static" }); return; }
        setState({ history: historyFixture, current: [...historyFixture].reverse().find((x) => x.adopted)?.version ?? null, source: "fixture" });
      });
    });
    return () => { on = false; };
  }, []);
  return state;
}

export const pct = (h: HistoryEntry) => {
  const v = h.heldoutPass;
  if (v > 1 && h.heldoutN) return v / h.heldoutN;
  return v;
};
