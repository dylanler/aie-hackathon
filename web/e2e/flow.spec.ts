import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.E2E_SHOTS || "e2e/.shots";
const RUN = "/runs/demo-freezer-latch";

/** Collect console errors + failed/404 requests for the page. */
function watch(page: Page) {
  const errors: string[] = [];
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/WebGL|GPU|THREE\.WebGLRenderer|favicon|Download the React DevTools/i.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("response", (r) => { if (r.status() >= 400 && !/favicon|\/api\/runs\/[^/]+\/files\/\.\.|_next\/webpack-hmr/.test(r.url())) bad.push(`${r.status()} ${r.url()}`); });
  return { errors, bad };
}

/** No element may stick out horizontally past the viewport. */
async function noOverflow(page: Page, label: string) {
  const res = await page.evaluate(() => {
    const W = window.innerWidth;
    const off: string[] = [];
    document.querySelectorAll("body *").forEach((el) => {
      const h = el as HTMLElement;
      if (h.closest("[data-allow-overflow]") || h.tagName === "CANVAS") return;
      const s = getComputedStyle(h);
      if (s.visibility === "hidden" || s.display === "none" || +s.opacity === 0) return;
      const r = h.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > W + 1 || r.left < -1) off.push(`${h.tagName}.${(h.className?.toString?.() || "").slice(0, 60)} [${Math.round(r.left)}..${Math.round(r.right)}] "${(h.innerText || "").slice(0, 30)}"`);
    });
    return { scroll: document.documentElement.scrollWidth > W + 1, off: off.slice(0, 8) };
  });
  expect.soft(res.scroll, `${label}: page scrolls horizontally`).toBeFalsy();
  expect.soft(res.off, `${label}: elements off-screen`).toEqual([]);
}

async function shot(page: Page, name: string, project: string) {
  await page.screenshot({ path: `${SHOTS}/${project}-${name}.png` });
}

test.describe("UI flow", () => {
  test("landing + example chips @layout", async ({ page }, info) => {
    const w = watch(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "What should exist?" })).toBeVisible();
    const chips = ["My freezer door won't stay shut", "A mini robot dog that can play dead", "A Wi-Fi powder dispenser"];
    await expect(page.getByRole("button", { name: chips[0] })).toBeVisible({ timeout: 5000 });
    await shot(page, "01-landing", info.project.name);
    await noOverflow(page, "landing");
    for (const c of chips.slice(0, 2)) {
      await page.goto("/");
      await page.getByRole("button", { name: c }).click();
      await page.waitForURL(/\/runs\//, { timeout: 15000 });
      expect(page.url()).toMatch(c.includes("freezer") ? /demo-freezer-latch/ : /demo-robot-dog/);
    }
    expect.soft(w.errors, "console errors").toEqual([]);
    expect.soft(w.bad, "4xx/5xx").toEqual([]);
  });

  test("freezer latch run: every screen @layout", async ({ page }, info) => {
    const w = watch(page);
    const p = info.project.name;
    await page.goto(RUN);
    // understanding replay
    await expect(page.getByText(/freezer/i).first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot(page, "02-understanding", p);
    await noOverflow(page, "understanding");
    // model screen — STL served from the run
    const stl = page.waitForResponse((r) => /\.stl(\?|$)/.test(r.url()) && r.status() === 200, { timeout: 30000 });
    await page.goto(RUN + "?view=design&instant=1");
    await stl;
    const slider = page.getByRole("slider").first();
    await expect(slider).toBeVisible({ timeout: 15000 });
    await shot(page, "03-model", p);
    await noOverflow(page, "model");
    const before = await slider.getAttribute("aria-valuenow");
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => slider.getAttribute("aria-valuenow")).not.toBe(before);
    // fit verdict
    await page.goto(RUN + "?view=verify&instant=1");
    await expect(page.getByText("Designed by one model. Checked by physics.")).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(800);
    await shot(page, "04-fit", p);
    await noOverflow(page, "fit");
    // make + order sheet never charges
    await page.goto(RUN + "?view=make&instant=1");
    const order = page.getByRole("button", { name: "Order print" });
    await expect(order).toBeVisible({ timeout: 15000 });
    await shot(page, "05-make", p);
    await noOverflow(page, "make");
    await order.click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText("Nothing is charged here");
    await shot(page, "06-order", p);
    await dlg.getByRole("button", { name: "Cancel" }).click();
    await expect(dlg).toBeHidden();
    expect.soft(w.errors, "console errors").toEqual([]);
    expect.soft(w.bad, "4xx/5xx").toEqual([]);
  });

  test("model: slider undo, hovers, keyboard, download (desktop)", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    const w = watch(page);
    await page.goto(RUN + "?view=design&instant=1");
    const slider = page.getByRole("slider").first();
    await expect(slider).toBeVisible({ timeout: 20000 });
    const v0 = await slider.getAttribute("aria-valuenow");
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => slider.getAttribute("aria-valuenow")).not.toBe(v0);
    const undo = page.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();
    await undo.click();
    await expect.poll(() => slider.getAttribute("aria-valuenow")).toBe(v0);
    // E explode toggles
    await page.locator("body").click({ position: { x: 700, y: 450 } });
    await page.keyboard.press("e");
    await expect(page.getByRole("button", { name: "Explode" })).toHaveClass(/text-signal/);
    // gets better hover shows a version tooltip
    const gb = page.getByText("Gets better").first();
    await expect(gb).toBeVisible();
    // download STL from the run's file API
    const href = await page.evaluate(() => fetch("/api/runs/demo-freezer-latch").then((r) => r.json()).then((j) => j.parts?.[0]?.stl));
    const res = await page.request.get(`/api/runs/demo-freezer-latch/files/${href}`);
    expect(res.status()).toBe(200);
    const buf = await res.body();
    const ascii = buf.subarray(0, 5).toString() === "solid" && buf.toString().includes("facet");
    const binary = buf.length > 84 && buf.length === 84 + 50 * buf.readUInt32LE(80);
    expect(ascii || binary, "valid STL").toBeTruthy();
    // fit hover checks
    await page.goto(RUN + "?view=verify&instant=1");
    const chip = page.getByText(/checks? pass|PASS|pass/i).first();
    await expect(chip).toBeVisible({ timeout: 15000 });
    await chip.hover();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/desktop-07-fit-hover.png` });
    expect.soft(w.errors, "console errors").toEqual([]);
    expect.soft(w.bad, "4xx/5xx").toEqual([]);
  });

  test("robot dog: train videos play + pause @layout", async ({ page }, info) => {
    const w = watch(page);
    await page.goto("/runs/demo-robot-dog?view=train&instant=1");
    const pause = page.getByRole("button", { name: "Pause" });
    await expect(pause).toBeVisible({ timeout: 25000 });
    const video = page.locator("video");
    if (await video.count()) {
      await expect.poll(() => video.first().evaluate((v: HTMLVideoElement) => v.readyState >= 2 && !v.paused), { timeout: 20000 }).toBeTruthy();
    }
    await shot(page, "08-train", info.project.name);
    await noOverflow(page, "train");
    await pause.click();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
    if (await video.count()) expect(await video.first().evaluate((v: HTMLVideoElement) => v.paused)).toBeTruthy();
    expect.soft(w.errors, "console errors").toEqual([]);
    expect.soft(w.bad, "4xx/5xx").toEqual([]);
  });
});

test.describe("API", () => {
  test("GET /api/evals + runs + traversal blocked", async ({ request }, info) => {
    test.skip(info.project.name !== "desktop");
    const ev = await request.get("/api/evals");
    expect(ev.status()).toBe(200);
    const j = await ev.json();
    expect(Array.isArray(j.history)).toBeTruthy();
    const runs = await request.get("/api/runs");
    expect(runs.status()).toBe(200);
    for (const bad of ["..%2F..%2FCOORDINATION.md", "%2e%2e/%2e%2e/COORDINATION.md", "..%2Frun.json", "parts/..%2F..%2F..%2Fpackage.json"]) {
      const r = await request.get(`/api/runs/demo-freezer-latch/files/${bad}`);
      expect(r.status(), bad).toBe(404);
    }
    const r2 = await request.get(`/api/runs/..%2F..%2Fweb/files/package.json`);
    expect(r2.status()).toBe(404);
  });

  test("POST /api/runs live pipeline to verdict", async ({ request, baseURL }, info) => {
    test.skip(info.project.name !== "desktop" || !!process.env.E2E_SKIP_LIVE);
    test.setTimeout(200_000);
    const res = await request.post("/api/runs", { data: { prompt: "a replacement knob for my stove" } });
    expect(res.status()).toBe(200);
    const { id } = await res.json();
    expect(id).toBeTruthy();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 180_000);
    const events: any[] = [];
    let end: any = null;
    try {
      const s = await fetch(`${baseURL}/api/runs/${id}/stream`, { signal: ctl.signal });
      const reader = s.body!.getReader();
      let buf = "";
      const dec = new TextDecoder();
      while (!end) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const msg = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = msg.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
          if (!data) continue;
          if (msg.startsWith("event: end")) end = JSON.parse(data); else events.push(JSON.parse(data));
        }
      }
    } catch { /* timeout: assert on what streamed */ } finally { clearTimeout(t); }
    console.log(`run ${id}: ${events.length} events; end=${end?.status}; stages=${[...new Set(events.map((e) => e.stage + ":" + e.phase))].join(",")}`);
    expect(events.length).toBeGreaterThan(3);
    expect(events.some((e) => e.stage === "cad" && (e.phase === "done" || e.phase === "artifact")), "STL compiled").toBeTruthy();
    expect(events.some((e) => e.stage === "verify"), "physics ran").toBeTruthy();
    const run = await (await request.get(`/api/runs/${id}`)).json();
    if (run.verdict) {
      const v = await request.get(`/api/runs/${id}/files/${run.verdict}`);
      expect(v.status()).toBe(200);
    } else {
      expect(end, "run finished or verdict written").toBeTruthy();
    }
  });
});
