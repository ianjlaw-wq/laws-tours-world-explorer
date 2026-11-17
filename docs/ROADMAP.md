# Roadmap

## Milestone B: exploration prototype (current)
Babylon.js scene, explorer with backpack, walk/run/jump, mobile joystick + swipe camera + jump button,
keyboard/mouse, follow camera, Sun Gate approach via the Inca Trail, terraces, plaza, temples,
Intihuatana, sky/fog/ambience, collision, loading screen, GitHub Pages deployment.

## Milestone C: first small adventure (awaiting owner acceptance of B)
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
