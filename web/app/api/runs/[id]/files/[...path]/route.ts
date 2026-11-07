import fs from "node:fs";
import path from "node:path";
import { runDir } from "@/lib/agents/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".stl": "model/stl", ".json": "application/json", ".scad": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".onnx": "application/octet-stream", ".xml": "application/xml",
  ".3mf": "model/3mf", ".jsonl": "application/x-ndjson", ".py": "text/plain; charset=utf-8", ".gif": "image/gif", ".webm": "video/webm",
};

export async function GET(_req: Request, { params }: { params: { id: string; path: string[] } }) {
  try {
  const base = path.resolve(runDir(params.id));
  const target = path.resolve(base, ...params.path);
  if (!target.startsWith(base + path.sep) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    return new Response("not found", { status: 404 });
  }
  const ext = path.extname(target).toLowerCase();
  const headers: Record<string, string> = { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-cache" };
  if (ext === ".stl" || ext === ".3mf") headers["Content-Disposition"] = `inline; filename="${path.basename(target)}"`;
  return new Response(fs.readFileSync(target), { headers });
  } catch { return new Response("not found", { status: 404 }); }
}
