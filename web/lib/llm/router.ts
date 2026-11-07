import { callGemini, geminiAvailable } from "./gemini";
import { callMuse } from "./muse";
import type { CallOpts, LLMResult, LLMRole } from "./types";
export type { ChatMessage, LLMResult, LLMRole } from "./types";

/**
 * Model router. Gemini 4 Argon is the default provider; any Gemini error (or a missing key)
 * falls back to Meta Muse Spark. The critic role prefers a *different* provider than the designer
 * when both are available so the designer never grades its own homework.
 * Env: LLM_PROVIDER=muse forces Muse for everything.
 */
export async function callLLM(opts: CallOpts & { role?: LLMRole }): Promise<LLMResult> {
  const forceMuse = process.env.LLM_PROVIDER === "muse";
  const criticOnMuse = opts.role === "critic"; // critic always independent: Muse when designer is Gemini
  if (!forceMuse && !criticOnMuse && geminiAvailable()) {
    try {
      return await callGemini(opts);
    } catch (e: any) {
      console.warn(`[router] gemini failed (${e?.message?.slice(0, 120)}), falling back to muse`);
    }
  }
  if (criticOnMuse) {
    // independent judge: a different model family member than the designer (Muse Wonder), Spark as backup
    try { return await callMuse({ ...opts, model: process.env.CRITIC_MODEL || "muse-wonder-1.0" }); }
    catch (e: any) { console.warn(`[router] critic model failed (${e?.message?.slice(0, 120)}), using spark`); }
  }
  return callMuse(opts);
}

export function parseJSON<T = any>(text: string): T {
  try {
    return JSON.parse(text);
  } catch {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      try { return JSON.parse(fence[1]); } catch {}
    }
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
    throw new Error("could not parse JSON from model output");
  }
}

export function providerTag(r: LLMResult): "gemini-argon" | "muse" {
  return r.provider;
}
