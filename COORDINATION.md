# COORDINATION — Thought to Reality (AIE Code Summit Hackathon, Nov 7 2026)

**Coordinator:** Hark. **Agents:** `hark`, `muse-dl88jing`, `muse-solana`, `grokbot`.
**Hard deadline:** submissions 5:00 PM PST. **Freeze:** 4:40 PM PST (demo-critical fixes only).

## Rules of the road (read before every work session)
1. **Stay in your lane.** Only edit the paths your lane owns. Need a change elsewhere? Open an issue with the owner's lane label and tag them in the body.
2. **Claim before you start.** Comment `claiming` on the issue (or open one) before writing code. One owner per issue.
3. **Commit message prefix = your agent name:** `[hark] ...`, `[muse-dl88jing] ...`, `[muse-solana] ...`, `[grokbot] ...`. Small commits, `git pull --rebase` before every push. Never force-push `main`.
4. **Contracts below are frozen.** Change a contract only via an issue labelled `contract` that the coordinator approves.
5. **No secrets in git.** Keys live in `.env.local` (see `.env.example`). Repo is public.
6. **New work only.** Everything here is written today. `get-me-an-alt` is inspiration only; do not copy files from it.
7. Hark sweeps issues + commits every 10 minutes and will comment on overlaps.

## Lanes
| Lane | Label | Owner | Owns paths | Deliverable |
|---|---|---|---|---|
| Core pipeline + model router + self-improvement loop | `lane:core` | **hark** | `web/lib/agents/**`, `web/lib/llm/**`, `web/app/api/**`, `evals/**` | Prompt → spec → OpenSCAD → verify → improve. Gemini Argon default, Muse fallback, SubQ long-context. Held-out eval + rollback of design "skills". |
| Frontend (calm instrument UI) | `lane:frontend` | **muse-dl88jing** | `web/app/(ui)/**`, `web/app/page.tsx`, `web/app/layout.tsx`, `web/app/globals.css`, `web/components/**` | 6 screens from `docs/DESIGN.md`. Consumes the SSE + JSON contracts below. Mock data in `web/fixtures/` until the API is live. |
| CAD compile + MuJoCo fit/load verifier | `lane:cad-sim` | **muse-solana** | `sim/**`, `web/lib/cad/**` | OpenSCAD → STL compile; MJCF assembly; interpenetration + clearance + load check → `verdict.json`. Must be independent of the designer (writes its own checks). |
| RL policies for moving products | `lane:rl` | **grokbot** | `rl/**` | MuJoCo quadruped (mini robot dog): walk, trot, rollover, play-dead. SubQ writes/iterates reward functions (Eureka-style) from full rollout logs; PPO trains; export ONNX + firmware/run instructions. |
| Fabrication routing | `lane:fab` | **grokbot** (after RL is training) | `fab/**`, `web/lib/fab/**` | Fits a mainstream printer? → STL/3MF download or print-service quote (Craftcloud/JLC3DP/etc). Metal/wood → CNC/sheet vendors (SendCutSend/Xometry/Protolabs). Quote only; no spend without user confirm. |
| Sponsors glue: Fetch.ai Agentverse + MongoDB Atlas memory | `lane:sponsors` | **hark** | `agents-fetch/**`, `web/lib/db/**` | uAgents chat-protocol agent wrapping the pipeline; MongoDB stores runs, verdicts, skill versions, eval history. |
| Demo, README, video, submission | `lane:demo` | **hark** | `README.md`, `docs/**`, `demo/**` | 1-min video, README stating what was built today, judge pitch. |

## Contracts (frozen)
### Run events (SSE `GET /api/runs/:id/stream`)
```json
{ "runId": "r_123", "stage": "diagnose|design|cad|verify|improve|rl|make", "phase": "start|progress|artifact|done|error",
  "message": "one short line", "data": {}, "model": "gemini-argon|muse|subq", "ts": 1731000000000 }
```
### Run manifest (`GET /api/runs/:id` → `data/runs/<id>/run.json`)
```json
{ "id": "r_123", "prompt": "my freezer door won't close", "kind": "static|mechanism|robot",
  "parts": [{ "id": "latch", "name": "Door latch clip", "scad": "parts/latch.scad", "stl": "parts/latch.stl",
              "material": "PETG", "dims_mm": [60, 22, 14], "printable": true }],
  "verdict": "verdict.json", "rl": "rl/manifest.json|null", "fab": "fab.json", "skillVersion": "v3" }
```
### Verifier output (`sim/` → `data/runs/<id>/verdict.json`)
```json
{ "pass": true, "fits_printer": "bambu-a1", "checks": [
  { "name": "interpenetration", "pass": true, "value": 0.0, "unit": "mm3" },
  { "name": "min_clearance", "pass": true, "value": 0.4, "unit": "mm" },
  { "name": "load_hold", "pass": true, "value": 35, "unit": "N" } ],
  "heatmap": "clearance.json", "notes": "short line" }
```
### RL manifest (`rl/` → `data/runs/<id>/rl/manifest.json`)
```json
{ "robot": "mini-dog-12dof", "mjcf": "robot.xml", "skills": [
  { "name": "walk", "policy": "walk.onnx", "reward_fn": "rewards/walk.py", "reward_version": 4,
    "curve": "walk_curve.json", "video": "walk.mp4", "success": 0.92 } ],
  "firmware": "firmware/README.md" }
```
### Self-improvement (`evals/`)
`evals/train/*.json` and `evals/heldout/*.json` (prompt + pass criteria). Skill versions in `evals/skills/vN.md`. A new version is adopted only if held-out pass rate beats the current one; otherwise rolled back. History in `evals/history.json`.

## Status (updated by Hark each sweep)
- 13:55 Repo initialised, lanes assigned, issues #1–#7 opened.
