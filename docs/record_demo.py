"""Record the ≤60 s demo against a running app (no env vars needed; static replay):
    python3 docs/record_demo.py http://localhost:3100   → docs/demo.webm (convert with ffmpeg → docs/demo.mp4)
"""
import shutil
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100"
OUT = Path(__file__).parent
T0 = time.time()


def mark(s):
    print(f"{time.time() - T0:5.1f}s  {s}", flush=True)


with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, record_video_dir=str(OUT / "_rec"),
                        record_video_size={"width": 1440, "height": 900})
    pg = ctx.new_page()
    pg.goto(BASE + "/", wait_until="load")
    pg.wait_for_timeout(1500)
    mark("prompt")
    box = pg.locator("textarea").first
    box.click()
    box.type("My freezer door won't stay shut. The latch clip snapped. Make me a replacement clip.", delay=28)
    pg.wait_for_timeout(500)
    box.press("Enter")
    mark("submitted")
    # the recorded run replays at reading pace: diagnose → design → verify (round 1 fail → repair → round 2)
    pg.wait_for_url("**/runs/**", timeout=15000)
    pg.get_by_text("Repair rounds").wait_for(timeout=45000)
    mark("fit rounds visible")
    pg.wait_for_timeout(1200)
    pg.locator("text=Round 1").first.hover()
    pg.wait_for_timeout(3500)
    pg.locator("text=Round 2").first.hover()
    pg.wait_for_timeout(2500)
    # gets better: hover the kept v1, then a rolled-back patch
    circles = pg.locator("svg circle")
    n = circles.count()
    if n:
        circles.nth(0).hover(force=True)
        pg.wait_for_timeout(1800)
        circles.nth(n - 1).hover(force=True)
        pg.wait_for_timeout(2600)
    mark("gets better")
    pg.mouse.move(700, 450)
    pg.get_by_role("button", name="Make", exact=True).first.click()
    pg.wait_for_timeout(2500)
    pg.get_by_role("button", name="Order print").first.click()
    pg.wait_for_timeout(3500)
    mark("order confirm")
    pg.get_by_role("button", name="Cancel").first.click()
    pg.wait_for_timeout(700)
    pg.goto(BASE + "/runs/demo-robot-dog?instant=1&view=train", wait_until="load")
    pg.wait_for_timeout(4500)
    try:
        pg.get_by_text("Trot", exact=False).first.click(timeout=2000)
    except Exception:
        pass
    pg.wait_for_timeout(3500)
    mark("train")
    video = pg.video
    ctx.close()
    src = Path(video.path())
    shutil.move(str(src), str(OUT / "demo.webm"))
    shutil.rmtree(OUT / "_rec", ignore_errors=True)
    b.close()
    mark("saved docs/demo.webm")
