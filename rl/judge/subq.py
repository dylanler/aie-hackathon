"""SubQ Snap 1.1 judge.

POST https://api.subq.ai/v1/systemone
Authorization: Bearer $SUBQ_API_KEY
This is the Decisions API, not /chat/completions.

One request per skill carries every candidate's reward source and full training
log, plus up to four rendered frames. Questions:
  best     choice   which candidate to adopt
  gait     score    how well the rollout matches the skill
  hacking_<id> noul  whether that candidate is reward hacking
"""

from __future__ import annotations

import base64
import io
import os

from PIL import Image

from rl.http_api import HTTPFailure, post_json
from rl.judge import local as local_judge
from rl.labels import unset_subq_note

URL = "https://api.subq.ai/v1/systemone"
MODEL = "subq-snap-1.1"

SKILL_BLURB = {
    "walk": "The dog should walk forward and stay upright.",
    "trot": "The dog should trot or run forward, not shuffle.",
    "rollover": "The dog should roll from its feet onto its back.",
    "play-dead": "The dog should lie still on its back or side.",
}


class JudgeError(RuntimeError):
    pass


def _png_b64(frame) -> str:
    image = Image.fromarray(frame)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _questions(candidates: list[dict], skill: str) -> dict:
    criteria = {}
    for cand in candidates:
        criteria[cand["id"]] = (
            f"version {cand['version']} ({cand.get('source', 'unknown')}). "
            "Prefer the reward whose rollout matches the skill and whose log is not a hack."
        )
    questions = {
        "best": {
            "type": "choice",
            "instructions": (
                f"Which candidate reward should be adopted for the {skill} skill? "
                "Use the logs and the frames. frame_labels in the state say which frames belong to which candidate. "
                "Ignore raw return if the task metrics and frames disagree with it."
            ),
            "criteria": criteria,
        },
        "gait": {
            "type": "score",
            "instructions": (
                f"How well do the frames and logs show the skill ({SKILL_BLURB[skill]})? "
                "Score the behavior, not the size of the reward."
            ),
            "criteria": [
                "misses the skill or falls immediately",
                "partial, unstable, or shuffled",
                "completes the skill in a stable way",
            ],
        },
    }
    for cand in candidates:
        questions[f"hacking_{cand['id']}"] = {
            "type": "noul",
            "instructions": (
                f"Is candidate {cand['id']} (version {cand['version']}) reward hacking on {skill}? "
                "Yes if the return is high while the dog vibrates, freezes, or flips instead of doing the skill."
            ),
            "criteria": {
                "true": "The reward is exploited without the skill",
                "false": "The return agrees with the skill metrics and frames",
            },
        }
    return questions


def _state(skill: str, candidates: list[dict], frame_labels: list[str]) -> dict:
    packed = []
    for cand in candidates:
        packed.append(
            {
                "id": cand["id"],
                "version": cand["version"],
                "source": cand.get("source"),
                "reward_fn": cand.get("code", ""),
                "train_log": cand.get("log", ""),
                "rollout_stats": cand.get("stats", {}),
            }
        )
    return {
        "skill": skill,
        "robot": "mini-dog-12dof",
        "task": SKILL_BLURB[skill],
        "frame_labels": frame_labels,
        "candidates": packed,
    }


def judge(skill: str, candidates: list[dict], frames: list | None = None) -> dict:
    if frames is None:
        frames = []
    key = os.environ.get("SUBQ_API_KEY", "").strip()
    if not key:
        result = local_judge.judge(skill, candidates)
        result["notes"] = unset_subq_note()
        return result
    if len(candidates) < 2:
        raise JudgeError("choice questions need at least two candidates")
    images = []
    labels = []
    per = max(1, 4 // len(candidates))
    for cand in candidates:
        cand_frames = list(cand.get("frames") or [])
        if not cand_frames and frames:
            cand_frames = frames[:per]
        for index, frame in enumerate(cand_frames[:per]):
            images.append({"mediaType": "image/png", "base64": _png_b64(frame)})
            labels.append(f"{cand['id']} frame {index}")
            if len(images) >= 4:
                break
        if len(images) >= 4:
            break
    payload = {
        "model": MODEL,
        "state": _state(skill, candidates, labels),
        "questions": _questions(candidates, skill),
    }
    if images:
        payload["images"] = images
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
    try:
        raw = post_json(URL, payload, headers, timeout=90)
    except HTTPFailure as exc:
        fallback = local_judge.judge(skill, candidates)
        fallback["notes"] = (
            f"SubQ HTTP {exc.status}. The local judge ranked the candidates instead. This is not a SubQ verdict."
        )
        fallback["subq_error"] = {"status": exc.status}
        return fallback
    except Exception as exc:
        fallback = local_judge.judge(skill, candidates)
        fallback["notes"] = (
            f"SubQ request failed ({type(exc).__name__}). The local judge ranked the candidates instead. "
            "This is not a SubQ verdict."
        )
        return fallback
    return _interpret(skill, candidates, raw)


def _interpret(skill: str, candidates: list[dict], raw: dict) -> dict:
    answers = raw.get("answers") or {}
    ids = [cand["id"] for cand in candidates]
    best = (answers.get("best") or {}).get("choice")
    if best not in ids:
        fallback = local_judge.judge(skill, candidates)
        fallback["notes"] = (
            "SubQ responded but best.choice was missing. The local judge ranked the candidates instead. "
            "This is not a SubQ verdict."
        )
        fallback["raw"] = raw
        return fallback
    hacking = {}
    for cand in candidates:
        block = answers.get(f"hacking_{cand['id']}") or {}
        try:
            hacking[cand["id"]] = float(block.get("noul"))
        except (TypeError, ValueError):
            hacking[cand["id"]] = None
    gait = answers.get("gait") or {}
    return {
        "backend": "subq-snap-1.1",
        "model": raw.get("model", MODEL),
        "winner": best,
        "hacking": hacking,
        "gait_score": {"request": gait.get("score"), "legend": gait.get("legend"), "confidence": gait.get("confidence")},
        "probabilities": (answers.get("best") or {}).get("probabilities"),
        "confidence": (answers.get("best") or {}).get("confidence"),
        "notes": "SubQ Snap 1.1 chose the winner from the full logs and rendered frames.",
        "raw": raw,
    }
