# Laws Tours — World Explorer

A mobile-first, browser-based 3D exploration adventure. First destination: **Machu Picchu, Peru**.

Built with [Babylon.js](https://www.babylonjs.com/) (Apache-2.0), TypeScript and Vite. Deployed to GitHub Pages.

## Play

- **Touchscreen (landscape):** left thumb = floating joystick (push further to run), swipe the right side to look, pinch to zoom, JUMP button to jump.
- **Keyboard & mouse:** WASD / arrow keys to walk, Shift to run, Space to jump, drag to look, mouse wheel to zoom.
- URL options: `?fps` shows a frame-rate counter; `?quality=low` disables shadows.

## Develop

```bash
npm install
npm run dev        # local dev server (http://localhost:5173/laws-tours-world-explorer/)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build (http://localhost:4173/laws-tours-world-explorer/)
npm run smoke      # headless browser smoke test against the preview server (screenshots in test-output/)
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
  world/textures.ts    procedural textures (stone, grass, thatch, clouds)
```

## Accuracy and assets

- **The landscape and ruins are an artistic approximation**, inspired by the real layout of Machu Picchu: the saddle between Machu Picchu Mountain and Huayna Picchu, the Sun Gate (Inti Punku) on the south-east ridge, the agricultural terraces, the main plaza, and the upper and lower sectors. Distances and heights are compressed for gameplay. It is **not** survey-accurate.
- **No third-party art, models, textures or audio are used.** Everything is generated in code at load time. Only open-source libraries are used: Babylon.js (Apache-2.0) and Vite/TypeScript (MIT/Apache-2.0, build-time only).

## Status

Milestone B (exploration prototype). See `docs/ROADMAP.md` for what comes next.
