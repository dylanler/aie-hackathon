"""Run the agents locally (same code as the Agentverse hosted agents).
  python run_local.py            # both agents in one Bureau, T2R agent with mailbox=True (connect via Inspector)
  python run_local.py --test     # offline end-to-end test: fake user -> T2R -> Physics Verifier -> reply
Env: APP_URL (default http://localhost:3000), MONGODB_URI (fallback to latest stored run), T2R_SEED, VERIFIER_SEED."""
import asyncio, json, os, sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from uagents import Agent, Bureau, Context
from uagents_core.contrib.protocols.chat import ChatMessage, ChatAcknowledgement, TextContent, chat_protocol_spec
from uagents import Protocol

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import deploy  # noqa: E402  (render + snapshot helpers)

test = "--test" in sys.argv
os.environ.setdefault("APP_URL", "http://localhost:3000")
verifier = Agent(name="t2r-physics-verifier", seed=os.environ.get("VERIFIER_SEED", "t2r physics verifier local seed"), port=8011,
                 endpoint=["http://127.0.0.1:8011/submit"])
t2r = Agent(name="thought-to-reality", seed=os.environ.get("T2R_SEED", "t2r chat agent local seed"), port=8010,
            **({"endpoint": ["http://127.0.0.1:8010/submit"]} if test else {"mailbox": True, "publish_agent_details": True}))
os.environ["VERIFIER_ADDRESS"] = verifier.address

snap, files_base = deploy.snapshot() if test else ({}, "")
exec(compile(deploy.render("physics_verifier.py"), "physics_verifier.py", "exec"), {"agent": verifier, "__name__": "verifier"})
exec(compile(deploy.render("t2r_agent.py", APP_URL="", VERIFIER_ADDRESS="", FILES_BASE=files_base or "https://raw.githubusercontent.com/dylanler/aie-hackathon/main/agents-fetch/snapshot/x",
                           SNAPSHOT=json.dumps(snap, default=str)), "t2r_agent.py", "exec"), {"agent": t2r, "__name__": "t2r"})

bureau = Bureau(port=8020) if test else Bureau(port=8020)
bureau.add(verifier); bureau.add(t2r)
if test:
    user = Agent(name="test-user", seed="t2r test user", port=8012, endpoint=["http://127.0.0.1:8012/submit"])
    up = Protocol(spec=chat_protocol_spec)

    @user.on_event("startup")
    async def go(ctx: Context):
        await asyncio.sleep(2)
        await ctx.send(t2r.address, ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(),
                                                 content=[TextContent(type="text", text="my freezer door won't close")]))

    @up.on_message(ChatMessage)
    async def got(ctx: Context, sender: str, msg: ChatMessage):
        print("\n=== REPLY ===\n" + "".join(c.text for c in msg.content if isinstance(c, TextContent)), flush=True)
        if "Download" in "".join(c.text for c in msg.content if isinstance(c, TextContent)):
            os._exit(0)

    @up.on_message(ChatAcknowledgement)
    async def ack(ctx, s, m):
        print("ack", flush=True)
    user.include(up)
    bureau.add(user)
print("T2R agent:", t2r.address, "\nPhysics Verifier:", verifier.address, flush=True)
bureau.run()
