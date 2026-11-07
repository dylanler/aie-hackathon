"use client";
import { motion } from "framer-motion";

export function Sparkline({ data, width = 220, height = 44, marker, color = "#FF5A1F" }: { data: number[]; width?: number; height?: number; marker?: number; color?: string }) {
  if (!data.length) return null;
  const lo = Math.min(0, ...data), hi = Math.max(1, ...data);
  const x = (i: number) => (i / Math.max(1, data.length - 1)) * width;
  const y = (v: number) => height - 2 - ((v - lo) / (hi - lo)) * (height - 4);
  const d = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = data[data.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {marker !== undefined && (
        <g>
          <line x1={0} x2={width} y1={y(marker)} y2={y(marker)} stroke="#5E5E66" strokeDasharray="2 3" strokeWidth={1} />
          <text x={width + 6} y={y(marker) + 3} className="num" fontSize="10" fill="#5E5E66">good enough</text>
        </g>
      )}
      <motion.path key={d} d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
      <circle cx={x(data.length - 1)} cy={y(last)} r={2.5} fill={color} />
    </svg>
  );
}
