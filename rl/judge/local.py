"""Offline judge used when SubQ Snap is unreachable.

It does not trust the training return. A candidate that scores a vibrating
probe higher than the scripted skill, or that posts a large return while the
task score stays low, is flagged as reward hacking.
"""

from __future__ import annotations

import math


def _gap(stats: dict) -> float:
    good = float(stats.get("probe_scripted_reward", 0.0))
    bad = float(stats.get("probe_bad_reward", 0.0))
    return good - bad


def hacking_probability(stats: dict) -> float:
    gap = _gap(stats)
    task = float(stats.get("task_score", 0.0))
    ret = float(stats.get("mean_reward", 0.0))
    jitter = float(stats.get("action_jitter", 0.0))
    if gap < -0.02:
        return 0.86
    if task < 0.15 and ret > 0.8 and jitter > 0.35:
        return 0.72
    if gap < 0.02 and task < 0.2:
        return 0.45
    return 0.12


def rank_score(stats: dict) -> float:
    task = float(stats.get("task_score", 0.0))
    gap = math.tanh(_gap(stats))
    hack = hacking_probability(stats)
    return task + 0.15 * gap - 0.45 * hack


def judge(skill: str, candidates: list[dict]) -> dict:
    """candidates: [{id, version, stats, log, code}]."""
    del skill
    scored = []
    hacking = {}
    gait = {}
    for cand in candidates:
        stats = cand["stats"]
        hack = hacking_probability(stats)
        hacking[cand["id"]] = hack
        gait[cand["id"]] = float(stats.get("task_score", 0.0))
        scored.append((rank_score(stats), cand["version"], cand["id"]))
    scored.sort(key=lambda item: (item[0], item[1]))
    winner = scored[-1][2]
    return {
        "backend": "local-fallback",
        "model": None,
        "winner": winner,
        "hacking": hacking,
        "gait_score": gait,
        "rank": {cand_id: rank for rank, _ver, cand_id in ((s, v, i) for s, v, i in scored)},
        "notes": "SubQ was not called. Winner is the candidate with the higher task score, a positive scripted-vs-vibration gap, and a lower hacking flag.",
        "raw": None,
    }
