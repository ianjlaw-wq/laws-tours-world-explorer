import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { groundMaterial } from './materials';
import { fbm, ridged } from './noise';
import { PADS, TRAIL, TRAIL_HALF_WIDTH } from './layout';

// ----------------------------------------------------------------------------
// Analytic height model
// ----------------------------------------------------------------------------

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Polynomial smooth maximum */
function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return { d: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t };
}

export const GORGE_FLOOR = -240;
export const RIVER_Y = -246;

/** Mountain profile: rounded summit (radius r0) blending into straight flanks. */
function peak(x: number, z: number, cx: number, cz: number, top: number, r0: number, slope: number) {
  const d = Math.hypot(x - cx, z - cz);
  return top - slope * (Math.sqrt(d * d + r0 * r0) - r0);
}

/** Natural landform before site pads and the trail are applied. */
function naturalHeight(x: number, z: number): number {
  // Urubamba gorge floor with a river channel looping round the ridge.
  const rRiver = Math.hypot(x - 0, z - 30);
  const riverCarve = 1 - smoothstep(10, 40, Math.abs(rRiver - 340));
  let h = GORGE_FLOOR + fbm(x / 60, z / 60, 3) * 6 - riverCarve * 14;

  // Domain warp so mountains are not perfect cones.
  const wx = x + fbm(x / 150 + 5.3, z / 150, 3) * 45;
  const wz = z + fbm(x / 150, z / 150 + 9.1, 3) * 45;

  // Site saddle plateau (ellipse) with steep flanks.
  const ex = x / 58;
  const ez = (z - 10) / 125;
  const ell = (Math.sqrt(ex * ex + ez * ez) - 1) * 58;
  const plateau = 0 - 1.7 * Math.max(0, ell) - 0.4 * Math.max(0, ell) * Math.max(0, ell) * 0.02;

  // Huayna Picchu: steep sugar-loaf with a rounded crown and vertical flutes.
  const hx = x + fbm(x / 60, z / 60 + 2, 2) * 10;
  const hz = z + fbm(x / 60 + 7, z / 60, 2) * 10;
  const hpAng = Math.atan2(hz - 215, hx + 15);
  const hpD = Math.hypot(hx + 15, hz - 215);
  const flutes = (ridged(hpAng * 2.6 + 4, hpD / 30, 3) - 0.5) * 16 * smoothstep(8, 40, hpD);
  const hp = peak(hx, hz, -15, 215, 182, 14, 2.7) + flutes + fbm(x / 18, z / 18, 3) * 6;
  // Huchuy Picchu: the small hill between the city and Huayna Picchu.
  const huchuy = peak(x, z, 10, 148, 36, 8, 1.5);

  // Machu Picchu Mountain to the south.
  const mpm = peak(wx, wz, -40, -330, 290, 25, 1.25);

  // Ridge from Machu Picchu Mountain out past the Sun Gate.
  const s = segDist(x, z, -40, -330, 205, -213);
  const ridgeTop = lerp(280, 18, s.t);
  const ridge = ridgeTop - 0.9 * Math.max(0, s.d - 6);

  // Distant Andes: ring of warped, ridged peaks beyond the gorge.
  const r = Math.hypot(x, z);
  const farMask = smoothstep(480, 1250, r);
  const fx = x + fbm(x / 400, z / 400 + 3, 3) * 220;
  const fz = z + fbm(x / 400 + 8, z / 400, 3) * 220;
  const far = GORGE_FLOOR - 40 + farMask * (
    ridged(fx / 650 + 3.1, fz / 650 - 1.7) * 950 + ridged(fx / 170, fz / 170, 4) * 150 + 100);

  let m = smax(plateau, hp, 30);
  m = smax(m, huchuy, 12);
  m = smax(m, mpm, 40);
  m = smax(m, ridge, 25);
  // Erosion-like spurs and gullies on the steep flanks (kept off the plateau).
  const flank = smoothstep(-6, -40, m) * smoothstep(8, 30, ell) * (1 - smoothstep(150, 260, m));
  m += (ridged(wx / 55, wz / 55, 3) - 0.45) * 26 * flank;
  m += fbm(x / 35, z / 35, 4) * 5 * smoothstep(-5, -40, m); // rugged flanks, smooth plateau
  m += fbm(x / 9, z / 9, 2) * 0.35; // fine undulation
  h = smax(h, m, 30);
  h = smax(h, far, 80);
  return h;
}

function padWeight(x: number, z: number, x0: number, x1: number, z0: number, z1: number, blend: number) {
  const dx = Math.max(x0 - x, 0, x - x1);
  const dz = Math.max(z0 - z, 0, z - z1);
  const d = Math.hypot(dx, dz);
  return 1 - smoothstep(0, blend, d);
}

/** 0..1 weight for how much the Inca Trail occupies this point, plus trail height. */
export function trailInfo(x: number, z: number): { w: number; y: number; core: number } {
  let best = Infinity;
  let y = 0;
  for (let i = 0; i < TRAIL.length - 1; i++) {
    const a = TRAIL[i];
    const b = TRAIL[i + 1];
    const s = segDist(x, z, a.x, a.z, b.x, b.z);
    if (s.d < best) {
      best = s.d;
      y = lerp(a.y, b.y, s.t);
    }
  }
  return {
    w: 1 - smoothstep(TRAIL_HALF_WIDTH, TRAIL_HALF_WIDTH + 7, best),
    core: 1 - smoothstep(TRAIL_HALF_WIDTH - 0.6, TRAIL_HALF_WIDTH + 0.4, best),
    y,
  };
}

/** Full analytic terrain height (used to build meshes and outside the detail mesh). */
export function terrainHeight(x: number, z: number): number {
  let h = naturalHeight(x, z);
  for (const p of PADS) {
    const w = padWeight(x, z, p.x0, p.x1, p.z0, p.z1, p.blend);
    if (w > 0) {
      const cx = Math.min(p.x1, Math.max(p.x0, x));
      const cz = Math.min(p.z1, Math.max(p.z0, z));
      h = lerp(h, p.h(cx, cz), w);
    }
  }
  const t = trailInfo(x, z);
  if (t.w > 0) h = lerp(h, t.y - 0.05, t.w);
  return h;
}

// ----------------------------------------------------------------------------
// Detail terrain grid (exact collision queries match the rendered triangles)
// ----------------------------------------------------------------------------

export const DETAIL = { x0: -200, z0: -300, x1: 260, z1: 260, step: 2.5 };

export class TerrainGrid {
  readonly nx: number;
  readonly nz: number;
  readonly heights: Float32Array;

  constructor() {
    this.nx = Math.round((DETAIL.x1 - DETAIL.x0) / DETAIL.step) + 1;
    this.nz = Math.round((DETAIL.z1 - DETAIL.z0) / DETAIL.step) + 1;
    this.heights = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        this.heights[j * this.nx + i] = terrainHeight(DETAIL.x0 + i * DETAIL.step, DETAIL.z0 + j * DETAIL.step);
      }
    }
  }

  inside(x: number, z: number): boolean {
    return x > DETAIL.x0 && x < DETAIL.x1 && z > DETAIL.z0 && z < DETAIL.z1;
  }

  /** Height exactly on the rendered triangle surface. */
  heightAt(x: number, z: number): number {
    if (!this.inside(x, z)) return terrainHeight(x, z);
    const gx = (x - DETAIL.x0) / DETAIL.step;
    const gz = (z - DETAIL.z0) / DETAIL.step;
    const i = Math.min(this.nx - 2, Math.floor(gx));
    const j = Math.min(this.nz - 2, Math.floor(gz));
    const fx = gx - i;
    const fz = gz - j;
    const H = this.heights;
    const h00 = H[j * this.nx + i];
    const h10 = H[j * this.nx + i + 1];
    const h01 = H[(j + 1) * this.nx + i];
    const h11 = H[(j + 1) * this.nx + i + 1];
    // Triangles split along the (0,0)-(1,1) diagonal.
    if (fx >= fz) return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
    return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }

  /** Slope magnitude (rise over run) at a point. */
  slopeAt(x: number, z: number): number {
    const e = 0.6;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }
}

// ----------------------------------------------------------------------------
// Mesh building
// ----------------------------------------------------------------------------

/** Per-vertex splat weights: r = trail, g = forest canopy. */
function splatFor(x: number, y: number, z: number, slope: number, out: Float32Array, idx: number) {
  const n = fbm(x / 40, z / 40, 3) * 0.5 + 0.5;
  const onSite = PADS.some((p) => x > p.x0 - 3 && x < p.x1 + 3 && z > p.z0 - 3 && z < p.z1 + 3);
  let forest = smoothstep(0.45, 0.9, slope + (n - 0.5) * 0.5) * (1 - smoothstep(230, 330, y));
  forest = Math.max(forest, smoothstep(-120, -200, y) * 0.9);
  if (onSite) forest = 0;
  const t = trailInfo(x, z);
  out[idx] = t.core * 0.95;
  out[idx + 1] = Math.min(1, forest) * (1 - t.w);
  out[idx + 2] = n;
  out[idx + 3] = 1;
}

function buildGridMesh(
  name: string,
  scene: Scene,
  nx: number,
  nz: number,
  x0: number,
  z0: number,
  step: number,
  heightFn: (i: number, j: number, x: number, z: number) => number,
  uvScale: number,
): Mesh {
  const positions = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      const k = j * nx + i;
      positions[k * 3] = x;
      positions[k * 3 + 1] = heightFn(i, j, x, z);
      positions[k * 3 + 2] = z;
      uvs[k * 2] = x / uvScale;
      uvs[k * 2 + 1] = z / uvScale;
    }
  }
  const indexCount = (nx - 1) * (nz - 1) * 6;
  const indices = nx * nz > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let p = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Diagonal a-d; winding chosen so faces point up in Babylon's left-handed system.
      indices[p++] = a; indices[p++] = d; indices[p++] = b;
      indices[p++] = a; indices[p++] = c; indices[p++] = d;
    }
  }
  let normals = new Float32Array(positions.length);
  VertexData.ComputeNormals(positions, indices, normals);
  // Make sure faces point up under Babylon's winding convention.
  const mid = (Math.floor(nz / 2) * nx + Math.floor(nx / 2)) * 3;
  if (normals[mid + 1] < 0) {
    for (let t = 0; t < indices.length; t += 3) {
      const tmp = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = tmp;
    }
    normals = new Float32Array(positions.length);
    VertexData.ComputeNormals(positions, indices, normals);
  }

  const splat = new Float32Array(nx * nz * 4);
  for (let k = 0; k < nx * nz; k++) {
    const ny = normals[k * 3 + 1];
    const slope = Math.sqrt(Math.max(0, 1 - ny * ny)) / Math.max(0.05, ny);
    splatFor(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2], slope, splat, k * 4);
  }

  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.uvs = uvs;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh, false);
  mesh.setVerticesData('splat', splat, false, 4);
  return mesh;
}

export function buildTerrain(scene: Scene, grid: TerrainGrid): Mesh[] {
  const mat = groundMaterial(scene, 'terrainMat', true);

  const near = buildGridMesh(
    'terrain-near', scene, grid.nx, grid.nz, DETAIL.x0, DETAIL.z0, DETAIL.step,
    (i, j) => grid.heights[j * grid.nx + i], 8,
  );
  near.material = mat;
  near.receiveShadows = true;

  // Far terrain: coarser grid; vertices under the detail area are sunk out of sight.
  const FAR = 4200;
  const FN = 241;
  const fstep = (FAR * 2) / (FN - 1);
  const margin = fstep * 1.5;
  const far = buildGridMesh('terrain-far', scene, FN, FN, -FAR, -FAR, fstep, (_i, _j, x, z) => {
    const h = terrainHeight(x, z);
    const insideDetail =
      x > DETAIL.x0 + margin && x < DETAIL.x1 - margin && z > DETAIL.z0 + margin && z < DETAIL.z1 - margin;
    return insideDetail ? h - 60 : h - 1.5;
  }, 60);
  far.material = mat;

  for (const m of [near, far]) {
    m.isPickable = false;
    m.freezeWorldMatrix();
    m.doNotSyncBoundingInfo = true;
  }
  return [near, far];
}
