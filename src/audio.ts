// Procedural ambience via Web Audio: mountain wind, distant birdsong, footsteps.
// No audio files are needed. Must be started from a user gesture (browser policy).

export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private birdTimer = 0;
  private fluteTimer = 4;
  private chiselTimer = 2;
  /** 15th-century settlement ambience (flute phrases, masons' chisels) */
  era = false;
  muted = false;

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    // 2 seconds of white noise, looped
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Wind: band-passed noise with slow gusting
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 380;
    bp.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.12;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.07;
    lfo.connect(lfoGain).connect(windGain.gain);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.11;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 160;
    lfo2.connect(lfo2Gain).connect(bp.frequency);
    src.connect(bp).connect(windGain).connect(this.master);
    src.start();
    lfo.start();
    lfo2.start();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  update(dt: number) {
    if (!this.ctx || this.muted) return;
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 3 + Math.random() * 8;
      this.chirp();
    }
    if (this.era) {
      this.fluteTimer -= dt;
      if (this.fluteTimer <= 0) { this.fluteTimer = 14 + Math.random() * 14; this.flute(); }
      this.chiselTimer -= dt;
      if (this.chiselTimer <= 0) { this.chiselTimer = 4 + Math.random() * 7; this.chisel(); }
    }
  }

  private tone(freq: number, t: number, dur: number, vol: number, type: OscillatorType = 'sine', dest?: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0003, t + dur);
    o.connect(g).connect(dest ?? this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private ready() {
    return !!this.ctx && !this.muted;
  }

  /** Breathy quena-like pentatonic phrase, distant. */
  private flute() {
    const ctx = this.ctx!;
    const scale = [392, 440, 523.25, 587.33, 659.25, 784];
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.2 - 0.6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    pan.connect(lp).connect(this.master!);
    let t = ctx.currentTime + 0.05;
    let idx = 2 + Math.floor(Math.random() * 3);
    const n = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const dur = i === n - 1 ? 1.1 : 0.28 + Math.random() * 0.35;
      const o = this.tone(scale[idx], t, dur, 0.028, 'sine', pan);
      const vib = ctx.createOscillator();
      const vg = ctx.createGain();
      vib.frequency.value = 5.5;
      vg.gain.value = 4;
      vib.connect(vg).connect(o.frequency);
      vib.start(t);
      vib.stop(t + dur + 0.05);
      t += dur * 0.92;
      idx = Math.max(0, Math.min(scale.length - 1, idx + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2))));
    }
  }

  /** Distant stone-mason taps. */
  private chisel() {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const k = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < k; i++) this.tone(1500 + Math.random() * 400, t0 + i * 0.42, 0.06, 0.012, 'triangle');
  }

  coin() {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    this.tone(1318.5, t, 0.18, 0.06, 'triangle');
    this.tone(1975.5, t + 0.07, 0.35, 0.05, 'triangle');
  }

  click() {
    if (!this.ready() || !this.noise) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t, Math.random(), 0.14);
    this.tone(180, t, 0.12, 0.05, 'triangle');
  }

  /** Stone grinding + resolving chord. */
  unlock() {
    if (!this.ready() || !this.noise) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.3);
    g.gain.linearRampToValueAtTime(0.0, t + 2.6);
    src.connect(lp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 2.7);
    [392, 493.88, 587.33, 783.99].forEach((f, i) => this.tone(f, t + 0.2 + i * 0.12, 2.2, 0.035, 'sine'));
  }

  /** Rising shimmer for the transformation. */
  swell(seconds: number) {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    [196, 293.66, 392, 587.33, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = i < 2 ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(f * 0.5, t);
      o.frequency.exponentialRampToValueAtTime(f, t + seconds * 0.55);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03, t + seconds * 0.5);
      g.gain.linearRampToValueAtTime(0.0, t + seconds + 1.2);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + seconds + 1.3);
    });
  }

  chime() {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    [659.25, 987.77].forEach((f, i) => this.tone(f, t + i * 0.09, 0.5, 0.035));
  }

  private chirp() {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1800;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.master!);
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = t0 + i * (0.09 + Math.random() * 0.06);
      o.type = 'sine';
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.3), t);
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), t + 0.07);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.025, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  footstep(speed: number) {
    if (!this.ctx || !this.noise || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500 + Math.random() * 300;
    const g = ctx.createGain();
    const vol = 0.05 + Math.min(1, speed / 6) * 0.06;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.11);
    src.connect(lp).connect(g).connect(this.master!);
    src.start(t, Math.random() * 1.5, 0.12);
  }
}
