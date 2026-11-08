"""Visible names for the shipped clips, the local judge, and missing API keys.

Importing this module does not import MuJoCo. The strings here are what a
person reads on a frame, in a curve, and in `python -m rl`. They do not claim
a Gemini, Muse, or SubQ response.
"""

from __future__ import annotations

import json

from rl import spec

POLICY_CAPTION = "ppo policy rollout"
OPEN_LOOP_CAPTION = "open-loop controller"

# Files Hark copies into web/public/rl/. This module never writes that tree.
PUBLIC_RL_FILES = (
    "manifest.json",
    "walk.mp4",
    "trot.mp4",
    "rollover.mp4",
    "play-dead.mp4",
    "walk_curve.json",
    "trot_curve.json",
    "rollover_curve.json",
    "play-dead_curve.json",
)


def _num(value) -> str:
    if not isinstance(value, (int, float)):
        return "n/a"
    return f"{float(value):.6f}".rstrip("0").rstrip(".")


def behavior_text(
    skill: str,
    source: str,
    success: float,
    policy_success: float,
    scripted_success: float,
    metrics: dict | None,
) -> str:
    """One honest sentence for the mp4 that success refers to."""
    metrics = metrics or {}
    success_s = f"{float(success):.4f}"
    if source != "ppo-policy":
        return (
            f"Open-loop controller clip. success {success_s} is the task score of this mp4. "
            f"The PPO rollout scored {float(policy_success):.4f} and is a different video."
        )
    return (
        f"PPO policy rollout. {_policy_detail(skill, metrics)} "
        f"success {success_s} is the task score of this mp4. "
        f"The open-loop controller scored {float(scripted_success):.4f} on the same robot "
        f"and is a different video."
    )


def _policy_detail(skill: str, metrics: dict) -> str:
    if skill == "rollover":
        reached = float(metrics.get("inverted_reached", 0.0))
        held = float(metrics.get("inverted_fraction", 0.0))
        up_z = metrics.get("min_up_z")
        up = f", min_up_z {_num(up_z)}" if isinstance(up_z, (int, float)) else ""
        if reached >= 0.75 and held < 0.5:
            return (
                f"Reaches belly-up (inverted_reached {_num(reached)}{up}) "
                f"but does not hold (inverted_fraction {_num(held)})."
            )
        if held >= 0.5:
            return f"Holds belly-up (inverted_fraction {_num(held)}{up})."
        return (
            f"Does not finish a belly-up roll (inverted_reached {_num(reached)}, "
            f"inverted_fraction {_num(held)}{up})."
        )
    if skill == "play-dead":
        inverted = float(metrics.get("inverted_fraction", 0.0))
        still = float(metrics.get("still_fraction", 0.0))
        if inverted >= 0.75 and still >= 0.5:
            return (
                f"Holds a still belly-up pose (inverted_fraction {_num(inverted)}, "
                f"still_fraction {_num(still)})."
            )
        return f"Belly-up fraction {_num(inverted)}, still fraction {_num(still)}."
    if skill in ("walk", "trot"):
        name = "Walks" if skill == "walk" else "Trots"
        return (
            f"{name} upright (mean_vx {_num(metrics.get('mean_vx'))} m/s, "
            f"upright_fraction {_num(metrics.get('upright_fraction'))}, "
            f"fell {_num(metrics.get('fell'))})."
        )
    return "Deterministic PPO rollout of the adopted checkpoint."


def local_rank_sentence() -> str:
    return (
        "The local judge picked the candidate with the higher task score, "
        "a positive scripted-vs-vibration gap, and a lower hacking flag."
    )


def unset_subq_note() -> str:
    return (
        "SUBQ_API_KEY is unset, so SubQ Snap was not called. "
        + local_rank_sentence()
        + " This is not a SubQ verdict."
    )


def designer_keys_unset_reason() -> str:
    return (
        "GEMINI_API_KEY is unset, and neither META_API_KEY nor MODEL_API_KEY is set. "
        "The local designer wrote this reward. No model API was called, and no key value is printed. "
        "Set GEMINI_API_KEY to ask Gemini, or META_API_KEY / MODEL_API_KEY to ask Muse."
    )


def designer_api_failed_reason(errors: list[str]) -> str:
    detail = "; ".join(errors) if errors else "the designer request failed"
    return (
        f"The designer API was not used ({detail}). "
        "The local designer wrote this reward instead. No key value is printed."
    )


def curve_note(behavior: str, backend: str | None) -> str:
    return f"{behavior} Judge backend: {backend}."


def sample_pack_readme() -> str:
    """README body for rl/sample_pack, built from the files on disk."""
    manifest_path = spec.ROOT / "manifest.json"
    lines = [
        "Sample RL pack for one robot run.",
        "",
        "The core pipeline can copy this directory onto a run:",
        "",
        "    mkdir -p data/runs/<id>/rl",
        "    cp -a rl/sample_pack/. data/runs/<id>/rl/",
        "",
        "manifest.json matches the frozen contract in COORDINATION.md.",
        "success is the task score of the mp4 next to it.",
        "",
        "The skill mp4s in this pack are the published clips. Read `behavior` in each curve",
        "for what that clip does. `video_label` is the caption burned into the frames.",
        "",
        "| skill | success | video_label | behavior |",
        "|---|---:|---|---|",
    ]
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        for row in manifest.get("skills") or []:
            curve_path = spec.ROOT / row.get("curve", "")
            curve = json.loads(curve_path.read_text()) if curve_path.exists() else {}
            behavior = str(curve.get("behavior") or curve.get("note") or "").replace("|", "/")
            lines.append(
                f"| {row.get('name')} | {row.get('success')} | {curve.get('video_label', '')} | {behavior} |"
            )
    lines.extend(
        [
            "",
            "Judge backend on these curves is whatever `judge_backend` says.",
            "local-fallback means SUBQ_API_KEY was unset and SubQ was not called.",
            "That ranking is not a SubQ verdict, and it is not a Gemini or Muse verdict.",
            "",
            "List or package the Train-screen copies (mp4s, manifest, curves) with:",
            "",
            "    python -m rl handoff",
            "    python -m rl handoff --pack /tmp/rl-public",
            "",
        ]
    )
    return "\n".join(lines)
