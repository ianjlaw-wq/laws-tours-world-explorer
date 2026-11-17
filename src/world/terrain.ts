import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
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

function cone(x: number, z: number, cx: number, cz: number, peak: number, rTop: number, slope: number) {
  const d = Math.hypot(x - cx, z - cz);
  return peak - slope * Math.max(0, d - rTop);
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return { d: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t };
}

export const GORGE_FLOOR = -240;
export const RIVER_Y = -246;

/** Natural landform before site pads and the trail are applied. */
function naturalHeight(x: number, z: number): number {
  // Urubamba gorge floor with a river channel looping round the ridge.
  const rRiver = Math.hypot(x - 0, z - 30);
  const riverCarve = 1 - smoothstep(10, 40, Math.abs(rRiver - 340));
  let h = GORGE_FLOOR + fbm(x / 60, z / 60, 3) * 6 - riverCarve * 14;

  // Site saddle plateau (ellipse) with steep flanks.
  const ex = x / 58;
  const ez = (z - 10) / 125;
  const ell = (Math.sqrt(ex * ex + ez * ez) - 1) * 58;
  const plateau = 0 - 1.7 * Math.max(0, ell) - 0.4 * Math.max(0, ell) * Math.max(0, ell) * 0.02;

  // Huayna Picchu: steep sugar-loaf peak to the north.
  const hp = cone(x, z, -15, 215, 175, 4, 2.6) + fbm(x / 18, z / 18, 3) * 10;
  // Huchuy Picchu: the small hill between the city and Huayna Picchu.
  const huchuy = cone(x, z, 10, 148, 34, 3, 1.6);

  // Machu Picchu Mountain to the south.
  const mpm = cone(x, z, -40, -330, 280, 10, 1.2);

  // Ridge from Machu Picchu Mountain out past the Sun Gate.
  const s = segDist(x, z, -40, -330, 205, -213);
  const ridgeTop = lerp(280, 18, s.t);
  const ridge = ridgeTop - 0.9 * Math.max(0, s.d - 6);

  // Distant Andes: ring of ridged peaks beyond the gorge.
  const r = Math.hypot(x, z);
  const farMask = smoothstep(420, 1000, r);
  const far = GORGE_FLOOR - 40 + farMask * (ridged(x / 650 + 3.1, z / 650 - 1.7) * 1250 + 120);

  let m = smax(plateau, hp, 30);
  m = smax(m, huchuy, 12);
  m = smax(m, mpm, 40);
  m = smax(m, ridge, 25);
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

const C_GRASS = new Color3(0.36, 0.5, 0.2);
const C_GRASS_LUSH = new Color3(0.28, 0.45, 0.16);
const C_FOREST = new Color3(0.13, 0.27, 0.1);
const C_ROCK = new Color3(0.42, 0.4, 0.36);
const C_DIRT = new Color3(0.52, 0.42, 0.3);
const C_SNOW = new Color3(0.92, 0.94, 0.97);
const C_GORGE = new Color3(0.1, 0.2, 0.09);

function colourFor(x: number, y: number, z: number, slope: number, out: number[], idx: number) {
  const n = fbm(x / 14, z / 14, 2) * 0.5 + 0.5;
  let c = Color3.Lerp(C_GRASS, C_GRASS_LUSH, n);
  // Cloud-forest on steep flanks and lower slopes
  // Cloud-forest clings even to very steep slopes here; only the sheerest faces are bare.
  const forest = smoothstep(0.55, 1.0, slope);
  c = Color3.Lerp(c, C_FOREST, Math.min(1, forest + smoothstep(-15, -60, y) * 0.8));
  const cliff = smoothstep(2.4, 3.6, slope + fbm(x / 7, z / 7, 2) * 0.9);
  c = Color3.Lerp(c, C_ROCK, cliff * (0.55 + 0.35 * n));
  c = Color3.Lerp(c, C_GORGE, smoothstep(-150, -230, y) * 0.5);
  // High distant peaks: rock then snow
  c = Color3.Lerp(c, C_ROCK, smoothstep(350, 550, y));
  c = Color3.Lerp(c, C_SNOW, smoothstep(650, 760, y + n * 60) * (1 - smoothstep(2.2, 3.2, slope) * 0.6));
  // Trail
  const t = trailInfo(x, z);
  if (t.core > 0) c = Color3.Lerp(c, C_DIRT, t.core * 0.9);
  out[idx] = c.r;
  out[idx + 1] = c.g;
  out[idx + 2] = c.b;
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

  const colours = new Array<number>(nx * nz * 4);
  for (let k = 0; k < nx * nz; k++) {
    const ny = normals[k * 3 + 1];
    const slope = Math.sqrt(Math.max(0, 1 - ny * ny)) / Math.max(0.05, ny);
    colourFor(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2], slope, colours, k * 4);
  }

  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.colors = colours;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh, false);
  return mesh;
}

export function buildTerrain(scene: Scene, grid: TerrainGrid, detailTex: Texture): Mesh[] {
  const mat = new StandardMaterial('terrainMat', scene);
  mat.diffuseTexture = detailTex;
  mat.specularColor = new Color3(0.02, 0.02, 0.02);

  const near = buildGridMesh(
    'terrain-near', scene, grid.nx, grid.nz, DETAIL.x0, DETAIL.z0, DETAIL.step,
    (i, j) => grid.heights[j * grid.nx + i], 8,
  );
  near.material = mat;
  near.receiveShadows = true;

  // Far terrain: coarse grid; vertices under the detail area are sunk out of sight.
  const FAR = 4200;
  const FN = 141;
  const fstep = (FAR * 2) / (FN - 1);
  const margin = fstep * 1.5;
  const far = buildGridMesh('terrain-far', scene, FN, FN, -FAR, -FAR, fstep, (_i, _j, x, z) => {
    const h = terrainHeight(x, z);
    const insideDetail =
      x > DETAIL.x0 + margin && x < DETAIL.x1 - margin && z > DETAIL.z0 + margin && z < DETAIL.z1 - margin;
    return insideDetail ? h - 60 : h - 1.5;
  }, 60);
  far.material = mat; // share: cloning would also clone (and blank) the DynamicTexture

  for (const m of [near, far]) {
    m.isPickable = false;
    m.freezeWorldMatrix();
    m.doNotSyncBoundingInfo = true;
  }
  return [near, far];
}
