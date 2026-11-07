import * as THREE from "three";
import type { Part } from "../data/types";

/** Procedural stand-ins for fixture parts (mm, Y up, resting on y=0, centred on x/z). */
export function latchGeometry(p: Record<string, number> = {}) {
  const L = p.length_mm ?? 32, W = p.width_mm ?? 20, B = p.base_mm ?? 4, H = p.hook_mm ?? 10;
  const t = 4, over = 6, lip = 2.4;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(L, 0);
  s.lineTo(L, B + H);
  s.lineTo(L - t - over, B + H);
  s.lineTo(L - t - over, B + H - lip);
  s.quadraticCurveTo(L - t - over * 0.4, B + H - lip - 0.8, L - t, B + H - lip - 2.6);
  s.lineTo(L - t, B);
  s.lineTo(0, B);
  s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.5, bevelSegments: 3, curveSegments: 16 });
  g.translate(-L / 2, 0.5, -W / 2);
  g.computeVertexNormals();
  return g;
}

function rounded(w: number, h: number, d: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: Math.min(r, h / 4), bevelSize: Math.min(r, h / 4) * 0.8, bevelSegments: 4, curveSegments: 10 });
  g.rotateX(-Math.PI / 2);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  g.translate(0, -bb.min.y, 0);
  g.computeVertexNormals();
  return g;
}

export function shimGeometry(p: Record<string, number> = {}) {
  const T = p.thickness_mm ?? 1.6;
  return rounded(24, T, 18, 2);
}

export function geometryFor(part: Part, params: Record<string, number>) {
  switch (part.shape) {
    case "latch": return latchGeometry(params);
    case "shim": return shimGeometry(params);
    default: {
      const [x, y, z] = part.dims_mm;
      return rounded(x, Math.min(y, z), Math.max(y, z), Math.min(4, Math.min(x, y, z) / 3));
    }
  }
}

export function roundedBox(w: number, h: number, d: number, r = 3) { return rounded(w, h, d, r); }

const OK = new THREE.Color("#3DD68C"), WARN = new THREE.Color("#F5B544"), ERR = new THREE.Color("#F2555A");

/** Paint vertex colours by proximity to a contact point: far = ok, close = warn, touching = err (only if failing). */
export function paintHeatmap(g: THREE.BufferGeometry, contact: THREE.Vector3, radius: number, failing: boolean) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = Math.max(0, 1 - v.distanceTo(contact) / radius);
    if (t < 0.5) c.copy(OK);
    else if (!failing) c.copy(OK).lerp(WARN, Math.min(1, (t - 0.5) / 0.4));
    else c.copy(WARN).lerp(ERR, Math.min(1, (t - 0.5) / 0.3));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
}
