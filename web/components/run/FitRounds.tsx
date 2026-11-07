"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { EASE_OUT, T } from "../ui/motion";

type C = { name: string; pass: boolean; value: number | string; unit?: string; by?: string; advisory?: boolean; detail?: string };
type V = { pass: boolean; checks: C[]; round?: number; critic_pass?: boolean; physics_pass?: boolean; critic_model?: string };
type SV = { checks: C[] };
type Round = { n: number; v: V; sim: SV | null; video: string | null; still: string | null };

const strip = (n: string) => n.replace(/^sim:/, "");
const num = (x: number | string) => (typeof x === "number" ? +x.toFixed(2) : x);

/** "Designed by one model. Checked by physics." Every number here is read from the round's verdict files. */
function describe(r: Round) {
  const critic = r.v.checks.filter((c) => c.by === "critic" && !c.advisory);
  const phys = r.v.checks.filter((c) => c.by === "mujoco" && !c.advisory);
  const cPass = critic.filter((c) => c.pass).length;
  const pPass = phys.filter((c) => c.pass).length;
  const find = (k: string) => phys.find((c) => strip(c.name) === k);
  const loadSim = r.sim?.checks.find((c) => c.name === "load_hold");
  const design = loadSim?.detail?.match(/of the ([\d.]+) N/)?.[1];
  const load = find("load_hold");
  if (phys.length && pPass === phys.length) {
    return { ok: true, head: `physics ${pPass}/${phys.length} pass`, tail: load ? `holds ${num(load.value)} ${load.unit ?? ""}`.trim() : "all checks pass", critic: `critic ${cPass}/${critic.length}` };
  }
  const why: string[] = [];
  const sa = find("screw_access"); if (sa && !sa.pass) why.push(`screw access ${String(sa.value).replace(" holes", "")}`);
  const pen = find("fit_penetration"); if (pen && !pen.pass) why.push(`binds striker ${num(pen.value)} ${pen.unit ?? ""}`.trim());
  if (load && !load.pass) why.push(`peels at ${num(load.value)} ${load.unit ?? "N"}${design ? ` of ${design} N` : ""}`);
  if (!why.length) phys.filter((c) => !c.pass).slice(0, 3).forEach((c) => why.push(strip(c.name).replace(/_/g, " ")));
  return { ok: false, head: `critic ${cPass}/${critic.length} pass · physics fail`, tail: why.join(" · "), critic: `critic ${cPass}/${critic.length}` };
}

export function FitRounds({ asset }: { asset: (rel: string) => string | null }) {
  const [rounds, setRounds] = useState<Round[]>([]);
  useEffect(() => {
    let on = true;
    const get = async (rel: string) => { const u = asset(rel); if (!u) return null; try { const x = await fetch(u, { cache: "no-store" }); return x.ok ? await x.json() : null; } catch { return null; } };
    const head = async (rel: string) => { const u = asset(rel); if (!u) return null; try { const x = await fetch(u, { cache: "force-cache" }); return x.ok ? u : null; } catch { return null; } };
    (async () => {
      const out: Round[] = [];
      for (const n of [1, 2, 3]) {
        const v = (await get(`verdict.round${n}.json`)) as V | null;
        if (!v) break;
        const [sim, video, still] = await Promise.all([get(`sim_verdict.round${n}.json`), head(`sim.round${n}.mp4`), head(`sim.round${n}.png`)]);
        out.push({ n, v, sim, video, still });
      }
      if (on) setRounds(out.length > 1 ? out : []);
    })();
    return () => { on = false; };
  }, [asset]);
  if (rounds.length < 2) return null;

  return (
    <div className="glass w-[360px] rounded-panel p-3">
      <div className="lbl px-1 pb-2 text-text-3">Repair rounds</div>
      <div className="flex flex-col gap-2">
        {rounds.map((r, i) => {
          const d = describe(r);
          return (
            <motion.div key={r.n} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.35, duration: T.panel, ease: EASE_OUT }}
              className={`flex gap-3 rounded-chip border p-2 ${d.ok ? "border-ok/25" : "border-err/25"}`}>
              {r.video ? (
                <video autoPlay loop muted playsInline poster={r.still ?? undefined} className="h-[60px] w-[80px] shrink-0 rounded-chip border border-line bg-surface object-cover">
                  <source src={r.video} type="video/mp4" />
                </video>
              ) : r.still ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.still} alt={`MuJoCo round ${r.n}`} className="h-[60px] w-[80px] shrink-0 rounded-chip border border-line object-cover" />
              ) : null}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full ${d.ok ? "bg-ok/15 text-ok" : "bg-err/15 text-err"}`}>
                    {d.ok ? <Check size={10} strokeWidth={2.5} /> : <X size={10} strokeWidth={2.5} />}
                  </span>
                  <span className="num text-s text-text">Round {r.n}</span>
                </div>
                <div className="num mt-1 text-[12px] leading-[1.35] text-text-2">{d.head}</div>
                {d.tail.split(" · ").map((t) => <div key={t} className={`num text-[12px] leading-[1.35] ${d.ok ? "text-ok" : "text-err"}`}>{t}</div>)}
                {d.ok && <div className="num text-[11px] text-text-3">{d.critic} still pass</div>}
              </div>
            </motion.div>
          );
        })}
      </div>
      <div className="mt-2 px-1 text-[12px] text-text-3">Round 1 fooled the critic. MuJoCo caught it, and its failures drove the repair.</div>
    </div>
  );
}
