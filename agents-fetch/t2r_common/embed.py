"""Deterministic 256-dim hashing embedding. Twin of web/lib/db/embed.ts (keep identical)."""
import math, re

EMBED_DIMS = 256


def _fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def hash_embed(text: str) -> list:
    v = [0.0] * EMBED_DIMS
    toks = re.findall(r"[a-z0-9]+", (text or "").lower())
    feats = toks + [toks[i] + "_" + toks[i + 1] for i in range(len(toks) - 1)]
    for f in feats:
        h = _fnv1a(f)
        v[h % EMBED_DIMS] += 1 if (h >> 8) & 1 else -1
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def part_text(p: dict, prompt: str = "") -> str:
    bits = [prompt, p.get("name"), p.get("purpose"), p.get("material"), (p.get("id") or "").replace("_", " ")]
    return " . ".join(b for b in bits if b)
