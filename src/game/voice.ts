// Spoken dialogue playback.
//
// Uses the browser's built-in speech synthesis (Web Speech API) - free and offline-capable, but
// the voice quality depends on the device: it is NOT equivalent to recorded voice acting.
// Each line may carry an optional `clip` URL; when present a recorded audio file is played
// instead, so professionally recorded lines can be dropped in later without changing callers.

export interface SpokenLine {
  text: string;
  /** optional recorded audio file (future milestone) */
  clip?: string;
}

export type VoiceStatus = 'idle' | 'speaking' | 'blocked';

const BAD_VOICE = /compact|eloquence|novelty|whisper|bad news|bells|zarvox|trinoids|albert|jester|organ|cellos|bubbles|boing|superstar|wobble|grandma|grandpa|rocko|shelley|reed|sandy|flo|eddy/i;
const FEMALE = /female|samantha|serena|karen|moira|tessa|fiona|victoria|zira|aria|jenny|sonia|libby|hazel|susan|kate|emma|ava|allison|michelle|natasha|clara|joanna|amy|salli/i;
const MALE = /\bmale|daniel|david|mark|george|james|fred|alex|guy|ryan|thomas|oliver|arthur|rishi|aaron/i;

function scoreVoice(v: SpeechSynthesisVoice): number {
  if (!/^en([-_]|$)/i.test(v.lang)) return -1;
  let s = 1;
  if (BAD_VOICE.test(v.name)) s -= 20;
  if (/natural|neural|online|enhanced|premium/i.test(v.name)) s += 6;
  if (/google/i.test(v.name)) s += 3;
  if (FEMALE.test(v.name)) s += 3; // Killa is a young woman
  else if (MALE.test(v.name)) s -= 2;
  if (/en[-_](GB|US|AU|IE|NZ|CA)/i.test(v.lang)) s += 1;
  if (v.default) s += 0.5;
  return s;
}

export class DialogueVoice {
  readonly supported: boolean;
  enabled = true;
  status: VoiceStatus = 'idle';
  /** called whenever `status` changes */
  onStatus: ((s: VoiceStatus) => void) | null = null;
  voiceName = '';
  private synth: SpeechSynthesis | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  private token = 0;
  private timers: number[] = [];
  private audio: HTMLAudioElement | null = null;
  private current: { line: SpokenLine; onEnd: () => void } | null = null;

  constructor() {
    const w = window as unknown as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: unknown };
    this.supported = !!w.speechSynthesis && typeof w.SpeechSynthesisUtterance === 'function';
    if (this.supported) {
      this.synth = w.speechSynthesis!;
      this.pickVoice();
      try { this.synth.addEventListener('voiceschanged', () => this.pickVoice()); } catch { /* old API */ }
    }
    // never keep talking in the background
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); });
  }

  /** True when lines will actually be heard (enabled, supported and not blocked). */
  get audible() {
    return this.enabled && this.supported && this.status !== 'blocked';
  }

  private pickVoice() {
    if (!this.synth) return;
    let best: SpeechSynthesisVoice | null = null;
    let bestScore = 0;
    for (const v of this.synth.getVoices()) {
      const s = scoreVoice(v);
      if (s > bestScore) { best = v; bestScore = s; }
    }
    this.voice = best;
    this.voiceName = best ? `${best.name} (${best.lang})` : '';
  }

  private setStatus(s: VoiceStatus) {
    if (this.status === s) return;
    this.status = s;
    this.onStatus?.(s);
  }

  /**
   * Call from inside a user gesture (e.g. the Start button) so that later automatic speech is
   * permitted by the browser's autoplay policy.
   */
  unlock() {
    if (!this.synth) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      this.synth.speak(u);
    } catch { /* ignore */ }
  }

  /**
   * Speak a line. `onEnd` fires once when it finishes (not when stopped or blocked).
   * Returns false when the line will not be heard (muted / unsupported / blocked).
   */
  speak(line: SpokenLine, onEnd: () => void): boolean {
    this.stop();
    this.current = { line, onEnd };
    if (!this.enabled || this.status === 'blocked') return false;
    if (line.clip) return this.playClip(line, onEnd);
    if (!this.synth) return false;
    const token = ++this.token;
    const synth = this.synth;
    let started = false;
    let done = false;
    const finish = () => {
      if (token !== this.token || done) return;
      done = true;
      this.clearTimers();
      this.setStatus('idle');
      this.current = null;
      onEnd();
    };
    const u = new SpeechSynthesisUtterance(line.text);
    if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; } else u.lang = 'en-GB';
    u.rate = 0.95;
    u.pitch = 1.08;
    u.volume = 1;
    u.onstart = () => {
      if (token !== this.token) return;
      started = true;
      this.setStatus('speaking');
    };
    u.onend = finish;
    u.onerror = (e) => {
      if (token !== this.token) return;
      const err = (e as SpeechSynthesisErrorEvent).error;
      if (err === 'interrupted' || err === 'canceled') return;
      if (err === 'not-allowed' || !started) {
        this.token++;
        this.clearTimers();
        this.setStatus('blocked');
      } else finish();
    };
    this.setStatus('speaking');
    const go = () => {
      if (token !== this.token) return;
      try { synth.speak(u); } catch { this.setStatus('blocked'); }
    };
    // Chrome may silently drop speech that directly follows cancel(), so defer slightly when
    // something was playing; otherwise speak synchronously (keeps a tap's user activation).
    if (this.cancelledAt > performance.now() - 50) this.timers.push(window.setTimeout(go, 60));
    else go();
    // If speech never starts the browser is refusing autoplay (or has no voice): offer Play Voice.
    this.timers.push(window.setTimeout(() => {
      if (token !== this.token || started) return;
      this.token++; // invalidate this attempt (the watchdog must not advance the dialogue)
      this.clearTimers();
      try { synth.cancel(); } catch { /* ignore */ }
      this.setStatus('blocked');
    }, 3000));
    // Watchdog: some engines never fire 'end'.
    const words = line.text.split(/\s+/).length;
    this.timers.push(window.setTimeout(finish, 4000 + (words / 2.3) * 1000 * 1.6));
    return token === this.token && (this.status as VoiceStatus) !== 'blocked';
  }

  private playClip(line: SpokenLine, onEnd: () => void): boolean {
    const token = ++this.token;
    const a = new Audio(line.clip);
    this.audio = a;
    a.onended = () => { if (token === this.token) { this.setStatus('idle'); this.current = null; onEnd(); } };
    a.play().then(() => { if (token === this.token) this.setStatus('speaking'); })
      .catch(() => { if (token === this.token) this.setStatus('blocked'); });
    this.setStatus('speaking');
    return true;
  }

  /** "Play voice" button: retry the current line from inside a user gesture. */
  retry() {
    const c = this.current;
    this.setStatus('idle');
    if (c) this.speak(c.line, c.onEnd);
  }

  /** Stop any speech immediately (skip, dismiss, scene change). */
  private cancelledAt = -1e9;

  stop() {
    this.token++;
    this.clearTimers();
    if (this.synth && (this.synth.speaking || this.synth.pending)) {
      try { this.synth.cancel(); } catch { /* ignore */ }
      this.cancelledAt = performance.now();
    }
    if (this.audio) { this.audio.pause(); this.audio = null; }
    this.current = null;
    if (this.status !== 'blocked') this.setStatus('idle');
  }

  /** Forget a previous autoplay refusal (e.g. after the user re-enables voice). */
  resetBlocked() {
    if (this.status === 'blocked') this.setStatus('idle');
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
  }
}
