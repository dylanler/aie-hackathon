// Mesh analysis for compiled STL parts: bbox, volume, watertightness, wall thickness and
// through-hole detection by axis-aligned ray probing. Pure TS, no deps.

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
  for (const c of edges.values()) if (c !== 2) { watertight = false; break; }

  const dims = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] as [number, number, number];
  const maxDim = Math.max(...dims);
  const h = Math.max(0.2, maxDim / 320);
  const walls: number[] = [];
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
          (cells[idx] ||= []).push(depth);
        }
      }
    }
    const occ = new Uint8Array(nu * nw);
    const axisWalls: number[] = [];
    for (let idx = 0; idx < cells.length; idx++) {
      const d = cells[idx];
      if (!d || d.length < 2) continue;
      d.sort((p, q) => p - q);
      occ[idx] = 1;
      for (let k = 0; k + 1 < d.length; k += 2) {
        const len = d[k + 1] - d[k];
        if (len > 1e-3) axisWalls.push(len);
      }
    }
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
    min_wall_mm: walls.length ? +Math.min(...walls).toFixed(2) : null,
    holes,
  };
}
