import type { CallOpts, LLMResult } from "./types";

// Meta Model API (OpenAI-compatible chat/completions).
export const MUSE_MODEL = process.env.MUSE_MODEL || "muse-spark-1.3";
const BASE = process.env.META_API_BASE || "https://api.meta.ai/v1";

export async function callMuse(opts: CallOpts & { model?: string }): Promise<LLMResult> {
  const key = process.env.META_API_KEY || process.env.MODEL_API_KEY;
  const model = opts.model || MUSE_MODEL;
  const t0 = Date.now();
  const body: any = { model, messages: opts.messages, reasoning_effort: opts.effort || "low" };
  if (opts.json) body.response_format = { type: "json_object" };
  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 240_000);
    try {
      const r = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      if (!r.ok) {
        const t = await r.text();
        if (r.status === 429 || r.status >= 500) throw new Error(`muse ${r.status}: ${t.slice(0, 200)}`);
        throw Object.assign(new Error(`muse ${r.status}: ${t.slice(0, 300)}`), { fatal: true });
      }
      const j: any = await r.json();
      const text = j.choices?.[0]?.message?.content || "";
      if (!text) throw new Error("muse empty response");
      return { text, model, provider: "muse", ms: Date.now() - t0 };
    } catch (e: any) {
      lastErr = e;
      if (e.fatal) break;
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
