import './style.css';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { TerrainGrid, buildTerrain } from './world/terrain';
import { CollisionWorld } from './world/colliders';
import { buildSite } from './world/site';
import { buildEnvironment, animateClouds } from './world/environment';
import { groundDetailTexture } from './world/textures';
import { PLAYER_START, ZONES } from './world/layout';
import { Explorer } from './player/explorer';
import { PlayerController } from './player/controller';
import { FollowCamera } from './camera';
import { Input } from './input';
import { Ambience } from './audio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function setProgress(p: number, text: string) {
  $('loading-fill').style.width = `${Math.round(p * 100)}%`;
  $('loading-text').textContent = text;
}

async function boot() {
  const canvas = $<HTMLCanvasElement>('game');
  const params = new URLSearchParams(location.search);
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const quality: 'high' | 'low' = (params.get('quality') as 'high' | 'low') || 'high';

  setProgress(0.05, 'Starting the 3D engine…');
  await nextFrame();
  const engine = new Engine(canvas, !isTouch, {
    preserveDrawingBuffer: false,
    stencil: false,
    powerPreference: 'high-performance',
    disableWebGL2Support: false,
  }, false);
  const dpr = window.devicePixelRatio || 1;
  let pixelRatio = Math.min(dpr, isTouch ? 1.5 : 2);
  engine.setHardwareScalingLevel(1 / pixelRatio);

  const scene = new Scene(engine);
  scene.skipPointerMovePicking = true;
  scene.skipFrustumClipping = false;

  setProgress(0.12, 'Shaping the Andes…');
  await nextFrame();
  const env = buildEnvironment(scene, quality);
  const grid = new TerrainGrid();

  setProgress(0.35, 'Carving the Urubamba gorge…');
  await nextFrame();
  buildTerrain(scene, grid, groundDetailTexture(scene));
  const world = new CollisionWorld(grid);

  setProgress(0.55, 'Laying Inca stonework…');
  await nextFrame();
  const site = buildSite(scene, world, grid);

  setProgress(0.75, 'Packing the explorer’s backpack…');
  await nextFrame();
  const explorer = new Explorer(scene);
  const startHeading = Math.atan2(0 - PLAYER_START.x, 0 - PLAYER_START.z);
  const player = new PlayerController(world, PLAYER_START, startHeading);
  const camera = new FollowCamera(scene, world);
  camera.setBehind(startHeading);
  camera.cam.beta = 1.32;
  scene.activeCamera = camera.cam;

  if (env.shadows) {
    for (const m of explorer.meshes) env.shadows.addShadowCaster(m, false);
    for (const m of site.shadowCasters) env.shadows.addShadowCaster(m, false);
  }

  const input = new Input(canvas);
  const audio = new Ambience();
  explorer.onFootstep = (s) => audio.footstep(s);

  setProgress(0.9, 'Compiling shaders…');
  await nextFrame();
  // Render behind the loading screen so shaders compile; continue when ready (or after a timeout).
  let warmup = true;
  engine.runRenderLoop(() => { if (warmup) scene.render(); });
  const t0 = performance.now();
  while (!scene.isReady() && performance.now() - t0 < 20000) await nextFrame();
  if (!scene.isReady()) {
    const notReady = scene.meshes.filter((m) => !m.isReady(true)).map((m) => m.name);
    console.warn('Scene not fully ready after 20 s; continuing. Pending:', notReady.slice(0, 10).join(', '));
  }
  warmup = false;
  engine.stopRenderLoop();
  setProgress(1, 'Ready');

  // ---------------- UI wiring ----------------
  const startBtn = $<HTMLButtonElement>('start-btn');
  startBtn.hidden = false;
  const banner = $('location-banner');
  let bannerTimer = 0;
  let currentZone = '';
  const showBanner = (text: string) => {
    banner.textContent = text;
    banner.classList.add('show');
    bannerTimer = 4;
  };

  const soundBtn = $<HTMLButtonElement>('btn-sound');
  soundBtn.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    soundBtn.textContent = audio.muted ? '🔇' : '🔊';
  });
  const help = $('help');
  $('btn-help').addEventListener('click', () => { help.hidden = false; });
  $('help-close').addEventListener('click', () => { help.hidden = true; });

  let playing = false;
  startBtn.addEventListener('click', () => {
    audio.start();
    $('loading').classList.add('fade');
    setTimeout(() => { $('loading').hidden = true; }, 700);
    $('hud').hidden = false;
    if (input.isTouch) $('touch-ui').hidden = false;
    document.body.classList.add('playing');
    playing = true;
    try {
      if (!localStorage.getItem('ltwe.seenHelp')) {
        help.hidden = false;
        localStorage.setItem('ltwe.seenHelp', '1');
      }
    } catch { /* storage unavailable */ }
    if (input.isTouch && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });

  // ---------------- Game loop ----------------
  let time = 0;
  let zoneCheck = 0;
  const fpsEl = $('fps');
  const showFps = params.has('fps');
  let perfAccum = 0;
  let perfFrames = 0;
  let downgraded = 0;

  engine.runRenderLoop(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
    time += dt;

    input.update();
    const look = input.consumeLook();
    const jump = input.consumeJump();
    if (playing && help.hidden) {
      player.update(dt, input.moveX, input.moveY, input.run, jump, camera.yaw);
    }
    explorer.root.position.copyFrom(player.pos);
    explorer.root.rotation.y = player.heading;
    explorer.animate(dt, player.horizontalSpeed, player.grounded, player.vel.y, time);

    const manualRecently = performance.now() - input.lastLookTime < 1500;
    camera.update(dt, player.pos, look, !manualRecently, player.heading, player.horizontalSpeed > 0.5);
    env.follow(player.pos);
    animateClouds(site.clouds, time);
    audio.update(dt);

    // Location banner
    zoneCheck -= dt;
    if (zoneCheck <= 0 && playing) {
      zoneCheck = 0.4;
      const z = ZONES.find((zn) => Math.hypot(player.pos.x - zn.x, player.pos.z - zn.z) < zn.r);
      const name = z?.name ?? '';
      if (name && name !== currentZone) showBanner(name);
      currentZone = name;
    }
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) banner.classList.remove('show');
    }

    scene.render();

    // Adaptive quality: if frame rate stays low, reduce resolution, then shadows.
    perfAccum += dt;
    perfFrames++;
    if (perfAccum >= 3) {
      const fps = perfFrames / perfAccum;
      if (showFps) fpsEl.textContent = `${fps.toFixed(0)} fps · x${pixelRatio.toFixed(2)}`;
      if (playing && fps < 38 && downgraded < 4) {
        downgraded++;
        if (pixelRatio > 1) {
          pixelRatio = Math.max(1, pixelRatio - 0.25);
        } else if (env.shadows && downgraded >= 2) {
          env.shadows.getShadowMap()!.renderList!.length = 0;
          env.sun.shadowEnabled = false;
        } else {
          pixelRatio = Math.max(0.75, pixelRatio - 0.25);
        }
        engine.setHardwareScalingLevel(1 / pixelRatio);
      }
      perfAccum = 0;
      perfFrames = 0;
    }
  });

  window.addEventListener('resize', () => engine.resize());

  // Small hook for automated smoke tests (read-only state + virtual joystick).
  (window as unknown as Record<string, unknown>).__ltwe = {
    player,
    camera,
    input,
    teleport: (x: number, z: number, heading?: number) => {
      player.pos.set(x, world.groundAt(x, z, 1000, 2000).y, z);
      player.vel.setAll(0);
      if (heading !== undefined) { player.heading = heading; camera.setBehind(heading); }
      camera.snap();
    },
    fps: () => engine.getFps(),
    ready: true,
  };
}

boot().catch((err) => {
  console.error(err);
  setProgress(1, 'Sorry — this device could not start the 3D scene. ' + (err?.message ?? ''));
});
