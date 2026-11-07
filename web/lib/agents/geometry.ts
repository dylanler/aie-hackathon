// Mesh analysis for compiled STL parts: bbox, volume, watertightness, wall thickness and
// through-hole detection by axis-aligned ray probing; wall thickness by morphological opening. Pure TS.
import { minWallByOpening } from "./thickness";

export type Mesh = { tris: Float64Array; n: number }; // 9 floats per triangle

export function parseSTL(buf: Buffer): Mesh {
  const head = buf.subarray(0, Math.min(buf.length, 512)).toString("latin1");
  const isAscii = head.trimStart().startsWith("solid") && buf.toString("latin1", 0, Math.min(buf.length, 2000)).includes("facet");
  if (!isAscii && buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    if (84 + n * 50 === buf.length) {
      const tris = new Float64Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        for (let k = 0; k < 9; k++) tris[i * 9 + k] = buf.readFloatLE(o + k * 4);
      }
      return { tris, n };
    }
  }
  const txt = buf.toString("latin1");
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  const v: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) v.push(+m[1], +m[2], +m[3]);
  const n = Math.floor(v.length / 9);
  return { tris: Float64Array.from(v.slice(0, n * 9)), n };
}

export type Hole = { axis: "x" | "y" | "z"; d_mm: number; center: [number, number] };
export type Analysis = {
  triangles: number;
  bbox_min: [number, number, number];
  bbox_max: [number, number, number];
  dims_mm: [number, number, number];
  volume_mm3: number;
  watertight: boolean;
  min_wall_mm: number | null;
  holes: Hole[];
};

const AX = ["x", "y", "z"] as const;

export function analyzeMesh(mesh: Mesh): Analysis {
  const { tris, n } = mesh;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  let vol = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) {
      const val = tris[o + k * 3 + c];
      if (val < mn[c]) mn[c] = val;
      if (val > mx[c]) mx[c] = val;
    }
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [tris[o], tris[o + 1], tris[o + 2], tris[o + 3], tris[o + 4], tris[o + 5], tris[o + 6], tris[o + 7], tris[o + 8]];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  if (n === 0) {
    return { triangles: 0, bbox_min: [0, 0, 0], bbox_max: [0, 0, 0], dims_mm: [0, 0, 0], volume_mm3: 0, watertight: false, min_wall_mm: null, holes: [] };
  }
  // watertight: every undirected edge used exactly twice
  const edges = new Map<string, number>();
  const key = (o: number) => `${tris[o].toFixed(4)},${tris[o + 1].toFixed(4)},${tris[o + 2].toFixed(4)}`;
  for (let i = 0; i < n; i++) {
    const ks = [key(i * 9), key(i * 9 + 3), key(i * 9 + 6)];
    for (let e = 0; e < 3; e++) {
      const a = ks[e], b = ks[(e + 1) % 3];
      const k2 = a < b ? a + "|" + b : b + "|" + a;
      edges.set(k2, (edges.get(k2) || 0) + 1);
    }
  }
  let watertight = true;
  for (const c of Array.from(edges.values())) if (c !== 2) { watertight = false; break; }

  const dims = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] as [number, number, number];
  const maxDim = Math.max(...dims);
  const h = Math.max(0.2, maxDim / 320);
  const walls: number[] = [];
  let zGrid: { solid: (number[] | undefined)[]; nu: number; nw: number; u0: number; w0: number } | null = null;
  const holes: Hole[] = [];
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3, w = (a + 2) % 3;
    const nu = Math.max(1, Math.ceil(dims[u] / h)) + 2, nw = Math.max(1, Math.ceil(dims[w] / h)) + 2;
    const u0 = mn[u] - h, w0 = mn[w] - h;
    const cells: (number[] | undefined)[] = new Array(nu * nw);
    const J = 1.37e-4; // jitter so cell centres never land exactly on an edge
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      const P = [0, 1, 2].map((k) => [tris[o + k * 3 + u], tris[o + k * 3 + w], tris[o + k * 3 + a]]);
      const det = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
      if (Math.abs(det) < 1e-12) continue;
      const iu0 = Math.max(0, Math.floor((Math.min(P[0][0], P[1][0], P[2][0]) - u0) / h - 0.5));
      const iu1 = Math.min(nu - 1, Math.ceil((Math.max(P[0][0], P[1][0], P[2][0]) - u0) / h - 0.5));
      const iw0 = Math.max(0, Math.floor((Math.min(P[0][1], P[1][1], P[2][1]) - w0) / h - 0.5));
      const iw1 = Math.min(nw - 1, Math.ceil((Math.max(P[0][1], P[1][1], P[2][1]) - w0) / h - 0.5));
      for (let iu = iu0; iu <= iu1; iu++) {
        const pu = u0 + (iu + 0.5) * h + J;
        for (let iw = iw0; iw <= iw1; iw++) {
          const pw = w0 + (iw + 0.5) * h + J * 0.71;
          const l1 = ((P[1][0] - pu) * (P[2][1] - pw) - (P[2][0] - pu) * (P[1][1] - pw)) / det;
          const l2 = ((P[2][0] - pu) * (P[0][1] - pw) - (P[0][0] - pu) * (P[2][1] - pw)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          const depth = l1 * P[0][2] + l2 * P[1][2] + l3 * P[2][2];
          const idx = iu * nw + iw;
          (cells[idx] ||= []).push(det < 0 ? depth : -depth - 1e9);
        }
      }
    }
    const occ = new Uint8Array(nu * nw);
    const axisWalls: number[] = [];
    // Each hit is encoded as entering (det<0) or exiting; convert to solid intervals by winding number,
    // which stays correct when the mesh has internal/duplicate faces (common in CSG output).
    const solid: (number[] | undefined)[] = new Array(cells.length);
    for (let idx = 0; idx < cells.length; idx++) {
      const raw = cells[idx];
      if (!raw || raw.length < 2) continue;
      const hits = raw.map((x) => (x < -5e8 ? { z: -(x + 1e9), s: -1 } : { z: x, s: 1 })).sort((p, q) => p.z - q.z);
      const iv: number[] = [];
      let wnd = 0;
      for (const hh of hits) {
        const before = wnd;
        wnd += hh.s;
        if (before <= 0 && wnd > 0) iv.push(hh.z);
        else if (before > 0 && wnd <= 0) iv.push(hh.z);
      }
      const ivs = iv.length % 2 ? iv.slice(0, -1) : iv;
      const merged: number[] = [];
      for (let k = 0; k + 1 < ivs.length; k += 2) {
        if (merged.length && ivs[k] - merged[merged.length - 1] < 0.05) merged[merged.length - 1] = ivs[k + 1]; // touching solids
        else merged.push(ivs[k], ivs[k + 1]);
      }
      if (merged.length >= 2) { solid[idx] = merged; occ[idx] = 1; }
    }
    // Wall thickness: solid segment lengths, but only from rays whose 8 neighbours also hit the part,
    // so rays grazing a curved silhouette (fillets, cylinders) don't masquerade as thin walls.
    for (let idx = 0; idx < cells.length; idx++) {
      const d = solid[idx];
      if (!d) continue;
      const iu = Math.floor(idx / nw), iw = idx % nw;
      let interior = iu > 0 && iw > 0 && iu < nu - 1 && iw < nw - 1;
      for (let du = -1; interior && du <= 1; du++) for (let dw = -1; dw <= 1; dw++) if (!occ[idx + du * nw + dw]) { interior = false; break; }
      if (!interior) continue;
      for (let k = 0; k + 1 < d.length; k += 2) {
        const len = d[k + 1] - d[k];
        if (len > 1e-3) { axisWalls.push(len); if (process.env.GEO_DEBUG && len < 1.2) console.log("thin", AX[a], len.toFixed(2), "u", (u0 + (iu + 0.5) * h).toFixed(1), "w", (w0 + (iw + 0.5) * h).toFixed(1), "depths", d.map((x) => x.toFixed(2)).join(" ")); }
      }
    }
    if (a === 2) zGrid = { solid, nu, nw, u0, w0 };
    if (axisWalls.length) {
      axisWalls.sort((p, q) => p - q);
      walls.push(axisWalls[Math.floor(axisWalls.length * 0.05)]);
    }
    // empty components not connected to the border = through-holes along this axis
    const seen = new Uint8Array(nu * nw);
    const stack: number[] = [];
    const flood = (start: number) => {
      const comp: number[] = [];
      stack.push(start); seen[start] = 1;
      let border = false;
      while (stack.length) {
        const c = stack.pop()!;
        comp.push(c);
        const iu = Math.floor(c / nw), iw = c % nw;
        if (iu === 0 || iw === 0 || iu === nu - 1 || iw === nw - 1) border = true;
        const nb = [iu > 0 ? c - nw : -1, iu < nu - 1 ? c + nw : -1, iw > 0 ? c - 1 : -1, iw < nw - 1 ? c + 1 : -1];
        for (const q of nb) if (q >= 0 && !seen[q] && !occ[q]) { seen[q] = 1; stack.push(q); }
      }
      return { comp, border };
    };
    for (let idx = 0; idx < occ.length; idx++) {
      if (occ[idx] || seen[idx]) continue;
      const { comp, border } = flood(idx);
      if (border) continue;
      const area = comp.length * h * h;
      const d = 2 * Math.sqrt(area / Math.PI);
      if (d < 0.8) continue;
      let su = 0, sw = 0;
      for (const c of comp) { su += u0 + (Math.floor(c / nw) + 0.5) * h; sw += w0 + ((c % nw) + 0.5) * h; }
      holes.push({ axis: AX[a], d_mm: +d.toFixed(2), center: [+(su / comp.length).toFixed(2), +(sw / comp.length).toFixed(2)] });
    }
  }
  return {
    triangles: n,
    bbox_min: mn.map((x) => +x.toFixed(3)) as any,
    bbox_max: mx.map((x) => +x.toFixed(3)) as any,
    dims_mm: dims.map((x) => +x.toFixed(2)) as any,
    volume_mm3: +Math.abs(vol).toFixed(1),
    watertight,
    min_wall_mm: wallByOpening(zGrid, h, mn[2], dims[2]) ?? (walls.length ? +Math.min(...walls).toFixed(2) : null),
    holes,
  };
}

/** Voxelize from the z-axis ray intervals (x,y grid of size h, z sampled at h) and run the opening test. */
function wallByOpening(g: { solid: (number[] | undefined)[]; nu: number; nw: number; u0: number; w0: number } | null, h: number, zmin: number, dz: number): number | null {
  if (!g) return null;
  // grid: u = x, w = y for the z axis
  const nx = g.nu, ny = g.nw, nz = Math.max(1, Math.ceil(dz / h)) + 2;
  if (nx * ny * nz > 12_000_000) return null;
  const vox = new Uint8Array(nx * ny * nz);
  const z0 = zmin - h;
  for (let iu = 0; iu < nx; iu++) for (let iw = 0; iw < ny; iw++) {
    const iv = g.solid[iu * g.nw + iw];
    if (!iv) continue;
    for (let k = 0; k + 1 < iv.length; k += 2) {
      const a = Math.max(0, Math.ceil((iv[k] - z0) / h - 0.5)), b = Math.min(nz - 1, Math.floor((iv[k + 1] - z0) / h - 0.5));
      for (let iz = a; iz <= b; iz++) vox[(iz * ny + iw) * nx + iu] = 1;
    }
  }
  return minWallByOpening(vox, nx, ny, nz, h);
}
