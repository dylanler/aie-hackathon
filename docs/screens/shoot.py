"""Re-shoot docs/screens against a running app: python3 docs/screens/shoot.py [base_url]"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100"
OUT = Path(__file__).parent
RUN = "/runs/demo-freezer-latch?instant=1"

shots = [
    ("01-prompt.png", "/", 2500, None),
    ("02-understanding.png", RUN + "&view=diagnose", 5000, None),
    ("03-model.png", RUN + "&view=design", 6000, None),
    ("04-fit.png", RUN + "&view=verify", 12000, None),
    ("05-gets-better.png", RUN + "&view=verify", 12000, "hover"),
    ("06-train.png", "/runs/demo-robot-dog?instant=1&view=train", 8000, None),
    ("07-make.png", RUN + "&view=make", 6000, None),
    ("08-order.png", RUN + "&view=make", 6000, "order"),
]

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    only = sys.argv[2:] 
    for name, url, wait, action in shots:
        if only and name not in only:
            continue
        pg.goto(BASE + url, wait_until="load")
        pg.wait_for_timeout(wait)
        if action == "hover":
            el = pg.locator("svg circle").last
            el.hover(force=True)
            pg.wait_for_timeout(600)
        if action == "order":
            pg.get_by_role("button", name="Order print").first.click(timeout=20000)
            pg.wait_for_timeout(900)
        pg.screenshot(path=str(OUT / name))
        print("shot", name)
    b.close()
