// Milestone C: the first playable Machu Picchu adventure.
// Transformation to c.1450, the villager Killa, a gold-coin trail, the turning-stone puzzle,
// the hidden chamber, the Explorer's Journal and automatic local saving.

import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import type { Light } from '@babylonjs/core/Lights/light';
import type { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';

import { Explorer } from '../player/explorer';
import type { PlayerController } from '../player/controller';
import type { FollowCamera } from '../camera';
import type { Input } from '../input';
import type { Ambience } from '../audio';
import type { Environment } from '../world/environment';
import type { SiteResult } from '../world/site';
import type { Box, CollisionWorld } from '../world/colliders';
import { AG, CHAMBER, MECHANISM, OVERLOOK, VILLAGER_HOME, ZONES } from '../world/layout';
import { cloudTexture } from '../world/textures';
import { SaveData, clearSave, freshSave, loadSave, writeSave } from './save';
import {
  AFTER_DIALOGUE, CHECKPOINTS, DialogueNode, GENERAL_NOTES, INTRO_DIALOGUE, LANDMARK_NOTES, Note, OBJECTIVES, REPEAT_DIALOGUE,
} from './story';
import { GLYPHS, GLYPH_NAMES, drawGlyph, glyphCanvas, paintGlyphCanvas } from './glyphs';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const TRANSFORM_SECONDS = 4.2;
const CITY = { x: 0, z: -60 };
const COIN_VALUE = 10;
const RELIC_VALUE = 50;
export const PUZZLE_ID = 'mp-turning-stones';
const SOLUTION = [0, 1, 2]; // condor (sky), puma (earth), serpent (below)
const START_WHEELS = [3, 0, 1];
const MECH_FRONT = { x: MECHANISM.x, z: MECHANISM.z + 1.35 };
const RELIC_SPOT = { x: CHAMBER.door.x, z: CHAMBER.zBack + 0.7 + 0.6 };
const WHEEL_LABELS = ['Upper wheel', 'Middle wheel', 'Lower wheel'];

type Modal = 'none' | 'cinematic' | 'dialogue' | 'puzzle' | 'journal';
interface Interaction { label: string; text: string; act: () => void }

export interface AdventureDeps {
  scene: Scene;
  world: CollisionWorld;
  site: SiteResult;
  env: Environment;
  player: PlayerController;
  camera: FollowCamera;
  input: Input;
  audio: Ambience;
  /** the player's character model (hidden while examining the mechanism) */
  explorerRoot: TransformNode;
}

export class Adventure {
  readonly save: SaveData;
  /** true when a save existed at boot */
  readonly resumed: boolean;
  modal: Modal = 'none';
  private d: AdventureDeps;
  private eraK = 0;
  private cine = -1;
  private base: { sunDiff: Color3; sunInt: number; hemiInt: number; hemiDiff: Color3; fog: Color3; fogDen: number; exposure: number };
  private hemi: HemisphericLight | null;
  private smoke: ParticleSystem;
  private sparkle: ParticleSystem;
  // villager
  readonly killa: Explorer;
  private killaPos = new Vector3();
  private killaHeading = 0;
  private killaSpeed = 0;
  private greeted = false;
  // coins
  readonly coins: Array<{ id: string; x: number; y: number; z: number; taken: boolean; anim: number }> = [];
  private coinMesh: Mesh;
  private coinMatrices: Float32Array;
  // puzzle
  private wheels = [...START_WHEELS];
  private wheelNodes: TransformNode[] = [];
  private wheelAngles = [0, 0, 0];
  private wheelMat: StandardMaterial;
  private door: Mesh;
  private doorBox: Box | null = null;
  private doorAnim = -1;
  private doorBaseY = 0;
  private relic: TransformNode;
  private puzzleSolvedAnim = -1;
  // ui
  private interaction: Interaction | null = null;
  private saveTimer = 0;
  private dialogueTree: Record<string, DialogueNode> = INTRO_DIALOGUE;
  private choiceHandlers: Array<() => void> = [];
  private wheelCanvases: HTMLCanvasElement[] = [];
  private cineEls = { flash: $('era-flash'), title: $('era-title'), skip: $('era-skip') };

  constructor(d: AdventureDeps) {
    this.d = d;
    const loaded = loadSave();
    this.resumed = !!loaded;
    this.save = loaded ?? freshSave();
    const { scene, env } = d;

    // ---- lighting presets ----
    this.hemi = (scene.lights.find((l: Light) => l.getClassName() === 'HemisphericLight') as HemisphericLight) ?? null;
    this.base = {
      sunDiff: env.sun.diffuse.clone(),
      sunInt: env.sun.intensity,
      hemiInt: this.hemi?.intensity ?? 1,
      hemiDiff: this.hemi?.diffuse.clone() ?? new Color3(1, 1, 1),
      fog: scene.fogColor.clone(),
      fogDen: scene.fogDensity,
      exposure: scene.imageProcessingConfiguration.exposure,
    };

    this.smoke = this.buildSmoke();
    this.sparkle = this.buildSparkle();
    this.killa = new Explorer(scene, { villager: true, name: 'killa' });
    for (const m of this.killa.meshes) m.receiveShadows = false;
    if (env.shadows) for (const m of this.killa.meshes) env.shadows.addShadowCaster(m, false);
    this.killaPos.set(VILLAGER_HOME.x, this.ground(VILLAGER_HOME.x, VILLAGER_HOME.z, VILLAGER_HOME.y + 2), VILLAGER_HOME.z);
    this.killaHeading = Math.atan2(0 - VILLAGER_HOME.x, -112 - VILLAGER_HOME.z);
    this.killa.root.setEnabled(false);

    this.coinMesh = this.buildCoins();
    this.coinMatrices = new Float32Array(this.coins.length * 16);
    this.wheelMat = this.buildMechanism();
    this.door = this.buildDoor();
    this.relic = this.buildRelic();

    // ---- restore persisted state ----
    if (this.save.flags.transformed) this.applyEra(1, true);
    if (this.save.puzzles.includes(PUZZLE_ID)) this.setSolvedInstant();
    if (this.save.flags.treasure) this.relic.setEnabled(false);

    this.wireUi();
    this.refreshHud(false);
  }

  // =====================================================================
  // Public API used by main.ts
  // =====================================================================

  get blocking() {
    return this.modal !== 'none';
  }

  /** Where to start: last safe saved position, else the current checkpoint. */
  spawn(): { x: number; y: number; z: number; heading: number } | null {
    const p = this.save.pos;
    const w = this.d.world;
    if (p && [p.x, p.y, p.z, p.heading].every(Number.isFinite)) {
      const g = w.groundAt(p.x, p.z, p.y + 0.6, 0.6).y;
      if (Math.abs(g - p.y) < 1.0 && !w.solidAt(p.x, g + 1.0, p.z, 0.05)) return { x: p.x, y: g, z: p.z, heading: p.heading };
    }
    if (!this.resumed) return null;
    const c = CHECKPOINTS[this.save.checkpoint] ?? CHECKPOINTS.sungate;
    return { x: c.x, y: w.groundAt(c.x, c.z, 1000, 2000).y, z: c.z, heading: c.heading };
  }

  /** Called when the player enters a named zone. */
  discover(name: string) {
    if (!name || this.save.discovered.includes(name)) return;
    this.save.discovered.push(name);
    this.toast(`📖 New journal entry: ${name}`);
    if (name === 'The Hidden Chamber' && this.save.objective === 'chamber') {
      this.d.audio.chime();
    }
    this.persist();
  }

  newGame() {
    clearSave();
  }

  persist() {
    const p = this.d.player;
    if (p.grounded) {
      const s = p.safe;
      this.save.pos = { x: s.x, y: s.y, z: s.z, heading: p.heading };
    }
    writeSave(this.save);
  }

  /**
   * Per-frame update. `playing` = the game has started. Adds camera zoom during the cinematic.
   */
  update(dt: number, time: number, playing: boolean, look: { dx: number; dy: number; zoom: number }) {
    const { player, input } = this.d;
    if (!playing) return;

    this.updateCinematic(dt, look);
    this.updateKilla(dt, time);
    this.updateCoins(dt, time);
    this.updateMechanism(dt, time);

    // trigger the transformation at the overlook (or, as a fallback, on reaching the city)
    if (!this.save.flags.transformed && this.cine < 0 && this.modal === 'none') {
      const dO = Math.hypot(player.pos.x - OVERLOOK.x, player.pos.z - OVERLOOK.z);
      const dC = Math.hypot(player.pos.x - CITY.x, player.pos.z - CITY.z);
      if (dO < 10 || dC < 110) this.startTransformation();
    }

    // objective progression by proximity
    const dM = Math.hypot(player.pos.x - MECHANISM.x, player.pos.z - MECHANISM.z);
    if ((this.save.objective === 'gold' || this.save.objective === 'meet') && dM < 7 && !this.save.puzzles.includes(PUZZLE_ID)) {
      this.setObjective('puzzle');
    }

    // interactions
    const act = input.consumeKey('KeyE') || input.consumeKey('Action');
    if (input.consumeKey('KeyJ')) this.toggleJournal();
    this.interaction = this.modal === 'none' ? this.findInteraction() : null;
    this.showPrompt(this.interaction);
    if (act && this.interaction) this.interaction.act();

    // autosave
    this.saveTimer += dt;
    if (this.saveTimer > 4 && this.modal === 'none' && player.grounded) {
      this.saveTimer = 0;
      this.persist();
    }
  }

  // =====================================================================
  // Transformation
  // =====================================================================

  startTransformation() {
    if (this.save.flags.transformed || this.cine >= 0) return;
    this.cine = 0;
    this.setModal('cinematic');
    this.cineEls.title.hidden = false;
    this.cineEls.skip.hidden = false;
    this.d.audio.swell(TRANSFORM_SECONDS);
    // turn the explorer to face the city and let the camera settle behind
    const p = this.d.player;
    this.cineHeading = Math.atan2(CITY.x - p.pos.x, CITY.z - p.pos.z);
  }

  private cineHeading = 0;

  /** Skip the cinematic (button, Esc, or test hook). */
  skipTransformation() {
    if (this.cine < 0) return;
    this.cine = TRANSFORM_SECONDS;
  }

  private updateCinematic(dt: number, look: { dx: number; dy: number; zoom: number }) {
    if (this.cine < 0) return;
    this.cine += dt;
    const t = this.cine;
    const k = clamp01(t / TRANSFORM_SECONDS);
    // explorer turns towards the city; camera pulls back
    const p = this.d.player;
    let dh = this.cineHeading - p.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    p.heading += dh * Math.min(1, dt * 3);
    if (t < 2.6) look.zoom += dt * 1.4;
    // golden flash peaks around the midpoint and hides the swap
    const flash = Math.exp(-Math.pow((k - 0.45) / 0.16, 2));
    this.cineEls.flash.style.opacity = (flash * 0.85).toFixed(3);
    this.cineEls.title.style.opacity = smooth((k - 0.35) / 0.2) * (1 - smooth((k - 0.88) / 0.12)) + '';
    this.applyEra(k, false);
    if (t >= TRANSFORM_SECONDS) {
      this.cine = -1;
      this.cineEls.flash.style.opacity = '0';
      this.cineEls.title.hidden = true;
      this.cineEls.skip.hidden = true;
      this.applyEra(1, false);
      this.save.flags.transformed = true;
      if (this.save.objective === 'walk') this.setObjective('meet');
      this.setModal('none');
      this.persist();
    }
  }

  /** Blend between the present-day ruins (0) and the inhabited settlement (1). */
  private applyEra(k: number, instant: boolean) {
    this.eraK = k;
    const { site, scene, env, audio } = this.d;
    const era = site.era;
    const rk = smooth((k - 0.3) / 0.6);
    era.roofs.setEnabled(rk > 0);
    era.roofs.position.y = (1 - rk) * 5;
    era.roofMat.alpha = rk >= 1 ? 1 : rk;
    era.crops.setEnabled(k > 0.45);
    site.rubble.setEnabled(k <= 0.45);
    if (k > 0.5 && !this.smoke.isStarted()) {
      if (instant) { this.smoke.preWarmCycles = 120; this.smoke.preWarmStepOffset = 6; }
      this.smoke.start();
    }
    audio.era = k >= 0.5;
    // warmer, clearer light in the living city
    const L = smooth(k);
    const b = this.base;
    env.sun.diffuse.copyFrom(Color3.Lerp(b.sunDiff, new Color3(1.0, 0.86, 0.66), L * 0.85));
    env.sun.intensity = b.sunInt * (1 + 0.08 * L);
    if (this.hemi) {
      this.hemi.intensity = b.hemiInt * (1 + 0.05 * L);
      this.hemi.diffuse.copyFrom(Color3.Lerp(b.hemiDiff, new Color3(0.86, 0.84, 0.92), L * 0.6));
    }
    scene.fogColor.copyFrom(Color3.Lerp(b.fog, new Color3(0.78, 0.76, 0.74), L * 0.7));
    scene.fogDensity = b.fogDen * (1 - 0.18 * L);
    scene.imageProcessingConfiguration.exposure = b.exposure + 0.06 * L;
  }

  private buildSmoke(): ParticleSystem {
    const { scene, site } = this.d;
    const chim = site.era.chimneys;
    const ps = new ParticleSystem('hearthSmoke', 140, scene);
    ps.particleTexture = cloudTexture(scene);
    ps.emitter = new Vector3(0, 0, 0);
    ps.startPositionFunction = (_m, pos) => {
      const c = chim[Math.floor(Math.random() * chim.length)] ?? Vector3.Zero();
      pos.copyFromFloats(c.x + (Math.random() - 0.5) * 0.8, c.y, c.z + (Math.random() - 0.5) * 0.8);
    };
    ps.direction1 = new Vector3(-0.15, 1, -0.1);
    ps.direction2 = new Vector3(0.3, 1.2, 0.2);
    ps.minEmitPower = 0.45;
    ps.maxEmitPower = 0.85;
    ps.minLifeTime = 5;
    ps.maxLifeTime = 8;
    ps.emitRate = Math.max(4, chim.length * 1.6);
    ps.gravity = new Vector3(0.22, 0.05, 0.08);
    ps.minAngularSpeed = -0.3;
    ps.maxAngularSpeed = 0.3;
    ps.addSizeGradient(0, 0.7);
    ps.addSizeGradient(1, 4.2);
    ps.addColorGradient(0, new Color4(0.82, 0.8, 0.76, 0));
    ps.addColorGradient(0.12, new Color4(0.8, 0.78, 0.75, 0.45));
    ps.addColorGradient(1, new Color4(0.86, 0.86, 0.86, 0));
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    return ps;
  }

  private buildSparkle(): ParticleSystem {
    const { scene } = this.d;
    const t = new DynamicTexture('sparkTex', 64, scene, false);
    const g = t.getContext() as unknown as CanvasRenderingContext2D;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,250,220,1)');
    grd.addColorStop(0.25, 'rgba(255,210,100,0.9)');
    grd.addColorStop(1, 'rgba(255,180,40,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    t.hasAlpha = true;
    t.update();
    const ps = new ParticleSystem('sparkle', 60, scene);
    ps.particleTexture = t;
    ps.emitter = new Vector3(0, -1000, 0);
    ps.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
    ps.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
    ps.direction1 = new Vector3(-1, 1.5, -1);
    ps.direction2 = new Vector3(1, 3, 1);
    ps.minEmitPower = 0.6;
    ps.maxEmitPower = 1.4;
    ps.minLifeTime = 0.35;
    ps.maxLifeTime = 0.7;
    ps.minSize = 0.08;
    ps.maxSize = 0.2;
    ps.gravity = new Vector3(0, -4, 0);
    ps.color1 = new Color4(1, 0.9, 0.5, 1);
    ps.color2 = new Color4(1, 0.75, 0.3, 1);
    ps.colorDead = new Color4(1, 0.6, 0.2, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.emitRate = 0;
    ps.start();
    return ps;
  }

  private burst(x: number, y: number, z: number, n = 22) {
    (this.sparkle.emitter as Vector3).set(x, y, z);
    this.sparkle.manualEmitCount = n;
  }

  // =====================================================================
  // Killa, the villager
  // =====================================================================

  private ground(x: number, z: number, fromY: number) {
    return this.d.world.groundAt(x, z, fromY, 0.6).y;
  }

  private updateKilla(dt: number, time: number) {
    const { player, world } = this.d;
    const k = this.killaPos;
    const dx = player.pos.x - k.x;
    const dz = player.pos.z - k.z;
    const d = Math.hypot(dx, dz);
    const on = this.eraK >= 1 && d < 90;
    this.killa.root.setEnabled(on);
    if (!on) return;
    const talking = this.modal === 'dialogue';
    let tx = VILLAGER_HOME.x;
    let tz = VILLAGER_HOME.z;
    if (!this.save.flags.introDialogue && d < 18 && !talking) {
      // walk out to greet the explorer, but stay near home
      if (!this.greeted && d < 15) {
        this.greeted = true;
        this.toast('Killa: “Allillanchu! Over here, traveller!”', 'speech');
      }
      tx = player.pos.x - (dx / d) * 2.0;
      tz = player.pos.z - (dz / d) * 2.0;
      const hx = tx - VILLAGER_HOME.x;
      const hz = tz - VILLAGER_HOME.z;
      const hd = Math.hypot(hx, hz);
      if (hd > 9) { tx = VILLAGER_HOME.x + (hx / hd) * 9; tz = VILLAGER_HOME.z + (hz / hd) * 9; }
    }
    const mx = tx - k.x;
    const mz = tz - k.z;
    const md = Math.hypot(mx, mz);
    let want = 0;
    let face = this.killaHeading;
    if (md > 0.35 && !talking) {
      want = Math.min(1.5, md * 1.2);
      face = Math.atan2(mx, mz);
    } else if (d < 9) {
      face = Math.atan2(dx, dz);
    }
    this.killaSpeed += (want - this.killaSpeed) * Math.min(1, dt * 5);
    let dh = face - this.killaHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.killaHeading += dh * Math.min(1, dt * 6);
    if (this.killaSpeed > 0.02) {
      let nx = k.x + Math.sin(this.killaHeading) * this.killaSpeed * dt;
      let nz = k.z + Math.cos(this.killaHeading) * this.killaSpeed * dt;
      [nx, nz] = world.resolve(nx, nz, 0.3, k.y, k.y + 1.6, 0.5);
      const g = this.ground(nx, nz, k.y + 0.6);
      if (Math.abs(g - k.y) < 0.7) k.set(nx, g, nz);
    }
    this.killa.root.position.copyFrom(k);
    this.killa.root.rotation.y = this.killaHeading;
    this.killa.animate(dt, this.killaSpeed, true, 0, time + 1.7);
  }

  // =====================================================================
  // Dialogue
  // =====================================================================

  openDialogue() {
    const f = this.save.flags;
    this.dialogueTree = f.treasure || this.save.puzzles.includes(PUZZLE_ID) ? AFTER_DIALOGUE : f.introDialogue ? REPEAT_DIALOGUE : INTRO_DIALOGUE;
    const p = this.d.player;
    // face each other
    this.killaHeading = Math.atan2(p.pos.x - this.killaPos.x, p.pos.z - this.killaPos.z);
    p.heading = Math.atan2(this.killaPos.x - p.pos.x, this.killaPos.z - p.pos.z);
    this.setModal('dialogue');
    $('dialogue').hidden = false;
    this.showNode('start');
  }

  private showNode(id: string) {
    const n = this.dialogueTree[id];
    if (!n) { this.closeDialogue(); return; }
    $('dlg-speaker').textContent = n.speaker;
    $('dlg-text').textContent = n.text;
    const note = $('dlg-note');
    note.hidden = !n.note;
    if (n.note) note.innerHTML = noteHtml(n.note);
    if (id === 'mystery') this.unlockNote('The three worlds');
    const box = $('dlg-choices');
    box.innerHTML = '';
    this.choiceHandlers = n.choices.map((c, i) => {
      const run = () => {
        this.d.audio.click();
        if (c.effect === 'startGold') this.finishIntro();
        if (c.next) this.showNode(c.next);
        else this.closeDialogue();
      };
      const b = document.createElement('button');
      b.className = 'choice';
      b.innerHTML = `<span class="num">${i + 1}</span>${esc(c.text)}`;
      b.addEventListener('click', run);
      box.appendChild(b);
      return run;
    });
  }

  private finishIntro() {
    if (this.save.flags.introDialogue) return;
    this.save.flags.introDialogue = true;
    this.unlockNote('Killa');
    if (this.save.objective === 'meet' || this.save.objective === 'walk') this.setObjective('gold');
    this.save.checkpoint = 'guardhouse';
    this.persist();
  }

  private closeDialogue() {
    $('dialogue').hidden = true;
    this.setModal('none');
  }

  // =====================================================================
  // Gold coins
  // =====================================================================

  private buildCoins(): Mesh {
    const { scene, world } = this.d;
    const pts: Array<[number, number]> = [[3, -108.5]];
    for (let k = AG.count - 1; k >= 0; k--) pts.push([AG.stairX, AG.zStart - AG.depth * k - 2.4]);
    pts.push([1.5, -40.6], [5.5, -39.6], [9.2, -38.4], [12.2, -37.2]);
    pts.forEach(([x, z], i) => {
      const y = world.groundAt(x, z, 200, 400).y + 0.85;
      this.coins.push({ id: `mp-coin-${String(i + 1).padStart(2, '0')}`, x, y, z, taken: false, anim: -1 });
    });
    for (const c of this.coins) c.taken = this.save.coins.includes(c.id);

    const disc = MeshBuilder.CreateCylinder('coinDisc', { height: 0.05, diameter: 0.42, tessellation: 24 }, scene);
    const rim = MeshBuilder.CreateTorus('coinRim', { diameter: 0.4, thickness: 0.05, tessellation: 24 }, scene);
    const boss = MeshBuilder.CreateCylinder('coinBoss', { height: 0.07, diameter: 0.16, tessellation: 12 }, scene);
    const coin = Mesh.MergeMeshes([disc, rim, boss], true)!;
    coin.rotation.x = Math.PI / 2;
    coin.bakeCurrentTransformIntoVertices();
    coin.name = 'goldCoins';
    const m = new StandardMaterial('goldMat', scene);
    m.diffuseColor = new Color3(0.82, 0.54, 0.12);
    m.specularColor = new Color3(1.0, 0.85, 0.45);
    m.specularPower = 36;
    m.emissiveColor = new Color3(0.2, 0.11, 0.0);
    coin.material = m;
    coin.isPickable = false;
    coin.alwaysSelectAsActiveMesh = true;
    coin.thinInstanceSetBuffer('matrix', new Float32Array(this.coins.length * 16), 16, false);
    return coin;
  }

  private tmpM = Matrix.Identity();
  private tmpQ = new Quaternion();
  private tmpS = new Vector3();
  private tmpP = new Vector3();

  private updateCoins(dt: number, time: number) {
    const visible = this.eraK >= 1;
    this.coinMesh.setEnabled(visible);
    if (!visible) return;
    const p = this.d.player.pos;
    let changed = false;
    this.coins.forEach((c, i) => {
      let s = 1;
      let y = c.y + Math.sin(time * 2.2 + i) * 0.08;
      if (c.taken) {
        if (c.anim < 0) s = 0;
        else {
          c.anim += dt;
          const a = c.anim / 0.45;
          y += a * 1.2;
          s = Math.max(0, 1 - a);
          if (a >= 1) c.anim = -1;
        }
      } else if (this.modal === 'none' && Math.hypot(p.x - c.x, p.z - c.z) < 1.1 && Math.abs(p.y + 0.9 - c.y) < 1.6) {
        this.collectCoin(c);
      }
      Quaternion.FromEulerAnglesToRef(0, time * 2.6 + i * 0.7, 0, this.tmpQ);
      this.tmpS.setAll(s);
      this.tmpP.set(c.x, y, c.z);
      Matrix.ComposeToRef(this.tmpS, this.tmpQ, this.tmpP, this.tmpM);
      this.tmpM.copyToArray(this.coinMatrices, i * 16);
      changed = true;
    });
    if (changed) this.coinMesh.thinInstanceSetBuffer('matrix', this.coinMatrices, 16, false);
  }

  private collectCoin(c: { id: string; x: number; y: number; z: number; taken: boolean; anim: number }) {
    if (c.taken || this.save.coins.includes(c.id)) { c.taken = true; return; }
    c.taken = true;
    c.anim = 0;
    this.save.coins.push(c.id);
    this.save.gold += COIN_VALUE;
    this.d.audio.coin();
    this.burst(c.x, c.y, c.z);
    this.toast(`+${COIN_VALUE} gold`, 'gold');
    this.refreshHud(true);
    if (this.save.objective === 'meet') this.setObjective('gold');
    this.persist();
  }

  // =====================================================================
  // The turning-stone mechanism, door and chamber
  // =====================================================================

  private buildMechanism(): StandardMaterial {
    const { scene, world, site } = this.d;
    const g = world.groundAt(MECHANISM.x, MECHANISM.z, 100, 200).y;
    const stele = MeshBuilder.CreateBox('stele', { width: 1.05, height: 1.9, depth: 0.6, wrap: true }, scene);
    stele.position.set(MECHANISM.x, g + 0.95 - 0.1, MECHANISM.z);
    stele.material = site.builder.mats.fine;
    stele.receiveShadows = true;
    const plinth = MeshBuilder.CreateBox('plinth', { width: 1.6, height: 0.22, depth: 1.1, wrap: true }, scene);
    plinth.position.set(MECHANISM.x, g + 0.06, MECHANISM.z + 0.1);
    plinth.material = site.builder.mats.fine;
    plinth.receiveShadows = true;
    world.addBox(MECHANISM.x, MECHANISM.z, 1.05, 0.6, g - 0.3, g + 1.8, 0);
    this.d.env.shadows?.addShadowCaster(stele, false);

    // shared wheel texture: four carved symbols around the face
    const S = 512;
    const tex = new DynamicTexture('wheelTex', S, scene, true);
    const c = tex.getContext() as unknown as CanvasRenderingContext2D;
    c.fillStyle = '#8f897c';
    c.fillRect(0, 0, S, S);
    for (let i = 0; i < 2500; i++) {
      const v = 110 + Math.floor(Math.random() * 60);
      c.fillStyle = `rgba(${v},${v - 4},${v - 12},0.5)`;
      c.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
    c.strokeStyle = 'rgba(40,36,30,0.75)';
    c.lineWidth = 10;
    c.beginPath();
    c.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(S / 2, S / 2, S * 0.1, 0, Math.PI * 2);
    c.stroke();
    GLYPHS.forEach((gl, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 2;
      c.save();
      c.translate(S / 2 + Math.cos(a) * S * 0.29, S / 2 + Math.sin(a) * S * 0.29);
      c.rotate((i * Math.PI) / 2);
      drawGlyph(c, gl, 0, 0, S * 0.27, 'rgba(48,40,30,0.92)');
      c.restore();
    });
    tex.update();
    const mat = new StandardMaterial('wheelMat', scene);
    mat.diffuseTexture = tex;
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    const gold = new StandardMaterial('markerMat', scene);
    gold.diffuseColor = new Color3(1, 0.76, 0.25);
    gold.emissiveColor = new Color3(0.4, 0.27, 0.05);

    for (let i = 0; i < 3; i++) {
      const node = new TransformNode('wheel' + i, scene);
      node.position.set(MECHANISM.x, g + 1.52 - i * 0.48, MECHANISM.z + 0.32);
      node.rotation.x = Math.PI / 2;
      const disc = MeshBuilder.CreateCylinder('wheelDisc' + i, {
        height: 0.07, diameter: 0.42, tessellation: 32,
        faceUV: [new Vector4(0, 0, 1, 1), new Vector4(0, 0, 0.02, 0.02), new Vector4(0, 0, 1, 1)],
      }, scene);
      disc.parent = node;
      disc.material = mat;
      disc.isPickable = false;
      // spin about the disc's own axis (child of the tilted node)
      this.wheelNodes.push(disc);
      const marker = MeshBuilder.CreateBox('wheelMarker' + i, { size: 0.06 }, scene);
      marker.position.set(MECHANISM.x, g + 1.52 - i * 0.48 + 0.26, MECHANISM.z + 0.31);
      marker.rotation.z = Math.PI / 4;
      marker.material = gold;
    }
    this.wheelAngles = this.wheels.map((w) => this.wheelAngle(w));
    this.wheelNodes.forEach((n, i) => { n.rotation.y = this.wheelAngles[i]; });
    return mat;
  }

  /** Rotation (about the wheel axis) that brings glyph `w` to the top marker. */
  private wheelAngle(w: number) {
    return WHEEL_SPIN_SIGN * w * (Math.PI / 2) + WHEEL_OFFSET;
  }

  private buildDoor(): Mesh {
    const { scene, world, site } = this.d;
    const { door, zFront } = CHAMBER;
    const fz = zFront - 0.45;
    const slab = MeshBuilder.CreateBox('chamberDoor', { width: door.w + 0.12, height: door.h + 0.7, depth: 0.5, wrap: true }, scene);
    this.doorBaseY = (door.h - 0.7) / 2;
    slab.position.set(door.x, this.doorBaseY, fz + 0.1);
    slab.material = site.builder.mats.fine;
    slab.receiveShadows = true;
    this.doorBox = world.addBox(door.x, fz, door.w + 0.12, 0.9, -1.2, door.h, 0);
    // carved sun disc on the door
    const sunTex = new DynamicTexture('doorSun', 256, scene, true);
    const c = sunTex.getContext() as unknown as CanvasRenderingContext2D;
    c.clearRect(0, 0, 256, 256);
    drawGlyph(c, 'sun', 128, 128, 220, 'rgba(60,48,32,0.85)');
    sunTex.hasAlpha = true;
    sunTex.update();
    const sm = new StandardMaterial('doorSunMat', scene);
    sm.diffuseTexture = sunTex;
    sm.useAlphaFromDiffuseTexture = true;
    sm.specularColor = new Color3(0, 0, 0);
    const plate = MeshBuilder.CreatePlane('doorSunPlate', { size: 0.8 }, scene);
    plate.parent = slab;
    plate.position.set(0, 0.55, 0.26);
    plate.rotation.y = Math.PI;
    plate.material = sm;
    return slab;
  }

  private buildRelic(): TransformNode {
    const { scene } = this.d;
    const root = new TransformNode('goldenLlama', scene);
    const m = new StandardMaterial('relicMat', scene);
    m.diffuseColor = new Color3(0.85, 0.57, 0.14);
    m.specularColor = new Color3(1, 0.88, 0.5);
    m.specularPower = 48;
    m.emissiveColor = new Color3(0.3, 0.18, 0.02);
    const part = (mesh: Mesh, x: number, y: number, z: number) => { mesh.parent = root; mesh.material = m; mesh.position.set(x, y, z); return mesh; };
    const body = part(MeshBuilder.CreateCapsule('lBody', { height: 0.3, radius: 0.07 }, scene), 0, 0.2, 0);
    body.rotation.x = Math.PI / 2;
    part(MeshBuilder.CreateCapsule('lNeck', { height: 0.2, radius: 0.035 }, scene), 0, 0.33, 0.11);
    const head = part(MeshBuilder.CreateCapsule('lHead', { height: 0.1, radius: 0.035 }, scene), 0, 0.43, 0.14);
    head.rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) {
      part(MeshBuilder.CreateCylinder('lEar', { height: 0.06, diameterTop: 0, diameterBottom: 0.025, tessellation: 6 }, scene), sx * 0.02, 0.48, 0.12);
      for (const sz of [-1, 1]) part(MeshBuilder.CreateCylinder('lLeg', { height: 0.16, diameter: 0.03, tessellation: 6 }, scene), sx * 0.04, 0.08, sz * 0.09);
    }
    part(MeshBuilder.CreateSphere('lTail', { diameter: 0.05, segments: 6 }, scene), 0, 0.24, -0.16);
    root.position.set(RELIC_SPOT.x, 0.85, RELIC_SPOT.z - 0.35);
    root.scaling.setAll(1.3);
    return root;
  }

  private updateMechanism(dt: number, time: number) {
    // ease wheels towards their target angle
    this.wheelNodes.forEach((n, i) => {
      const target = this.wheelAngles[i];
      n.rotation.y += (target - n.rotation.y) * Math.min(1, dt * 10);
    });
    if (this.puzzleSolvedAnim >= 0) {
      this.puzzleSolvedAnim += dt;
      const glow = Math.max(0, 1 - this.puzzleSolvedAnim / 2.5);
      this.wheelMat.emissiveColor.set(0.6 * glow, 0.45 * glow, 0.1 * glow);
      if (glow <= 0) this.puzzleSolvedAnim = -1;
    }
    if (this.doorAnim >= 0) {
      this.doorAnim += dt;
      const k = smooth(this.doorAnim / 2.6);
      this.door.position.y = this.doorBaseY - k * (CHAMBER.door.h + 0.72);
      this.door.position.x = CHAMBER.door.x + (k < 1 ? Math.sin(this.doorAnim * 40) * 0.006 : 0);
      if (k >= 1) { this.doorAnim = -1; this.door.setEnabled(false); }
    }
    if (this.relic.isEnabled()) {
      this.relic.rotation.y = time * 0.6;
    }
  }

  openPuzzle() {
    if (this.save.puzzles.includes(PUZZLE_ID)) return;
    const p = this.d.player;
    p.heading = Math.PI; // face the stone (south)
    this.d.camera.setBehind(Math.PI);
    this.d.camera.cam.beta = 1.5;
    this.savedZoom = this.d.camera.zoom;
    this.d.camera.setZoom(1.2);
    this.d.explorerRoot.setEnabled(false); // first-person-ish close-up of the wheels
    this.setModal('puzzle');
    $('puzzle').hidden = false;
    $('pz-hint').innerHTML = this.save.flags.introDialogue
      ? 'Killa’s words: “Sky, earth, and the world below.”'
      : 'Three wheels, four carved symbols each. Perhaps someone nearby knows the old story…';
    $('pz-status').textContent = '';
    this.renderWheels();
  }

  private renderWheels() {
    const box = $('pz-wheels');
    if (!this.wheelCanvases.length) {
      box.innerHTML = '';
      WHEEL_LABELS.forEach((label, i) => {
        const row = document.createElement('div');
        row.className = 'wheel-row';
        const prev = document.createElement('button');
        prev.className = 'wheel-btn';
        prev.textContent = '◀';
        prev.setAttribute('aria-label', `${label}: turn left`);
        const next = document.createElement('button');
        next.className = 'wheel-btn';
        next.textContent = '▶';
        next.setAttribute('aria-label', `${label}: turn right`);
        const cv = glyphCanvas(GLYPHS[this.wheels[i]]);
        cv.dataset.wheel = String(i);
        const lbl = document.createElement('span');
        lbl.className = 'lbl';
        prev.addEventListener('click', () => this.turnWheel(i, -1));
        next.addEventListener('click', () => this.turnWheel(i, 1));
        row.append(lbl, prev, cv, next);
        box.appendChild(row);
        this.wheelCanvases.push(cv);
      });
    }
    const rows = box.querySelectorAll('.wheel-row .lbl');
    this.wheels.forEach((w, i) => {
      paintGlyphCanvas(this.wheelCanvases[i], GLYPHS[w]);
      rows[i].textContent = `${WHEEL_LABELS[i]}: ${GLYPH_NAMES[GLYPHS[w]]}`;
    });
  }

  /** Turn wheel i by dir (+1 / -1). */
  turnWheel(i: number, dir: number) {
    if (this.save.puzzles.includes(PUZZLE_ID)) return;
    this.wheels[i] = (this.wheels[i] + dir + 4) % 4;
    this.wheelAngles[i] += WHEEL_SPIN_SIGN * dir * (Math.PI / 2);
    this.d.audio.click();
    this.renderWheels();
    if (this.wheels.every((w, j) => w === SOLUTION[j])) this.solvePuzzle();
  }

  private solvePuzzle() {
    this.save.puzzles.push(PUZZLE_ID);
    this.save.checkpoint = 'mechanism';
    this.setObjective('chamber');
    $('pz-status').textContent = 'The wheels lock into place. Behind you, stone grinds against stone…';
    this.d.audio.unlock();
    this.puzzleSolvedAnim = 0;
    this.openDoor();
    this.unlockNote('Inca stonework');
    this.persist();
    setTimeout(() => { if (this.modal === 'puzzle') this.closePuzzle(); this.toast('📖 Journal updated: The Turning Stones solved'); }, 2200);
  }

  private openDoor() {
    if (this.doorBox) { this.d.world.removeBox(this.doorBox); this.doorBox = null; }
    this.doorAnim = 0;
  }

  private setSolvedInstant() {
    this.wheels = [...SOLUTION];
    this.wheelAngles = this.wheels.map((w) => this.wheelAngle(w));
    this.wheelNodes.forEach((n, i) => { n.rotation.y = this.wheelAngles[i]; });
    if (this.doorBox) { this.d.world.removeBox(this.doorBox); this.doorBox = null; }
    this.door.setEnabled(false);
  }

  private savedZoom = 6.5;

  closePuzzle() {
    $('puzzle').hidden = true;
    this.d.explorerRoot.setEnabled(true);
    this.d.camera.setZoom(this.savedZoom);
    this.d.camera.cam.beta = 1.32;
    this.setModal('none');
  }

  private takeRelic() {
    if (this.save.flags.treasure) return;
    this.save.flags.treasure = true;
    this.save.gold += RELIC_VALUE;
    this.save.checkpoint = 'chamber';
    this.relic.setEnabled(false);
    this.burst(RELIC_SPOT.x, 1.2, RELIC_SPOT.z - 0.35, 50);
    this.d.audio.coin();
    this.d.audio.chime();
    this.toast(`The golden llama! +${RELIC_VALUE} gold`, 'gold');
    this.unlockNote('Offerings of gold');
    this.setObjective('explore');
    this.refreshHud(true);
    this.persist();
  }

  // =====================================================================
  // Interactions, HUD, journal
  // =====================================================================

  private findInteraction(): Interaction | null {
    const p = this.d.player.pos;
    if (this.eraK >= 1 && this.killa.root.isEnabled() && Math.hypot(p.x - this.killaPos.x, p.z - this.killaPos.z) < 2.8) {
      return { label: 'TALK', text: 'Talk to Killa', act: () => this.openDialogue() };
    }
    if (!this.save.puzzles.includes(PUZZLE_ID) && Math.hypot(p.x - MECH_FRONT.x, p.z - MECH_FRONT.z) < 2.0 && Math.abs(p.y - this.coins[0].y) < 100) {
      return { label: 'EXAMINE', text: 'Examine the turning stones', act: () => this.openPuzzle() };
    }
    if (!this.save.flags.treasure && this.save.puzzles.includes(PUZZLE_ID) && Math.hypot(p.x - RELIC_SPOT.x, p.z - RELIC_SPOT.z) < 1.9) {
      return { label: 'TAKE', text: 'Take the golden llama', act: () => this.takeRelic() };
    }
    return null;
  }

  private lastPrompt = '';
  private showPrompt(i: Interaction | null) {
    const key = i ? i.label + i.text : '';
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    const prompt = $('prompt');
    const btn = $('btn-action');
    if (!i) { prompt.hidden = true; btn.hidden = true; return; }
    if (this.d.input.isTouch) {
      btn.textContent = i.label;
      btn.hidden = false;
      prompt.hidden = true;
    } else {
      prompt.innerHTML = `<kbd>E</kbd>${esc(i.text)}`;
      prompt.hidden = false;
    }
  }

  private setModal(m: Modal) {
    this.modal = m;
    document.body.classList.toggle('modal', m !== 'none');
    if (m !== 'none') {
      this.d.input.clearHeld();
      this.showPrompt(null);
    }
  }

  private setObjective(o: string) {
    if (this.save.objective === o) return;
    this.save.objective = o;
    this.refreshHud(false);
    const el = $('objective');
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    this.d.audio.chime();
  }

  private refreshHud(pulse: boolean) {
    $('gold-count').textContent = String(this.save.gold);
    $('objective').textContent = OBJECTIVES[this.save.objective] ?? '';
    if (pulse) {
      const g = $('gold');
      g.classList.add('pulse');
      setTimeout(() => g.classList.remove('pulse'), 160);
    }
    if (this.modal === 'journal') this.renderJournal();
  }

  toast(text: string, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild?.remove();
    setTimeout(() => el.remove(), 3300);
  }

  private unlockNote(title: string) {
    const key = 'note:' + title;
    if (this.save.discovered.includes(key)) return;
    this.save.discovered.push(key);
  }

  toggleJournal() {
    if (this.modal === 'journal') { this.closeJournal(); return; }
    if (this.modal !== 'none') return;
    this.setModal('journal');
    $('journal').hidden = false;
    this.renderJournal();
  }

  closeJournal() {
    $('journal').hidden = true;
    this.setModal('none');
  }

  private renderJournal() {
    const s = this.save;
    const solved = s.puzzles.includes(PUZZLE_ID);
    const landmarks = ZONES.map((z) => z.name).filter((n, i, a) => a.indexOf(n) === i);
    const found = landmarks.filter((n) => s.discovered.includes(n));
    const notes: Note[] = [GENERAL_NOTES[0]];
    const unlocked = (t: string) => s.discovered.includes('note:' + t);
    if (unlocked('The three worlds')) notes.push(GENERAL_NOTES[1]);
    if (unlocked('Inca stonework') || found.length >= 3) notes.push(GENERAL_NOTES[2]);
    if (s.flags.transformed) notes.push(GENERAL_NOTES[3]);
    if (unlocked('Killa')) notes.push(GENERAL_NOTES[4]);
    if (unlocked('Offerings of gold')) notes.push(OFFERINGS_NOTE);
    const stat = (k: string, v: string) => `<div class="stat"><span>${k}</span><span>${v}</span></div>`;
    const coinsTaken = this.coins.filter((c) => c.taken).length;
    $('journal-body').innerHTML = `
      <section><h4>Current objective</h4><p>${esc(OBJECTIVES[s.objective] ?? '')}</p></section>
      <section><h4>Progress</h4>
        ${stat('Gold', String(s.gold))}
        ${stat('Gold coins found', `${coinsTaken} / ${this.coins.length}`)}
        ${stat('Transformation witnessed', s.flags.transformed ? '✓' : '—')}
        ${stat('Met Killa', s.flags.introDialogue ? '✓' : '—')}
        ${stat('Puzzle: The Turning Stones', solved ? '✓ Solved' : 'Unsolved')}
        ${stat('Hidden chamber treasure', s.flags.treasure ? '✓ Found' : '—')}
        ${stat('Landmarks discovered', `${found.length} / ${landmarks.length}`)}
      </section>
      <section><h4>Landmarks</h4>
        ${landmarks.map((n) => {
          const note = LANDMARK_NOTES[n];
          if (!s.discovered.includes(n)) return `<div class="entry todo">Undiscovered landmark</div>`;
          return `<div class="entry"><b>${esc(n)}</b><p>${note ? noteHtml(note) : ''}</p></div>`;
        }).join('')}
      </section>
      <section><h4>Notes</h4>
        ${notes.map((n) => `<div class="entry"><b>${esc(n.title)}</b><p>${noteHtml(n)}</p></div>`).join('')}
        <p class="legend"><span class="tag history">History</span> documented or widely accepted by historians.
        <span class="tag story">Story</span> invented for this game.</p>
        <p class="legend">The landscape and buildings are an artistic approximation, not a survey-accurate reconstruction.</p>
        <button class="reset" id="journal-reset">Start a new journey (erase progress)</button>
      </section>`;
    $('journal-reset').addEventListener('click', () => {
      if (confirm('Erase all saved progress and start again from the Sun Gate?')) {
        clearSave();
        this.resetting = true;
        location.reload();
      }
    });
  }

  /** set when the player wipes progress, so pagehide does not re-save */
  resetting = false;

  private wireUi() {
    const { input } = this.d;
    this.cineEls.skip.addEventListener('click', () => this.skipTransformation());
    $('btn-journal').addEventListener('click', () => this.toggleJournal());
    $('journal-close').addEventListener('click', () => this.closeJournal());
    $('pz-close').addEventListener('click', () => this.closePuzzle());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.modal === 'cinematic') this.skipTransformation();
        else if (this.modal === 'journal') this.closeJournal();
        else if (this.modal === 'puzzle') this.closePuzzle();
        else if (this.modal === 'dialogue' && this.save.flags.introDialogue) this.closeDialogue();
      }
      if (this.modal === 'dialogue') {
        const n = Number(e.key);
        if (n >= 1 && n <= this.choiceHandlers.length) this.choiceHandlers[n - 1]();
      }
      if (this.modal === 'journal' && e.code === 'KeyJ') { e.preventDefault(); input.consumeKey('KeyJ'); this.closeJournal(); }
    });
    const flush = () => { if (!this.resetting) this.persist(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  }

  // ---- test hooks ----
  debugState() {
    return {
      ...JSON.parse(JSON.stringify(this.save)) as SaveData,
      eraK: this.eraK,
      modal: this.modal,
      cine: this.cine,
      wheels: [...this.wheels],
      doorOpen: !this.doorBox,
      coinsLeft: this.coins.filter((c) => !c.taken).length,
      killa: { x: this.killaPos.x, z: this.killaPos.z, enabled: this.killa.root.isEnabled() },
      interaction: this.interaction?.text ?? null,
    };
  }

  /** test hook: wheel display check (which glyph is at the top marker) */
  wheelRotation(i: number) {
    return this.wheelNodes[i].rotation.y;
  }
}

// Wheel orientation constants (verified visually: glyph index w sits under the gold marker).
const WHEEL_SPIN_SIGN = -1;
const WHEEL_OFFSET = Math.PI;

const OFFERINGS_NOTE: Note = {
  kind: 'history',
  title: 'Offerings of gold',
  text: 'Small figurines of llamas and people in gold, silver and shell have been found in Inca ritual offerings, for example on high Andean summits. The golden llama in this game is fictional.',
};

function noteHtml(n: Note) {
  return `<span class="tag ${n.kind}">${n.kind === 'history' ? 'History' : 'Story'}</span> ${esc(n.text)}`;
}
