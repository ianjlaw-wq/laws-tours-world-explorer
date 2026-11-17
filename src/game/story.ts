// Story content. Every note is labelled: 'history' = documented / widely accepted scholarship,
// 'story' = invented for this game. Keep historical claims conservative.

export type NoteKind = 'history' | 'story';
export interface Note { kind: NoteKind; title: string; text: string }

export const OBJECTIVES: Record<string, string> = {
  walk: 'Walk the Inca Trail through the Sun Gate towards Machu Picchu.',
  meet: 'Someone is waiting at the guardhouse above the terraces. Go and meet them.',
  gold: 'Follow the trail of gold down the terrace staircase.',
  puzzle: 'Examine the carved stone wheels in front of the terrace wall.',
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

export interface DialogueChoice { text: string; next: string | null; effect?: string }
export interface DialogueNode { speaker: string; text: string; choices: DialogueChoice[]; note?: Note }

export const INTRO_DIALOGUE: Record<string, DialogueNode> = {
  start: {
    speaker: 'Killa',
    text: 'Allillanchu! Welcome, traveller. You came down from Inti Punku, the Gate of the Sun. Few arrive by that road unless they have walked a long way.',
    choices: [
      { text: 'Who are you?', next: 'who' },
      { text: 'What is this place?', next: 'place' },
      { text: 'I heard something is hidden here…', next: 'mystery' },
    ],
  },
  who: {
    speaker: 'Killa',
    text: 'I am Killa. My family tends these terraces: maize below, potatoes higher up where the air is cold. You look tired. And curious.',
    choices: [
      { text: 'What is this place?', next: 'place' },
      { text: 'Curious about what?', next: 'mystery' },
    ],
  },
  place: {
    speaker: 'Killa',
    text: 'This is the mountain estate of the Sapa Inca. The masons are still shaping stone for the temples. You can hear their hammers from dawn.',
    note: GENERAL_NOTES[0],
    choices: [
      { text: 'Who are you?', next: 'who' },
      { text: 'Is anything hidden here?', next: 'mystery' },
    ],
  },
  mystery: {
    speaker: 'Killa',
    text: 'The elders tell a story. Only a story, perhaps. A chamber lies sealed beneath the terraces, closed by a stone that turns like the sky. They say the three worlds open the way: the condor above, the puma between, the serpent below.',
    choices: [
      { text: 'Where should I look?', next: 'trail' },
      { text: 'Sounds like a legend.', next: 'legend' },
    ],
  },
  legend: {
    speaker: 'Killa',
    text: 'Legends are maps that lost their lines. But someone has been dropping gold on the terrace stairs. Odd, for a legend.',
    choices: [{ text: 'Then I\'ll follow the gold.', next: null, effect: 'startGold' }],
  },
  trail: {
    speaker: 'Killa',
    text: 'Follow the glint of gold down the long stairway to the plaza. Where it ends, look for the turning stone. Remember: sky, earth, and the world below.',
    choices: [{ text: 'Thank you, Killa.', next: null, effect: 'startGold' }],
  },
};

export const REPEAT_DIALOGUE: Record<string, DialogueNode> = {
  start: {
    speaker: 'Killa',
    text: 'Sky, earth, and the world below: condor, puma, serpent. The gold will lead you down the stairs.',
    choices: [{ text: 'Goodbye.', next: null }],
  },
};

export const AFTER_DIALOGUE: Record<string, DialogueNode> = {
  start: {
    speaker: 'Killa',
    text: 'You opened it? Then the elders were right after all. The mountain has many more secrets. Walk freely, traveller.',
    choices: [{ text: 'Goodbye, Killa.', next: null }],
  },
};

export const CHECKPOINTS: Record<string, { x: number; z: number; heading: number; label: string }> = {
  sungate: { x: 160, z: -249, heading: Math.atan2(128 - 160, -216 + 249), label: 'Sun Gate' },
  guardhouse: { x: 2, z: -110, heading: 0, label: 'Guardhouse' },
  mechanism: { x: 14, z: -35.5, heading: Math.PI, label: 'Plaza' },
  chamber: { x: 14, z: -41, heading: Math.PI, label: 'Hidden Chamber' },
};
