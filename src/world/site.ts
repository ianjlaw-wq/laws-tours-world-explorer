import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { CollisionWorld } from './colliders';
import { TerrainGrid, trailInfo, DETAIL } from './terrain';
import { rng } from './noise';
import {
  AG, EAST_Y, FLANK, GUARDHOUSE, PADS, PLAZA_Y, SUN_GATE, TRAIL, WEST_Y,
} from './layout';
import { cloudTexture, groundDetailTexture, stoneTexture, thatchTexture } from './textures';

type MatKey = 'stone' | 'fine' | 'grass' | 'thatch' | 'rock' | 'wood';

/** Collects boxes per material, registers colliders, then merges into few draw calls. */
class Builder {
  private groups = new Map<MatKey, Mesh[]>();
  private n = 0;
  constructor(private scene: Scene, private world: CollisionWorld, private mats: Record<MatKey, StandardMaterial>) {}

  private add(key: MatKey, m: Mesh) {
    let g = this.groups.get(key);
    if (!g) this.groups.set(key, (g = []));
    g.push(m);
  }

  /** Axis box centred at (x,z) with local width w (x) and depth d (z), from y0 to y1, yawed by rot. */
  block(key: MatKey, x: number, z: number, w: number, d: number, y0: number, y1: number, rot = 0, collide = true, tile = 2.2) {
    const h = y1 - y0;
    const fu = (a: number, b: number) => new Vector4(0, 0, a / tile, b / tile);
    const m = MeshBuilder.CreateBox('b' + this.n++, {
      width: w, height: h, depth: d, wrap: true,
      faceUV: [fu(w, h), fu(w, h), fu(d, h), fu(d, h), fu(w, d), fu(w, d)],
    }, this.scene);
    m.position.set(x, y0 + h / 2, z);
    m.rotation.y = rot;
    this.add(key, m);
    if (collide) this.world.addBox(x, z, w, d, y0, y1, rot);
    return m;
  }

  /** Straight wall between two points. */
  wall(key: MatKey, x1: number, z1: number, x2: number, z2: number, y0: number, y1: number, thick = 0.8) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const rot = Math.atan2(x2 - x1, z2 - z1); // local z along the wall
    this.block(key, (x1 + x2) / 2, (z1 + z2) / 2, thick, len, y0, y1, rot);
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
    m.position.set(x, baseY, z);
    m.rotation.y = rot;
    this.add(key, m);
    return m;
  }

  rock(x: number, z: number, sx: number, sy: number, sz: number, y: number, rot = 0, collide = true) {
    const m = MeshBuilder.CreateIcoSphere('r' + this.n++, { radius: 1, subdivisions: 1, flat: true }, this.scene);
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
      this.block(key, x - fx * mid, z - fz * mid, width, len, y0 - 0.4, y0 + rise * i, rot, true, 1.2);
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

function mat(scene: Scene, name: string, colour: Color3, tex?: Texture, spec = 0.04): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = colour;
  if (tex) m.diffuseTexture = tex;
  m.specularColor = new Color3(spec, spec, spec);
  return m;
}

export interface SiteResult {
  shadowCasters: Mesh[];
  clouds: Mesh[];
}

export function buildSite(scene: Scene, world: CollisionWorld, grid: TerrainGrid): SiteResult {
  const stoneTex = stoneTexture(scene, 3);
  const fineTex = stoneTexture(scene, 9, true);
  const detail = groundDetailTexture(scene);
  const mats: Record<MatKey, StandardMaterial> = {
    stone: mat(scene, 'stoneMat', new Color3(1.0, 0.98, 0.93), stoneTex),
    fine: mat(scene, 'fineStoneMat', new Color3(0.95, 0.92, 0.86), fineTex, 0.08),
    grass: mat(scene, 'grassMat', new Color3(0.34, 0.47, 0.2), detail),
    thatch: mat(scene, 'thatchMat', new Color3(0.95, 0.9, 0.8), thatchTexture(scene)),
    rock: mat(scene, 'rockMat', new Color3(0.55, 0.53, 0.5), stoneTex),
    wood: mat(scene, 'woodMat', new Color3(0.4, 0.28, 0.16)),
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

  buildTrailPaving(scene, grid);
  buildTrees(scene, grid);
  const clouds = buildClouds(scene);
  return { shadowCasters: casters, clouds };
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

function buildTrailPaving(scene: Scene, grid: TerrainGrid) {
  const slab = MeshBuilder.CreateBox('trailSlab', { width: 0.95, height: 0.22, depth: 0.75 }, scene);
  const m = mat(scene, 'slabMat', new Color3(0.66, 0.63, 0.58), stoneTexture(scene, 41, true));
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
    const steps = Math.floor(len / 0.85);
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      for (const lane of [-0.55, 0.5]) {
        if (r() < 0.12) continue; // missing stones
        const px = a.x + (c.x - a.x) * t + Math.cos(rot) * (lane + (r() - 0.5) * 0.2);
        const pz = a.z + (c.z - a.z) * t - Math.sin(rot) * (lane + (r() - 0.5) * 0.2);
        const py = grid.heightAt(px, pz) - 0.07;
        const q = Quaternion.FromEulerAngles((r() - 0.5) * 0.06, rot + (r() - 0.5) * 0.35, (r() - 0.5) * 0.06);
        const s = 0.75 + r() * 0.4;
        Matrix.ComposeToRef(new Vector3(s, 1, s), q, new Vector3(px, py, pz), tmp);
        matrices.push(...tmp.toArray());
      }
    }
  }
  slab.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16, true);
  slab.freezeWorldMatrix();
}

function buildTrees(scene: Scene, grid: TerrainGrid) {
  // Low-poly cloud-forest tree built from two meshes with vertex colours.
  const trunk = MeshBuilder.CreateCylinder('trunk', { height: 3, diameterTop: 0.25, diameterBottom: 0.45, tessellation: 5 }, scene);
  trunk.position.y = 1.5;
  const crown = MeshBuilder.CreateIcoSphere('crown', { radius: 2.2, subdivisions: 1, flat: true }, scene);
  crown.scaling.set(1, 1.15, 1);
  crown.position.y = 4.2;
  const crown2 = MeshBuilder.CreateIcoSphere('crown2', { radius: 1.5, subdivisions: 1, flat: true }, scene);
  crown2.position.set(0.8, 5.6, 0.3);
  const paint = (m: Mesh, c: Color4) => {
    const n = m.getTotalVertices();
    const cols = new Array(n * 4);
    for (let i = 0; i < n; i++) { cols[i * 4] = c.r; cols[i * 4 + 1] = c.g; cols[i * 4 + 2] = c.b; cols[i * 4 + 3] = 1; }
    m.setVerticesData('color', cols);
  };
  paint(trunk, new Color4(0.32, 0.22, 0.14, 1));
  paint(crown, new Color4(0.16, 0.33, 0.12, 1));
  paint(crown2, new Color4(0.2, 0.38, 0.14, 1));
  const tree = Mesh.MergeMeshes([trunk, crown, crown2], true)!;
  tree.name = 'tree';
  const tm = new StandardMaterial('treeMat', scene);
  tm.specularColor = Color3.Black();
  tree.material = tm;
  tree.isPickable = false;

  const r = rng(99);
  const matrices: number[] = [];
  const tmp = Matrix.Identity();
  const inPad = (x: number, z: number) =>
    PADS.some((p) => x > p.x0 - 4 && x < p.x1 + 4 && z > p.z0 - 4 && z < p.z1 + 4);
  let placed = 0;
  for (let i = 0; i < 9000 && placed < 2200; i++) {
    const x = DETAIL.x0 + r() * (DETAIL.x1 - DETAIL.x0);
    const z = DETAIL.z0 + r() * (DETAIL.z1 - DETAIL.z0);
    if (inPad(x, z)) continue;
    if (trailInfo(x, z).w > 0.02) continue;
    const y = grid.heightAt(x, z);
    if (y > 150 || y < -235) continue;
    const slope = grid.slopeAt(x, z);
    if (slope > 2.3) continue;
    const s = 0.8 + r() * 0.9;
    Matrix.ComposeToRef(new Vector3(s, s * (0.9 + r() * 0.4), s), Quaternion.FromEulerAngles(0, r() * 6.28, 0), new Vector3(x, y - 0.3, z), tmp);
    matrices.push(...tmp.toArray());
    placed++;
  }
  tree.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16, true);
  tree.freezeWorldMatrix();
}

function buildClouds(scene: Scene): Mesh[] {
  const tex = cloudTexture(scene);
  const m = new StandardMaterial('cloudMat', scene);
  m.diffuseTexture = tex;
  m.opacityTexture = tex;
  m.emissiveColor = new Color3(0.85, 0.87, 0.9);
  m.disableLighting = true;
  m.backFaceCulling = false;
  m.fogEnabled = true;
  const r = rng(13);
  const clouds: Mesh[] = [];
  for (let i = 0; i < 26; i++) {
    const p = MeshBuilder.CreatePlane('cloud' + i, { size: 1 }, scene);
    const s = 60 + r() * 110;
    p.scaling.set(s * 1.6, s * 0.6, 1);
    const a = r() * Math.PI * 2;
    const d = 140 + r() * 360;
    p.position.set(Math.cos(a) * d, -150 + r() * 160, 20 + Math.sin(a) * d);
    p.billboardMode = Mesh.BILLBOARDMODE_Y;
    p.material = m;
    p.isPickable = false;
    clouds.push(p);
  }
  return clouds;
}
