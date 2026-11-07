"""Meta Muse fallback designer.

Uses https://api.meta.ai/v1 chat completions with Authorization: Bearer.
The key is META_API_KEY, or MODEL_API_KEY if that is the one set.
Tries muse-spark-1.3 first, then muse-wonder-1.0.
"""

from __future__ import annotations

import os

from rl.designers.gemini import DesignerError, _extract_code
from rl.designers.prompt import build
from rl.http_api import HTTPFailure, post_json
from rl.reward_api import RewardRejected, load_reward_source, smoke_call

URL = "https://api.meta.ai/v1/chat/completions"
MODELS = ("muse-spark-1.3", "muse-wonder-1.0")


def _key() -> str:
    key = os.environ.get("META_API_KEY", "").strip() or os.environ.get("MODEL_API_KEY", "").strip()
    if not key:
        raise DesignerError("META_API_KEY and MODEL_API_KEY are unset")
    return key


def _one(model: str, prompt: str) -> str:
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {_key()}"}
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You write short, safe Python reward functions. Output code only."},
            {"role": "user", "content": prompt},
        ],
    }
    try:
        payload = post_json(URL, body, headers, timeout=120)
    except HTTPFailure as exc:
        raise DesignerError(f"{model} HTTP {exc.status}") from None
    try:
        text = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise DesignerError(f"{model} response missing choices") from exc
    code = _extract_code(text)
    try:
        fn = load_reward_source(code, filename=f"<{model}>")
        smoke_call(fn)
    except RewardRejected as exc:
        raise DesignerError(f"{model} reward rejected: {exc}") from None
    return code


def generate(skill: str, version: int, parent_code: str, feedback: str) -> tuple[str, str]:
    prompt = build(skill, version, parent_code, feedback)
    errors = []
    preferred = os.environ.get("META_MODEL", "").strip()
    models = (preferred,) + MODELS if preferred else MODELS
    seen = set()
    for model in models:
        if not model or model in seen:
            continue
        seen.add(model)
        try:
            return _one(model, prompt), model
        except DesignerError as exc:
            errors.append(str(exc))
    raise DesignerError("; ".join(errors) or "muse failed")
