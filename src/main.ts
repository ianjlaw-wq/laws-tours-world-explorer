import './style.css';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { TerrainGrid, buildTerrain } from './world/terrain';
import { CollisionWorld } from './world/colliders';
import { buildSite } from './world/site';
import { buildEnvironment, animateClouds } from './world/environment';
import { setMaterialTime } from './world/materials';
import { PLAYER_START, TRAIL, ZONES } from './world/layout';
import { Explorer } from './player/explorer';
import { PlayerController } from './player/controller';
import { FollowCamera } from './camera';
import { Input } from './input';
import { Ambience } from './audio';
import { Adventure } from './game/adventure';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';

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
  // MSAA is cheap on tile-based mobile GPUs and removes the jagged edges on stonework.
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: false,
    stencil: false,
    powerPreference: 'high-performance',
    disableWebGL2Support: false,
  }, false);
  const dpr = window.devicePixelRatio || 1;
  let pixelRatio = Math.min(dpr, isTouch ? 1.35 : 2);
  engine.setHardwareScalingLevel(1 / pixelRatio);

  const scene = new Scene(engine);
  scene.skipPointerMovePicking = true;
  scene.skipFrustumClipping = false;

  setProgress(0.12, 'Shaping the Andes…');
  await nextFrame();
  const env = buildEnvironment(scene, quality, isTouch);
  const grid = new TerrainGrid();

  setProgress(0.35, 'Carving the Urubamba gorge…');
  await nextFrame();
  buildTerrain(scene, grid);
  const world = new CollisionWorld(grid);

  setProgress(0.55, 'Laying Inca stonework…');
  await nextFrame();
  const site = buildSite(scene, world, grid);
  if (quality === 'low') site.grass.isVisible = false;

  setProgress(0.75, 'Packing the explorer’s backpack…');
  await nextFrame();
  const explorer = new Explorer(scene);
  // face through the Sun Gate towards the city
  const startHeading = Math.atan2(TRAIL[2].x - PLAYER_START.x, TRAIL[2].z - PLAYER_START.z);
  const player = new PlayerController(world, PLAYER_START, startHeading);
  const camera = new FollowCamera(scene, world);
  camera.setBehind(startHeading);
  // a slightly raised view: Killa, waiting beyond the gate, shows above the explorer's shoulder
  camera.cam.beta = 1.2;
  scene.activeCamera = camera.cam;

  if (env.shadows) {
    for (const m of explorer.meshes) env.shadows.addShadowCaster(m, false);
    for (const m of site.shadowCasters) env.shadows.addShadowCaster(m, false);
    env.shadows.addShadowCaster(site.era.roofs, false);
  }

  const input = new Input(canvas);
  const audio = new Ambience();
  explorer.onFootstep = (s) => audio.footstep(s);
  if (input.isTouch) document.body.classList.add('touch');

  // Milestone C adventure: restores the local save (position, coins, puzzle, journal, era).
  const adventure = new Adventure({ scene, world, site, env, player, camera, input, audio, explorerRoot: explorer.root });
  const spawn = adventure.spawn();
  if (spawn) {
    player.pos.set(spawn.x, spawn.y, spawn.z);
    player.safe.copyFrom(player.pos);
    player.heading = spawn.heading;
    camera.setBehind(spawn.heading);
  }

  setProgress(0.9, 'Compiling shaders…');
  await nextFrame();
  // Render behind the loading screen so shaders compile; continue when ready (or after a timeout).
  let warmup = true;
  adventure.setWarmup(true); // compile the living-city shaders now, not mid-game
  engine.runRenderLoop(() => { if (warmup) scene.render(); });
  const t0 = performance.now();
  while (!scene.isReady() && performance.now() - t0 < 20000) await nextFrame();
  if (!scene.isReady()) {
    const notReady = scene.meshes.filter((m) => !m.isReady(true)).map((m) => m.name);
    console.warn('Scene not fully ready after 20 s; continuing. Pending:', notReady.slice(0, 10).join(', '));
  }
  warmup = false;
  engine.stopRenderLoop();
  adventure.setWarmup(false);
  setProgress(1, 'Ready');

  // ---------------- UI wiring ----------------
  const startBtn = $<HTMLButtonElement>('start-btn');
  startBtn.hidden = false;
  if (adventure.resumed) {
    startBtn.textContent = 'Continue the journey';
    const ng = $<HTMLButtonElement>('newgame-btn');
    ng.hidden = false;
    ng.addEventListener('click', () => {
      if (confirm('Start a new journey? Your saved progress will be erased.')) {
        adventure.resetting = true;
        adventure.newGame();
        location.reload();
      }
    });
  }
  const banner = $('location-banner');
  let bannerTimer = 0;
  let currentZone = '';
  const showBanner = (text: string) => {
    banner.textContent = text;
    banner.classList.add('show');
    bannerTimer = 4;
  };

  // sound, voice and subtitle controls (CC, speaker, settings) are wired by the adventure
  const help = $('help');
  $('help-close').addEventListener('click', () => { help.hidden = true; });

  let playing = false;
  startBtn.addEventListener('click', () => {
    audio.start();
    adventure.voice.unlock(); // inside the tap: lets Killa speak automatically later
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
  let smoothDt = 1 / 60;
  let explorerFade = 1;
  let zoneCheck = 0;
  const fpsEl = $('fps');
  const showFps = params.has('fps');
  let perfAccum = 0;
  let perfFrames = 0;
  let downgraded = 0;
  // Frame-time instrumentation (?fps): separates a steady low frame rate from intermittent spikes,
  // and JavaScript update time from render submission time. No allocations per frame.
  const FT_N = 240;
  const frameMs = new Float32Array(FT_N);
  const jsMs = new Float32Array(FT_N);
  const renderMs = new Float32Array(FT_N);
  let ftIndex = 0;
  let ftCount = 0;
  let lastFrameAt = performance.now();
  const totals = { frames: 0, over33: 0, over50: 0, over100: 0 };
  let statTimer = 0;
  // draw calls per frame = change in the engine's running total
  const drawCounter = (engine as unknown as { _drawCalls?: { total: number } })._drawCalls;
  let drawTotal = 0;
  let drawsLastFrame = 0;
  const frameStats = () => {
    const n = Math.min(ftCount, FT_N);
    let sum = 0, worst = 0, o33 = 0, o50 = 0, js = 0, jsWorst = 0, rn = 0, rnWorst = 0;
    for (let i = 0; i < n; i++) {
      const f = frameMs[i];
      sum += f; if (f > worst) worst = f;
      if (f > 33.4) o33++;
      if (f > 50) o50++;
      js += jsMs[i]; if (jsMs[i] > jsWorst) jsWorst = jsMs[i];
      rn += renderMs[i]; if (renderMs[i] > rnWorst) rnWorst = renderMs[i];
    }
    const k = Math.max(1, n);
    return {
      frames: n, avgMs: sum / k, fps: (1000 * k) / Math.max(1, sum), worstMs: worst, over33: o33, over50: o50,
      jsAvgMs: js / k, jsWorstMs: jsWorst, renderAvgMs: rn / k, renderWorstMs: rnWorst, totals: { ...totals },
    };
  };

  engine.runRenderLoop(() => {
    const frameStart = performance.now();
    const ft = frameStart - lastFrameAt;
    lastFrameAt = frameStart;
    // lightly smoothed frame delta: removes judder from uneven frame pacing
    const rawDt = Math.min(engine.getDeltaTime() / 1000, 0.05);
    smoothDt += (rawDt - smoothDt) * 0.3;
    const dt = smoothDt;
    time += dt;
    setMaterialTime(time);

    input.update();
    const look = input.consumeLook();
    const jump = input.consumeJump();
    adventure.update(dt, time, playing, look);
    if (playing && help.hidden && !adventure.blocking) {
      player.update(dt, input.moveX, input.moveY, input.run, jump, camera.yaw);
    } else if (playing) {
      player.update(dt, 0, 0, false, false, camera.yaw); // keep gravity/landing during cutscenes and panels
    }
    explorer.root.position.copyFrom(player.pos);
    explorer.root.rotation.y = player.heading;
    explorer.animate(dt, player.horizontalSpeed, player.grounded, player.vel.y, time);

    const manualRecently = performance.now() - input.lastLookTime < 1500;
    camera.update(dt, player.pos, look, !manualRecently, player.heading, player.horizontalSpeed > 0.5);
    // fade the explorer when walls push the camera very close (e.g. inside the hidden chamber)
    const fade = Math.round(Math.max(0.25, Math.min(1, (camera.cam.radius - 1.3) / 1.5)) * 20) / 20;
    if (fade !== explorerFade) {
      explorerFade = fade;
      for (const m of explorer.meshes) m.visibility = fade;
    }
    env.follow(adventure.shadowFocus ?? player.pos);
    animateClouds(site.clouds, time);
    audio.update(dt);

    // Location banner
    zoneCheck -= dt;
    if (zoneCheck <= 0 && playing) {
      zoneCheck = 0.4;
      let name = '';
      for (const zn of ZONES) {
        if (Math.hypot(player.pos.x - zn.x, player.pos.z - zn.z) < zn.r) { name = zn.name; break; }
      }
      if (name && name !== currentZone) { showBanner(name); adventure.discover(name); }
      currentZone = name;
    }
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) banner.classList.remove('show');
    }

    const renderStart = performance.now();
    scene.render();
    const frameEnd = performance.now();
    if (drawCounter) { drawsLastFrame = drawCounter.total - drawTotal; drawTotal = drawCounter.total; }
    if (playing) {
      frameMs[ftIndex] = ft;
      jsMs[ftIndex] = renderStart - frameStart;
      renderMs[ftIndex] = frameEnd - renderStart;
      ftIndex = (ftIndex + 1) % FT_N;
      ftCount++;
      totals.frames++;
      if (ft > 33.4) totals.over33++;
      if (ft > 50) totals.over50++;
      if (ft > 100) totals.over100++;
    }
    if (showFps) {
      statTimer += rawDt;
      if (statTimer >= 1) {
        statTimer = 0;
        const st = frameStats();
        fpsEl.textContent = `${st.fps.toFixed(0)} fps · avg ${st.avgMs.toFixed(1)} ms · worst ${st.worstMs.toFixed(0)} ms · ` +
          `spikes >33ms ${st.over33} / >50ms ${st.over50} (last ${st.frames}) · js ${st.jsAvgMs.toFixed(1)}/${st.jsWorstMs.toFixed(0)} ms · ` +
          `render ${st.renderAvgMs.toFixed(1)}/${st.renderWorstMs.toFixed(0)} ms · draws ${drawsLastFrame} · x${pixelRatio.toFixed(2)}`;
      }
    }

    // Adaptive quality: if frame rate stays low, reduce resolution, then shadows.
    perfAccum += dt;
    perfFrames++;
    if (perfAccum >= 3) {
      const fps = perfFrames / perfAccum;
      if (playing && fps < 38 && downgraded < 4) {
        downgraded++;
        if (pixelRatio > 1) {
          pixelRatio = Math.max(1, pixelRatio - 0.25);
        } else if (site.grass.isVisible) {
          site.grass.isVisible = false; // bunch-grass cards are the biggest fill-rate cost
        } else if (env.shadows && env.sun.shadowEnabled) {
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
    world,
    adventure,
    /** Complete the opening (Killa's welcome + transformation) immediately (tests). */
    skipIntro: () => adventure.completeOpening(),
    /** Frame-time statistics over the last 240 frames, plus totals since start. */
    perfStats: () => frameStats(),
    /** Draw calls, active meshes and totals (instrumentation enabled on first call). */
    sceneStats: () => {
      return {
        drawCalls: drawsLastFrame,
        activeMeshes: scene.getActiveMeshes().length,
        meshes: scene.meshes.length,
        enabledMeshes: scene.meshes.filter((m) => m.isEnabled() && m.isVisible).length,
        materials: scene.materials.length,
        particles: scene.particleSystems.map((p) => `${p.name}:${p.getActiveCount()}`).join(','),
        pixelRatio,
      };
    },
    teleport: (x: number, z: number, heading?: number) => {
      player.pos.set(x, world.groundAt(x, z, 1000, 2000).y, z);
      player.vel.setAll(0);
      if (heading !== undefined) { player.heading = heading; camera.setBehind(heading); }
      camera.snap();
    },
    fps: () => engine.getFps(),
    /** World point -> CSS pixel position on screen (tests: is something in frame?). */
    project: (x: number, y: number, z: number) => {
      const w = engine.getRenderWidth();
      const h = engine.getRenderHeight();
      const v = Vector3.Project(new Vector3(x, y, z), Matrix.IdentityReadOnly, scene.getTransformMatrix(), camera.cam.viewport.toGlobal(w, h));
      const k = canvas.clientWidth / w;
      return { x: v.x * k, y: v.y * k, depth: v.z };
    },
    /** Deterministic fixed-step simulation of the controller (for automated tests). */
    simulate: (seconds: number, moveX: number, moveY: number, run = false, jumpAt = -1) => {
      let maxY = -Infinity;
      const steps = Math.round(seconds * 60);
      for (let i = 0; i < steps; i++) {
        player.update(1 / 60, moveX, moveY, run, i === jumpAt, camera.yaw);
        maxY = Math.max(maxY, player.pos.y);
      }
      return { x: player.pos.x, y: player.pos.y, z: player.pos.z, maxY, grounded: player.grounded };
    },
    ready: true,
  };
}

boot().catch((err) => {
  console.error(err);
  setProgress(1, 'Sorry — this device could not start the 3D scene. ' + (err?.message ?? ''));
});
