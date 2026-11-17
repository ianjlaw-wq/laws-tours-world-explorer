import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';

// A stylised low-poly explorer assembled from primitives (no external model files).
// Local +Z is forward; the root sits at the feet.

function m(scene: Scene, name: string, c: Color3, spec = 0.05) {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = c;
  mat.specularColor = new Color3(spec, spec, spec);
  return mat;
}

export class Explorer {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];
  private hips: TransformNode;
  private torso: TransformNode;
  private legL: TransformNode;
  private legR: TransformNode;
  private kneeL: TransformNode;
  private kneeR: TransformNode;
  private armL: TransformNode;
  private armR: TransformNode;
  private elbowL: TransformNode;
  private elbowR: TransformNode;
  private head: TransformNode;
  private phase = 0;
  private lastStepSign = 1;
  /** Called at each footfall with the current speed. */
  onFootstep: ((speed: number) => void) | null = null;

  constructor(scene: Scene) {
    const skin = m(scene, 'skin', new Color3(0.78, 0.58, 0.44));
    const shirt = m(scene, 'shirt', new Color3(0.78, 0.7, 0.5));
    const trousers = m(scene, 'trousers', new Color3(0.36, 0.33, 0.25));
    const boots = m(scene, 'boots', new Color3(0.25, 0.16, 0.1));
    const hat = m(scene, 'hat', new Color3(0.5, 0.36, 0.2));
    const pack = m(scene, 'pack', new Color3(0.62, 0.22, 0.14));
    const strap = m(scene, 'strap', new Color3(0.2, 0.15, 0.1));
    const roll = m(scene, 'roll', new Color3(0.2, 0.36, 0.3));
    const hair = m(scene, 'hair', new Color3(0.2, 0.13, 0.08));

    this.root = new TransformNode('explorer', scene);
    const add = (mesh: Mesh, parent: TransformNode, mat: StandardMaterial) => {
      mesh.parent = parent;
      mesh.material = mat;
      mesh.isPickable = false;
      this.meshes.push(mesh);
      return mesh;
    };
    const node = (name: string, parent: TransformNode, x: number, y: number, z: number) => {
      const n = new TransformNode(name, scene);
      n.parent = parent;
      n.position.set(x, y, z);
      return n;
    };

    this.hips = node('hips', this.root, 0, 0.95, 0);
    this.torso = node('torso', this.hips, 0, 0, 0);

    // Torso and belt
    const chest = add(MeshBuilder.CreateBox('chest', { width: 0.44, height: 0.56, depth: 0.26 }, scene), this.torso, shirt);
    chest.position.y = 0.33;
    const belt = add(MeshBuilder.CreateBox('belt', { width: 0.42, height: 0.08, depth: 0.25 }, scene), this.torso, strap);
    belt.position.y = 0.05;
    const pelvis = add(MeshBuilder.CreateBox('pelvis', { width: 0.4, height: 0.16, depth: 0.24 }, scene), this.torso, trousers);
    pelvis.position.y = -0.04;

    // Head, hair and wide-brimmed explorer's hat
    this.head = node('head', this.torso, 0, 0.7, 0);
    const neck = add(MeshBuilder.CreateCylinder('neck', { height: 0.12, diameter: 0.11, tessellation: 8 }, scene), this.head, skin);
    neck.position.y = -0.06;
    const skull = add(MeshBuilder.CreateSphere('skull', { diameter: 0.25, segments: 8 }, scene), this.head, skin);
    skull.position.y = 0.11;
    skull.scaling.set(0.95, 1.08, 1);
    const hairM = add(MeshBuilder.CreateSphere('hair', { diameter: 0.26, segments: 8, slice: 0.6 }, scene), this.head, hair);
    hairM.position.set(0, 0.12, -0.015);
    const brim = add(MeshBuilder.CreateCylinder('brim', { height: 0.025, diameter: 0.46, tessellation: 18 }, scene), this.head, hat);
    brim.position.y = 0.2;
    const crown = add(MeshBuilder.CreateCylinder('crown', { height: 0.13, diameterTop: 0.22, diameterBottom: 0.27, tessellation: 14 }, scene), this.head, hat);
    crown.position.y = 0.27;
    const band = add(MeshBuilder.CreateCylinder('band', { height: 0.035, diameter: 0.272, tessellation: 14 }, scene), this.head, strap);
    band.position.y = 0.225;

    // Backpack (on the back = local -Z), with bedroll and side bottle
    const packBody = add(MeshBuilder.CreateBox('pack', { width: 0.38, height: 0.5, depth: 0.22 }, scene), this.torso, pack);
    packBody.position.set(0, 0.32, -0.25);
    const flap = add(MeshBuilder.CreateBox('packFlap', { width: 0.39, height: 0.16, depth: 0.235 }, scene), this.torso, strap);
    flap.position.set(0, 0.52, -0.25);
    const pocket = add(MeshBuilder.CreateBox('pocket', { width: 0.26, height: 0.18, depth: 0.08 }, scene), this.torso, pack);
    pocket.position.set(0, 0.2, -0.39);
    const bedroll = add(MeshBuilder.CreateCylinder('bedroll', { height: 0.46, diameter: 0.14, tessellation: 10 }, scene), this.torso, roll);
    bedroll.rotation.z = Math.PI / 2;
    bedroll.position.set(0, 0.64, -0.24);
    const bottle = add(MeshBuilder.CreateCylinder('bottle', { height: 0.2, diameter: 0.08, tessellation: 8 }, scene), this.torso, strap);
    bottle.position.set(0.23, 0.18, -0.24);
    for (const side of [-1, 1]) {
      const s = add(MeshBuilder.CreateBox('strap', { width: 0.06, height: 0.5, depth: 0.03 }, scene), this.torso, strap);
      s.position.set(side * 0.12, 0.35, 0.135);
    }

    // Limbs: pivot nodes at shoulders/hips, child nodes at elbows/knees
    const limb = (name: string, parent: TransformNode, x: number, y: number, upperLen: number, lowerLen: number, thick: number, mat: StandardMaterial, endMat: StandardMaterial, isLeg: boolean) => {
      const pivot = node(name, parent, x, y, 0);
      const upper = add(MeshBuilder.CreateCapsule(name + 'U', { height: upperLen + thick, radius: thick / 2, tessellation: 8, subdivisions: 1 }, scene), pivot, mat);
      upper.position.y = -upperLen / 2;
      const joint = node(name + 'J', pivot, 0, -upperLen, 0);
      const lower = add(MeshBuilder.CreateCapsule(name + 'L', { height: lowerLen + thick * 0.9, radius: thick * 0.45, tessellation: 8, subdivisions: 1 }, scene), joint, isLeg ? mat : skin);
      lower.position.y = -lowerLen / 2;
      if (isLeg) {
        const boot = add(MeshBuilder.CreateBox(name + 'B', { width: 0.13, height: 0.11, depth: 0.27 }, scene), joint, endMat);
        boot.position.set(0, -lowerLen - 0.01, 0.05);
      } else {
        const hand = add(MeshBuilder.CreateSphere(name + 'H', { diameter: 0.1, segments: 6 }, scene), joint, endMat);
        hand.position.y = -lowerLen - 0.03;
      }
      return [pivot, joint] as const;
    };
    [this.legL, this.kneeL] = limb('legL', this.hips, -0.11, -0.04, 0.44, 0.44, 0.15, trousers, boots, true);
    [this.legR, this.kneeR] = limb('legR', this.hips, 0.11, -0.04, 0.44, 0.44, 0.15, trousers, boots, true);
    [this.armL, this.elbowL] = limb('armL', this.torso, -0.28, 0.57, 0.3, 0.28, 0.11, shirt, skin, false);
    [this.armR, this.elbowR] = limb('armR', this.torso, 0.28, 0.57, 0.3, 0.28, 0.11, shirt, skin, false);
    this.armL.rotation.z = -0.12;
    this.armR.rotation.z = 0.12;
  }

  /**
   * Procedural animation.
   * @param speed horizontal speed in m/s
   * @param grounded whether feet are on the ground
   * @param vy vertical velocity
   */
  animate(dt: number, speed: number, grounded: boolean, vy: number, time: number) {
    const runBlend = Math.min(1, Math.max(0, (speed - 3) / 3));
    const moving = Math.min(1, speed / 1.5);
    const cadence = 1.6 + speed * 0.55; // strides per second scale
    this.phase += dt * cadence * Math.PI * (speed > 0.05 ? 1 : 0);

    const sw = Math.sin(this.phase);
    const legAmp = (0.45 + 0.35 * runBlend) * moving;
    const armAmp = (0.35 + 0.55 * runBlend) * moving;

    if (grounded) {
      this.legL.rotation.x = sw * legAmp;
      this.legR.rotation.x = -sw * legAmp;
      this.kneeL.rotation.x = Math.max(0, -Math.cos(this.phase)) * (0.5 + runBlend * 0.7) * moving;
      this.kneeR.rotation.x = Math.max(0, Math.cos(this.phase)) * (0.5 + runBlend * 0.7) * moving;
      this.armL.rotation.x = -sw * armAmp;
      this.armR.rotation.x = sw * armAmp;
      this.elbowL.rotation.x = -(0.2 + runBlend * 0.9) * moving - 0.08;
      this.elbowR.rotation.x = -(0.2 + runBlend * 0.9) * moving - 0.08;
      const bob = Math.abs(Math.cos(this.phase)) * (0.03 + 0.05 * runBlend) * moving;
      const breathe = Math.sin(time * 1.8) * 0.006 * (1 - moving);
      this.hips.position.y = 0.95 - 0.02 * runBlend + bob + breathe;
      this.torso.rotation.x = 0.04 + runBlend * 0.16;
      this.torso.rotation.y = sw * 0.06 * moving;
      this.head.rotation.x = -runBlend * 0.1;

      const sign = Math.sign(sw);
      if (moving > 0.2 && sign !== this.lastStepSign) {
        this.lastStepSign = sign;
        this.onFootstep?.(speed);
      }
    } else {
      // airborne pose: tucked legs, raised arms
      const up = vy > 0 ? 1 : 0.6;
      this.legL.rotation.x = -0.5 * up;
      this.legR.rotation.x = 0.25;
      this.kneeL.rotation.x = 0.9 * up;
      this.kneeR.rotation.x = 0.5;
      this.armL.rotation.x = -0.6;
      this.armR.rotation.x = -0.6;
      this.elbowL.rotation.x = -0.5;
      this.elbowR.rotation.x = -0.5;
      this.torso.rotation.x = 0.1;
      this.hips.position.y = 0.95;
    }
  }
}
