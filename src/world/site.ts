import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { CollisionWorld } from './colliders';
import { TerrainGrid, trailInfo, DETAIL } from './terrain';
import { fbm, rng } from './noise';
import {
  AG, EAST_Y, FLANK, GUARDHOUSE, PADS, PLAZA_Y, SUN_GATE, TRAIL, WEST_Y,
} from './layout';
import { cloudTexture, grassBladeTexture, leafClusterTexture } from './textures';
import { boulderMaterial, foliageMaterial, groundMaterial, stoneMaterial, tex, thatchMaterial } from './materials';

type MatKey = 'stone' | 'fine' | 'grass' | 'thatch' | 'rock' | 'wood';

/** Collects boxes per material, registers colliders, then merges into few draw calls. */
interface WallTop { x: number; z: number; w: number; d: number; rot: number; top: number }

class Builder {
  private groups = new Map<MatKey, Mesh[]>();
  private n = 0;
  private r = rng(2024);
  /** When true, masonry walls get rubble/irregular capstones (roofless ruins). */
  ruin = false;
  readonly ruinTops: WallTop[] = [];
  constructor(private scene: Scene, private world: CollisionWorld, readonly mats: Record<MatKey, StandardMaterial>) {}

  /** Per-block tint variation and darker, weathered bases (vertex colours). */
  private paint(m: Mesh, masonry: boolean, tint = 1) {
    const pos = m.getVerticesData('position')!;
    const n = pos.length / 3;
    const t = (0.84 + this.r() * 0.24) * tint;
    const warm = 1 + (this.r() - 0.5) * 0.06;
    const cols = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const f = masonry && pos[i * 3 + 1] < 0 ? 0.68 : 1;
      cols[i * 4] = t * warm * f;
      cols[i * 4 + 1] = t * f;
      cols[i * 4 + 2] = (t / warm) * 0.97 * f;
      cols[i * 4 + 3] = 1;
    }
    m.setVerticesData('color', cols);
  }

  /** Highest surface (terrain or box top) under a point, not above maxY. */
  groundUnder(x: number, z: number, maxY: number): number {
    return this.world.groundAt(x, z, maxY, 0).y;
  }

  /** Inca walls lean inwards (batter): narrow the top along the wall's thin axis. */
  private batter(m: Mesh, w: number, d: number, h: number) {
    const pos = m.getVerticesData('position')!;
    const thinX = w <= d;
    const half = (thinX ? w : d) / 2;
    const t = Math.min(0.07 * h, half * 0.36);
    const k = (half - t) / half;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i + 1] > 0) {
        if (thinX) pos[i] *= k;
        else pos[i + 2] *= k;
      }
    }
    m.setVerticesData('position', pos);
  }

  private add(key: MatKey, m: Mesh) {
    let g = this.groups.get(key);
    if (!g) this.groups.set(key, (g = []));
    g.push(m);
  }

  /** Axis box centred at (x,z) with local width w (x) and depth d (z), from y0 to y1, yawed by rot. */
  block(key: MatKey, x: number, z: number, w: number, d: number, y0: number, y1: number, rot = 0, collide = true, tile = 0) {
    const h = y1 - y0;
    if (!tile) tile = key === 'fine' ? 2.4 : key === 'grass' ? 6 : 1.9;
    const fu = (a: number, b: number) => new Vector4(0, 0, a / tile, b / tile);
    const m = MeshBuilder.CreateBox('b' + this.n++, {
      width: w, height: h, depth: d, wrap: true,
      faceUV: [fu(w, h), fu(w, h), fu(d, h), fu(d, h), fu(w, d), fu(w, d)],
    }, this.scene);
    const masonry = key === 'stone' || key === 'fine';
    const wallLike = masonry && h > 1 && Math.min(w, d) <= 1.6;
    if (wallLike) this.batter(m, w, d, h);
    this.paint(m, masonry);
    m.position.set(x, y0 + h / 2, z);
    m.rotation.y = rot;
    this.add(key, m);
    if (collide) this.world.addBox(x, z, w, d, y0, y1, rot);
    if (this.ruin && wallLike && collide) this.ruinTops.push({ x, z, w, d, rot, top: y1 });
    return m;
  }

  /** Straight wall between two points. */
  wall(key: MatKey, x1: number, z1: number, x2: number, z2: number, y0: number, y1: number, thick = 0.8) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const rot = Math.atan2(x2 - x1, z2 - z1); // local z along the wall
    const was = this.ruin;
    this.ruin = true;
    this.block(key, (x1 + x2) / 2, (z1 + z2) / 2, thick, len, y0, y1, rot);
    this.ruin = was;
  }

  /** Triangular prism (gable or roof). Span along local x, ridge along local z. */
  prism(key: MatKey, x: number, z: number, span: number, height: number, length: number, baseY: number, rot: number) {
    const hs = span / 2;
    const hl = length / 2;
    const p = [
      -hs, 0, -hl, hs, 0, -hl, 0, height, -hl,
      -hs, 0, hl, hs, 0, hl, 0, height, hl,
    ];
    const idx = orientOutward(p, [0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3]);
    const uv = [0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1].map((v) => v * (Math.max(span, length) / 2.2));
    const vd = new VertexData();
    vd.positions = p;
    vd.indices = idx;
    vd.uvs = uv;
    const normals: number[] = [];
    VertexData.ComputeNormals(p, idx, normals);
    vd.normals = normals;
    const m = new Mesh('p' + this.n++, this.scene);
    vd.applyToMesh(m);
    m.convertToFlatShadedMesh();
    // planar UVs per face: slopes run along the ridge, gable ends face-on
    {
      const fp = m.getVerticesData('position')!;
      const fn = m.getVerticesData('normal')!;
      const uvs = new Float32Array((fp.length / 3) * 2);
      const tile = key === 'thatch' ? 1.6 : 1.9;
      for (let i = 0; i < fp.length / 3; i++) {
        const [px, py, pz] = [fp[i * 3], fp[i * 3 + 1], fp[i * 3 + 2]];
        if (Math.abs(fn[i * 3 + 2]) > 0.5) { uvs[i * 2] = px / tile; uvs[i * 2 + 1] = py / tile; }
        else { uvs[i * 2] = pz / tile; uvs[i * 2 + 1] = (Math.abs(px) + (height - py)) / tile; }
      }
      m.setVerticesData('uv', uvs);
    }
    this.paint(m, false);
    m.position.set(x, baseY, z);
    m.rotation.y = rot;
    this.add(key, m);
    return m;
  }

  rock(x: number, z: number, sx: number, sy: number, sz: number, y: number, rot = 0, collide = true) {
    const m = boulderMesh(this.scene, 'r' + this.n++, this.n * 7.3);
    this.paint(m, false, 1.05);
    m.scaling.set(sx, sy, sz);
    m.position.set(x, y, z);
    m.rotation.set(0.1 * Math.sin(x), rot, 0.1 * Math.cos(z));
    this.add('rock', m);
    if (collide) this.world.addBox(x, z, sx * 1.5, sz * 1.5, y - sy, y + sy * 0.85, rot);
    return m;
  }

  /** Rectangular Inca house (roofless ruin by default) with a doorway on the local +z side. */
  house(x: number, z: number, w: number, d: number, rot: number, floor: number, opts: { h?: number; roof?: boolean; gable?: boolean; key?: MatKey; door?: number } = {}) {
    const h = opts.h ?? 2.6;
    const t = 0.7;
    const key = opts.key ?? 'stone';
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const L = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
    const top = floor + h;
    const hw = w / 2;
    const hd = d / 2;
    const was = this.ruin;
    this.ruin = !opts.roof;
    // back wall
    let [px, pz] = L(0, -hd + t / 2);
    this.block(key, px, pz, w, t, floor - 0.6, top, rot);
    // side walls
    [px, pz] = L(-hw + t / 2, 0);
    this.block(key, px, pz, t, d - t * 2, floor - 0.6, top, rot);
    [px, pz] = L(hw - t / 2, 0);
    this.block(key, px, pz, t, d - t * 2, floor - 0.6, top, rot);
    // front wall with doorway
    const door = 1.15;
    const doorX = opts.door ?? 0;
    const leftW = hw + doorX - door / 2;
    const rightW = hw - doorX - door / 2;
    [px, pz] = L(-hw + leftW / 2, hd - t / 2);
    this.block(key, px, pz, leftW, t, floor - 0.6, top, rot);
    [px, pz] = L(hw - rightW / 2, hd - t / 2);
    this.block(key, px, pz, rightW, t, floor - 0.6, top, rot);
    this.ruin = was;
    [px, pz] = L(doorX, hd - t / 2);
    if (h > 2.3) this.block(key, px, pz, door + 0.2, t, floor + 2.15, top, rot, false);
    // gable end walls on the short sides
    const gh = d * 0.42;
    if (opts.gable || opts.roof) {
      [px, pz] = L(-hw + t / 2, 0);
      this.prism(key, px, pz, d, gh, t, top, rot + Math.PI / 2);
      [px, pz] = L(hw - t / 2, 0);
      this.prism(key, px, pz, d, gh, t, top, rot + Math.PI / 2);
    }
    if (opts.roof) {
      // thatch overhangs the walls
      this.prism('thatch', x, z, d + 1.3, gh + 0.55, w + 0.9, top - 0.5, rot + Math.PI / 2);
    }
  }

  /**
   * Flight of steps whose TOP edge is at (x,z); climbing direction is heading `rot`
   * (the steps extend backwards from the top edge), from y0 up to y1.
   */
  stairs(key: MatKey, x: number, z: number, width: number, y0: number, y1: number, rot: number, riseMax = 0.32, run = 0.34) {
    const n = Math.max(1, Math.ceil((y1 - y0) / riseMax));
    const rise = (y1 - y0) / n;
    const fx = Math.sin(rot);
    const fz = Math.cos(rot);
    for (let i = 1; i <= n; i++) {
      const len = (n - i + 1) * run; // each step reaches all the way to the top edge
      const mid = len / 2;
      this.block(key, x - fx * mid, z - fz * mid, width, len, y0 - 0.4, y0 + rise * i, rot, true, 1.1);
    }
  }

  finish(shadowCasters: Mesh[]) {
    const out: Mesh[] = [];
    for (const [key, meshes] of this.groups) {
      // merge in chunks to keep index buffers reasonable
      for (let i = 0; i < meshes.length; i += 400) {
        const merged = Mesh.MergeMeshes(meshes.slice(i, i + 400), true, true);
        if (!merged) continue;
        merged.name = `site-${key}-${i}`;
        merged.material = this.mats[key];
        merged.receiveShadows = true;
        merged.isPickable = false;
        merged.freezeWorldMatrix();
        out.push(merged);
        if (key !== 'grass') shadowCasters.push(merged);
      }
    }
    return out;
  }
}

/** Flip any triangle whose computed normal points towards the solid's centroid. */
function orientOutward(p: number[], idx: number[]): number[] {
  let cx = 0, cy = 0, cz = 0;
  const nv = p.length / 3;
  for (let i = 0; i < nv; i++) { cx += p[i * 3]; cy += p[i * 3 + 1]; cz += p[i * 3 + 2]; }
  cx /= nv; cy /= nv; cz /= nv;
  const out = idx.slice();
  for (let t = 0; t < out.length; t += 3) {
    const tri = [out[t], out[t + 1], out[t + 2]];
    const normals: number[] = new Array(p.length).fill(0);
    VertexData.ComputeNormals(p, tri, normals);
    const a = tri[0];
    const fx = (p[tri[0] * 3] + p[tri[1] * 3] + p[tri[2] * 3]) / 3 - cx;
    const fy = (p[tri[0] * 3 + 1] + p[tri[1] * 3 + 1] + p[tri[2] * 3 + 1]) / 3 - cy;
    const fz = (p[tri[0] * 3 + 2] + p[tri[1] * 3 + 2] + p[tri[2] * 3 + 2]) / 3 - cz;
    const dot = normals[a * 3] * fx + normals[a * 3 + 1] * fy + normals[a * 3 + 2] * fz;
    if (dot < 0) { out[t + 1] = tri[2]; out[t + 2] = tri[1]; }
  }
  return out;
}

/** Irregular, smooth granite boulder: displaced icosphere. */
function boulderMesh(scene: Scene, name: string, seed: number, subdivisions = 3): Mesh {
  const m = MeshBuilder.CreateIcoSphere(name, { radius: 1, subdivisions }, scene);
  const pos = m.getVerticesData('position')!;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    let k = 1 + fbm(x * 1.4 + seed, z * 1.4 + y * 1.1 - seed, 3) * 0.32;
    if (y < -0.35) k *= 0.75 + 0.25 * (1 + y); // flatter base
    pos[i] = x * k;
    pos[i + 1] = Math.max(y * k, -0.55);
    pos[i + 2] = z * k;
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, m.getIndices()!, normals);
  m.setVerticesData('position', pos);
  m.setVerticesData('normal', normals);
  return m;
}

export interface SiteResult {
  shadowCasters: Mesh[];
  clouds: Mesh[];
  grass: Mesh;
}

export function buildSite(scene: Scene, world: CollisionWorld, grid: TerrainGrid): SiteResult {
  const wood = new StandardMaterial('woodMat', scene);
  wood.diffuseColor = new Color3(0.4, 0.28, 0.16);
  const mats: Record<MatKey, StandardMaterial> = {
    stone: stoneMaterial(scene, 'stoneMat', 'wall_rough', new Color3(0.9, 0.9, 0.88)),
    fine: stoneMaterial(scene, 'fineStoneMat', 'wall_fine', new Color3(1.08, 1.06, 1.02)),
    grass: groundMaterial(scene, 'lawnMat', false),
    thatch: thatchMaterial(scene),
    rock: boulderMaterial(scene),
    wood,
  };
  const b = new Builder(scene, world, mats);
  const casters: Mesh[] = [];

  buildSunGate(b);
  buildAgriculturalTerraces(b);
  buildGuardhouse(b);
  buildUrbanCore(b);
  buildFlankTerraces(b);
  buildIntihuatana(b);

  b.finish(casters);

  const rubble = buildRubble(scene, b);
  casters.push(rubble);
  buildTrailPaving(scene, grid);
  buildTrees(scene, grid);
  const grass = buildGrass(scene, world, grid);
  buildScatterRocks(scene, grid, b.mats.rock);
  const clouds = buildClouds(scene);
  return { shadowCasters: casters, clouds, grass };
}

// ----------------------------------------------------------------------------

function buildSunGate(b: Builder) {
  // Inti Punku: a gateway on the ridge, with flanking terrace walls.
  const { x, z, y } = SUN_GATE;
  const dirX = TRAIL[2].x - TRAIL[0].x;
  const dirZ = TRAIL[2].z - TRAIL[0].z;
  const rot = Math.atan2(dirX, dirZ); // local +z along the trail (towards the city)
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const L = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  const floor = y - 0.1;

  // Tall jambs, slightly inward-leaning look approximated by stepped blocks
  for (const side of [-1, 1]) {
    let [px, pz] = L(side * 1.75, 0);
    b.block('fine', px, pz, 1.3, 1.8, floor - 1, floor + 3.6, rot);
    [px, pz] = L(side * 1.6, 0);
    b.block('fine', px, pz, 1.0, 1.6, floor + 3.6, floor + 4.3, rot);
    // flanking walls, two tiers stepping down the ridge
    for (let k = 0; k < 3; k++) {
      [px, pz] = L(side * (4.6 + k * 4.2), -k * 0.6);
      b.block('stone', px, pz, 4.4, 1.4, floor - 1.5 - k * 3, floor + 2.6 - k * 0.6, rot);
    }
    [px, pz] = L(side * 7, -4.5);
    b.block('stone', px, pz, 9, 1.0, floor - 2, floor + 1.4, rot);
    // small ruined rooms either side of the gate (the guard posts)
    [px, pz] = L(side * 6.5, -8.5);
    b.house(px, pz, 5, 4, rot + Math.PI, floor - 0.2, { h: 1.6 });
  }
  // Lintel
  const [lx, lz] = L(0, 0);
  b.block('fine', lx, lz, 4.6, 1.7, floor + 4.3, floor + 5.1, rot, false);
  // Threshold stones and a carved rock
  b.block('stone', lx, lz, 2.4, 2.2, floor - 0.6, floor + 0.12, rot, true, 1.2);
  const [rx, rz] = L(-3.5, 4.5);
  b.rock(rx, rz, 1.4, 0.9, 1.1, floor + 0.4, rot);
}

function buildAgriculturalTerraces(b: Builder) {
  for (let k = 0; k < AG.count; k++) {
    const zf = AG.zStart - AG.depth * k; // front (north) edge
    const zb = zf - AG.depth;
    const top = AG.rise * (k + 1);
    const bottom = AG.rise * k - 1.2;
    const x0 = AG.x0 + 2.2 * Math.sin(k * 1.7) + k * 0.4;
    const x1 = AG.x1 - 1.8 * Math.cos(k * 1.3) - k * 0.3;
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    // stone retaining wall (front face)
    b.block('stone', cx, zf - 0.45, w, 0.9, bottom, top, 0);
    // earth fill with grass top
    b.block('grass', cx, (zf - 0.9 + zb) / 2, w, zf - 0.9 - zb, bottom, top - 0.02, 0, true, 6);
    // staircase climbing this riser from the level below (sits on the lower terrace)
    b.stairs('stone', AG.stairX, zf + 0.02, 1.7, AG.rise * k, top, Math.PI);
  }
  // Two side staircases further along for variety (west side)
  for (let k = 0; k < AG.count; k += 3) {
    const zf = AG.zStart - AG.depth * k;
    b.stairs('stone', -24 + k * 0.4, zf + 0.02, 1.3, AG.rise * k, AG.rise * (k + 1), Math.PI);
  }
}

function buildGuardhouse(b: Builder) {
  const { x, z, y } = GUARDHOUSE;
  b.house(x, z, 7.5, 4.6, 0, y, { roof: true, h: 2.5 });
  // Funerary rock (carved stone) beside the hut
  b.rock(x + 10, z - 2.5, 2.2, 0.9, 1.4, y + 0.3, 0.4);
  b.block('fine', x + 10, z - 2.5, 1.2, 0.8, y + 0.8, y + 1.25, 0.4);
  // Viewpoint low wall on the north edge
  b.block('stone', x + 2, AG.zStart - AG.depth * AG.count - 0.2, 12, 0.6, y - 1, y + 0.7, 0);
}

function buildUrbanCore(b: Builder) {
  // --- Plaza edges: retaining walls to the west (upper) and east (lower) sectors
  b.block('stone', -20.7, 16, 1.8, 112, PLAZA_Y - 1.5, WEST_Y, 0);
  b.stairs('stone', -19.78, 2, 2, PLAZA_Y, WEST_Y, -Math.PI / 2); // steps rise towards -x
  b.stairs('stone', -19.78, 40, 2, PLAZA_Y, WEST_Y, -Math.PI / 2);
  b.block('stone', 21, 10, 2, 100, EAST_Y - 1.5, PLAZA_Y, 0);
  b.stairs('stone', 22.02, -6, 2, EAST_Y, PLAZA_Y, -Math.PI / 2);
  b.stairs('stone', 22.02, 30, 2, EAST_Y, PLAZA_Y, -Math.PI / 2);
  // north-south lower plaza step (two-level plaza)
  b.block('grass', 0, 30, 36, 30, PLAZA_Y - 1, PLAZA_Y + 0.6, 0, true, 6);
  b.block('stone', 0, 14.8, 36, 0.6, PLAZA_Y - 1, PLAZA_Y + 0.62, 0);
  // east sector edge wall above flank terraces
  b.block('stone', 49.3, 10, 1.4, 96, EAST_Y - 5, EAST_Y + 0.6, 0);
  b.block('stone', -49.3, 17, 1.4, 112, WEST_Y - 5, WEST_Y + 0.6, 0);

  // --- Temple of the Sun (Torreón): curved tower on a rock outcrop
  {
    const cx = -33;
    const cz = -12;
    const base = WEST_Y;
    b.rock(cx, cz, 5.5, 2.2, 5.0, base - 0.2, 0.3, false);
    b.block('stone', cx, cz, 11, 11, base - 1, base + 1.2, 0); // platform
    b.stairs('stone', cx + 5.52, cz, 2, base, base + 1.2, -Math.PI / 2);
    const r = 4.2;
    const segs = 14;
    for (let i = 0; i < segs; i++) {
      const a0 = -Math.PI * 0.62 + (i / segs) * Math.PI * 1.24;
      const a1 = -Math.PI * 0.62 + ((i + 1) / segs) * Math.PI * 1.24;
      // leave a doorway opening facing south-east
      if (i === 3) continue;
      const am = (a0 + a1) / 2;
      const px = cx + Math.cos(am) * r;
      const pz = cz + Math.sin(am) * r;
      const len = 2 * r * Math.sin((a1 - a0) / 2) + 0.25;
      b.block('fine', px, pz, 0.95, len, base + 1.2, base + 5.4, -am);
    }
    // straight back wall closing the D-shape
    const ax = cx + Math.cos(Math.PI * 0.62) * r;
    const az1 = cz + Math.sin(Math.PI * 0.62) * r;
    const az0 = cz - Math.sin(Math.PI * 0.62) * r;
    b.wall('fine', ax, az0, ax, az1, base + 1.2, base + 5.4, 0.95);
    // Royal residence beside it
    b.house(cx - 2, cz + 13, 9, 6, Math.PI / 2, base, { h: 2.8, gable: true, key: 'fine' });
  }

  // --- Sacred Plaza: Main Temple and Temple of the Three Windows
  {
    const base = WEST_Y;
    // Main Temple: three massive walls, open to the east
    b.wall('fine', -44, 26, -44, 38, base - 0.5, base + 5.2, 1.4);
    b.wall('fine', -43.3, 25.6, -36, 25.6, base - 0.5, base + 4.6, 1.2);
    b.wall('fine', -43.3, 38.4, -36, 38.4, base - 0.5, base + 4.6, 1.2);
    b.block('fine', -42.6, 32, 1.2, 3.6, base, base + 0.9, 0); // altar stone
    // Temple of the Three Windows: east-facing wall with three openings
    const wx = -23.6;
    const z0 = 26;
    const z1 = 38;
    b.wall('fine', wx, z0, wx, z1, base - 0.5, base + 1.8, 1.1); // sill course
    b.wall('fine', wx, z0, wx, z1, base + 3.3, base + 4.4, 1.1); // lintel course
    const piers = [z0, 29.2, 32.6, 36, z1];
    for (let i = 0; i < piers.length; i++) {
      const pz = piers[i];
      const wdt = i === 0 || i === piers.length - 1 ? 1.6 : 1.6;
      b.block('fine', wx, Math.min(z1 - 0.8, Math.max(z0 + 0.8, pz)), 1.1, wdt, base + 1.8, base + 3.3, 0);
    }
    b.wall('fine', -24, z0, -30, z0, base - 0.5, base + 4.4, 1.0);
    b.wall('fine', -24, z1, -30, z1, base - 0.5, base + 4.4, 1.0);
  }

  // --- Upper-sector houses
  b.house(-44, 6, 7, 5, Math.PI / 2, WEST_Y, { gable: true });
  b.house(-38, 46, 7, 5, 0, WEST_Y, { gable: true });
  b.house(-46, 46, 5.5, 5, 0, WEST_Y, {});
  // Quarry: scattered granite boulders
  const r = rng(77);
  for (let i = 0; i < 14; i++) {
    b.rock(-38 + r() * 14, 12 + r() * 9, 0.8 + r() * 1.6, 0.5 + r() * 0.9, 0.7 + r() * 1.4, WEST_Y + 0.2, r() * 3);
  }

  // --- Eastern residential sector: grid of house compounds
  const houses: Array<[number, number, number, boolean]> = [
    [30, 50, 0, false], [43, 50, 0, true],
    [30, 38, Math.PI, false], [43, 38, Math.PI, false],
    [30, 22, 0, true], [43, 22, 0, false],
    [30, 10, Math.PI, false], [43, 10, Math.PI, false],
    [30, -2, 0, false], [43, -4, 0, false],
    [43, -30, Math.PI, true],
  ];
  for (const [hx, hz, rot, roof] of houses) {
    b.house(hx, hz, 8, 5.2, rot, EAST_Y, { roof, gable: true, door: roof ? 0 : 1.2 });
  }
  // compound walls
  b.wall('stone', 25, 44, 48, 44, EAST_Y - 0.5, EAST_Y + 1.6, 0.6);
  b.wall('stone', 25, 16, 48, 16, EAST_Y - 0.5, EAST_Y + 1.6, 0.6);

  // --- Temple of the Condor: a rock outcrop shaped like spread wings, head stone on the ground
  {
    const cx = 34;
    const cz = -20;
    b.rock(cx - 3, cz - 2.5, 3.2, 3.4, 1.4, EAST_Y + 1.6, 0.55);
    b.rock(cx + 3, cz - 2.5, 3.2, 3.4, 1.4, EAST_Y + 1.6, -0.55);
    b.block('fine', cx, cz + 1.8, 2.6, 2.0, EAST_Y - 0.3, EAST_Y + 0.25, 0); // the head/collar stone
    b.wall('stone', cx - 6, cz - 6, cx + 6, cz - 6, EAST_Y - 0.5, EAST_Y + 2.4, 0.8);
  }

  // --- Sacred Rock at the north end with two wayronas (three-walled halls)
  {
    b.block('rock', 0, 80, 8, 1.2, PLAZA_Y - 1, PLAZA_Y + 3.6, 0.15);
    b.block('stone', 0, 79.3, 10, 2.4, PLAZA_Y - 1, PLAZA_Y + 0.5, 0.15);
    b.house(-12, 76, 9, 5, Math.PI, PLAZA_Y, { roof: true, gable: true });
    b.house(12, 76, 9, 5, Math.PI, PLAZA_Y, { roof: true, gable: true });
  }
}

function buildFlankTerraces(b: Builder) {
  for (const side of [1, -1]) {
    const startY = side > 0 ? EAST_Y : WEST_Y;
    for (let i = 1; i <= FLANK.rows; i++) {
      const top = startY - AG.rise * i;
      const xIn = side * (50 + FLANK.width * (i - 1));
      const xOut = side * (50 + FLANK.width * i);
      const cx = (xIn + xOut) / 2;
      const z0 = -36 + i * 1.5;
      const z1 = (side > 0 ? 56 : 58) - i * 1.5;
      b.block('grass', cx - side * 0.4, (z0 + z1) / 2, FLANK.width - 0.8, z1 - z0, top - 6, top - 0.02, 0, true, 6);
      b.block('stone', xOut - side * 0.4, (z0 + z1) / 2, 0.8, z1 - z0, top - 6, top, 0);
    }
  }
}

function buildIntihuatana(b: Builder) {
  // Stepped hill with the carved "hitching post of the sun" on top.
  const cx = -32;
  const cz = 62;
  const tiers = [
    { hx: 10.5, hz: 10 },
    { hx: 7.5, hz: 7 },
    { hx: 4.5, hz: 4 },
  ];
  let y = WEST_Y;
  for (const t of tiers) {
    const top = y + AG.rise;
    b.block('stone', cx, cz, t.hx * 2, t.hz * 2, y - 1.5, top - 0.15, 0);
    b.block('grass', cx, cz, t.hx * 2 - 1.2, t.hz * 2 - 1.2, top - 0.3, top, 0, true, 6);
    // stairs up the south face, resting on the tier below
    b.stairs('stone', cx, cz - t.hz - 0.02, 1.8, y, top, 0);
    y = top;
  }
  // The Intihuatana stone
  b.block('fine', cx, cz, 2.4, 1.6, y - 0.1, y + 0.7, 0.3);
  b.block('fine', cx + 0.2, cz, 0.6, 0.6, y + 0.7, y + 2.0, 0.3);
}

// ----------------------------------------------------------------------------
// Decorative (non-colliding) layers
// ----------------------------------------------------------------------------

function buildRubble(scene: Scene, b: Builder): Mesh {
  // Irregular capstones and loose blocks along the tops of roofless walls, plus fallen stones.
  const stone = MeshBuilder.CreateBox('rubble', { size: 1, wrap: true }, scene);
  stone.material = b.mats.stone;
  stone.receiveShadows = true;
  stone.isPickable = false;
  const r = rng(31);
  const matrices: number[] = [];
  const tmp = Matrix.Identity();
  const push = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, tilt: number) => {
    Matrix.ComposeToRef(new Vector3(sx, sy, sz), Quaternion.FromEulerAngles(tilt * (r() - 0.5), yaw, tilt * (r() - 0.5)), new Vector3(x, y, z), tmp);
    matrices.push(...tmp.toArray());
  };
  for (const t of b.ruinTops) {
    const alongZ = t.d >= t.w;
    const len = alongZ ? t.d : t.w;
    const thick = Math.min(t.w, t.d);
    const c = Math.cos(t.rot), s = Math.sin(t.rot);
    let u = -len / 2 + 0.2;
    while (u < len / 2 - 0.2) {
      const sl = 0.35 + r() * 0.45;
      if (r() < 0.72) {
        const lx = alongZ ? (r() - 0.5) * thick * 0.25 : u + sl / 2;
        const lz = alongZ ? u + sl / 2 : (r() - 0.5) * thick * 0.25;
        const sy = 0.18 + r() * 0.3;
        push(t.x + lx * c + lz * s, t.top + sy / 2 - 0.06, t.z - lx * s + lz * c,
          alongZ ? thick * (0.55 + r() * 0.3) : sl, sy, alongZ ? sl : thick * (0.55 + r() * 0.3), t.rot, 0.15);
      }
      u += sl + 0.04;
    }
    // a few fallen blocks at the foot of the wall
    for (let k = 0; k < len / 3; k++) {
      if (r() > 0.45) continue;
      const side = r() < 0.5 ? -1 : 1;
      const lu = (r() - 0.5) * len;
      const lo = side * (thick / 2 + 0.3 + r() * 0.8);
      const lx = alongZ ? lo : lu;
      const lz = alongZ ? lu : lo;
      const sz = 0.25 + r() * 0.3;
      const wx = t.x + lx * c + lz * s;
      const wz = t.z - lx * s + lz * c;
      const gy = b.groundUnder(wx, wz, t.top - 1);
      push(wx, gy + sz * 0.35, wz, sz * 1.3, sz, sz, r() * 6.28, 0.5);
    }
  }
  stone.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16, true);
  stone.freezeWorldMatrix();
  return stone;
}

function buildTrailPaving(scene: Scene, grid: TerrainGrid) {
  // Irregular polygonal flagstones (7-sided slabs) along the Inca Trail.
  const slab = MeshBuilder.CreateCylinder('trailSlab', { height: 0.22, diameter: 1, tessellation: 7 }, scene);
  const m = new StandardMaterial('slabMat', scene);
  m.diffuseTexture = tex(scene, 'boulder_diff');
  m.bumpTexture = tex(scene, 'boulder_nor');
  m.diffuseColor = new Color3(1.05, 1.03, 0.98);
  m.specularColor = new Color3(0.04, 0.04, 0.04);
  slab.material = m;
  slab.receiveShadows = true;
  slab.isPickable = false;
  const r = rng(4);
  const matrices: number[] = [];
  const tmp = Matrix.Identity();
  for (let i = 0; i < TRAIL.length - 1; i++) {
    const a = TRAIL[i];
    const c = TRAIL[i + 1];
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    const rot = Math.atan2(c.x - a.x, c.z - a.z);
    const steps = Math.floor(len / 0.7);
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      for (const lane of [-0.75, 0, 0.72]) {
        if (r() < 0.14) continue; // missing stones
        const off = lane + (r() - 0.5) * 0.25;
        const px = a.x + (c.x - a.x) * t + Math.cos(rot) * off;
        const pz = a.z + (c.z - a.z) * t - Math.sin(rot) * off;
        const py = grid.heightAt(px, pz) - 0.08;
        const q = Quaternion.FromEulerAngles((r() - 0.5) * 0.06, r() * 6.28, (r() - 0.5) * 0.06);
        const sx = 0.62 + r() * 0.35;
        Matrix.ComposeToRef(new Vector3(sx, 1, sx * (0.7 + r() * 0.4)), q, new Vector3(px, py, pz), tmp);
        matrices.push(...tmp.toArray());
      }
    }
  }
  slab.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16, true);
  slab.freezeWorldMatrix();
}

/** Cloud-forest tree: tapered trunk with branches and an alpha-card crown with soft radial normals. */
function makeTreeMeshes(scene: Scene, cardCount: number, suffix: string): { trunk: Mesh; crown: Mesh } {
  const parts: Mesh[] = [];
  const trunk0 = MeshBuilder.CreateCylinder('t0', { height: 5.2, diameterTop: 0.2, diameterBottom: 0.5, tessellation: 7 }, scene);
  trunk0.position.y = 2.6;
  parts.push(trunk0);
  for (let i = 0; i < 4; i++) {
    const br = MeshBuilder.CreateCylinder('br' + i, { height: 2.2, diameterTop: 0.06, diameterBottom: 0.16, tessellation: 5 }, scene);
    const a = i * 1.7;
    br.position.set(Math.cos(a) * 0.55, 3.6 + i * 0.35, Math.sin(a) * 0.55);
    br.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    parts.push(br);
  }
  const trunk = Mesh.MergeMeshes(parts, true)!;
  trunk.name = 'treeTrunk' + suffix;
  const bark = new StandardMaterial('barkMat', scene);
  bark.diffuseTexture = tex(scene, 'boulder_diff');
  bark.diffuseColor = new Color3(0.42, 0.33, 0.24);
  bark.specularColor = Color3.Black();
  trunk.material = bark;

  const cards: Mesh[] = [];
  const r = rng(8);
  const centre = new Vector3(0, 5.6, 0);
  const big = cardCount < 8 ? 1.35 : 1;
  for (let i = 0; i < cardCount; i++) {
    const p = MeshBuilder.CreatePlane('c' + i, { size: (2.4 + r() * 1.4) * big }, scene);
    const a = r() * Math.PI * 2;
    const e = (r() - 0.35) * 1.4;
    p.position.set(Math.cos(a) * 1.4 * Math.cos(e), centre.y + Math.sin(e) * 1.2, Math.sin(a) * 1.4 * Math.cos(e));
    p.rotation.set((r() - 0.5) * 1.2, r() * Math.PI, (r() - 0.5) * 0.8);
    p.bakeCurrentTransformIntoVertices();
    cards.push(p);
  }
  const crown = Mesh.MergeMeshes(cards, true)!;
  crown.name = 'treeCrown' + suffix;
  // radial normals give soft, volumetric foliage lighting
  const pos = crown.getVerticesData('position')!;
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const v = new Vector3(pos[i] - centre.x, (pos[i + 1] - centre.y) * 0.8 + 0.6, pos[i + 2] - centre.z).normalize();
    nrm[i] = v.x; nrm[i + 1] = v.y; nrm[i + 2] = v.z;
  }
  crown.setVerticesData('normal', nrm);
  crown.material = foliageMaterial(scene, 'leafMat' + suffix, leafClusterTexture(scene), 0.018);
  return { trunk, crown };
}

function buildTrees(scene: Scene, grid: TerrainGrid) {
  // Detailed crowns near the explorable area, lighter 5-card crowns further away.
  const nearSet = { ...makeTreeMeshes(scene, 10, ''), matrices: [] as number[], colours: [] as number[] };
  const farSet = { ...makeTreeMeshes(scene, 5, 'Far'), matrices: [] as number[], colours: [] as number[] };
  const r = rng(99);
  const tmp = Matrix.Identity();
  const inPad = (x: number, z: number) =>
    PADS.some((p) => x > p.x0 - 4 && x < p.x1 + 4 && z > p.z0 - 4 && z < p.z1 + 4);
  let placed = 0;
  for (let i = 0; i < 16000 && placed < 3000; i++) {
    // denser near the site, sparser further out
    const near = r() < 0.55;
    const x = near ? -110 + r() * 220 : DETAIL.x0 + r() * (DETAIL.x1 - DETAIL.x0);
    const z = near ? -170 + r() * 300 : DETAIL.z0 + r() * (DETAIL.z1 - DETAIL.z0);
    if (inPad(x, z)) continue;
    if (trailInfo(x, z).w > 0.02) continue;
    const y = grid.heightAt(x, z);
    if (y > 175 || y < -238) continue;
    const slope = grid.slopeAt(x, z);
    if (slope > 2.6 || slope < 0.25) continue;
    // clumping
    if (fbm(x / 30, z / 30, 2) < -0.15 && r() < 0.7) continue;
    const s = 0.75 + r() * 0.75;
    Matrix.ComposeToRef(new Vector3(s, s * (0.85 + r() * 0.5), s), Quaternion.FromEulerAngles(0, r() * 6.28, 0), new Vector3(x, y - 0.3, z), tmp);
    const set = Math.abs(x) < 120 && z > -200 && z < 160 ? nearSet : farSet;
    set.matrices.push(...tmp.toArray());
    const g = 0.62 + r() * 0.32;
    set.colours.push(g * (0.82 + r() * 0.2), g, g * (0.75 + r() * 0.2), 1);
    placed++;
  }
  for (const set of [nearSet, farSet]) {
    const buf = new Float32Array(set.matrices);
    for (const m of [set.trunk, set.crown]) {
      m.thinInstanceSetBuffer('matrix', buf, 16, true);
      m.isPickable = false;
      m.freezeWorldMatrix();
    }
    set.crown.thinInstanceSetBuffer('color', new Float32Array(set.colours), 4, true);
  }
}

function buildGrass(scene: Scene, world: CollisionWorld, grid: TerrainGrid): Mesh {
  // Andean bunch grass (ichu) tufts: three crossed alpha cards, lit like the ground.
  const quads: Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const p = MeshBuilder.CreatePlane('g' + i, { width: 0.7, height: 0.5 }, scene);
    p.position.y = 0.23;
    p.rotation.y = (i * Math.PI) / 3;
    p.bakeCurrentTransformIntoVertices();
    quads.push(p);
  }
  const tuft = Mesh.MergeMeshes(quads, true)!;
  tuft.name = 'grassTufts';
  const n = tuft.getTotalVertices();
  const up = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) up[i * 3 + 1] = 1;
  tuft.setVerticesData('normal', up);
  tuft.material = foliageMaterial(scene, 'grassTuftMat', grassBladeTexture(scene), 0.09);
  tuft.isPickable = false;

  const r = rng(55);
  const matrices: number[] = [];
  const colours: number[] = [];
  const tmp = Matrix.Identity();
  const onLawn = (x: number, z: number) => PADS.some((p) => x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1);
  let placed = 0;
  for (let i = 0; i < 60000 && placed < 6000; i++) {
    let x: number, z: number;
    if (r() < 0.85) {
      x = -95 + r() * 190;
      z = -135 + r() * 245;
    } else {
      // along the Inca Trail
      const seg = Math.floor(r() * (TRAIL.length - 1));
      const a = TRAIL[seg], c = TRAIL[seg + 1];
      const t = r();
      const off = (r() - 0.5) * 16;
      const rot = Math.atan2(c.x - a.x, c.z - a.z);
      x = a.x + (c.x - a.x) * t + Math.cos(rot) * off;
      z = a.z + (c.z - a.z) * t - Math.sin(rot) * off;
    }
    const tr = trailInfo(x, z);
    if (tr.core > 0.3) continue;
    const terr = grid.heightAt(x, z);
    const g = world.groundAt(x, z, terr + 3, 0).y;
    if (world.solidAt(x, g + 0.3, z, 0.12)) continue; // inside a wall
    const nearWall = world.solidAt(x, g + 0.3, z, 0.9);
    const slope = grid.slopeAt(x, z);
    if (slope > 1.6) continue;
    const lawn = onLawn(x, z) && !nearWall;
    if (lawn && r() > 0.12) continue;
    if (!nearWall && !lawn && r() > 0.6) continue;
    const s = (nearWall ? 0.9 : 0.7) + r() * 0.6;
    Matrix.ComposeToRef(new Vector3(s, s * (0.7 + r() * 0.6), s), Quaternion.FromEulerAngles(0, r() * 6.28, 0), new Vector3(x, g - 0.03, z), tmp);
    matrices.push(...tmp.toArray());
    const dry = r();
    const k = 0.8 + r() * 0.3;
    // olive-green to straw (ichu)
    colours.push(k * (0.78 + dry * 0.42), k * (0.86 + dry * 0.06), k * (0.55 - dry * 0.15), 1);
    placed++;
  }
  tuft.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16, true);
  tuft.thinInstanceSetBuffer('color', new Float32Array(colours), 4, true);
  tuft.freezeWorldMatrix();
  return tuft;
}

function buildScatterRocks(scene: Scene, grid: TerrainGrid, mat: StandardMaterial) {
  const rock = boulderMesh(scene, 'scatterRock', 3.3, 2);
  rock.material = mat;
  rock.isPickable = false;
  rock.receiveShadows = true;
  const r = rng(71);
  const matrices: number[] = [];
  const tmp = Matrix.Identity();
  const inPad = (x: number, z: number) => PADS.some((p) => x > p.x0 - 1 && x < p.x1 + 1 && z > p.z0 - 1 && z < p.z1 + 1);
  let placed = 0;
  for (let i = 0; i < 12000 && placed < 700; i++) {
    const x = -150 + r() * 330;
    const z = -280 + r() * 450;
    if (inPad(x, z) || trailInfo(x, z).core > 0.1) continue;
    const slope = grid.slopeAt(x, z);
    if (slope < 0.3 && r() < 0.8) continue;
    const s = 0.2 + Math.pow(r(), 3) * 1.6;
    Matrix.ComposeToRef(new Vector3(s * (0.8 + r() * 0.6), s * (0.5 + r() * 0.4), s), Quaternion.FromEulerAngles((r() - 0.5) * 0.4, r() * 6.28, (r() - 0.5) * 0.4), new Vector3(x, grid.heightAt(x, z) + s * 0.1, z), tmp);
    matrices.push(...tmp.toArray());
    placed++;
  }
  rock.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16, true);
  rock.freezeWorldMatrix();
}

function buildClouds(scene: Scene): Mesh[] {
  const tex = cloudTexture(scene);
  const m = new StandardMaterial('cloudMat', scene);
  m.diffuseTexture = tex;
  m.opacityTexture = tex;
  m.emissiveColor = new Color3(0.92, 0.93, 0.95);
  m.disableLighting = true;
  m.backFaceCulling = false;
  m.fogEnabled = true;
  m.disableDepthWrite = true;
  const r = rng(13);
  const clouds: Mesh[] = [];
  const add = (x: number, y: number, z: number, w: number, h: number) => {
    const p = MeshBuilder.CreatePlane('cloud' + clouds.length, { size: 1 }, scene);
    p.scaling.set(w, h, 1);
    p.position.set(x, y, z);
    p.billboardMode = Mesh.BILLBOARDMODE_Y;
    p.material = m;
    p.isPickable = false;
    clouds.push(p);
  };
  // drifting cloud banks in the gorge, below and around the city
  for (let i = 0; i < 30; i++) {
    const s = 70 + r() * 130;
    const a = r() * Math.PI * 2;
    const d = 150 + r() * 420;
    add(Math.cos(a) * d, -170 + r() * 150, 20 + Math.sin(a) * d, s * 1.8, s * 0.55);
  }
  // wisps clinging to Huayna Picchu and Machu Picchu Mountain
  for (let i = 0; i < 6; i++) add(-15 + (r() - 0.5) * 110, 40 + r() * 90, 215 + (r() - 0.5) * 80, 60 + r() * 50, 18 + r() * 14);
  for (let i = 0; i < 5; i++) add(-40 + (r() - 0.5) * 160, 120 + r() * 120, -330 + (r() - 0.5) * 120, 70 + r() * 60, 20 + r() * 16);
  return clouds;
}
