// Player preferences (audio / subtitles), stored separately from adventure progress so that
// "New journey" never resets them. Never throws: storage may be unavailable.

const KEY = 'ltwe.prefs.v1';

export interface Prefs {
  /** Killa's spoken dialogue */
  voice: boolean;
  /** subtitles (always shown anyway when speech is muted or unavailable) */
  subs: boolean;
  /** ambient sound and effects */
  sound: boolean;
}

export function loadPrefs(): Prefs {
  const d: Prefs = { voice: true, subs: false, sound: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<Prefs>;
    if (typeof p.voice === 'boolean') d.voice = p.voice;
    if (typeof p.subs === 'boolean') d.subs = p.subs;
    if (typeof p.sound === 'boolean') d.sound = p.sound;
  } catch { /* defaults */ }
  return d;
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch { /* ignore */ }
}
