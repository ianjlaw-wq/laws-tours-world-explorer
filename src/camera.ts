import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CollisionWorld } from './world/colliders';

// Smooth third-person follow camera with user-adjustable angle and zoom.
// Cinematics and conversations can take over by setting `pose` (orbit target + angles + distance).

export interface CamPose { target: Vector3; alpha: number; beta: number; radius: number }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Interpolate two poses (shortest way round for alpha) into `out`. */
export function lerpPose(a: CamPose, b: CamPose, t: number, out: CamPose): CamPose {
  Vector3.LerpToRef(a.target, b.target, t, out.target);
  out.alpha = a.alpha + wrap(b.alpha - a.alpha) * t;
  out.beta = a.beta + (b.beta - a.beta) * t;
  // interpolate distance logarithmically so long swoops feel even
  out.radius = Math.exp(Math.log(a.radius) + (Math.log(b.radius) - Math.log(a.radius)) * t);
  return out;
}

export const newPose = (): CamPose => ({ target: new Vector3(), alpha: 0, beta: 1.3, radius: 6 });

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
  /** When set, the camera holds this pose and ignores the explorer and look input. */
  pose: CamPose | null = null;

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

  /** Current camera pose (copied into `out`). */
  getPose(out: CamPose): CamPose {
    out.target.copyFrom(this.cam.target);
    out.alpha = this.cam.alpha;
    out.beta = this.cam.beta;
    out.radius = this.cam.radius;
    return out;
  }

  /** The pose the follow camera would settle at behind the explorer. */
  followPose(focus: Vector3, heading: number, out: CamPose): CamPose {
    out.target.set(focus.x, focus.y + 1.55, focus.z);
    out.alpha = Math.atan2(-Math.cos(heading), -Math.sin(heading));
    out.beta = 1.3;
    out.radius = this.desiredRadius;
    return out;
  }

  update(dt: number, focus: Vector3, look: { dx: number; dy: number; zoom: number }, autoFollow: boolean, heading: number, moving: boolean) {
    const c = this.cam;
    if (this.pose) {
      c.target.copyFrom(this.pose.target);
      c.alpha = this.pose.alpha;
      c.beta = this.pose.beta;
      c.radius = this.pose.radius;
      this.target.copyFrom(this.pose.target);
      this.initialised = true;
      return;
    }
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
