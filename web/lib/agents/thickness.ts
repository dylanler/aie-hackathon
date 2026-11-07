// Minimum wall thickness by morphological opening on a voxel grid.
// A wall of thickness t survives an opening with a ball of diameter t; thinner features vanish.
// min_wall = the largest t (0.1 mm steps) for which ≥ 98% of the material survives the opening.
// Robust to curved surfaces (pins, rings) where axis-aligned chord lengths under-report thickness.

const INF = 1e20;

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}

/** Squared Euclidean distance (in voxels) from every voxel to the nearest voxel where seed[i] is true. */
function sqEDT(seed: Uint8Array, nx: number, ny: number, nz: number): Float64Array {
  const out = new Float64Array(nx * ny * nz);
  for (let i = 0; i < out.length; i++) out[i] = seed[i] ? 0 : INF;
  const m = Math.max(nx, ny, nz);
  const f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  const pass = (n: number, idx: (t: number) => number) => {
    for (let t = 0; t < n; t++) f[t] = out[idx(t)];
    edt1d(f, n, d, v, z);
    for (let t = 0; t < n; t++) out[idx(t)] = d[t];
  };
  for (let y = 0; y < ny; y++) for (let zz = 0; zz < nz; zz++) pass(nx, (t) => (zz * ny + y) * nx + t);
  for (let x = 0; x < nx; x++) for (let zz = 0; zz < nz; zz++) pass(ny, (t) => (zz * ny + t) * nx + x);
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) pass(nz, (t) => (t * ny + y) * nx + x);
  return out;
}

/** solid: voxel occupancy (x fastest), h = voxel size in mm. Returns min wall in mm. */
export function minWallByOpening(solid: Uint8Array, nx: number, ny: number, nz: number, h: number): number {
  const total = solid.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  const empty = new Uint8Array(solid.length);
  for (let i = 0; i < solid.length; i++) empty[i] = solid[i] ? 0 : 1;
  const inside = sqEDT(empty, nx, ny, nz); // distance from solid voxel to nearest empty voxel
  const survives = (t: number) => {
    const r = t / 2 / h; // radius in voxels
    const r2 = r * r;
    const core = new Uint8Array(solid.length);
    let nc = 0;
    for (let i = 0; i < solid.length; i++) if (solid[i] && inside[i] >= r2 - 1e-9) { core[i] = 1; nc++; }
    if (!nc) return 0;
    const dist = sqEDT(core, nx, ny, nz);
    const rr = (r + 0.5) ** 2;
    let kept = 0;
    for (let i = 0; i < solid.length; i++) if (solid[i] && dist[i] <= rr) kept++;
    return kept / total;
  };
  let lo = 0, hi = 0.1;
  while (hi < 40 && survives(hi) >= 0.98) { lo = hi; hi *= 2; }
  for (let it = 0; it < 7 && hi - lo > 0.05; it++) {
    const mid = (lo + hi) / 2;
    if (survives(mid) >= 0.98) lo = mid; else hi = mid;
  }
  return +lo.toFixed(2);
}
