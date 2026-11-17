// Route following for the objective indicator: the arrow points along the path the player should
// actually walk (trail -> terrace stairway -> doorway), not straight through cliffs and walls.

export type P2 = [number, number];

export class Polyline {
  readonly cum: number[] = [0];
  readonly total: number;
  constructor(readonly pts: P2[]) {
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    this.total = this.cum[this.cum.length - 1];
  }

  /** Closest point on the route: arc length `s` and distance `d` (written into `out`). */
  project(x: number, z: number, out: { s: number; d: number }) {
    let best = Infinity;
    let bestS = 0;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const [ax, az] = this.pts[i];
      const [bx, bz] = this.pts[i + 1];
      const vx = bx - ax, vz = bz - az;
      const len2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2));
      const d = Math.hypot(ax + vx * t - x, az + vz * t - z);
      if (d < best) { best = d; bestS = this.cum[i] + t * Math.sqrt(len2); }
    }
    out.s = bestS;
    out.d = best;
    return out;
  }

  /** Point at arc length s (clamped), written into `out`. */
  pointAt(s: number, out: { x: number; z: number }) {
    s = Math.max(0, Math.min(this.total, s));
    let i = 0;
    while (i < this.pts.length - 2 && this.cum[i + 1] < s) i++;
    const seg = this.cum[i + 1] - this.cum[i] || 1;
    const t = (s - this.cum[i]) / seg;
    out.x = this.pts[i][0] + (this.pts[i + 1][0] - this.pts[i][0]) * t;
    out.z = this.pts[i][1] + (this.pts[i + 1][1] - this.pts[i][1]) * t;
    return out;
  }
}

/** On-screen objective arrow (top centre). Writes to the DOM only when something visibly changes. */
export class NavIndicator {
  private el = document.getElementById('nav')!;
  private arrow = document.getElementById('nav-arrow')!;
  private label = document.getElementById('nav-label')!;
  private shown = false;
  private lastDeg = 1e9;
  private lastText = '';
  private proj = { s: 0, d: 0 };
  private carrot = { x: 0, z: 0 };
  /** for tests: last computed world bearing to the steering point, and the arrow angle */
  bearing = 0;
  arrowDeg = 0;
  /** remaining distance along the route (m) */
  distance = 0;

  constructor(private route: Polyline, private name: string) {}

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.el.hidden = true;
  }

  /**
   * px/pz = player position, camYaw = horizontal direction the camera looks (rotation.y convention).
   * `direct` = when the player is off the route in the open city, aim straight at the goal.
   */
  update(px: number, pz: number, camYaw: number) {
    const r = this.route;
    r.project(px, pz, this.proj);
    const end = r.pts[r.pts.length - 1];
    let tx: number, tz: number, dist: number;
    const directToGoal = Math.hypot(end[0] - px, end[1] - pz);
    if ((this.proj.d > 12 && pz > -50) || directToGoal < 14) {
      tx = end[0]; tz = end[1]; dist = directToGoal;
    } else {
      r.pointAt(this.proj.s + 9, this.carrot);
      tx = this.carrot.x; tz = this.carrot.z;
      dist = r.total - this.proj.s + this.proj.d;
    }
    this.bearing = Math.atan2(tx - px, tz - pz);
    this.distance = dist;
    let rel = this.bearing - camYaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const deg = Math.round((rel * 180) / Math.PI / 3) * 3;
    this.arrowDeg = deg;
    if (!this.shown) { this.shown = true; this.el.hidden = false; }
    if (deg !== this.lastDeg) {
      this.lastDeg = deg;
      this.arrow.style.transform = `rotate(${deg}deg)`;
    }
    const m = dist < 20 ? Math.max(1, Math.round(dist)) : Math.round(dist / 10) * 10;
    const text = `${this.name} · ${m} m`;
    if (text !== this.lastText) {
      this.lastText = text;
      this.label.textContent = text;
    }
  }
}
