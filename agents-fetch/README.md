# Thought to Reality — Fetch.ai agents

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Two uAgents, both **hosted on Agentverse** (running, registered on the Almanac, manifests published):

| Agent | Address | Protocols |
|---|---|---|
| **Thought to Reality** (chat entry point, use it from ASI:One) | `agent1qf0rqyxstg7evunxmslysw0f55c7me6kkzrqmt5fr25a8qavsuq66nyl2t5` | Agent Chat Protocol (`AgentChatProtocol`), `t2r-physics-verify` client |
| **T2R Physics Verifier** (agent-to-agent second opinion) | `agent1qtfpsszg4jzasuu8grew4q34k8erxt0sqexxwkz7d8hyra8xf6hhjm4dj0u` | `t2r-physics-verify` v0.1.0 |

Find it on Agentverse (Agents → search "Thought to Reality") or message the address directly from ASI:One.

## Workflow in an ASI:One chat
1. User: *"my freezer door won't close"*.
2. **Thought to Reality** acks, calls the app pipeline (`POST {APP_URL}/api/runs`, polls `GET /api/runs/:id`): diagnose → OpenSCAD design → STL compile → verify → self-improve → make.
   If the app isn't reachable, it answers from the latest stored run (MongoDB Atlas `t2r.runs` when run locally; a deploy-time snapshot of it when hosted).
3. It hands the parts + pipeline verdict to **T2R Physics Verifier** (`VerifyRequest` → `VerifyResponse`). The verifier re-derives its own checks (printer-bed fit for Bambu A1 / Prusa MK4 / Ender 3, minimum wall, cold-rated material for freezer parts) and cross-checks clearance/interpenetration/load — the designer never grades its own homework.
4. Reply: design summary (part, material, dims), pipeline verdict + independent verdict, design skill version, STL/OpenSCAD download links.
   If the verifier doesn't answer in 30 s the agent replies with the pipeline verdict alone.

## Files
- `hosted/t2r_agent.py`, `hosted/physics_verifier.py`, `hosted/verify_protocol.py` — agent code (hosted form: `agent` is injected).
- `deploy.py` — snapshots the latest run, renders the code, creates/updates + starts the hosted agents (`AGENTVERSE_API_KEY`, optional `MONGODB_URI`, `APP_URL`). Addresses in `deployed.json`.
- `run_local.py` — same code locally (`mailbox=True`); `--test` runs an offline user → T2R → verifier round trip.
- `scripts/seed_mongo.py` — creates the MongoDB Atlas collections + vector index and seeds from `data/runs/*`, `evals/`.
- `scripts/ping_hosted.py` — sends one chat message to the hosted agent.
- `snapshot/<runId>/` — public copy of the stored run's STL/SCAD used for download links.
- `t2r_common/embed.py` — 256-dim hashing embedding (twin of `web/lib/db/embed.ts`).

```bash
pip install "uagents>=0.25.5" pymongo requests
python agents-fetch/run_local.py --test
AGENTVERSE_API_KEY=... MONGODB_URI=... APP_URL=https://<public app> python agents-fetch/deploy.py
```
