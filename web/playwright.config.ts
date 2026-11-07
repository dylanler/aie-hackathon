import { defineConfig, devices } from "@playwright/test";

// E2E: `npm run test:e2e`. Points at E2E_BASE_URL (default http://localhost:3210, start with
// `NODE_USE_ENV_PROXY=1 MUJOCO_GL=disable npx next dev -p 3210`). Set PW_CHROMIUM to use a preinstalled chromium.
const exe = process.env.PW_CHROMIUM;
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "./e2e/.out",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3210",
    launchOptions: exe ? { executablePath: exe, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] } : { args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] },
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "desktop-720", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } }, grep: /@layout/ },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, grep: /@layout|@mobile/ },
    { name: "mobile-430", use: { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, grep: /@layout/ },
  ],
});
