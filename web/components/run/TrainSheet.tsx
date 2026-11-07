"use client";
import { Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { RLManifest } from "../data/types";
import { modelName } from "../data/types";
import { HintTip } from "../ui/HintTip";
import { BottomSheet } from "../ui/Sheets";
import { Sparkline } from "../ui/Sparkline";
import type { Gait } from "../three/Canvas3D";

export function TrainSheet({ rl, gait, onGait, paused, onPause, curves }: { rl: RLManifest; gait: Gait; onGait: (g: Gait) => void; paused: boolean; onPause: () => void; curves: Record<string, number[]> }) {
  const skill = rl.skills.find((s) => s.name === gait) ?? rl.skills[0];
  const data = curves[skill.name] || [];
  const [ep, setEp] = useState(0);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setEp((e) => e + 1), 1000 / 12);
    return () => clearInterval(t);
  }, [paused]);
  return (
    <BottomSheet className="w-[760px] p-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {rl.skills.map((s) => (
            <button key={s.name} onClick={() => onGait(s.name as Gait)}
              className={`flex h-8 items-center gap-2 rounded-full px-3 text-s capitalize transition-colors ${s.name === skill.name ? "bg-raised text-text" : "text-text-3 hover:text-text-2"}`}>
              {s.name}
              <span className="num text-[11px] text-text-3">{Math.round(s.success * 100)}%</span>
            </button>
          ))}
        </div>
        <HintTip label={paused ? "Resume" : "Pause"} kbd="Space" side="top">
          <button aria-label={paused ? "Resume" : "Pause"} onClick={onPause} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-text hover:bg-raised">
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
        </HintTip>
      </div>
      <div className="mt-3 flex items-end justify-between gap-6 border-t border-line pt-3">
        <div>
          <div className="lbl text-text-3">Reward · {skill.name}</div>
          <div className="mt-2"><Sparkline data={data} width={380} height={44} marker={0.85} /></div>
        </div>
        <div className="flex gap-6 pb-1 pr-1">
          <div>
            <div className="lbl text-text-3">Success</div>
            <div className="num mt-1 text-l text-text">{Math.round(skill.success * 100)}%</div>
          </div>
          <div>
            <div className="lbl text-text-3">Episode</div>
            <div className="num mt-1 text-l text-text">{(data.length * 250 + ep).toLocaleString()}</div>
          </div>
        </div>
      </div>
      <div className="mt-3 text-s text-text-3">
        <span className="num">{modelName(rl.judge) || "SubQ"} judged reward v{skill.reward_version} · picked 1 of {skill.candidates ?? 4}</span>
      </div>
    </BottomSheet>
  );
}
