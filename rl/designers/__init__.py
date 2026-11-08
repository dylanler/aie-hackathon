"""Eureka reward designers: Gemini, then Muse, then a local fallback."""

from __future__ import annotations

import os
from pathlib import Path

from rl.designers import gemini, local, muse
from rl.designers.gemini import DesignerError
from rl.labels import designer_api_failed_reason, designer_keys_unset_reason
from rl.reward_api import RewardRejected, load_reward_source, smoke_call


def propose(skill: str, version: int, parent_code: str, feedback: str, dest: Path) -> dict:
    """Write one candidate reward to dest. Never raises if the local fallback works."""
    errors: list[str] = []
    code = None
    source = "local-fallback"
    model = None
    if os.environ.get("GEMINI_API_KEY", "").strip():
        try:
            code = gemini.generate(skill, version, parent_code, feedback)
            source = "gemini-4-argon"
            model = os.environ.get("GEMINI_MODEL", "gemini-4-argon").strip() or "gemini-4-argon"
        except DesignerError as exc:
            errors.append(str(exc))
    if code is None and (os.environ.get("META_API_KEY", "").strip() or os.environ.get("MODEL_API_KEY", "").strip()):
        try:
            code, model = muse.generate(skill, version, parent_code, feedback)
            source = model
        except DesignerError as exc:
            errors.append(str(exc))
    if code is None:
        code = local.generate(skill, version, parent_code, feedback)
        try:
            fn = load_reward_source(code, filename=str(dest))
            smoke_call(fn)
        except RewardRejected as exc:
            raise DesignerError(f"local fallback reward was rejected: {exc}") from exc
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(code)
    if source == "local-fallback" and not errors:
        reason = designer_keys_unset_reason()
    elif source == "local-fallback":
        reason = designer_api_failed_reason(errors)
    else:
        reason = "; ".join(errors)
    return {"source": source, "model": model, "path": dest, "errors": errors, "reason": reason, "code": code}
