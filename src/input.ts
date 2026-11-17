// Unified input: keyboard + mouse on desktop, virtual joystick + swipe camera + jump on touch.

export class Input {
  /** Desired movement in camera space: x = right, y = forward. Magnitude 0..1 */
  moveX = 0;
  moveY = 0;
  run = false;
  private jumpQueued = false;
  /** Accumulated camera look deltas in pixels since last consume */
  lookDX = 0;
  lookDY = 0;
  zoomDelta = 0;
  /** ms timestamp of last manual camera input */
  lastLookTime = -1e9;
  readonly isTouch: boolean;

  private keys = new Set<string>();
  private joyId: number | null = null;
  private joyVec = { x: 0, y: 0 };
  private lookPointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') { this.jumpQueued = true; e.preventDefault(); }
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // Camera look: mouse drag or touch swipe on the canvas
    canvas.addEventListener('pointerdown', (e) => {
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      this.lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.lookPointers.size === 2) this.pinchDist = this.currentPinch();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.lookPointers.get(e.pointerId);
      if (!p) return;
      if (this.lookPointers.size >= 2) {
        p.x = e.clientX; p.y = e.clientY;
        const d = this.currentPinch();
        if (this.pinchDist > 0) this.zoomDelta += (this.pinchDist - d) * 0.03;
        this.pinchDist = d;
        this.lastLookTime = performance.now();
        return;
      }
      const scale = e.pointerType === 'touch' ? 1.4 : 1;
      this.lookDX += (e.clientX - p.x) * scale;
      this.lookDY += (e.clientY - p.y) * scale;
      p.x = e.clientX; p.y = e.clientY;
      this.lastLookTime = performance.now();
    });
    const endLook = (e: PointerEvent) => {
      this.lookPointers.delete(e.pointerId);
      // remaining finger continues from its own last position (no jump)
      if (this.lookPointers.size < 2) this.pinchDist = 0;
    };
    canvas.addEventListener('pointerup', endLook);
    canvas.addEventListener('pointercancel', endLook);
    canvas.addEventListener('lostpointercapture', endLook);

    // Block browser gestures (scroll, pull-to-refresh, double-tap / pinch page zoom) during play,
    // but allow scrolling inside panels marked .scrollable.
    const allowScroll = (t: EventTarget | null) => t instanceof Element && !!t.closest('.scrollable');
    document.addEventListener('touchmove', (e) => { if (!allowScroll(e.target)) e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      this.zoomDelta += Math.sign(e.deltaY) * 0.8;
      this.lastLookTime = performance.now();
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.setupJoystick();
    this.setupJumpButton();
  }

  private currentPinch() {
    const pts = [...this.lookPointers.values()];
    return pts.length < 2 ? 0 : Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  /**
   * Fixed joystick anchored bottom-left. Only a touch that STARTS on the joystick activates it,
   * and only that pointer id drives it; every other finger is free for camera/pinch/buttons.
   */
  private setupJoystick() {
    const zone = document.getElementById('joystick-zone')!;
    const base = document.getElementById('joystick-base')!;
    const knob = document.getElementById('joystick-knob')!;
    const R = 52; // max knob travel in px

    const setKnob = (dx: number, dy: number) => {
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const update = (clientX: number, clientY: number) => {
      // centre is read from the live layout so rotation/resizes never displace input
      const r = base.getBoundingClientRect();
      let dx = clientX - (r.left + r.width / 2);
      let dy = clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      setKnob(dx, dy);
      this.joyVec = { x: dx / R, y: -dy / R };
    };
    const release = () => {
      this.joyId = null;
      this.joyVec = { x: 0, y: 0 };
      setKnob(0, 0);
      zone.classList.remove('active');
    };
    this.releaseJoystick = release;

    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.joyId !== null) return; // already held by another finger
      this.joyId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      zone.classList.add('active');
      update(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyId) return;
      e.preventDefault();
      update(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.joyId) release();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
    // app switched / screen locked: never leave the explorer walking on its own
    document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
    window.addEventListener('blur', release);
  }

  /** Release the joystick (also used when menus/dialogue take over). */
  releaseJoystick: () => void = () => {};

  /** Joystick base position (for tests). */
  joystickActive() {
    return this.joyId !== null;
  }

  private setupJumpButton() {
    const btn = document.getElementById('btn-jump')!;
    btn.addEventListener('pointerdown', (e) => {
      this.jumpQueued = true;
      btn.classList.add('pressed');
      e.preventDefault();
    });
    const up = () => btn.classList.remove('pressed');
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }

  /** Refresh the movement vector from keys/joystick. Call once per frame. */
  update() {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    const keyMag = Math.hypot(x, y);
    if (keyMag > 0) {
      const shift = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      // keyboard: walk by default, Shift to run
      this.moveX = x / keyMag;
      this.moveY = y / keyMag;
      this.run = shift;
      return;
    }
    // joystick: deflection controls speed; beyond ~80% = run
    const jm = Math.hypot(this.joyVec.x, this.joyVec.y);
    const dead = 0.12;
    if (jm < dead) {
      this.moveX = 0; this.moveY = 0; this.run = false;
      return;
    }
    const scaled = Math.min(1, (jm - dead) / (1 - dead));
    this.moveX = (this.joyVec.x / jm) * scaled;
    this.moveY = (this.joyVec.y / jm) * scaled;
    this.run = scaled > 0.8;
  }

  consumeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  private look = { dx: 0, dy: 0, zoom: 0 };
  /** Returns a reused object (no per-frame allocation). */
  consumeLook(): { dx: number; dy: number; zoom: number } {
    const r = this.look;
    r.dx = this.lookDX; r.dy = this.lookDY; r.zoom = this.zoomDelta;
    this.lookDX = 0; this.lookDY = 0; this.zoomDelta = 0;
    return r;
  }

  /** For automated testing: drive movement directly. */
  setVirtualStick(x: number, y: number) {
    this.joyVec = { x, y };
  }
}
