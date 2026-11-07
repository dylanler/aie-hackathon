"""Version history for reward functions. This is the 'gets better' log."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from rl import spec

PATH = spec.REWARDS / "history.json"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def empty() -> dict:
    return {"robot": spec.ROBOT_NAME, "updated": None, "skills": {}}


def load() -> dict:
    if not PATH.exists():
        return empty()
    data = json.loads(PATH.read_text())
    data.setdefault("robot", spec.ROBOT_NAME)
    data.setdefault("skills", {})
    return data


def save(data: dict) -> None:
    data["updated"] = _now()
    PATH.parent.mkdir(parents=True, exist_ok=True)
    PATH.write_text(json.dumps(data, indent=2) + "\n")


def code_hash(source: str) -> str:
    return hashlib.sha256(source.encode("utf-8")).hexdigest()[:16]


def versions(data: dict, skill: str) -> list[dict]:
    return data.setdefault("skills", {}).setdefault(skill, {"adopted_version": None, "versions": []})["versions"]


def register(data: dict, skill: str, version: int, path: Path, source: str, model: str | None, parent: int | None, note: str = "") -> dict:
    rel = str(path.relative_to(spec.ROOT)) if path.is_absolute() else str(path)
    source_text = path.read_text()
    entry = {
        "version": version,
        "path": rel,
        "sha256_16": code_hash(source_text),
        "source": source,
        "model": model,
        "parent": parent,
        "created": _now(),
        "note": note,
        "metrics": {},
        "judge": {},
    }
    bucket = versions(data, skill)
    bucket[:] = [item for item in bucket if item["version"] != version]
    bucket.append(entry)
    bucket.sort(key=lambda item: item["version"])
    return entry


def latest_version(data: dict, skill: str) -> int:
    bucket = versions(data, skill)
    if not bucket:
        return 0
    return max(item["version"] for item in bucket)


def entry(data: dict, skill: str, version: int) -> dict | None:
    for item in versions(data, skill):
        if item["version"] == version:
            return item
    return None
