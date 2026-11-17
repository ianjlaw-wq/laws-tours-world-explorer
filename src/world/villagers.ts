// Inhabitants of the living city: simple low-poly figures drawn with thin instances
// (two draw calls for everyone), walking short routes or tending the terraces.
// Artistic impression only.

import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { CollisionWorld } from './colliders';
import { AG } from './layout';

type RGB = [number, number, number];
function colour(m: Mesh, c: RGB) {
  const n = m.getTotalVertices();
  const cols = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { cols[i * 4] = c[0]; cols[i * 4 + 1] = c[1]; cols[i * 4 + 2] = c[2]; cols[i * 4 + 3] = 1; }
  m.setVerticesData('color', cols);
  return m;
}
function part(m: Mesh, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  m.scaling.set(sx, sy, sz);
  m.rotation.set(rx, 0, rz);
  m.position.set(x, y, z);
  m.bakeCurrentTransformIntoVertices();
  return m;
}

interface Walker {
  /** route waypoints (x, z); y follows the ground */
  pts: Array<[number, number]>;
  seg: number;
  u: number;
  speed: number;
  pause: number;
  x: number; y: number; z: number; heading: number;
  /** farmer: works in place, bending */
  farmer: boolean;
  phase: number;
}

const COLOURS: RGB[] = [
  [0.62, 0.18, 0.13], [0.24, 0.3, 0.5], [0.72, 0.55, 0.22], [0.36, 0.22, 0.32],
  [0.55, 0.45, 0.32], [0.18, 0.36, 0.3], [0.68, 0.3, 0.16], [0.42, 0.18, 0.2],
];

export class Villagers {
  readonly body: Mesh;
  readonly head: Mesh;
  private walkers: Walker[] = [];
  private mats: Float32Array;
  private visible = 0;
  private tmpM = Matrix.Identity();
  private tmpQ = new Quaternion();
  private tmpS = new Vector3();
  private tmpP = new Vector3();

  constructor(scene: Scene, private world: CollisionWorld) {
    // ---- clothing (tinted per person by instance colour) ----
    const skirt = part(MeshBuilder.CreateCylinder('vSkirt', { height: 0.95, diameterTop: 0.34, diameterBottom: 0.46, tessellation: 8 }, scene), 0, 0.5, 0, 1, 1, 0.8);
    const torso = part(MeshBuilder.CreateCylinder('vTorso', { height: 0.45, diameterTop: 0.3, diameterBottom: 0.34, tessellation: 8 }, scene), 0, 1.18, 0, 1, 1, 0.75);
    const mantle = part(MeshBuilder.CreateSphere('vMantle', { diameter: 0.46, segments: 4 }, scene), 0, 1.36, -0.02, 1, 0.42, 0.8);
    const bundle = part(MeshBuilder.CreateSphere('vBundle', { diameter: 0.34, segments: 4 }, scene), 0, 1.12, -0.2, 1, 1.1, 0.7);
    const belt = part(MeshBuilder.CreateCylinder('vBelt', { height: 0.07, diameter: 0.35, tessellation: 8 }, scene), 0, 0.98, 0, 1, 1, 0.77);
    colour(skirt, [1, 1, 1]); colour(torso, [1, 1, 1]); colour(mantle, [0.82, 0.8, 0.78]);
    colour(bundle, [1.25, 1.15, 0.9]); colour(belt, [1.4, 1.2, 0.6]);
    this.body = Mesh.MergeMeshes([skirt, torso, mantle, bundle, belt], true, true)!;
    this.body.name = 'villagerBodies';

    // ---- skin, hair, arms, feet (not tinted) ----
    const skin: RGB = [0.55, 0.37, 0.26];
    const head = colour(part(MeshBuilder.CreateSphere('vHead', { diameter: 0.22, segments: 6 }, scene), 0, 1.58, 0.01, 0.9, 1.05, 1), skin);
    const hair = colour(part(MeshBuilder.CreateSphere('vHair', { diameter: 0.235, segments: 6, slice: 0.6 }, scene), 0, 1.6, -0.01, 0.92, 1, 1), [0.05, 0.04, 0.035]);
    const parts = [head, hair];
    for (const sx of [-1, 1]) {
      parts.push(colour(part(MeshBuilder.CreateCylinder('vArm', { height: 0.6, diameterTop: 0.09, diameterBottom: 0.07, tessellation: 5 }, scene), sx * 0.2, 1.08, 0.02, 1, 1, 1, 0, sx * 0.12), skin));
      parts.push(colour(part(MeshBuilder.CreateSphere('vFoot', { diameter: 0.1, segments: 3 }, scene), sx * 0.08, 0.04, 0.05, 0.9, 0.5, 1.6), [0.3, 0.22, 0.15]));
    }
    this.head = Mesh.MergeMeshes(parts, true, true)!;
    this.head.name = 'villagerHeads';

    const mat = new StandardMaterial('villagerMat', scene);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = new Color3(0.03, 0.03, 0.03);
    this.body.material = mat;
    this.head.material = mat;

    // ---- routes (artistic impression; open ground only) ----
    const routes: Array<{ pts: Array<[number, number]>; farmer?: boolean }> = [
      { pts: [[-12, -32], [8, -22], [-4, 6], [-14, -10]] },
      { pts: [[6, 8], [14, -12], [-8, -28]] },
      { pts: [[-2, 10], [-12, 0], [4, -14]] },
      { pts: [[30, -10], [40, 12], [32, 40], [40, 12]] },
      { pts: [[44, 30], [30, 20], [38, -6]] },
      { pts: [[-36, -26], [-30, 0], [-40, 12], [-30, 0]] },
      { pts: [[-18, -114], [-4, -120], [-14, -121]] },
      // up and down the great terrace stairway
      { pts: [[AG.stairX, -42], [AG.stairX, -104]] },
      // farmers in the fields
      { pts: [[-16, AG.zStart - AG.depth * 2 - 3]], farmer: true },
      { pts: [[9, AG.zStart - AG.depth * 3 - 3.2]], farmer: true },
      { pts: [[-6, AG.zStart - AG.depth * 5 - 2.8]], farmer: true },
      { pts: [[20, AG.zStart - AG.depth * 1 - 3]], farmer: true },
    ];
    routes.forEach((rt, i) => {
      const [x, z] = rt.pts[0];
      const y = world.groundAt(x, z, 200, 400).y;
      this.walkers.push({
        pts: rt.pts, seg: 0, u: 0, speed: 0.9 + (i % 3) * 0.15, pause: i * 0.7,
        x, y, z, heading: i, farmer: !!rt.farmer, phase: i * 1.3,
      });
    });

    const n = this.walkers.length;
    this.mats = new Float32Array(n * 16);
    const cols = new Float32Array(n * 4);
    this.walkers.forEach((_, i) => {
      const c = COLOURS[i % COLOURS.length];
      cols.set([c[0], c[1], c[2], 1], i * 4);
    });
    for (const m of [this.body, this.head]) {
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true; // instances span the whole site
      m.thinInstanceSetBuffer('matrix', this.mats, 16, false);
      m.setEnabled(false);
    }
    this.body.thinInstanceSetBuffer('color', cols, 4, true);
    this.update(0, 0);
  }

  /** 0 = hidden, 1 = fully present (they "fade in" by growing from the ground). */
  setPresence(k: number) {
    this.visible = k;
    const on = k > 0.001;
    this.body.setEnabled(on);
    this.head.setEnabled(on);
  }

  update(dt: number, time: number) {
    if (this.visible <= 0.001 && dt > 0) return;
    const k = Math.min(1, this.visible);
    this.walkers.forEach((w, i) => {
      let bob = 0;
      let lean = 0;
      if (w.farmer) {
        // hoeing / bending in the field
        const b = Math.max(0, Math.sin(time * 1.1 + w.phase));
        lean = 0.15 + b * 0.45;
        w.heading = w.phase;
      } else if (w.pause > 0) {
        w.pause -= dt;
      } else if (w.pts.length > 1) {
        const a = w.pts[w.seg];
        const b = w.pts[(w.seg + 1) % w.pts.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        w.u += (w.speed * dt) / len;
        if (w.u >= 1) {
          w.u = 0;
          w.seg = (w.seg + 1) % w.pts.length;
          w.pause = 1.5 + ((i * 7) % 5) * 0.6;
        }
        const nx = a[0] + (b[0] - a[0]) * w.u;
        const nz = a[1] + (b[1] - a[1]) * w.u;
        w.heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
        w.x = nx; w.z = nz;
        if (dt > 0) {
          const g = this.world.groundAt(nx, nz, w.y + 1.2, 0.6).y;
          w.y += (g - w.y) * Math.min(1, dt * 12);
        }
        bob = Math.abs(Math.sin(time * 6 + i)) * 0.04;
      }
      Quaternion.FromEulerAnglesToRef(lean, w.heading, 0, this.tmpQ);
      this.tmpS.set(1, k, 1);
      this.tmpP.set(w.x, w.y + bob, w.z);
      Matrix.ComposeToRef(this.tmpS, this.tmpQ, this.tmpP, this.tmpM);
      this.tmpM.copyToArray(this.mats, i * 16);
    });
    this.body.thinInstanceBufferUpdated('matrix');
    this.head.thinInstanceBufferUpdated('matrix');
  }
}
