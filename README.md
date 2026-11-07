# Thought to Reality

> Say what should exist. Get parts that fit, physics that proves it, and a robot that already knows how to move.

Built from scratch at the **AIE Code Summit Hackathon** (Cerebral Valley, SHACK15 SF, **Nov 7, 2026**). Every file in this repo was written during the event.

**Problem statement:** *The System That Gets Better*, with *Trust but Verify* as the mechanism.
The designer never grades its own homework. Physics does.

## What it does
1. **Describe** a broken thing or a machine: "my freezer door won't close", "build me a mini robot dog".
2. **Design** — Gemini 4 Argon (fallback: Meta Muse) turns it into parametric OpenSCAD parts.
3. **Verify independently** — a separate verifier compiles STLs and runs a MuJoCo fit + load test it wrote itself.
4. **Get better** — every failure becomes a versioned change to the design skill; changes are adopted only when a held-out set of real household prompts improves, otherwise rolled back.
5. **Move** — moving products get RL policies (walk, trot, roll over, play dead) with reward functions written and refined by SubQ over full rollout logs.
6. **Make** — fits a mainstream printer? Download STL/3MF or get a print-service quote. Metal or wood? Routed to custom-parts vendors.

## Sponsors used
| Sponsor | Where |
|---|---|
| Google DeepMind — Gemini 4 Argon | default designer + diagnosis |
| Meta — Muse (Model API) | fallback designer, independent critic |
| Subquadratic — SubQ | long-context reward design over full RL rollouts + whole-history self-improvement |
| Fetch.ai — Agentverse / uAgents | the pipeline as a chat-protocol agent |
| MongoDB Atlas | run history, verdicts, skill versions, eval history |

See `COORDINATION.md` for lanes and contracts, `docs/DESIGN.md` for the UI system.
