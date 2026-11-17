# Laws Tours — World Explorer

A mobile-first, browser-based 3D exploration adventure. First destination: **Machu Picchu, Peru**.

Built with [Babylon.js](https://www.babylonjs.com/) (Apache-2.0), TypeScript and Vite. Deployed to GitHub Pages.

## Play

- **Touchscreen (landscape):** fixed joystick bottom-left (push further to run), swipe anywhere else to look, pinch to zoom, JUMP button to jump, TALK / EXAMINE / TAKE button to interact, 📖 for the Journal.
- **Keyboard & mouse:** WASD / arrow keys to walk, Shift to run, Space to jump, drag to look, mouse wheel to zoom, E to interact, J for the Journal, Esc to close panels or skip the transformation.
- URL options: `?fps` shows a frame-rate counter; `?quality=low` disables shadows and grass for slower phones.

## Develop

```bash
npm install
npm run dev        # local dev server (http://localhost:5173/laws-tours-world-explorer/)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build (http://localhost:4173/laws-tours-world-explorer/)
npm run smoke      # headless browser smoke test against the preview server (screenshots in test-output/)
npm run touchtest  # real multi-touch (CDP) checks of the fixed joystick, camera gestures and JUMP
npm run advtest    # end-to-end Milestone C test: transformation, Killa, coins, puzzle, chamber, journal, saves
```

The smoke test needs a Chromium binary: it uses the Playwright browser cache, or set `CHROME_PATH`.

## Project layout

```
src/
  main.ts              bootstrap, loading screen, game loop, adaptive quality
  input.ts             keyboard, mouse, virtual joystick, swipe/pinch camera, jump
  camera.ts            third-person follow camera with terrain/wall avoidance
  audio.ts             procedural ambience (wind, birds, footsteps) via Web Audio
  player/explorer.ts   procedural explorer model + animation
  player/controller.ts walk/run/jump kinematic controller
  world/layout.ts      site layout: trail, sectors, terraces, named zones
  world/terrain.ts     height model, terrain meshes, exact ground queries
  world/colliders.ts   box collision world
  world/site.ts        Sun Gate, terraces, temples, houses, trees, trail paving, clouds
  world/environment.ts sky, sun, fog, shadows, river
  world/textures.ts    procedural textures (foliage, grass, clouds)
  game/adventure.ts    Milestone C: transformation, villager, coins, puzzle, chamber, journal, autosave
  game/story.ts        dialogue, objectives, journal notes (each labelled History or Story)
  game/save.ts         versioned localStorage save
  game/glyphs.ts       carved symbols shared by the 3D wheels and the puzzle panel
```

## Saving

Progress is saved automatically in the browser's localStorage (key `ltwe.save.v1`) every few seconds,
on every collectible/puzzle/dialogue event and when the page is hidden: last safe position, checkpoint,
collected coin IDs, gold, solved puzzles, discovered landmarks, transformation and dialogue flags.
The loading screen offers *Continue* or *New journey*; the Journal also has a reset button.

## Accuracy and assets

- **The landscape and ruins are an artistic approximation** inspired by the real layout of Machu Picchu (saddle between Machu Picchu Mountain and Huayna Picchu, Sun Gate on the south-east ridge, agricultural terraces, main plaza, upper/lower sectors). Distances and heights are compressed for gameplay; it is **not** survey-accurate.
- **Photo textures:** CC0 (public domain) from Poly Haven. See `public/textures/LICENSE.md`. Regenerate with `node scripts/prepare-textures.mjs`.
- Geometry, the explorer, foliage cards, clouds and audio are generated in code. Libraries: Babylon.js (Apache-2.0); Vite/TypeScript (build-time only).

- **Story vs history:** Killa, the hidden chamber, the turning-stone mechanism and the golden llama are fictional.
  Journal notes and dialogue notes are tagged **History** (documented / widely accepted) or **Story** (invented).

## Status

Milestone C (first playable adventure). See `docs/ROADMAP.md`.
