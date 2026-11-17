import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CollisionWorld } from './world/colliders';

// Smooth third-person follow camera with user-adjustable angle and zoom.

const MIN_R = 2.6;
const MAX_R = 14;
const MIN_BETA = 0.35; // looking down from above
const MAX_BETA = 1.72; // slightly below horizontal (look up at peaks)

export class FollowCamera {
  readonly cam: ArcRotateCamera;
  private desiredRadius = 6.5;
  private target = new Vector3();
  private goal = new Vector3();
  private initialised = false;

  constructor(scene: Scene, private world: CollisionWorld) {
    this.cam = new ArcRotateCamera('cam', -Math.PI / 2, 1.25, 6.5, Vector3.Zero(), scene);
    this.cam.minZ = 0.15;
    this.cam.maxZ = 10000;
    this.cam.fov = 0.9;
    // We drive the camera ourselves; no built-in inputs.
    this.cam.inputs.clear();
  }

  /** Horizontal forward yaw (Babylon rotation.y convention) the camera is looking along. */
  get yaw(): number {
    // camera sits at target + r*(cos a, ., sin a); it looks along -(cos a, sin a)
    return Math.atan2(-Math.cos(this.cam.alpha), -Math.sin(this.cam.alpha));
  }

  /** Place the camera directly behind a heading. */
  setBehind(heading: number) {
    this.cam.alpha = Math.atan2(-Math.cos(heading), -Math.sin(heading));
  }

  /** Set the preferred camera distance (clamped). */
  setZoom(r: number) {
    this.desiredRadius = Math.min(MAX_R, Math.max(MIN_R, r));
  }

  get zoom() {
    return this.desiredRadius;
  }

  /** Jump straight to the target next frame (after teleports/respawns). */
  snap() {
    this.initialised = false;
  }

  update(dt: number, focus: Vector3, look: { dx: number; dy: number; zoom: number }, autoFollow: boolean, heading: number, moving: boolean) {
    const c = this.cam;
    c.alpha -= look.dx * 0.0065;
    c.beta = Math.min(MAX_BETA, Math.max(MIN_BETA, c.beta - look.dy * 0.005));
    this.desiredRadius = Math.min(MAX_R, Math.max(MIN_R, this.desiredRadius + look.zoom));

    // Gently swing behind the explorer while moving if the player isn't steering the camera.
    if (autoFollow && moving) {
      const want = Math.atan2(-Math.cos(heading), -Math.sin(heading));
      let d = want - c.alpha;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      c.alpha += d * (1 - Math.exp(-1.2 * dt));
    }

    // Smoothly follow the explorer's upper body
    const goal = this.goal.set(focus.x, focus.y + 1.55, focus.z);
    if (!this.initialised) { this.target.copyFrom(goal); this.initialised = true; }
    const k = 1 - Math.exp(-10 * dt);
    this.target.x += (goal.x - this.target.x) * k;
    this.target.y += (goal.y - this.target.y) * (1 - Math.exp(-6 * dt));
    this.target.z += (goal.z - this.target.z) * k;
    c.target.copyFrom(this.target);

    // March along the boom from the explorer outwards; stop short of terrain or walls.
    let r = this.desiredRadius;
    const sb = Math.sin(c.beta);
    const dx = Math.cos(c.alpha) * sb;
    const dy = Math.cos(c.beta);
    const dz = Math.sin(c.alpha) * sb;
    for (let t = 0.6; t <= this.desiredRadius; t += 0.3) {
      if (this.world.solidAt(this.target.x + dx * t, this.target.y + dy * t, this.target.z + dz * t, 0.3)) {
        r = Math.max(0.8, t - 0.35);
        break;
      }
    }
    c.radius += (r - c.radius) * (r < c.radius ? 0.5 : 1 - Math.exp(-4 * dt));
  }
}
