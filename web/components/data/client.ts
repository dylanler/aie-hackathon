"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import type { Fab, HistoryEntry, RLManifest, Run, RunEvent, StepKey, StepState, Verdict } from "./types";
import { STEPS, stepOf } from "./types";
import { freezerEvents, freezerFab, freezerRun, freezerVerdict } from "@/fixtures/freezer-latch";
import { dogEvents, dogFab, dogRL, dogRun, dogVerdict } from "@/fixtures/robot-dog";
import { historyFixture } from "@/fixtures/evals-history";

export type Source = "api" | "fixture";

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

export const fileUrl = (runId: string, rel: string) => `/api/runs/${encodeURIComponent(runId)}/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

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

export function useRun(id: string): RunState {
  const [source, setSource] = useState<Source | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [fab, setFab] = useState<Fab | null>(null);
  const [rl, setRl] = useState<RLManifest | null>(null);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    const alive = { current: true };
    setSource(null); setRun(null); setEvents([]); setVerdict(null); setFab(null); setRl(null); setFinished(false);
    let es: EventSource | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const loadArtifacts = async (r: Run) => {
      if (r.verdict) getJSON<Verdict>(fileUrl(id, r.verdict), 15000).then((v) => alive.current && v && setVerdict(v));
      if (r.fab) getJSON<Fab>(fileUrl(id, r.fab), 15000).then((v) => alive.current && v && setFab(v));
      if (r.rl) getJSON<RLManifest>(fileUrl(id, r.rl), 15000).then((v) => alive.current && v && setRl(v));
    };

    const replayFixture = (fx: Fixture) => {
      setSource("fixture");
      setRun({ ...fx.run, parts: [] });
      let at = 0;
      fx.events.forEach(([d, ev]) => {
        at += d;
        timers.push(setTimeout(() => {
          if (!alive.current) return;
          setEvents((p) => [...p, { ...ev, ts: Date.now() }]);
          if (ev.stage === "design" && ev.phase === "artifact") setRun(fx.run);
          if (ev.stage === "verify" && ev.phase === "done") setVerdict(fx.verdict);
          if (ev.stage === "rl" && ev.phase === "start") setRl(fx.rl);
          if (ev.stage === "make") setFab(fx.fab);
        }, at));
      });
      timers.push(setTimeout(() => alive.current && setFinished(true), at + 200));
    };

    (async () => {
      const r = await getJSON<Run>(`/api/runs/${encodeURIComponent(id)}`, 15000);
      if (!alive.current) return;
      if (!r) {
        replayFixture(FIXTURES[id] || FIXTURES["demo-freezer-latch"]);
        return;
      }
      setSource("api");
      setRun(r);
      if (r.status === "done" || r.status === "error") loadArtifacts(r);
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
        es.onerror = () => { /* browser retries; end event closes */ };
      } catch {}
    })();

    return () => { alive.current = false; es?.close(); timers.forEach(clearTimeout); };
  }, [id]);

  const steps = useMemo(() => stepsFrom(events, run?.kind, finished), [events, run?.kind, finished]);
  const diagnosis = useMemo(() => events.find((e) => e.stage === "diagnose" && e.phase === "done")?.data ?? null, [events]);
  return { source, run, events, steps, verdict, fab, rl, diagnosis, finished };
}

/** Held-out history of design-skill versions. API first, fixture fallback. */
export function useHistory(): { history: HistoryEntry[]; current: string | null; source: Source | null } {
  const [state, setState] = useState<{ history: HistoryEntry[]; current: string | null; source: Source | null }>({ history: [], current: null, source: null });
  useEffect(() => {
    let on = true;
    getJSON<{ current: string; history: HistoryEntry[] }>("/api/evals", 15000).then((j) => {
      if (!on) return;
      if (j && Array.isArray(j.history) && j.history.length) setState({ history: j.history, current: j.current, source: "api" });
      else setState({ history: historyFixture, current: [...historyFixture].reverse().find((h) => h.adopted)?.version ?? null, source: "fixture" });
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
