// Lightweight collision world: terrain height grid + yaw-rotated boxes.
// Box tops are walkable; box sides block when taller than the step height.

import { TerrainGrid } from './terrain';

export interface Box {
  cx: number; cz: number; // centre
  hx: number; hz: number; // half extents in local x/z
  cos: number; sin: number; // yaw
  y0: number; y1: number; // bottom/top
  minX: number; maxX: number; minZ: number; maxZ: number; // world AABB
}

const CELL = 16;

export class CollisionWorld {
  readonly boxes: Box[] = [];
  private cells = new Map<number, Box[]>();

  constructor(readonly terrain: TerrainGrid) {}

  addBox(cx: number, cz: number, w: number, d: number, y0: number, y1: number, yaw: number): Box {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const hx = w / 2;
    const hz = d / 2;
    const ex = Math.abs(cos * hx) + Math.abs(sin * hz);
    const ez = Math.abs(sin * hx) + Math.abs(cos * hz);
    const b: Box = { cx, cz, hx, hz, cos, sin, y0, y1, minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez };
    this.boxes.push(b);
    // Register with a 1 m margin so circle queries near cell borders still see the box.
    for (let i = Math.floor((b.minX - 1) / CELL); i <= Math.floor((b.maxX + 1) / CELL); i++) {
      for (let j = Math.floor((b.minZ - 1) / CELL); j <= Math.floor((b.maxZ + 1) / CELL); j++) {
        const k = this.key(i, j);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(b);
      }
    }
    return b;
  }

  /** Remove a box (e.g. an opened door). */
  removeBox(b: Box) {
    const i = this.boxes.indexOf(b);
    if (i >= 0) this.boxes.splice(i, 1);
    for (const list of this.cells.values()) {
      const j = list.indexOf(b);
      if (j >= 0) list.splice(j, 1);
    }
  }

  private key(i: number, j: number) {
    return (i + 4096) * 8192 + (j + 4096);
  }

  private near(x: number, z: number): Box[] {
    return this.cells.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? EMPTY;
  }

  /** World -> box-local (x along box width, z along depth). Yaw follows Babylon's rotation.y. */
  private toLocal(b: Box, x: number, z: number): [number, number] {
    const dx = x - b.cx;
    const dz = z - b.cz;
    // inverse of: wx = lx*cos + lz*sin ; wz = -lx*sin + lz*cos
    return [dx * b.cos - dz * b.sin, dx * b.sin + dz * b.cos];
  }

  /**
   * Highest walkable surface under (x,z) that is not above feetY + step.
   * Returns the height and whether it is a man-made surface.
   */
  groundAt(x: number, z: number, feetY: number, step: number): { y: number; structure: boolean } {
    let y = this.terrain.heightAt(x, z);
    let structure = false;
    for (const b of this.near(x, z)) {
      if (b.y1 > feetY + step || b.y1 <= y) continue;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      const [lx, lz] = this.toLocal(b, x, z);
      if (Math.abs(lx) <= b.hx + 0.05 && Math.abs(lz) <= b.hz + 0.05) {
        y = b.y1;
        structure = true;
      }
    }
    return { y, structure };
  }

  /** True if the point is inside (or within `margin` of) any box or below the terrain. */
  solidAt(x: number, y: number, z: number, margin: number): boolean {
    if (y < this.terrain.heightAt(x, z) + margin) return true;
    for (const b of this.near(x, z)) {
      if (y < b.y0 - margin || y > b.y1 + margin) continue;
      if (x < b.minX - margin || x > b.maxX + margin || z < b.minZ - margin || z > b.maxZ + margin) continue;
      const [lx, lz] = this.toLocal(b, x, z);
      if (Math.abs(lx) <= b.hx + margin && Math.abs(lz) <= b.hz + margin) return true;
    }
    return false;
  }

  /** Push a circle out of any blocking boxes. Returns the corrected position. */
  resolve(x: number, z: number, r: number, feetY: number, headY: number, step: number): [number, number] {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of this.near(x, z)) {
        if (b.y1 <= feetY + step || b.y0 >= headY) continue;
        if (x < b.minX - r || x > b.maxX + r || z < b.minZ - r || z > b.maxZ + r) continue;
        const [lx, lz] = this.toLocal(b, x, z);
        const qx = Math.max(-b.hx, Math.min(b.hx, lx));
        const qz = Math.max(-b.hz, Math.min(b.hz, lz));
        let dx = lx - qx;
        let dz = lz - qz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        let nlx: number;
        let nlz: number;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nlx = qx + (dx / d) * r;
          nlz = qz + (dz / d) * r;
        } else {
          // centre inside the box: exit via nearest face
          const px = b.hx - Math.abs(lx);
          const pz = b.hz - Math.abs(lz);
          if (px < pz) { nlx = Math.sign(lx || 1) * (b.hx + r); nlz = lz; }
          else { nlx = lx; nlz = Math.sign(lz || 1) * (b.hz + r); }
        }
        // local -> world
        x = b.cx + nlx * b.cos + nlz * b.sin;
        z = b.cz - nlx * b.sin + nlz * b.cos;
        moved = true;
      }
      if (!moved) break;
    }
    return [x, z];
  }
}

const EMPTY: Box[] = [];
