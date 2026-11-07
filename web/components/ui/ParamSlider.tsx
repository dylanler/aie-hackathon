"use client";
import { motion, useAnimationControls } from "framer-motion";
import { useRef } from "react";

/** Drag anywhere on the row to scrub. Shift = fine steps. Arrow keys nudge. */
export function ParamSlider({ label, value, min, max, step = 0.1, unit = "mm", onChange, onCommit }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string;
  onChange: (v: number) => void; onCommit?: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; v: number } | null>(null);
  const pulse = useAnimationControls();
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const frac = (value - min) / (max - min);

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = ref.current!.getBoundingClientRect();
    const v = clamp(min + ((e.clientX - rect.left) / rect.width) * (max - min));
    drag.current = { x: e.clientX, v };
    onChange(v);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const rect = ref.current!.getBoundingClientRect();
    const k = e.shiftKey ? 0.2 : 1;
    const v = clamp(drag.current.v + ((e.clientX - drag.current.x) / rect.width) * (max - min) * k);
    onChange(v);
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    pulse.start({ opacity: [0.0, 0.5, 0], transition: { duration: 0.12 * 3 } });
    onCommit?.(value);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const d = (e.shiftKey ? step : step * 10) * (e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0);
    if (d) { e.preventDefault(); const v = clamp(value + d); onChange(v); onCommit?.(v); }
  };
  const decimals = step < 1 ? 1 : 0;

  return (
    <div className="group select-none">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-s text-text-2 transition-colors group-hover:text-text">{label}</span>
        <span className="num text-s text-text">
          {value.toFixed(decimals)}<span className="ml-1 text-text-3">{unit}</span>
        </span>
      </div>
      <div
        ref={ref} role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
        className="relative h-10 cursor-ew-resize touch-none md:h-6"
      >
        <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-line" />
        <div className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-text-2 transition-colors group-hover:bg-text" style={{ width: `${frac * 100}%` }} />
        <div className="absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-text" style={{ left: `${frac * 100}%` }} />
        <motion.div animate={pulse} initial={{ opacity: 0 }} className="pointer-events-none absolute -inset-x-1 inset-y-0 rounded-chip bg-signal/30" />
      </div>
    </div>
  );
}
