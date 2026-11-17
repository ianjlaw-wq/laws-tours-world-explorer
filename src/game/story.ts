// Story content. Every note is labelled: 'history' = documented / widely accepted scholarship,
// 'story' = invented for this game. Keep historical claims conservative.

export type NoteKind = 'history' | 'story';
export interface Note { kind: NoteKind; title: string; text: string }

export const OBJECTIVES: Record<string, string> = {
  walk: 'Pass through the Sun Gate. Someone is waiting for you on the trail.',
  meet: 'Talk to Killa, your guide to Machu Picchu.',
  gold: 'Follow the trail and the gold coins down to the carved doorway below the terraces.',
  puzzle: 'You found the carved doorway! Examine the turning stones in front of it.',
  chamber: 'The way is open. Enter the hidden chamber.',
  explore: 'Explore freely. Discover every landmark of Machu Picchu.',
};

/** Landmark notes keyed by ZONES name. */
export const LANDMARK_NOTES: Record<string, Note> = {
  'Inti Punku · The Sun Gate': { kind: 'history', title: 'Inti Punku', text: 'The "Sun Gate" is a stone gateway on the ridge above Machu Picchu where the Inca Trail from the south-east reaches the site. It probably served as a controlled entrance.' },
  'The Inca Trail': { kind: 'history', title: 'The Inca road', text: 'The Inca built a road network (Qhapaq Ñan) of tens of thousands of kilometres. The stretch to Machu Picchu is paved with stone and includes stairways cut into the mountainside.' },
  'The Guardhouse': { kind: 'history', title: 'The Guardhouse', text: 'A small thatched building, reconstructed in modern times, overlooks the site from the upper agricultural terraces. Nearby is a carved stone often called the "Funerary Rock".' },
  'Agricultural Terraces': { kind: 'history', title: 'Agricultural terraces', text: 'Terraces held soil on steep slopes, controlled erosion and drained heavy rain through layered stone and gravel fill. Crops such as maize and potatoes were grown in the Andes.' },
  'Main Plaza': { kind: 'history', title: 'Main Plaza', text: 'A large open lawn divides the site into an upper sector (often called hanan) and a lower sector (hurin).' },
  'Temple of the Sun': { kind: 'history', title: 'Temple of the Sun', text: 'A curved tower of finely fitted stone built over a rock outcrop. One of its windows is widely reported to align with sunrise at the June solstice.' },
  'Sacred Plaza': { kind: 'history', title: 'Sacred Plaza', text: 'Surrounded by the Main Temple and the Temple of the Three Windows, built with large polished blocks fitted without mortar.' },
  'Intihuatana': { kind: 'history', title: 'Intihuatana', text: 'A carved granite stone on a stepped hill. The name is often translated "hitching post of the sun"; its exact purpose is still debated.' },
  'Temple of the Condor': { kind: 'history', title: 'Temple of the Condor', text: 'Natural rock formations here are commonly interpreted as the outstretched wings of a condor, with a carved stone on the ground as its head.' },
  'Sacred Rock': { kind: 'history', title: 'Sacred Rock', text: 'A large flat stone at the north end of the site, set in front of the mountains, flanked by two three-walled halls (wayronas).' },
  'Eastern Residential Sector': { kind: 'history', title: 'Residential sector', text: 'Groups of houses around small courtyards. Ordinary walls used fieldstone set in clay mortar; the finest fitted masonry was reserved for important buildings.' },
  'The Carved Doorway': { kind: 'story', title: 'The Carved Doorway', text: 'A sealed doorway with a golden sun, guarded by three turning stones. The doorway, its decorations and the stones are invented for the game.' },
  'The Hidden Chamber': { kind: 'story', title: 'The Hidden Chamber', text: 'This chamber and its stone mechanism are invented for the game. No such room is known at Machu Picchu.' },
};

export const GENERAL_NOTES: Note[] = [
  { kind: 'history', title: 'Machu Picchu', text: 'Built in the mid-1400s, most likely as a royal estate associated with the Inca ruler Pachacuti. It was abandoned around the time of the Spanish conquest, drew international attention after Hiram Bingham\'s 1911 expedition, and became a UNESCO World Heritage Site in 1983.' },
  { kind: 'history', title: 'The three worlds', text: 'Andean cosmology is commonly described as three realms: Hanan Pacha (the upper world, associated with the condor), Kay Pacha (this world, the puma) and Uku Pacha (the inner world, the serpent).' },
  { kind: 'history', title: 'Inca stonework', text: 'Important buildings used precisely fitted blocks without mortar. Walls often lean slightly inwards and doorways and windows are trapezoidal, which helps them withstand earthquakes.' },
  { kind: 'story', title: 'The transformation', text: 'The game shows the site "coming to life" as a living settlement around 1450. The people, roofs, crops and smoke are an artistic impression, not a reconstruction of a specific day.' },
  { kind: 'story', title: 'Killa', text: 'Killa is a fictional character. Her name means "moon" in Quechua. Her legend of the hidden chamber is part of the game\'s story.' },
];

// ---------------- Dialogue ----------------
// Every node's text is spoken by Killa (speech synthesis or, later, a recorded clip) and shown as a
// subtitle. Nodes without choices continue to `next` automatically when the line has been spoken.

export interface DialogueChoice { text: string; next: string | null; effect?: string }
export interface DialogueNode {
  speaker: string;
  text: string;
  choices: DialogueChoice[];
  /** continue automatically to this node (when there are no choices) */
  next?: string | null;
  /** run when the line has finished (e.g. 'transform') */
  effect?: string;
  note?: Note;
  /** optional recorded voice clip (future) */
  clip?: string;
}

const K = 'Killa';

/** Pieces shared by several conversations. */
const DIRECTIONS: Record<string, DialogueNode> = {
  way: {
    speaker: K,
    text: 'Your first adventure is waiting below. Follow this trail down to the terraces, then follow the gold coins down the great stairway.',
    choices: [], next: 'door',
  },
  door: {
    speaker: K,
    text: 'At the bottom you will find a carved doorway with a golden sun, and torches burning beside it. In front of it stand the turning stones.',
    choices: [
      { text: 'I\'m on my way!', next: null, effect: 'finishIntro' },
      { text: 'What are the turning stones?', next: 'stones' },
    ],
  },
  stones: {
    speaker: K,
    text: 'The elders say they guard a sealed chamber. The three worlds open the way: the condor above, the puma between, the serpent below.',
    choices: [{ text: 'Thank you, Killa. I\'m on my way!', next: null, effect: 'finishIntro' }],
  },
};

/** First meeting, just beyond the Sun Gate (present-day ruins, before the transformation). */
export const MEET_DIALOGUE: Record<string, DialogueNode> = {
  start: {
    speaker: K,
    text: 'Allillanchu! Hello, traveller, and welcome to Machu Picchu. My name is Killa.',
    choices: [], next: 'ruins',
  },
  ruins: {
    speaker: K,
    text: 'Today these are quiet ruins. But I can show you this mountain as my people knew it, more than five hundred years ago.',
    choices: [], next: 'watch',
  },
  watch: {
    speaker: K,
    text: 'Look out over the city, and watch it come alive!',
    choices: [], next: 'living', effect: 'transform',
  },
  living: {
    speaker: K,
    text: 'This is Machu Picchu around the year 1450, in the time of the Inca. Smoke rises from the hearths, and maize grows on the terraces.',
    note: { kind: 'story', title: 'An artistic impression', text: 'The people, roofs, crops and smoke show the idea of a living Inca estate. They are not a reconstruction of a specific day.' },
    choices: [], next: 'way',
  },
  ...DIRECTIONS,
};

/** First meeting for older saves that had already seen the transformation. */
export const MEET_LATE_DIALOGUE: Record<string, DialogueNode> = {
  start: {
    speaker: K,
    text: 'Allillanchu! Hello, traveller. My name is Killa. Welcome to Machu Picchu, in the time of the Inca.',
    choices: [], next: 'way',
  },
  ...DIRECTIONS,
};

/** Later conversations, before the puzzle is solved. */
export const REPEAT_DIALOGUE: Record<string, DialogueNode> = {
  start: {
    speaker: K,
    text: 'Hello again, traveller. How can I help you?',
    choices: [
      { text: 'Where should I go?', next: 'way2' },
      { text: 'Who are you?', next: 'who' },
      { text: 'What is this place?', next: 'place' },
      { text: 'Goodbye.', next: null },
    ],
  },
  way2: {
    speaker: K,
    text: 'Go down the great stairway through the terraces, following the gold. The carved doorway with the golden sun is at the bottom, on the right.',
    choices: [
      { text: 'What are the turning stones?', next: 'mystery' },
      { text: 'Thank you.', next: null },
    ],
  },
  who: {
    speaker: K,
    text: 'I am Killa. My family tends these terraces: maize below, potatoes higher up, where the air is cold.',
    choices: [
      { text: 'What is this place?', next: 'place' },
      { text: 'Where should I go?', next: 'way2' },
      { text: 'Goodbye.', next: null },
    ],
  },
  place: {
    speaker: K,
    text: 'This is the mountain estate of the Sapa Inca. The masons are still shaping stone for the temples. You can hear their hammers from dawn.',
    note: GENERAL_NOTES[0],
    choices: [
      { text: 'Who are you?', next: 'who' },
      { text: 'Where should I go?', next: 'way2' },
      { text: 'Goodbye.', next: null },
    ],
  },
  mystery: {
    speaker: K,
    text: 'The elders tell a story. A chamber lies sealed beneath the terraces, closed by stones that turn like the sky. The three worlds open the way: the condor above, the puma between, the serpent below.',
    choices: [
      { text: 'Sounds like a legend.', next: 'legend' },
      { text: 'Thank you, Killa.', next: null },
    ],
  },
  legend: {
    speaker: K,
    text: 'Legends are maps that lost their lines. But someone has been dropping gold on the terrace stairs. Odd, for a legend.',
    choices: [{ text: 'Then I\'ll follow the gold.', next: null }],
  },
};

export const AFTER_DIALOGUE: Record<string, DialogueNode> = {
  start: {
    speaker: K,
    text: 'You opened it? Then the elders were right after all. The mountain has many more secrets. Walk freely, traveller.',
    choices: [{ text: 'Goodbye, Killa.', next: null }],
  },
};

export const CHECKPOINTS: Record<string, { x: number; z: number; heading: number; label: string }> = {
  sungate: { x: 159.57, z: -249.42, heading: Math.atan2(128 - 159.57, -216 + 249.42), label: 'Sun Gate' },
  guardhouse: { x: 2, z: -110, heading: 0, label: 'Guardhouse' },
  mechanism: { x: 14, z: -35.5, heading: Math.PI, label: 'Plaza' },
  chamber: { x: 14, z: -41, heading: Math.PI, label: 'Hidden Chamber' },
};
