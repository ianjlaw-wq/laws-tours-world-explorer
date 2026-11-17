import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { rng } from '../world/noise';

// A stylised-realistic explorer assembled from rounded primitives (no external model files).
// Local +Z is forward; the root sits at the feet.

/** Woven-fabric detail texture (procedural). */
function fabricTexture(scene: Scene, seed: number): DynamicTexture {
  const t = new DynamicTexture('fabric' + seed, { width: 128, height: 128 }, scene, true);
  const ctx = t.getContext() as unknown as CanvasRenderingContext2D;
  const r = rng(seed);
  ctx.fillStyle = 'rgb(200,200,200)';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 2) {
    ctx.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.06})`;
    ctx.fillRect(0, y, 128, 1);
  }
  for (let x = 0; x < 128; x += 2) {
    ctx.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.05})`;
    ctx.fillRect(x, 0, 1, 128);
  }
  for (let i = 0; i < 300; i++) {
    const v = Math.floor(150 + r() * 100);
    ctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
    ctx.fillRect(r() * 128, r() * 128, 1 + r() * 3, 1 + r() * 3);
  }
  t.update(true);
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.uScale = 3;
  t.vScale = 3;
  return t;
}

const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export class Explorer {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];
  private body: TransformNode;
  private hips: TransformNode;
  private torso: TransformNode;
  private chest: TransformNode;
  private head: TransformNode;
  private legL: TransformNode;
  private legR: TransformNode;
  private kneeL: TransformNode;
  private kneeR: TransformNode;
  private ankleL: TransformNode;
  private ankleR: TransformNode;
  private armL: TransformNode;
  private armR: TransformNode;
  private elbowL: TransformNode;
  private elbowR: TransformNode;
  private phase = 0;
  private lastStepSign = 1;
  private lastHeading = 0;
  private bank = 0;
  private landing = 0;
  private wasGrounded = true;
  private runBlendS = 0;
  private moveS = 0;
  /** Called at each footfall with the current speed. */
  onFootstep: ((speed: number) => void) | null = null;

  constructor(scene: Scene, opts: { villager?: boolean; name?: string } = {}) {
    const v = !!opts.villager;
    const fab = (name: string, c: Color3, seed: number) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = c;
      m.diffuseTexture = fabricTexture(scene, seed);
      m.specularColor = new Color3(0.03, 0.03, 0.03);
      return m;
    };
    const plain = (name: string, c: Color3, spec = 0.05, power = 32) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = c;
      m.specularColor = new Color3(spec, spec, spec);
      m.specularPower = power;
      return m;
    };
    const skin = plain('skin', v ? new Color3(0.6, 0.41, 0.29) : new Color3(0.8, 0.6, 0.47), 0.12, 20);
    // villager: anaku (wrapped dress) in madder red, woven belt, lliclla shawl
    const shirt = fab('shirt', v ? new Color3(0.56, 0.17, 0.13) : new Color3(0.86, 0.79, 0.6), 1);
    const trousers = fab('trousers', v ? new Color3(0.5, 0.15, 0.12) : new Color3(0.42, 0.38, 0.28), 2);
    const leather = v ? fab('chumpi', new Color3(0.85, 0.62, 0.2), 6) : plain('leather', new Color3(0.33, 0.21, 0.12), 0.18, 40);
    const boots = plain('boots', v ? new Color3(0.42, 0.3, 0.18) : new Color3(0.27, 0.18, 0.11), 0.12, 30);
    const sole = plain('sole', new Color3(0.12, 0.1, 0.08));
    const hat = fab('hat', new Color3(0.58, 0.44, 0.27), 3);
    const pack = fab('pack', new Color3(0.55, 0.24, 0.15), 4);
    const roll = fab('roll', new Color3(0.22, 0.35, 0.3), 5);
    const hair = plain('hair', v ? new Color3(0.05, 0.04, 0.035) : new Color3(0.18, 0.11, 0.07), 0.1, 20);
    const metal = plain('metal', new Color3(0.7, 0.68, 0.6), 0.6, 64);

    this.root = new TransformNode(opts.name ?? 'explorer', scene);
    const add = (mesh: Mesh, parent: TransformNode, mat: StandardMaterial, x = 0, y = 0, z = 0) => {
      mesh.parent = parent;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.position.set(x, y, z);
      this.meshes.push(mesh);
      return mesh;
    };
    const node = (name: string, parent: TransformNode, x: number, y: number, z: number) => {
      const n = new TransformNode(name, scene);
      n.parent = parent;
      n.position.set(x, y, z);
      return n;
    };
    const cap = (name: string, h: number, r: number, rTop?: number) =>
      MeshBuilder.CreateCapsule(name, { height: h, radius: r, radiusTop: rTop, tessellation: 12, subdivisions: 2, capSubdivisions: 4 }, scene);

    this.body = node('body', this.root, 0, 0, 0);
    this.hips = node('hips', this.body, 0, 0.96, 0);
    this.torso = node('torso', this.hips, 0, 0.02, 0);
    this.chest = node('chest', this.torso, 0, 0.18, 0);

    // Pelvis, waist, chest (tapered), collar and belt
    const pelvis = add(cap('pelvis', 0.3, 0.165), this.torso, trousers, 0, -0.05, 0);
    pelvis.rotation.z = Math.PI / 2;
    pelvis.scaling.set(1, 1.15, 0.78);
    const waist = add(cap('waist', 0.36, 0.155), this.torso, shirt, 0, 0.1, 0);
    waist.scaling.set(1.12, 1, 0.78);
    const ribs = add(cap('ribs', 0.44, 0.185, 0.2), this.chest, shirt, 0, 0.16, 0);
    ribs.scaling.set(1.15, 1, 0.74);
    const collar = add(MeshBuilder.CreateTorus('collar', { diameter: 0.17, thickness: 0.045, tessellation: 16 }, scene), this.chest, shirt, 0, 0.38, 0.0);
    collar.scaling.set(1, 1, 0.85);
    add(MeshBuilder.CreateCylinder('belt', { height: 0.06, diameter: 0.33, tessellation: 16 }, scene), this.torso, leather, 0, 0.0, 0).scaling.set(1.03, 1, 0.8);
    if (!v) add(MeshBuilder.CreateBox('buckle', { width: 0.06, height: 0.05, depth: 0.02 }, scene), this.torso, metal, 0, 0.0, 0.135);
    // shirt pockets
    for (const sx of v ? [] : [-1, 1]) {
      add(MeshBuilder.CreateBox('pocketS', { width: 0.09, height: 0.1, depth: 0.02 }, scene), this.chest, shirt, sx * 0.09, 0.22, 0.135);
    }

    // Head: neck, skull, jaw, nose, ears, hair, hat
    this.head = node('head', this.chest, 0, 0.47, 0);
    add(MeshBuilder.CreateCylinder('neck', { height: 0.12, diameter: 0.1, tessellation: 12 }, scene), this.head, skin, 0, -0.02, 0);
    const skull = add(MeshBuilder.CreateSphere('skull', { diameter: 0.23, segments: 16 }, scene), this.head, skin, 0, 0.12, 0.005);
    skull.scaling.set(0.9, 1.05, 1);
    const jaw = add(MeshBuilder.CreateSphere('jaw', { diameter: 0.17, segments: 12 }, scene), this.head, skin, 0, 0.06, 0.03);
    jaw.scaling.set(0.95, 0.75, 0.95);
    add(MeshBuilder.CreateSphere('nose', { diameter: 0.035, segments: 8 }, scene), this.head, skin, 0, 0.1, 0.115).scaling.set(0.8, 1.2, 1);
    for (const sx of [-1, 1]) {
      add(MeshBuilder.CreateSphere('ear', { diameter: 0.05, segments: 8 }, scene), this.head, skin, sx * 0.105, 0.11, -0.005).scaling.set(0.4, 1, 0.7);
      add(MeshBuilder.CreateSphere('eye', { diameter: 0.022, segments: 6 }, scene), this.head, hair, sx * 0.04, 0.135, 0.1);
    }
    const hairM = add(MeshBuilder.CreateSphere('hair', { diameter: 0.245, segments: 14, slice: 0.55 }, scene), this.head, hair, 0, 0.13, -0.012);
    hairM.scaling.set(0.94, 1, 1.02);
    if (!v) {
      add(MeshBuilder.CreateCylinder('brim', { height: 0.018, diameter: 0.44, tessellation: 28 }, scene), this.head, hat, 0, 0.215, 0);
      const crown = add(MeshBuilder.CreateCylinder('crown', { height: 0.13, diameterTop: 0.2, diameterBottom: 0.25, tessellation: 24 }, scene), this.head, hat, 0, 0.285, 0);
      crown.scaling.set(1, 1, 1.12);
      add(MeshBuilder.CreateCylinder('crease', { height: 0.02, diameterTop: 0.12, diameterBottom: 0.2, tessellation: 20 }, scene), this.head, hat, 0, 0.35, 0).scaling.set(1, 1, 1.12);
      add(MeshBuilder.CreateCylinder('band', { height: 0.03, diameter: 0.252, tessellation: 24 }, scene), this.head, leather, 0, 0.235, 0).scaling.set(1, 1, 1.12);

      // Rucksack (on the back = local -Z): rounded body, flap, side pockets, bedroll, straps
      const bag = add(cap('pack', 0.52, 0.16), this.chest, pack, 0, 0.12, -0.24);
      bag.scaling.set(1.2, 1, 0.68);
      const flap = add(cap('flap', 0.26, 0.12), this.chest, leather, 0, 0.32, -0.25);
      flap.rotation.z = Math.PI / 2;
      flap.scaling.set(0.55, 1.35, 0.9);
      for (const sx of [-1, 1]) {
        const sp = add(cap('sidePocket', 0.24, 0.07), this.chest, pack, sx * 0.205, 0.04, -0.24);
        sp.scaling.set(0.8, 1, 1);
        add(MeshBuilder.CreateBox('strap', { width: 0.05, height: 0.42, depth: 0.025 }, scene), this.chest, leather, sx * 0.1, 0.17, 0.14);
        add(MeshBuilder.CreateBox('strapTop', { width: 0.05, height: 0.025, depth: 0.32 }, scene), this.chest, leather, sx * 0.1, 0.38, -0.02);
        add(MeshBuilder.CreateBox('rollStrap', { width: 0.03, height: 0.16, depth: 0.16 }, scene), this.chest, leather, sx * 0.12, 0.46, -0.22);
      }
      const bed = add(MeshBuilder.CreateCylinder('bedroll', { height: 0.5, diameter: 0.14, tessellation: 16 }, scene), this.chest, roll, 0, 0.46, -0.22);
      bed.rotation.z = Math.PI / 2;
      add(MeshBuilder.CreateCylinder('bottle', { height: 0.2, diameter: 0.075, tessellation: 12 }, scene), this.torso, metal, 0.2, -0.05, -0.05);
    } else {
      // ñañaka head cloth, long braid, lliclla shawl pinned with a tupu, long anaku skirt
      const shawl = fab('lliclla', new Color3(0.82, 0.6, 0.22), 7);
      const cloth = fab('nanaka', new Color3(0.3, 0.2, 0.42), 8);
      const hc = add(MeshBuilder.CreateBox('headcloth', { width: 0.27, height: 0.03, depth: 0.29 }, scene), this.head, cloth, 0, 0.245, -0.01);
      hc.rotation.x = -0.12;
      add(MeshBuilder.CreateBox('headclothBack', { width: 0.25, height: 0.18, depth: 0.025 }, scene), this.head, cloth, 0, 0.17, -0.145);
      const braid = add(cap('braid', 0.42, 0.03), this.head, hair, 0, -0.1, -0.12);
      braid.rotation.x = 0.15;
      const sh = add(cap('shawl', 0.5, 0.2), this.chest, shawl, 0, 0.3, -0.03);
      sh.rotation.z = Math.PI / 2;
      sh.scaling.set(0.5, 1.02, 0.9);
      add(MeshBuilder.CreateCylinder('tupu', { height: 0.12, diameter: 0.018, tessellation: 6 }, scene), this.chest, metal, 0, 0.26, 0.16);
      add(MeshBuilder.CreateCylinder('skirt', { height: 0.78, diameterTop: 0.36, diameterBottom: 0.52, tessellation: 18 }, scene), this.hips, trousers, 0, -0.42, 0).scaling.set(1, 1, 0.82);
    }

    // Limbs: pivot at shoulder/hip, joint at elbow/knee, ankle for feet
    const arm = (name: string, sx: number) => {
      const pivot = node(name, this.chest, sx * 0.23, 0.34, 0);
      add(MeshBuilder.CreateSphere(name + 'Sh', { diameter: 0.14, segments: 10 }, scene), pivot, shirt, 0, 0, 0);
      add(cap(name + 'U', 0.32, 0.058, 0.064), pivot, shirt, 0, -0.15, 0);
      const elbow = node(name + 'E', pivot, 0, -0.29, 0);
      add(MeshBuilder.CreateCylinder(name + 'Cuff', { height: 0.06, diameter: 0.115, tessellation: 12 }, scene), elbow, shirt, 0, -0.01, 0);
      add(cap(name + 'L', 0.29, 0.042, 0.05), elbow, skin, 0, -0.13, 0);
      const hand = add(MeshBuilder.CreateSphere(name + 'H', { diameter: 0.09, segments: 10 }, scene), elbow, skin, 0, -0.29, 0.01);
      hand.scaling.set(0.75, 1.15, 1);
      return [pivot, elbow] as const;
    };
    const leg = (name: string, sx: number) => {
      const pivot = node(name, this.hips, sx * 0.1, -0.04, 0);
      add(cap(name + 'U', 0.48, 0.078, 0.088), pivot, trousers, 0, -0.21, 0);
      const knee = node(name + 'K', pivot, 0, -0.44, 0);
      add(cap(name + 'L', 0.46, 0.06, 0.07), knee, trousers, 0, -0.2, 0);
      add(MeshBuilder.CreateCylinder(name + 'Cuff', { height: 0.14, diameter: 0.125, tessellation: 12 }, scene), knee, boots, 0, -0.36, 0);
      const ankle = node(name + 'A', knee, 0, -0.43, 0);
      const foot = add(cap(name + 'F', 0.27, 0.055), ankle, boots, 0, -0.03, 0.05);
      foot.rotation.x = Math.PI / 2;
      foot.scaling.set(1.05, 1, 0.85);
      add(MeshBuilder.CreateBox(name + 'Sole', { width: 0.1, height: 0.025, depth: 0.27 }, scene), ankle, sole, 0, -0.075, 0.05);
      return [pivot, knee, ankle] as const;
    };
    [this.armL, this.elbowL] = arm('armL', -1);
    [this.armR, this.elbowR] = arm('armR', 1);
    [this.legL, this.kneeL, this.ankleL] = leg('legL', -1);
    [this.legR, this.kneeR, this.ankleR] = leg('legR', 1);
  }

  /**
   * Procedural animation with smoothed blending between idle, walk, run and air poses.
   */
  animate(dt: number, speed: number, grounded: boolean, vy: number, time: number) {
    if (dt <= 0) return;
    const moving = Math.min(1, speed / 1.4);
    const runBlend = Math.min(1, Math.max(0, (speed - 3) / 3));
    this.moveS = damp(this.moveS, moving, 10, dt);
    this.runBlendS = damp(this.runBlendS, runBlend, 6, dt);
    const mv = this.moveS;
    const rb = this.runBlendS;

    const cadence = 1.75 + speed * 0.5;
    if (speed > 0.05) this.phase += dt * cadence * Math.PI;
    const ph = this.phase;
    const sw = Math.sin(ph);
    const cw = Math.cos(ph);

    // banking into turns
    const heading = this.root.rotation.y;
    let dh = heading - this.lastHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.lastHeading = heading;
    this.bank = damp(this.bank, Math.max(-0.25, Math.min(0.25, -(dh / dt) * 0.05 * (0.4 + speed * 0.15))), 8, dt);

    if (grounded && !this.wasGrounded) this.landing = Math.min(1, Math.max(0.3, -vy / 9));
    this.wasGrounded = grounded;
    this.landing = damp(this.landing, 0, 7, dt);

    const set = (n: TransformNode, axis: 'x' | 'y' | 'z', v: number, rate = 18) => {
      n.rotation[axis] = damp(n.rotation[axis], v, rate, dt);
    };

    if (grounded) {
      const legAmp = (0.42 + 0.38 * rb) * mv;
      const armAmp = (0.32 + 0.55 * rb) * mv;
      set(this.legL, 'x', -sw * legAmp - 0.04 * rb);
      set(this.legR, 'x', sw * legAmp - 0.04 * rb);
      // knee bends during swing (leg moving forward)
      set(this.kneeL, 'x', (Math.max(0, cw) * (0.55 + 0.75 * rb) + 0.06) * mv + this.landing * 0.5);
      set(this.kneeR, 'x', (Math.max(0, -cw) * (0.55 + 0.75 * rb) + 0.06) * mv + this.landing * 0.5);
      // heel strike / toe off
      set(this.ankleL, 'x', (-sw * 0.25 - Math.max(0, cw) * 0.2) * mv);
      set(this.ankleR, 'x', (sw * 0.25 - Math.max(0, -cw) * 0.2) * mv);
      set(this.armL, 'x', sw * armAmp);
      set(this.armR, 'x', -sw * armAmp);
      set(this.armL, 'z', -0.1 - 0.05 * rb);
      set(this.armR, 'z', 0.1 + 0.05 * rb);
      set(this.elbowL, 'x', -(0.18 + rb * 1.0) * mv - 0.12 - Math.max(0, sw) * 0.25 * mv);
      set(this.elbowR, 'x', -(0.18 + rb * 1.0) * mv - 0.12 - Math.max(0, -sw) * 0.25 * mv);

      const bob = Math.abs(cw) * (0.025 + 0.05 * rb) * mv;
      const idleT = 1 - mv;
      const breathe = Math.sin(time * 1.7) * 0.006 * idleT;
      const shift = Math.sin(time * 0.45) * 0.02 * idleT; // weight shift when idle
      this.hips.position.y = damp(this.hips.position.y, 0.96 - 0.03 * rb + bob + breathe - this.landing * 0.14, 20, dt);
      this.hips.position.x = damp(this.hips.position.x, shift, 4, dt);
      set(this.hips, 'z', sw * 0.05 * mv * (1 - rb * 0.5) - shift * 1.5);
      set(this.hips, 'y', sw * 0.12 * mv);
      set(this.torso, 'x', 0.03 + rb * 0.2 + this.landing * 0.25);
      set(this.chest, 'y', -sw * (0.14 + 0.08 * rb) * mv); // shoulders counter-rotate
      set(this.chest, 'x', breathe * 2);
      // head stays level-ish and occasionally looks around when idle
      set(this.head, 'y', sw * 0.1 * mv + Math.sin(time * 0.3) * 0.35 * idleT * Math.max(0, Math.sin(time * 0.13)), 4);
      set(this.head, 'x', -rb * 0.12 - this.landing * 0.1);

      const sign = Math.sign(sw);
      if (mv > 0.25 && sign !== this.lastStepSign) {
        this.lastStepSign = sign;
        this.onFootstep?.(speed);
      }
    } else {
      // airborne: tuck legs on the way up, reach down on the way down
      const up = vy > 0 ? 1 : 0.4;
      set(this.legL, 'x', -0.55 * up - 0.1, 12);
      set(this.legR, 'x', 0.2, 12);
      set(this.kneeL, 'x', 0.95 * up + 0.2, 12);
      set(this.kneeR, 'x', 0.5, 12);
      set(this.ankleL, 'x', 0.2, 12);
      set(this.ankleR, 'x', 0.3, 12);
      set(this.armL, 'x', -0.5, 10);
      set(this.armR, 'x', -0.35, 10);
      set(this.armL, 'z', -0.45, 10);
      set(this.armR, 'z', 0.45, 10);
      set(this.elbowL, 'x', -0.6, 10);
      set(this.elbowR, 'x', -0.6, 10);
      set(this.torso, 'x', 0.12, 10);
      this.hips.position.y = damp(this.hips.position.y, 0.96, 12, dt);
    }
    this.body.rotation.z = this.bank;
  }
}
