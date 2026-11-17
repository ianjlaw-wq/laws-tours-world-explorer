# Roadmap

## Milestone B: exploration prototype (accepted)
Babylon.js scene, explorer with backpack, walk/run/jump, mobile joystick + swipe camera + jump button,
keyboard/mouse, follow camera, Sun Gate approach via the Inca Trail, terraces, plaza, temples,
Intihuatana, sky/fog/ambience, collision, loading screen, GitHub Pages deployment.

## Milestone C: first small adventure (tested on Android by the owner)
Implemented in `src/game/`. Flow: Sun Gate → transformation at the trail overlook (≈4 s, skippable) →
Killa greets you at the guardhouse → gold-coin trail down the terrace stairs → the Turning Stones
(condor / puma / serpent) → the hidden chamber and golden llama → free exploration.
Original plan:
1. Short historical transformation sequence (ruins → inhabited 15th-century settlement).
2. One welcoming Inca villager with scripted dialogue.
3. A short trail of collectible gold coins.
4. One interactive stone-mechanism puzzle.
5. A basic Explorer's Journal.
6. Checkpoints and persistent local saving (localStorage).
7. Free exploration after the introductory challenge.

Prepared hooks in the code:
- `world/layout.ts` `ZONES`: named areas; these can become checkpoint/journal triggers.
- `world/colliders.ts`: box colliders; a puzzle stone can be a movable box.
- `site.ts` `Builder.house(... { roof })`: roofs and thatch for the "inhabited" transformation.
- `localStorage` key prefix `ltwe.` is already in use (help screen seen flag).

## Milestone D: the living Inca city (implemented; awaiting Android testing)
Flow: Sun Gate → Killa waits just beyond it (waves, speech bubble) → she walks up, the camera frames
both characters and she speaks (skippable) → ~7.6 s transformation cinematic (elevated view; walls
rebuilt, roofs drop in, terraces tilled, maize and potatoes grow, smoke, people, warmer light; skippable)
→ Killa's spoken directions → objective arrow + beacon lead along the trail and the gold coins to the
carved doorway → Turning Stones → hidden chamber. The cinematic can be replayed at the Sun Gate (WATCH).
- Voice: Web Speech API with voice selection, Play Voice fallback, text fallback; CC and voice toggles.
- Performance: shaders for late-appearing layers compiled behind the loading screen; character meshes
  merged per joint; coin buffer updated in place; no per-frame closures in animation; CSS pulse moved
  to a composited layer; `?fps` frame-spike statistics.
- Needs real-phone checks: voice choice/quality and autoplay behaviour on Android Chrome, frame-time
  spikes with `?fps`, readability of the cinematic on a small screen.
