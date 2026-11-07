// Usage: node scad-compile.mjs <in.scad> <out.stl>
// Compiles OpenSCAD with the openscad-wasm build (no system install needed). Runs as a child
// process so Next.js never has to bundle the wasm. Exit 0 on success; stderr carries the log.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const [, , inp, out] = process.argv;
const require = createRequire(path.resolve(process.cwd(), "package.json"));
let mod;
try { mod = await import("openscad-wasm-prebuilt"); }
catch { mod = await import(require.resolve("openscad-wasm-prebuilt")); }
const log = [];
const inst = await mod.createOpenSCAD({ print: (t) => log.push(t), printErr: (t) => log.push(t) });
const wasm = inst.getInstance();
wasm.FS.writeFile("/in.scad", readFileSync(inp, "utf8"));
let code = 0;
try { code = wasm.callMain(["/in.scad", "-o", "/out.stl"]); } catch (e) { log.push(String(e?.message || e)); code = 1; }
let ok = false;
try { const stl = wasm.FS.readFile("/out.stl"); if (stl.length > 84) { writeFileSync(out, stl); ok = true; } } catch {}
process.stderr.write(log.join("\n"));
process.exit(ok && !code ? 0 : 1);
