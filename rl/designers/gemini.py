"""Gemini reward designer. Native generateContent, never Bearer auth.

AQ. keys are sent only as x-goog-api-key. The OpenAI-compat endpoint rejects
those keys when they are also sent as Authorization: Bearer.
"""

from __future__ import annotations

import os
import re

from rl.designers.prompt import build
from rl.http_api import HTTPFailure, post_json
from rl.reward_api import RewardRejected, load_reward_source, smoke_call

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODEL = "gemini-4-argon"


class DesignerError(RuntimeError):
    pass


def _key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise DesignerError("GEMINI_API_KEY is unset")
    return key


def _extract_code(text: str) -> str:
    blocks = re.findall(r"```(?:python)?\s*(.*?)```", text, flags=re.S)
    for block in blocks:
        if "compute_reward" in block:
            return block.strip() + "\n"
    if blocks:
        return blocks[0].strip() + "\n"
    return text.strip() + "\n"


def _text_from_response(payload: dict) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        raise DesignerError("gemini response had no candidates")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    texts = []
    for part in parts:
        if part.get("thought"):
            continue
        if "text" in part:
            texts.append(part["text"])
    if not texts:
        raise DesignerError("gemini response had no text part")
    return "\n".join(texts)


def generate(skill: str, version: int, parent_code: str, feedback: str) -> str:
    model = os.environ.get("GEMINI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    prompt = build(skill, version, parent_code, feedback)
    url = ENDPOINT.format(model=model)
    # Header auth only. Do not set Authorization.
    headers = {"Content-Type": "application/json", "x-goog-api-key": _key()}
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 8192},
    }
    try:
        payload = post_json(url, body, headers, timeout=180)
    except HTTPFailure as exc:
        raise DesignerError(f"gemini HTTP {exc.status}") from None
    code = _extract_code(_text_from_response(payload))
    try:
        fn = load_reward_source(code, filename=f"<{model}:{skill}:v{version}>")
        smoke_call(fn)
    except RewardRejected as exc:
        raise DesignerError(f"gemini reward rejected: {exc}") from None
    return code
