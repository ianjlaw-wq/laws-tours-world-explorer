// World layout for the Machu Picchu prototype.
//
// Units are metres. +X = east, +Z = north, +Y = up. The main plaza is at y = 0.
// IMPORTANT: this is an artistic, compressed approximation of the real site's
// arrangement (ridge saddle between Machu Picchu Mountain to the south and
// Huayna Picchu to the north, agricultural terraces to the south, urban sector
// to the north, Sun Gate up on the south-east ridge). Distances and heights are
// scaled down for gameplay and are NOT survey accurate.

export interface Vec3 { x: number; y: number; z: number }

/** Inca Trail waypoints from just behind the Sun Gate down to the guardhouse terrace. */
export const TRAIL: Vec3[] = [
  { x: 168, y: 77, z: -256 },
  { x: 150, y: 74, z: -239 }, // Inti Punku (Sun Gate)
  { x: 128, y: 66, z: -216 },
  { x: 102, y: 58, z: -194 },
  { x: 74, y: 49, z: -170 },
  { x: 49, y: 40, z: -148 },
  { x: 26, y: 32, z: -129 },
  { x: 10, y: 27, z: -117 },
  { x: 0, y: 25, z: -112 },
];
export const TRAIL_HALF_WIDTH = 1.8;

export const SUN_GATE = { x: 150, z: -239, y: 74 };
/** Player start: just behind the Sun Gate, looking down towards the city. */
export const PLAYER_START = { x: 160, z: -249, y: 76 };

// ---- Site levels ----
export const PLAZA_Y = 0;
export const WEST_Y = 4; // Hanan (upper / sacred) sector
export const EAST_Y = -2; // Hurin (lower / residential) sector

// Agricultural terraces climbing south from the plaza to the guardhouse.
export const AG = {
  count: 10,
  zStart: -44, // north (front) edge of first terrace
  depth: 6.2,
  rise: 2.5,
  x0: -34,
  x1: 30,
  stairX: -2,
};
export const FLANK = { rows: 5, width: 4 };

export const AG_TOP_Y =AG.rise * AG.count; // 25
export const AG_Z_END = AG.zStart - AG.depth * AG.count; // -106

export const GUARDHOUSE = { x: -12, z: -115, y: AG_TOP_Y };

export interface Pad {
  x0: number; x1: number; z0: number; z1: number;
  /** target height inside the rectangle */
  h: (x: number, z: number) => number;
  blend: number;
}

const flat = (y: number) => () => y;

/** Terrain flattening pads, applied in order (later pads win). */
export const PADS: Pad[] = [
  // Main plaza and the urban core
  { x0: -20, x1: 20, z0: -44, z1: 68, h: flat(PLAZA_Y), blend: 8 },
  // West (upper) sector
  { x0: -50, x1: -21, z0: -40, z1: 74, h: flat(WEST_Y), blend: 2 },
  // East (lower) sector
  { x0: 22, x1: 50, z0: -40, z1: 60, h: flat(EAST_Y), blend: 2 },
  // Flank terraces (east and west), stepping down the ridge sides.
  // Terrain sits well below the stepped terrace boxes that are built on top.
  { x0: 50.5, x1: 50 + FLANK.rows * FLANK.width, z0: -38, z1: 58, h: (x) => EAST_Y - (AG.rise * (x - 50)) / FLANK.width - 2.9, blend: 3 },
  { x0: -50 - FLANK.rows * FLANK.width, x1: -50.5, z0: -38, z1: 60, h: (x) => WEST_Y - (AG.rise * (-50 - x)) / FLANK.width - 2.9, blend: 3 },
  // Agricultural terraces slope (terrain sits just under the terrace tops)
  {
    x0: AG.x0, x1: AG.x1, z0: AG_Z_END, z1: AG.zStart,
    h: (_x, z) => ((AG.zStart - z) / (AG.depth * AG.count)) * AG_TOP_Y - 0.4,
    blend: 2,
  },
  // Guardhouse platform at the top of the terraces
  { x0: -24, x1: 8, z0: -124, z1: AG_Z_END, h: flat(AG_TOP_Y), blend: 6 },
  // Sun Gate saddle
  { x0: 142, x1: 172, z0: -260, z1: -232, h: (x, z) => 74 + Math.max(0, ((x - 150) - (z + 239)) * 0.06), blend: 6 },
];

/** Named areas for the location banner. Checked in order; first match wins. */
export interface Zone { name: string; x: number; z: number; r: number }
export const ZONES: Zone[] = [
  { name: 'Inti Punku · The Sun Gate', x: 150, z: -239, r: 22 },
  { name: 'The Guardhouse', x: -12, z: -115, r: 16 },
  { name: 'Intihuatana', x: -30, z: 60, r: 12 },
  { name: 'Temple of the Sun', x: -32, z: -12, r: 12 },
  { name: 'Sacred Plaza', x: -32, z: 32, r: 14 },
  { name: 'Temple of the Condor', x: 34, z: -20, r: 12 },
  { name: 'Sacred Rock', x: 0, z: 78, r: 12 },
  { name: 'Main Plaza', x: 0, z: 12, r: 26 },
  { name: 'Eastern Residential Sector', x: 36, z: 25, r: 26 },
  { name: 'Agricultural Terraces', x: -2, z: -75, r: 40 },
  { name: 'The Inca Trail', x: 80, z: -175, r: 120 },
];
