// Deterministic 256-dim hashing embedding (feature hashing of unigrams + bigrams, FNV-1a, signed, L2-normalised).
// Used for Atlas Vector Search on `parts.embedding` so "similar past fixes" works with no embedding API.
// MUST stay byte-identical in behaviour to agents-fetch/t2r_common/embed.py (seed + agent use the Python twin).
export const EMBED_DIMS = 256;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(s);
  for (const b of Array.from(bytes)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function hashEmbed(text: string): number[] {
  const v = new Array(EMBED_DIMS).fill(0);
  const toks = (text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  const feats: string[] = [...toks];
  for (let i = 0; i + 1 < toks.length; i++) feats.push(toks[i] + "_" + toks[i + 1]);
  for (const f of feats) {
    const h = fnv1a(f);
    v[h % EMBED_DIMS] += (h >>> 8) & 1 ? 1 : -1;
  }
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export function partText(p: any, prompt = ""): string {
  return [prompt, p?.name, p?.purpose, p?.material, p?.id?.replace(/_/g, " ")].filter(Boolean).join(" . ");
}
