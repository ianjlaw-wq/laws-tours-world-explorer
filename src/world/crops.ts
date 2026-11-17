// Low-poly, vertex-coloured crop models for the 15th-century terraces. Each model is one small mesh
// drawn many times with thin instances (one draw call per model).

import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { rng } from './noise';

type RGB = [number, number, number];

function colour(m: Mesh, c: RGB | ((y: number, i: number) => RGB)) {
  const pos = m.getVerticesData('position')!;
  const n = pos.length / 3;
  const cols = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = typeof c === 'function' ? c(pos[i * 3 + 1], i) : c;
    cols[i * 4] = v[0]; cols[i * 4 + 1] = v[1]; cols[i * 4 + 2] = v[2]; cols[i * 4 + 3] = 1;
  }
  m.setVerticesData('color', cols);
  return m;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** One arching, tapering maize leaf as a strip of quads. */
function leaf(scene: Scene, h: number, az: number, len: number, width: number, droop: number, tint: RGB, tip: RGB): Mesh {
  const S = 4;
  const dx = Math.sin(az), dz = Math.cos(az);
  const sx = Math.cos(az), sz = -Math.sin(az);
  const p: number[] = [];
  const c: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= S; j++) {
    const t = j / S;
    const r = len * t * 0.88;
    const y = h + len * (0.62 * t - droop * t * t);
    // broad strap-shaped blade: narrow at the sheath, widest a third of the way out, pointed tip
    const w = width * Math.pow(1 - t, 0.6) * (0.45 + 0.55 * Math.min(1, t * 3)) * 0.5;
    const col = mix(tint, tip, t * t);
    // slight V-fold along the midrib
    p.push(dx * r - sx * w, y - w * 0.25, dz * r - sz * w);
    p.push(dx * r + sx * w, y - w * 0.25, dz * r + sz * w);
    c.push(...col, 1, ...col, 1);
    if (j < S) {
      const a = j * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const vd = new VertexData();
  vd.positions = p;
  vd.indices = idx;
  vd.colors = c;
  vd.uvs = new Array((p.length / 3) * 2).fill(0);
  const normals: number[] = [];
  VertexData.ComputeNormals(p, idx, normals);
  vd.normals = normals;
  const m = new Mesh('leaf', scene);
  vd.applyToMesh(m);
  return m;
}

/**
 * Maize plant (~1.9 m): tapered stalk, seven alternate broad arching leaves, tassel and one ear.
 * `ripe` = the ear's husk is pulled back, showing golden kernels.
 */
export function maizeMesh(scene: Scene, name: string, ripe: boolean): Mesh {
  const r = rng(ripe ? 91 : 17);
  const parts: Mesh[] = [];
  const stalk = MeshBuilder.CreateCylinder('stalk', { height: 1.78, diameterTop: 0.02, diameterBottom: 0.045, tessellation: 5, cap: Mesh.NO_CAP }, scene);
  stalk.position.y = 0.89;
  stalk.bakeCurrentTransformIntoVertices();
  parts.push(colour(stalk, (y) => mix([0.36, 0.42, 0.18], [0.5, 0.55, 0.26], y / 1.8)));

  const N = 7;
  for (let i = 0; i < N; i++) {
    const h = 0.28 + i * 0.2;
    const az = i * Math.PI + (r() - 0.5) * 0.7; // alternate sides, roughly in one plane
    const len = 0.58 + 0.34 * Math.sin(Math.PI * (i + 0.6) / N);
    const droop = (0.95 - i * 0.07) * (0.85 + r() * 0.3);
    // lower leaves dry and yellow first; upper ones a deep, slightly blue-green
    const base: RGB = i === 0 ? [0.52, 0.48, 0.25] : [0.27 + r() * 0.04, 0.4 + r() * 0.04, 0.16];
    const tip: RGB = i <= 1 ? [0.62, 0.55, 0.3] : [0.4, 0.47, 0.2];
    parts.push(leaf(scene, h, az, len, 0.19, droop, base, tip));
  }
  // tassel: three thin strands
  for (let k = 0; k < 3; k++) {
    const s = MeshBuilder.CreateCylinder('tassel', { height: 0.3, diameterTop: 0, diameterBottom: 0.016, tessellation: 3, cap: Mesh.NO_CAP }, scene);
    s.position.y = 0.13;
    s.bakeCurrentTransformIntoVertices();
    s.rotation.set(0.35 * Math.cos(k * 2.1), 0, 0.35 * Math.sin(k * 2.1));
    s.position.y = 1.76;
    s.bakeCurrentTransformIntoVertices();
    parts.push(colour(s, [0.74, 0.63, 0.36]));
  }
  // ear, angled out from the stalk
  const ear = MeshBuilder.CreateCylinder('ear', { height: 0.22, diameterTop: 0.03, diameterBottom: 0.06, tessellation: 6 }, scene);
  ear.position.y = 0.11;
  ear.bakeCurrentTransformIntoVertices();
  ear.rotation.set(0.45, 0.8, 0);
  ear.position.set(0.03, 0.82, 0.02);
  ear.bakeCurrentTransformIntoVertices();
  parts.push(colour(ear, ripe ? [0.95, 0.77, 0.26] : [0.47, 0.53, 0.24]));
  if (ripe) {
    // peeled-back husk leaves and silk
    for (const a of [-0.9, 0.9]) {
      const hsk = leaf(scene, 0.86, 0.8 + a, 0.2, 0.07, 1.6, [0.75, 0.7, 0.45], [0.82, 0.76, 0.5]);
      hsk.position.set(0.03, 0, 0.02);
      hsk.bakeCurrentTransformIntoVertices();
      parts.push(hsk);
    }
  }
  const m = Mesh.MergeMeshes(parts, true, true)!;
  m.name = name;
  m.isPickable = false;
  return m;
}

/** Low, leafy potato plant (a mound of foliage with a few flowers). */
export function potatoMesh(scene: Scene, name: string): Mesh {
  const r = rng(5);
  const parts: Mesh[] = [];
  for (let k = 0; k < 3; k++) {
    const s = MeshBuilder.CreateSphere('pot', { diameter: 0.42, segments: 3 }, scene);
    s.scaling.set(1 + r() * 0.3, 0.55 + r() * 0.2, 1 + r() * 0.3);
    s.position.set((r() - 0.5) * 0.2, 0.14 + r() * 0.05, (r() - 0.5) * 0.2);
    s.bakeCurrentTransformIntoVertices();
    parts.push(colour(s, (y, i) => {
      const f = 0.85 + ((i * 37) % 11) / 40;
      return [0.2 * f, (0.33 + y * 0.2) * f, 0.13 * f];
    }));
  }
  for (let k = 0; k < 2; k++) {
    const f = MeshBuilder.CreateSphere('flower', { diameter: 0.06, segments: 2 }, scene);
    f.position.set((r() - 0.5) * 0.3, 0.34, (r() - 0.5) * 0.3);
    f.bakeCurrentTransformIntoVertices();
    parts.push(colour(f, [0.78, 0.72, 0.9]));
  }
  const m = Mesh.MergeMeshes(parts, true, true)!;
  m.name = name;
  m.isPickable = false;
  return m;
}
