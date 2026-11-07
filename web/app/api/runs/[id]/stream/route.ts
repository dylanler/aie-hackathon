/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs";
import path from "node:path";
import { runDir } from "@/lib/agents/paths";
import { readRun } from "@/lib/agents/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const STALE_MS = 10 * 60 * 1000;

// SSE: replays stored events, then tails events.jsonl until the run finishes.
// Each message is one contract event: {runId, stage, phase, message, data, model, ts}.
// A final `event: end` carries the run.json when the run is done or errored.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  let file = "";
  try {
    file = path.join(runDir(params.id), "events.jsonl");
    if (!fs.existsSync(runDir(params.id))) return new Response("not found", { status: 404 });
  } catch { return new Response("not found", { status: 404 }); }
  const enc = new TextEncoder();
  let offset = 0;
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => { if (!closed) controller.enqueue(enc.encode(s)); };
      const flush = () => {
        let buf = "";
        try {
          const st = fs.statSync(file);
          if (st.size > offset) {
            const fd = fs.openSync(file, "r");
            const b = Buffer.alloc(st.size - offset);
            fs.readSync(fd, b, 0, b.length, offset);
            fs.closeSync(fd);
            buf = b.toString("utf8");
            const last = buf.lastIndexOf("\n");
            if (last < 0) return;
            buf = buf.slice(0, last + 1);
            offset += Buffer.byteLength(buf);
          }
        } catch { return; }
        for (const line of buf.split("\n")) if (line.trim()) send(`data: ${line}\n\n`);
      };
      let ticks = 0;
      const tick = () => {
        if (closed) return;
        flush();
        let run: any = null;
        try { run = readRun(params.id); } catch {}
        // a run orphaned by a server restart never finishes: after 10 min with no new events, end the stream as an error
        if (run && run.status === "running") {
          let idle = 0;
          try { idle = Date.now() - fs.statSync(file).mtimeMs; } catch {}
          if (idle > STALE_MS) run = { ...run, status: "error", error: "Run stopped: no progress for 10 min." };
        }
        if (run && (run.status === "done" || run.status === "error")) {
          flush();
          send(`event: end\ndata: ${JSON.stringify(run)}\n\n`);
          closed = true;
          controller.close();
          return;
        }
        if (++ticks % 30 === 0) send(`: keepalive\n\n`);
        setTimeout(tick, 500);
      };
      tick();
      req.signal.addEventListener("abort", () => { closed = true; try { controller.close(); } catch {} });
    },
    cancel() { closed = true; },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
