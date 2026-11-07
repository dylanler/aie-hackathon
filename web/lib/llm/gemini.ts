import type { CallOpts, LLMResult } from "./types";

// Google Gemini 4 Argon via native REST (AQ. auth keys go in x-goog-api-key, never Bearer).
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-4-argon";

export function geminiAvailable() {
  return !!process.env.GEMINI_API_KEY && process.env.DISABLE_GEMINI !== "1";
}

export async function callGemini(opts: CallOpts): Promise<LLMResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");
  const t0 = Date.now();
  const system = opts.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const body: any = {
    contents,
    generationConfig: {
      maxOutputTokens: 32768,
      thinkingConfig: { thinkingLevel: opts.effort === "high" ? "high" : opts.effort === "medium" ? "medium" : "low" },
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 180_000);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j: any = await r.json();
    const text = (j.candidates?.[0]?.content?.parts || []).filter((p: any) => !p.thought).map((p: any) => p.text || "").join("");
    if (!text) throw new Error("gemini empty response");
    return { text, model: GEMINI_MODEL, provider: "gemini-argon", ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}
