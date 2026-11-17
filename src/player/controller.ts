import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CollisionWorld } from '../world/colliders';
import { DETAIL } from '../world/terrain';

// Kinematic third-person controller: walk / run / jump with terrain + box collision.

export const WALK_SPEED = 2.6;
export const RUN_SPEED = 6.4;
const GRAVITY = 18;
const JUMP_SPEED = 7.2; // apex ≈ 1.45 m
const STEP = 0.5; // max auto step-up
const RADIUS = 0.32;
const HEIGHT = 1.8;
const MAX_SLOPE = 1.15; // ~49°; steeper natural terrain is not walkable
const COYOTE = 0.12;

export class PlayerController {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  heading = 0;
  grounded = true;
  private airTime = 0;
  /** Last confirmed safe standing spot (used for respawn and saves). */
  readonly safe = new Vector3();
  private safeTimer = 0;

  constructor(private world: CollisionWorld, start: { x: number; y: number; z: number }, heading: number) {
    this.pos.set(start.x, start.y, start.z);
    this.pos.y = this.world.groundAt(start.x, start.z, start.y + 50, 100).y;
    this.safe.copyFrom(this.pos);
    this.heading = heading;
  }

  get horizontalSpeed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  private walkable(x: number, z: number, feet: number): boolean {
    if (x < DETAIL.x0 + 8 || x > DETAIL.x1 - 8 || z < DETAIL.z0 + 8 || z > DETAIL.z1 - 8) return false;
    const g = this.world.groundAt(x, z, feet, STEP);
    if (g.structure) return true;
    return this.world.terrain.slopeAt(x, z) <= MAX_SLOPE;
  }

  /**
   * @param moveX right input (-1..1) in camera space
   * @param moveY forward input (-1..1) in camera space
   * @param camYaw horizontal forward direction of the camera (radians, Babylon rotation.y convention)
   */
  update(dt: number, moveX: number, moveY: number, run: boolean, jump: boolean, camYaw: number) {
    dt = Math.min(dt, 0.05);
    const mag = Math.min(1, Math.hypot(moveX, moveY));
    const fx = Math.sin(camYaw);
    const fz = Math.cos(camYaw);
    // right vector of forward (fx,fz) in a left-handed, y-up world
    const rx = fz;
    const rz = -fx;
    let dx = fx * moveY + rx * moveX;
    let dz = fz * moveY + rz * moveX;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-4) { dx /= dl; dz /= dl; }

    const target = mag > 0.01 ? (run ? RUN_SPEED : WALK_SPEED * Math.min(1, mag / 0.8)) : 0;
    const accel = this.grounded ? 14 : 4;
    const tvx = dx * target;
    const tvz = dz * target;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (tvx - this.vel.x) * k;
    this.vel.z += (tvz - this.vel.z) * k;

    // Turn to face movement direction
    if (target > 0.1) {
      const want = Math.atan2(dx, dz);
      let diff = want - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * (1 - Math.exp(-12 * dt));
    }

    // Horizontal move with collision; try full move, then axis-separated slides
    const feet = this.pos.y;
    const tryMove = (nx: number, nz: number): boolean => {
      [nx, nz] = this.world.resolve(nx, nz, RADIUS, feet, feet + HEIGHT, STEP);
      if (!this.walkable(nx, nz, feet)) {
        // allow leaving steep ground (e.g. after landing on it) if it isn't steeper
        const here = this.world.terrain.slopeAt(this.pos.x, this.pos.z);
        const there = this.world.terrain.slopeAt(nx, nz);
        const inBounds = nx > DETAIL.x0 + 8 && nx < DETAIL.x1 - 8 && nz > DETAIL.z0 + 8 && nz < DETAIL.z1 - 8;
        if (!(inBounds && here > MAX_SLOPE && there < here)) return false;
      }
      this.pos.x = nx;
      this.pos.z = nz;
      return true;
    };
    const mx = this.vel.x * dt;
    const mz = this.vel.z * dt;
    if (Math.abs(mx) + Math.abs(mz) > 1e-6) {
      if (!tryMove(this.pos.x + mx, this.pos.z + mz)) {
        const okX = tryMove(this.pos.x + mx, this.pos.z);
        const okZ = tryMove(this.pos.x, this.pos.z + mz);
        if (!okX) this.vel.x *= 0.2;
        if (!okZ) this.vel.z *= 0.2;
      }
    }

    // Vertical
    const ground = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y, STEP).y;
    if (this.grounded) {
      if (this.pos.y - ground > 0.6) {
        // walked off a ledge
        this.grounded = false;
        this.vel.y = 0;
      } else {
        // follow slopes and steps (up or down)
        this.pos.y += (ground - this.pos.y) * Math.min(1, dt * 22);
        if (Math.abs(ground - this.pos.y) < 0.02) this.pos.y = ground;
        this.vel.y = 0;
        this.airTime = 0;
      }
    }
    if (!this.grounded) {
      this.airTime += dt;
      this.vel.y -= GRAVITY * dt;
      this.pos.y += this.vel.y * dt;
      // bump the head on ceilings (e.g. inside the hidden chamber)
      if (this.vel.y > 0 && this.world.solidAt(this.pos.x, this.pos.y + HEIGHT, this.pos.z, 0)) this.vel.y = 0;
      if (this.pos.y <= ground && this.vel.y <= 0) {
        this.pos.y = ground;
        this.vel.y = 0;
        this.grounded = true;
        this.airTime = 0;
      }
    }
    if (jump && (this.grounded || this.airTime < COYOTE) && this.vel.y <= 0.01) {
      this.vel.y = JUMP_SPEED;
      this.grounded = false;
      this.airTime = COYOTE;
      this.pos.y += 0.02;
    }

    // Remember a safe spot; recover if something goes badly wrong
    this.safeTimer += dt;
    if (this.grounded && this.safeTimer > 0.5 && this.walkable(this.pos.x, this.pos.z, this.pos.y)) {
      this.safe.copyFrom(this.pos);
      this.safeTimer = 0;
    }
    if (this.pos.y < -120 || !Number.isFinite(this.pos.y)) this.respawn();
  }

  respawn() {
    this.pos.copyFrom(this.safe);
    this.vel.setAll(0);
    this.grounded = true;
  }
}
