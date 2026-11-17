// Automatic local save (browser localStorage). Never throws: storage may be unavailable.

const KEY = 'ltwe.save.v1';

export interface SaveData {
  v: 1;
  /** last safe grounded position of the explorer */
  pos: { x: number; y: number; z: number; heading: number } | null;
  checkpoint: string;
  coins: string[];
  gold: number;
  puzzles: string[];
  discovered: string[];
  flags: {
    transformed: boolean;
    introDialogue: boolean;
    treasure: boolean;
  };
  objective: string;
  savedAt: number;
}

export function freshSave(): SaveData {
  return {
    v: 1,
    pos: null,
    checkpoint: 'sungate',
    coins: [],
    gold: 0,
    puzzles: [],
    discovered: [],
    flags: { transformed: false, introDialogue: false, treasure: false },
    objective: 'walk',
    savedAt: 0,
  };
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<SaveData>;
    if (d.v !== 1) return null;
    const base = freshSave();
    return {
      ...base,
      ...d,
      flags: { ...base.flags, ...(d.flags ?? {}) },
      coins: Array.isArray(d.coins) ? d.coins.filter((c) => typeof c === 'string') : [],
      puzzles: Array.isArray(d.puzzles) ? d.puzzles : [],
      discovered: Array.isArray(d.discovered) ? d.discovered : [],
      gold: Number.isFinite(d.gold) ? (d.gold as number) : 0,
    } as SaveData;
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData): boolean {
  try {
    d.savedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}
