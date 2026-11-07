# Sponsor API cheat sheet — AIE Code Summit Hackathon (Sat Nov 7 2026, Shack15 SF)
Event: Meta, Google DeepMind, MongoDB, Subquadratic, Fetch.ai. $11K prizes incl. **$5K best use of Meta Model API**; Fetch.ai runs its own 2×$2,500 track. Theme: agents that improve every run / reconstruct software / verify before merge. (cerebralvalley.ai/e/aie-code-2026-hackathon). Verified 2026-11-07.

## 1. Subquadratic SubQ — https://docs.subq.ai/llms.txt
- Base `https://api.subq.ai/v1`, header `Authorization: Bearer $SUBQ_API_KEY` (console.subq.ai; 100M free tokens; 402 = no credits).
- **`subq-snap-1.1`** (public preview): *decision model*, 384K ctx (393,216), text + ≤4 images, $0.04/M input, output free, <1s/100K tok. **Not chat** — `POST /v1/systemone`, NOT OpenAI-compatible. Question types: `noul` (P(yes)), `choice` (2–255 options + probs + confidence), `score` (2–10 ordered levels → weighted score). 1–128 questions/request.
- `subq-preview` (early access, per-org; others get **403 model_not_allowed**): OpenAI-compatible `/chat/completions`, `/responses`, files, function calling (tool_calls reliable only with `stream:true`; must use `max_tokens`, not `max_completion_tokens`). Don't plan on it unless `GET /v1/models` lists it.
```bash
curl -s https://api.subq.ai/v1/systemone -H "Authorization: Bearer $SUBQ_API_KEY" -H 'Content-Type: application/json' -d '{
 "model":"subq-snap-1.1",
 "state":{"reward_fn":"<code>","train_log":"<full PPO log>","rollout_stats":"<json>"},
 "questions":{
  "gait":{"type":"score","instructions":"How natural/stable is the quadruped gait in this rollout?","criteria":["falls","shuffles","trots stably"]},
  "hacking":{"type":"noul","instructions":"Is the policy exploiting the reward (e.g. vibrating, flipping) rather than walking?"},
  "best":{"type":"choice","instructions":"Which candidate reward produced the best locomotion?","criteria":{"r0":null,"r1":null,"r2":null}}}}'
# answers.gait.score, answers.hacking.noul, answers.best.choice/.probabilities
```
**Realistic RL role** (Snap can't write code): (a) **Eureka loop judge** — Gemini/Muse write N reward fns → short PPO each → Snap reads *entire* logs + 4 rendered frames, `choice` picks winner, `noul` flags reward hacking, feedback goes back to the generator; (b) **VLM-style reward / success detector** — `score` on sampled frames+state as sparse episode reward or curriculum gate; (c) **early-stop / hyperparam gating** on long training logs; (d) high-level **option selector** at ~1 Hz (gait mode = `choice`), never a 50 Hz joint controller.

## 2. Google Gemini — model **`gemini-4-argon`** (GA Oct 13 2026)
- 1,048,576 unified ctx; 65,536 sync output (long decode to 1M with `background:true`); thinking `low|medium(default)|high`; function calling, code exec, structured output, search grounding, computer use. **Paid tier only** ($2/$10 per M through Nov 30). Drop `temperature/top_p/top_k` (ignored); no explicit caching; set client timeout ≥15 min.
- **`AQ.` keys = new "Auth keys": send as `x-goog-api-key` header** (or `?key=`). Do NOT send `Authorization: Bearer` (OpenAI-compat endpoint rejects AQ. keys with "Multiple authentication credentials"); prefer native REST/SDK over `/v1beta/openai`.
```bash
curl https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent \
 -H "x-goog-api-key: $GEMINI_API_KEY" -H 'Content-Type: application/json' \
 -d '{"contents":[{"parts":[{"text":"Write a MuJoCo reward fn for a 4-leg trot"}]}],"generationConfig":{"thinkingConfig":{"thinkingLevel":"medium"},"maxOutputTokens":32768}}'
# Recommended newer API: POST /v1beta/interactions {"model":"gemini-4-argon","input":"...","generation_config":{"thinking_level":"high"}}
# Managed agent: add "agent":"antigravity-preview-09-2026","environment":"remote","agent_config":{"type":"antigravity","model":"gemini-4-argon"}
```
JS: `new GoogleGenAI({apiKey})` from `@google/genai`. Docs: ai.google.dev/gemini-api/docs/latest-model. (`thinkingConfig.thinkingLevel` name inferred — verify or omit; default medium.) No event-specific DeepMind guide found.

## 3. Meta Model API — https://dev.meta.ai/docs
- Base `https://api.meta.ai/v1`, `Authorization: Bearer $MODEL_API_KEY` (key from dev.meta.ai dashboard). OpenAI SDK (Responses + Chat Completions) **and** Anthropic Messages (`https://api.meta.ai`) compatible.
- Models: **`muse-spark-1.3`** (recommended; 1.2/1.1; `-contributor` discounted variants), 1M ctx, text/image/video/audio/PDF in, reasoning effort `minimal`→`max`. **"Muse Wonderful" doesn't exist — it's `muse-wonder-1.0`** (most capable, preview, same requests). Also `muse-image-1.0`, `sam-3.1`, `muse-voice-transcribe-1.0`. Reasoning models: `stop`, `logit_bias`, `logprobs` → 400.
- **Muse Code** = Meta's terminal coding agent (/docs/muse-code); OpenCode etc. also plug in.
```bash
curl https://api.meta.ai/v1/chat/completions -H "Authorization: Bearer $MODEL_API_KEY" -H 'Content-Type: application/json' \
 -d '{"model":"muse-spark-1.3","messages":[{"role":"user","content":"Generate an MJCF quadruped"}],"tools":[...]}'
```
```ts
const meta = new OpenAI({ baseURL: "https://api.meta.ai/v1", apiKey: process.env.MODEL_API_KEY }); // SDK won't auto-read MODEL_API_KEY
```

## 4. Fetch.ai — hackpack: innovationlab.fetch.ai/events/hackathons/aie-code-summit-hackathon/hackpack
**Mandatory:** ≥1 agent registered on Agentverse; Agent Chat Protocol; discoverable + usable in ASI:One; whole primary workflow inside an ASI:One chat (no custom frontend needed); public GitHub with README listing agent name+address and badges `![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)` `![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)`; 3–5 min demo video; submit via ASI:One submission agent. Bonus: multi-agent, **Payment Protocol**, ASI1 Interactive Cards. Promo: `AIECODEHACK` (ASI:One Pro) / `AIECODEHACKAV` (Agentverse Premium).
```bash
pip install "uagents>=0.25.5" openai   # ASI:One key: asi1.ai/dashboard/api-keys
```
```python
from datetime import datetime; from uuid import uuid4
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import ChatMessage, ChatAcknowledgement, TextContent, EndSessionContent, chat_protocol_spec
agent = Agent(name="robot-fab-agent", seed="<secret seed>", port=8001, mailbox=True, publish_agent_details=True)
proto = Protocol(spec=chat_protocol_spec)
@proto.on_message(ChatMessage)
async def on_msg(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.utcnow(), acknowledged_msg_id=msg.msg_id))
    text = "".join(c.text for c in msg.content if isinstance(c, TextContent))
    reply = await run_pipeline(text)   # call Next.js API / workers
    await ctx.send(sender, ChatMessage(timestamp=datetime.utcnow(), msg_id=uuid4(),
        content=[TextContent(type="text", text=reply), EndSessionContent(type="end-session")]))
@proto.on_message(ChatAcknowledgement)
async def on_ack(ctx, sender, msg): pass
agent.include(proto, publish_manifest=True)
agent.run()
```
Run → Inspector URL → Connect → **Mailbox** → Agent Profile (handle, README, keywords) → "Chat with Agent". Keep it running. ASI:One LLM is OpenAI-compatible: `base_url="https://api.asi1.ai/v1"`, model `asi1`. Agentverse MCP: `https://mcp-lite.agentverse.ai/mcp`.

## 5. MongoDB Atlas
- Fastest: `brew install mongodb-atlas-cli && atlas setup` (signup, free M0 cluster, IP allowlist, DB user, connection string in ~3 min). Free cluster supports Vector Search.
- Credits: cloud.mongodb.com → Organization → **Billing → Overview → "Apply Code"** → `MKT-BUILDERS-100` (Org Owner only; may need a card on file; code not independently verified).
```ts
import { MongoClient } from "mongodb";
const col = new MongoClient(process.env.MONGODB_URI!).db("fab").collection("designs");
await col.createSearchIndex({ name: "vec", type: "vectorSearch",
  definition: { fields: [{ type: "vector", path: "embedding", numDimensions: 768, similarity: "cosine" },
                         { type: "filter", path: "kind" }] } });   // ~1 min to become queryable
const hits = await col.aggregate([{ $vectorSearch: { index: "vec", path: "embedding", queryVector: q,
  numCandidates: 100, limit: 5, filter: { kind: "reward_fn" } } },
  { $project: { code: 1, score: { $meta: "vectorSearchScore" } } }]).toArray();
```
Optional `autoEmbed` field type (`model:"voyage-4"`) lets Atlas embed for you. Store runs/reward fns/scores = memory that improves every run.

## 6. Fabrication APIs (programmatic ordering)
| Service | Public API / MCP | Notes |
|---|---|---|
| **Craftcloud** (3D print + CNC, 150+ shops) | **Yes**, REST v5 `https://api.craftcloud3d.com` (swagger.craftcloud3d.com) | Flow: upload model → poll `POST/GET /v5/price` → `/v5/offer` → `/v5/cart` → `/v5/order` (+payment). Upload endpoint `POST /v5/model` per Kiln MCP (not in public swagger — verify). Kiln (`codeofaxel/kiln`) wraps it as MCP. **Best 3D-print pick.** |
| **OSH Cut** (sheet/tube laser, bending) | **MCP live: `https://app.oshcut.com/api/mcp`** | quote_cart, check_manufacturability, process_part; checkout = cart link to human. **Best metal pick.** |
| Fabworks | MCP `https://api.fabworks.com/mcp` (OAuth) | sheet metal quote+DFM |
| JLC3DP / JLCPCB | Official API (api.jlcpcb.com; application/approval) | upload, price, order, track; community `jlcpcb-mcp` (orders gated) |
| Shapeways | REST `api.shapeways.com` (models/v1, orders/v1, OAuth app) | still listed live |
| Sculpteo | Upload + order API (invoice accounts only) | |
| Treatstock / Ponoko | Treatstock API (tokens on request); Ponoko legacy OAuth API | secondary |
| Xometry | developer.xometry.com = **supplier/partner** jobs API only (403 unless approved) | no buyer ordering |
| SendCutSend, Protolabs, Hubs, Fictiv | **No public API** | web upload only |
Hackathon-safe: generate STL/STEP → get live quote via Craftcloud/OSH Cut MCP → return checkout link (never auto-pay).

## 7. MuJoCo
**Load STL:** MuJoCo reads binary STL/OBJ; collisions use each mesh's **convex hull** (decompose concave parts, e.g. CoACD, into several convex STLs).
```python
import mujoco
xml = """<mujoco><compiler meshdir="meshes"/><asset>
 <mesh name="body" file="body.stl" scale="0.001 0.001 0.001"/><mesh name="leg" file="leg.stl" scale="0.001 0.001 0.001"/></asset>
 <worldbody><body name="b"><freejoint/><geom type="mesh" mesh="body"/>
   <body name="l" pos="0.05 0 0"><joint type="hinge" axis="0 1 0"/><geom type="mesh" mesh="leg"/></body></body></worldbody></mujoco>"""
m = mujoco.MjModel.from_xml_string(xml); d = mujoco.MjData(m)
mujoco.mj_forward(m, d)   # runs collision
bad = [(m.geom(c.geom1).name, m.geom(c.geom2).name, c.dist) for c in d.contact[:d.ncon] if c.dist < -1e-4]  # dist<0 = penetration
# pairwise: mujoco.mj_geomDistance(m, d, g1, g2, distmax, fromto)  (<0 = overlap)
```
Note: parent/child bodies are auto-excluded from contact — for assembly checks use separate free bodies or `<option><flag filterparent="disable"/></option>`.
**Fast RL:** MuJoCo Playground (`pip install playground`): `Go1JoystickFlatTerrain` PPO ≈ **7 min on RTX 4090** (Colab locomotion.ipynb); CLI `train-jax-ppo --env_name Go1JoystickFlatTerrain`. Needs GPU (`jax[cuda12]`) → run on Modal (A100/H100). **MJX has no mesh–mesh collision** → use primitive/mesh-vs-plane colliders for a custom quadruped. CPU fallback: custom MJCF/`Ant-v5` + `stable-baselines3` PPO, 8 `SubprocVecEnv` — ~1M steps ≈ 20–40 min (my estimate), wobbly but demoable.
