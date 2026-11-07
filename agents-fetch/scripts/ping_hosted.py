"""Send one chat message to the hosted Thought to Reality agent (check hosted logs for the A2A handoff)."""
import asyncio, json, sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from uagents import Agent, Context
from uagents_core.contrib.protocols.chat import ChatMessage, TextContent
TARGET = json.loads((Path(__file__).resolve().parents[1] / "deployed.json").read_text())["t2r_agent"]
a = Agent(name="t2r-ping", seed="t2r ping seed 1", port=8031, endpoint=["http://127.0.0.1:8031/submit"])
@a.on_event("startup")
async def go(ctx: Context):
    await asyncio.sleep(3)
    r = await ctx.send(TARGET, ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(),
                                           content=[TextContent(type="text", text=" ".join(sys.argv[1:]) or "my freezer door won't close")]))
    print("send status:", r, flush=True)
a.run()
