"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useState } from "react";

/** Up to three finished runs from GET /api/runs, as a quiet text list. Renders nothing when there are none. */
export function RecentRuns() {
  const [runs, setRuns] = useState<{ id: string; prompt: string }[]>([]);
  useEffect(() => {
    let on = true;
    fetch("/api/runs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).then((j: any[]) => {
      if (!on || !Array.isArray(j)) return;
      setRuns(j.filter((r) => r?.status === "done" && r.prompt && r.parts?.length).slice(0, 3).map((r) => ({ id: r.id, prompt: r.prompt })));
    }).catch(() => {});
    return () => { on = false; };
  }, []);
  if (!runs.length) return null;
  return (
    <div className="mt-6 w-full max-w-[640px] px-1">
      <div className="lbl mb-1 text-text-3">Recent</div>
      <ul>
        {runs.map((r) => (
          <li key={r.id}>
            <Link href={`/runs/${encodeURIComponent(r.id)}`} className="block truncate py-1.5 text-s text-text-3 transition-colors duration-200 hover:text-text-2">{r.prompt}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
