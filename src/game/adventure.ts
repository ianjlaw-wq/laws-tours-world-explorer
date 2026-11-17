// The Machu Picchu adventure (Milestones C + D).
// Opening: Sun Gate -> Killa waits just beyond it -> spoken welcome -> cinematic transformation of the
// ruins into the living Inca city -> Killa's directions -> the carved doorway and the turning-stone
// puzzle -> the hidden chamber. Also: gold coins, the Explorer's Journal and automatic local saving.

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
import { CamPose, FollowCamera, lerpPose, newPose } from '../camera';
import type { Input } from '../input';
import type { Ambience } from '../audio';
import type { Environment } from '../world/environment';
import type { SiteResult } from '../world/site';
import { COURSE_H } from '../world/site';
import type { Box, CollisionWorld } from '../world/colliders';
import { Villagers } from '../world/villagers';
import { AG, AG_Z_END, CHAMBER, MECHANISM, PLAYER_START, SUN_GATE, TRAIL, VILLAGER_HOME, ZONES } from '../world/layout';
import { cloudTexture } from '../world/textures';
import { SaveData, clearSave, freshSave, loadSave, writeSave } from './save';
import {
  AFTER_DIALOGUE, CHECKPOINTS, DialogueNode, GENERAL_NOTES, LANDMARK_NOTES, MEET_DIALOGUE, MEET_LATE_DIALOGUE, Note, OBJECTIVES, REPEAT_DIALOGUE,
} from './story';
import { GLYPHS, GLYPH_NAMES, drawGlyph, glyphCanvas, paintGlyphCanvas } from './glyphs';
import { DialogueVoice } from './voice';
import { Prefs, loadPrefs, savePrefs } from './prefs';
import { NavIndicator, P2, Polyline } from './nav';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Length of the transformation cinematic (seconds). */
export const TRANSFORM_SECONDS = 7.6;
// cinematic timeline
const T_SWOOP = 1.5; // camera reaches the elevated view
const T_ERA0 = 1.9; // ruins start to change
const T_ERA1 = 5.6; // city fully alive
const T_RETURN = 6.0; // camera starts returning to the explorer
const COIN_VALUE = 10;
const RELIC_VALUE = 50;
export const PUZZLE_ID = 'mp-turning-stones';
const SOLUTION = [0, 1, 2]; // condor (sky), puma (earth), serpent (below)
const START_WHEELS = [3, 0, 1];
const MECH_FRONT = { x: MECHANISM.x, z: MECHANISM.z + 1.35 };
const RELIC_SPOT = { x: CHAMBER.door.x, z: CHAMBER.zBack + 0.7 + 0.6 };
const WHEEL_LABELS = ['Upper wheel', 'Middle wheel', 'Lower wheel'];
const DOORWAY_ZONE = 'The Carved Doorway';

/**
 * Killa's first-meeting spot: on the trail beyond the Sun Gate, a little to the right of the
 * path so the explorer (in the middle of the screen) never hides her.
 */
const GATE_SPOT = (() => {
  const dx = TRAIL[2].x - SUN_GATE.x;
  const dz = TRAIL[2].z - SUN_GATE.z;
  const L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  return { x: SUN_GATE.x + ux * 8 + uz * 0.8, z: SUN_GATE.z + uz * 8 - ux * 0.8 };
})();
/** Elevated view over the city used by the transformation cinematic. */
const CITY_VIEW = { target: new Vector3(0, 4, -20), alpha: Math.atan2(-0.819, 0.574), beta: 1.0, radius: 104 };
/** Walking route from the Sun Gate to the turning stones (for the objective arrow). */
const ROUTE: P2[] = [
  ...TRAIL.slice(1).map((p) => [p.x, p.z] as P2),
  [AG.stairX, AG_Z_END + 1.5],
  [AG.stairX, AG.zStart + 1.6],
  [8, MECHANISM.z + 0.6],
  [MECH_FRONT.x, MECH_FRONT.z],
];
const TRAIL_LINE = new Polyline(TRAIL.map((p) => [p.x, p.z] as P2));

type Modal = 'none' | 'cinematic' | 'dialogue' | 'puzzle' | 'journal' | 'settings';
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
  readonly voice = new DialogueVoice();
  readonly prefs: Prefs = loadPrefs();
  private d: AdventureDeps;
  private eraK = 0;
  private base: { sunDiff: Color3; sunInt: number; hemiInt: number; hemiDiff: Color3; fog: Color3; fogDen: number; exposure: number; contrast: number };
  private hemi: HemisphericLight | null;
  private smoke: ParticleSystem;
  private sparkle: ParticleSystem;
  private villagers: Villagers;
  // ---- cinematic ----
  private cine = -1;
  private cineReplay = false;
  /** dialogue node to continue with after the cinematic */
  private cineResume: string | null = null;
  private poseFrom = newPose();
  private poseTo = newPose();
  private poseCity = newPose();
  private poseOut = newPose();
  private camMode: 'none' | 'frame' | 'cine' | 'release' = 'none';
  private camT = 0;
  private frameSide = 1;
  /** shadow-map focus while the camera is away from the explorer */
  shadowFocus: Vector3 | null = null;
  // ---- villager Killa ----
  readonly killa: Explorer;
  private killaPos = new Vector3();
  private killaHome = new Vector3();
  private killaHomeHeading = 0;
  private killaHeading = 0;
  private killaSpeed = 0;
  private meeting: 'none' | 'approach' | 'talk' = 'none';
  private meetT = 0;
  private bubble: Mesh;
  private relocateToGuardhouse = false;
  private started = false;
  // ---- coins ----
  readonly coins: Array<{ id: string; x: number; y: number; z: number; taken: boolean; anim: number }> = [];
  private coinMesh: Mesh;
  private coinMatrices: Float32Array;
  // ---- puzzle & doorway ----
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
  private beacon: Mesh;
  private marker: Mesh;
  private flames: Mesh[] = [];
  private banners: Mesh[] = [];
  private navWasOn = false;
  readonly nav = new NavIndicator(new Polyline(ROUTE), 'Carved doorway');
  // ---- ui ----
  private interaction: Interaction | null = null;
  private saveTimer = 0;
  private dialogueTree: Record<string, DialogueNode> = MEET_DIALOGUE;
  private nodeId = '';
  private choiceHandlers: Array<() => void> = [];
  private advanceTimer = 0;
  private wheelCanvases: HTMLCanvasElement[] = [];
  private cineEls = { title: $('era-title'), year: $('era-year'), name: $('era-name'), skip: $('era-skip') };

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
      contrast: scene.imageProcessingConfiguration.contrast,
    };

    this.smoke = this.buildSmoke();
    this.sparkle = this.buildSparkle();
    this.villagers = new Villagers(scene, d.world);

    // ---- Killa ----
    this.killa = new Explorer(scene, { villager: true, name: 'killa' });
    this.killa.root.scaling.setAll(0.95); // a little shorter than the explorer: distinct silhouettes
    for (const m of this.killa.meshes) m.receiveShadows = false;
    if (env.shadows) for (const m of this.killa.meshes) env.shadows.addShadowCaster(m, false);
    this.bubble = this.buildBubble();
    this.bubble.scaling.setAll(1.4);
    this.placeKilla();

    this.coinMesh = this.buildCoins();
    this.coinMatrices = new Float32Array(this.coins.length * 16);
    this.coinMesh.thinInstanceSetBuffer('matrix', this.coinMatrices, 16, false);
    this.wheelMat = this.buildMechanism();
    this.door = this.buildDoor();
    this.relic = this.buildRelic();
    const deco = this.buildDoorway();
    this.beacon = deco.beacon;
    this.marker = deco.marker;

    // the era layers are animated by the transformation
    d.site.rubble.unfreezeWorldMatrix();
    d.site.era.soil.unfreezeWorldMatrix();

    // ---- restore persisted state ----
    this.applyEra(this.save.flags.transformed ? 1 : 0);
    if (this.save.puzzles.includes(PUZZLE_ID)) this.setSolvedInstant();
    if (this.save.flags.treasure) this.relic.setEnabled(false);

    this.voice.enabled = this.prefs.voice;
    this.d.audio.setMuted(!this.prefs.sound);
    this.voice.onStatus = () => this.refreshVoiceUi();
    this.wireUi();
    this.refreshPrefsUi();
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
    let out: { x: number; y: number; z: number; heading: number } | null = null;
    if (p && [p.x, p.y, p.z, p.heading].every(Number.isFinite)) {
      const g = w.groundAt(p.x, p.z, p.y + 0.6, 0.6).y;
      if (Math.abs(g - p.y) < 1.0 && !w.solidAt(p.x, g + 1.0, p.z, 0.05)) out = { x: p.x, y: g, z: p.z, heading: p.heading };
    }
    if (!out && this.resumed) {
      const c = CHECKPOINTS[this.save.checkpoint] ?? CHECKPOINTS.sungate;
      out = { x: c.x, y: w.groundAt(c.x, c.z, 1000, 2000).y, z: c.z, heading: c.heading };
    }
    if (out) this.placeKilla(out.x, out.z);
    return out;
  }

  /** Called when the player enters a named zone. */
  discover(name: string) {
    if (!name || this.save.discovered.includes(name)) return;
    this.save.discovered.push(name);
    this.toast(`📖 New journal entry: ${name}`);
    if (name === DOORWAY_ZONE && !this.save.puzzles.includes(PUZZLE_ID)) {
      this.setObjective('puzzle');
    }
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

  /** Per-frame update. `playing` = the game has started. */
  update(dt: number, time: number, playing: boolean, _look: { dx: number; dy: number; zoom: number }) {
    const { player, input } = this.d;
    if (!playing) return;
    this.started = true;

    this.updateCinematic(dt);
    this.updateKilla(dt, time);
    this.updateCamera(dt);
    this.updateCoins(dt, time);
    this.updateMechanism(dt, time);
    this.updateDoorway(time);
    this.villagers.update(dt, time);
    this.updateDialogueTimer(dt);

    // first meeting: Killa notices the explorer
    if (!this.save.flags.introDialogue && this.meeting === 'none' && this.modal === 'none' && this.killa.root.isEnabled()) {
      const d = Math.hypot(player.pos.x - this.killaPos.x, player.pos.z - this.killaPos.z);
      if (d < 5.5 || this.passedKilla()) this.beginMeeting();
    }

    // the doorway is discovered on approach (also handled by the zone banner)
    const dM = Math.hypot(player.pos.x - MECHANISM.x, player.pos.z - MECHANISM.z);
    if (dM < 8 && !this.save.discovered.includes(DOORWAY_ZONE)) this.discover(DOORWAY_ZONE);

    // objective indicator and beacon (only once Killa has given directions, until the puzzle is solved)
    const navOn = this.navActive();
    if (navOn) this.nav.update(player.pos.x, player.pos.z, this.d.camera.yaw);
    else this.nav.hide();
    if (navOn !== this.navWasOn) { this.navWasOn = navOn; document.body.classList.toggle('nav-on', navOn); }
    const s = this.save;
    this.setObjectiveMarkers(s.flags.introDialogue && s.flags.transformed && !s.puzzles.includes(PUZZLE_ID) && this.cine < 0);

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

  /**
   * Loading-screen warm-up: enable every layer that can appear later (living-city layers, coins,
   * villagers, Killa, markers) so their shaders compile before play. Compiling them mid-game - as
   * Milestone C did when the city first came to life - causes multi-frame hitches on phones.
   */
  setWarmup(on: boolean) {
    if (on) {
      this.applyEra(1);
      this.coinMesh.setEnabled(true);
      this.killa.root.setEnabled(true);
      this.bubble.setEnabled(true);
      this.beacon.setEnabled(true);
      this.marker.setEnabled(true);
    } else {
      this.applyEra(this.save.flags.transformed ? 1 : 0);
      this.coinMesh.setEnabled(this.eraK >= 1);
      const s = this.save;
      const markers = s.flags.introDialogue && s.flags.transformed && !s.puzzles.includes(PUZZLE_ID);
      this.beacon.setEnabled(markers);
      this.marker.setEnabled(markers);
    }
  }

  private navActive() {
    const s = this.save;
    return this.modal === 'none' && s.flags.introDialogue && s.flags.transformed && !s.puzzles.includes(PUZZLE_ID);
  }

  // =====================================================================
  // Camera direction (conversation framing, cinematic, hand-back)
  // =====================================================================

  /** Over-the-shoulder two-shot of the explorer and Killa. */
  private framingPose(out: CamPose): CamPose {
    const p = this.d.player.pos;
    const k = this.killaPos;
    let ux = k.x - p.x;
    let uz = k.z - p.z;
    const L = Math.hypot(ux, uz) || 1;
    ux /= L; uz /= L;
    const px = uz * this.frameSide;
    const pz = -ux * this.frameSide;
    const ox = px * 0.85 - ux * 0.5;
    const oz = pz * 0.85 - uz * 0.5;
    // aim a little below the faces so both characters sit above the dialogue panel
    out.target.set((p.x + k.x) / 2, (p.y + k.y) / 2 + 0.75, (p.z + k.z) / 2);
    out.alpha = Math.atan2(oz, ox);
    out.beta = 1.36;
    out.radius = this.clearBoom(out.target, out.alpha, out.beta, 3.9 + L * 0.7);
    return out;
  }

  /** Longest camera distance (up to `r`) along a boom that does not pass through rock or walls. */
  private clearBoom(t: Vector3, alpha: number, beta: number, r: number) {
    const sb = Math.sin(beta);
    const dx = Math.cos(alpha) * sb, dy = Math.cos(beta), dz = Math.sin(alpha) * sb;
    for (let s = 0.8; s <= r; s += 0.25) {
      if (this.d.world.solidAt(t.x + dx * s, t.y + dy * s, t.z + dz * s, 0.45)) return Math.max(1.4, s - 0.5);
    }
    return r;
  }

  /** Choose the side of the two-shot nearest the current camera, so the cut is gentle. */
  private pickFrameSide() {
    const cur = this.d.camera.cam.alpha;
    this.frameSide = 1;
    const a = this.framingPose(this.poseOut);
    const aAlpha = a.alpha, aR = a.radius;
    this.frameSide = -1;
    const b = this.framingPose(this.poseOut);
    // prefer an unobstructed view, then the side closest to the current camera
    const scoreA = aR - Math.abs(wrapA(aAlpha - cur)) * 0.8;
    const scoreB = b.radius - Math.abs(wrapA(b.alpha - cur)) * 0.8;
    this.frameSide = scoreA >= scoreB ? 1 : -1;
  }

  private setCamMode(m: 'none' | 'frame' | 'cine' | 'release') {
    this.d.camera.getPose(this.poseFrom);
    this.camMode = m;
    this.camT = 0;
    this.d.camera.pose = m === 'none' ? null : this.poseOut;
    if (m === 'none') this.shadowFocus = null;
  }

  private updateCamera(dt: number) {
    if (this.camMode === 'none' || this.camMode === 'cine') return;
    this.camT += dt;
    const { camera, player } = this.d;
    if (this.camMode === 'frame') {
      lerpPose(this.poseFrom, this.framingPose(this.poseTo), smooth(this.camT / 1.0), this.poseOut);
    } else {
      lerpPose(this.poseFrom, camera.followPose(player.pos, player.heading, this.poseTo), smooth(this.camT / 0.8), this.poseOut);
      if (this.camT >= 0.8) { camera.pose = null; this.camMode = 'none'; }
    }
  }

  // =====================================================================
  // Transformation cinematic: present-day ruins -> living Inca city (c. 1450)
  // =====================================================================

  /**
   * Play the transformation. `resume` = dialogue node to continue with afterwards.
   * `replay` = revisit from the Sun Gate (progress unaffected).
   */
  startTransformation(resume: string | null = null, replay = false) {
    if (this.cine >= 0) return;
    if (!replay && this.save.flags.transformed) return;
    this.cine = 0;
    this.cineReplay = replay;
    this.cineResume = resume;
    this.voice.stop();
    $('dialogue').hidden = true;
    this.setModal('cinematic');
    this.applyEra(0);
    this.cineEls.title.hidden = false;
    this.cineEls.title.style.opacity = '0';
    this.cineEls.skip.hidden = false;
    this.d.audio.swell(T_ERA1 - T_ERA0 + 1);
    this.d.camera.getPose(this.poseFrom);
    this.camMode = 'cine';
    this.d.camera.pose = this.poseOut;
    this.poseCity.target.copyFrom(CITY_VIEW.target);
    this.poseCity.alpha = CITY_VIEW.alpha;
    this.poseCity.beta = CITY_VIEW.beta;
    this.poseCity.radius = CITY_VIEW.radius;
    this.shadowFocus = CITY_VIEW.target;
  }

  /** Skip the cinematic (button, Esc, or test hook): the city is left in its final state. */
  skipTransformation() {
    if (this.cine < 0) return;
    this.cine = TRANSFORM_SECONDS;
  }

  private updateCinematic(dt: number) {
    if (this.cine < 0) return;
    this.cine += dt;
    const t = this.cine;
    // camera: swoop up to the elevated view, drift slowly, then return to the explorer
    const drift = this.poseTo;
    drift.target.copyFrom(this.poseCity.target);
    drift.alpha = this.poseCity.alpha + 0.035 * Math.max(0, t - T_SWOOP);
    drift.beta = this.poseCity.beta;
    drift.radius = this.poseCity.radius - 2.2 * Math.max(0, t - T_SWOOP);
    if (t < T_RETURN) {
      lerpPose(this.poseFrom, drift, smooth(t / T_SWOOP), this.poseOut);
    } else {
      const back = this.cineResume ? this.framingPose(newPoseTmp) : this.d.camera.followPose(this.d.player.pos, this.d.player.heading, newPoseTmp);
      // long, smooth descent: ease the target first, the distance follows
      lerpPose(drift, back, smooth((t - T_RETURN) / (TRANSFORM_SECONDS - T_RETURN)), this.poseOut);
    }
    this.shadowFocus = t < T_RETURN ? CITY_VIEW.target : null;
    // captions: "today" over the ruins, then the date once the city is alive
    const today = smooth((t - 0.6) / 0.4) * (1 - smooth((t - 2.6) / 0.4));
    const past = smooth((t - 4.3) / 0.5) * (1 - smooth((t - 6.6) / 0.5));
    if (today > 0.01) {
      this.setCaption('Today', 'The ruins of Machu Picchu');
      this.cineEls.title.style.opacity = today.toFixed(2);
    } else {
      this.setCaption('c. 1450', 'The living Inca city');
      this.cineEls.title.style.opacity = past.toFixed(2);
    }
    this.applyEra(clamp01((t - T_ERA0) / (T_ERA1 - T_ERA0)));
    if (t >= TRANSFORM_SECONDS) this.endCinematic();
  }

  private lastCaption = '';
  private setCaption(year: string, name: string) {
    if (this.lastCaption === year) return;
    this.lastCaption = year;
    this.cineEls.year.textContent = year;
    this.cineEls.name.textContent = name;
  }

  private endCinematic() {
    this.cine = -1;
    this.cineEls.title.hidden = true;
    this.cineEls.skip.hidden = true;
    this.applyEra(1);
    this.shadowFocus = null;
    const first = !this.cineReplay && !this.save.flags.transformed;
    this.cineReplay = false;
    this.save.flags.transformed = true;
    if (this.save.objective === 'walk' && !this.cineResume) this.setObjective(this.save.flags.introDialogue ? 'gold' : 'meet');
    if (this.cineResume) {
      // continue the conversation with Killa
      const node = this.cineResume;
      this.cineResume = null;
      this.setCamMode('frame');
      this.camT = 1; // already framed
      this.setModal('dialogue');
      $('dialogue').hidden = false;
      this.showNode(node);
    } else {
      // the camera already returned behind the explorer during the cinematic
      this.setModal('none');
      this.d.camera.pose = null;
      this.camMode = 'none';
      if (first && this.save.flags.introDialogue) this.toast('Follow the arrow at the top of the screen ▲');
    }
    this.persist();
  }

  /** Blend between the present-day ruins (0) and the inhabited settlement (1). */
  private applyEra(k: number) {
    this.eraK = k;
    const { site, scene, env, audio } = this.d;
    const era = site.era;
    const win = (a: number, b: number) => smooth((k - a) / (b - a));
    // 1. stone: fallen blocks sink away, restored courses rise out of the walls
    const rb = win(0, 0.32);
    site.rubble.setEnabled(rb < 1);
    site.rubble.position.y = -0.7 * rb;
    const cs = win(0.02, 0.38);
    era.courses.setEnabled(cs > 0);
    era.courses.position.y = -(COURSE_H + 0.1) * (1 - cs);
    // 2. thatched roofs drop into place
    const rk = win(0.26, 0.6);
    era.roofs.setEnabled(rk > 0);
    era.roofs.position.y = (1 - rk) * 6;
    era.roofMat.alpha = rk >= 1 ? 1 : 0.25 + 0.75 * rk;
    // 3. terraces are tilled, then the crops grow
    const so = win(0.38, 0.55);
    era.soil.setEnabled(so > 0);
    era.soil.position.y = -0.3 * (1 - so);
    const cr = win(0.48, 0.85);
    for (const c of era.crops) {
      // crops grow up out of the soil (below the surface they are hidden inside the terrace fill)
      c.setEnabled(cr > 0);
      c.position.y = -2.1 * (1 - cr);
    }
    // 4. hearth smoke and people
    if (k > 0.66 && !this.smoke.isStarted()) {
      if (k >= 1) { this.smoke.preWarmCycles = 120; this.smoke.preWarmStepOffset = 6; } else { this.smoke.preWarmCycles = 0; }
      this.smoke.start();
    } else if (k <= 0.66 && this.smoke.isStarted()) {
      this.smoke.stop();
      this.smoke.reset();
    }
    this.villagers.setPresence(win(0.66, 0.95));
    audio.era = k >= 0.5;
    // 5. warmer, golden light and a clearer, inhabited atmosphere
    const L = smooth(k);
    const b = this.base;
    Color3.LerpToRef(b.sunDiff, WARM_SUN, L * 0.85, env.sun.diffuse);
    env.sun.intensity = b.sunInt * (1 + 0.1 * L);
    if (this.hemi) {
      this.hemi.intensity = b.hemiInt * (1 + 0.05 * L);
      Color3.LerpToRef(b.hemiDiff, WARM_SKY, L * 0.6, this.hemi.diffuse);
    }
    Color3.LerpToRef(b.fog, WARM_FOG, L * 0.7, scene.fogColor);
    scene.fogDensity = b.fogDen * (1 - 0.18 * L);
    scene.imageProcessingConfiguration.exposure = b.exposure + 0.07 * L;
    scene.imageProcessingConfiguration.contrast = b.contrast + 0.06 * L;
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
  // Killa
  // =====================================================================

  private ground(x: number, z: number, fromY: number) {
    return this.d.world.groundAt(x, z, fromY, 0.6).y;
  }

  /** Decide where Killa stands, given where the explorer (re)starts. */
  private placeKilla(px = PLAYER_START.x, pz = PLAYER_START.z) {
    const f = this.save.flags;
    let x = GATE_SPOT.x;
    let z = GATE_SPOT.z;
    if (f.introDialogue || (f.transformed && Math.hypot(px - GATE_SPOT.x, pz - GATE_SPOT.z) > 60)) {
      x = VILLAGER_HOME.x; z = VILLAGER_HOME.z;
    } else {
      // an older save may resume further down the trail: wait a little ahead of the explorer instead
      const pr = TRAIL_LINE.project(px, pz, { s: 0, d: 0 });
      const kg = TRAIL_LINE.project(GATE_SPOT.x, GATE_SPOT.z, { s: 0, d: 0 });
      if (pr.d < 25 && pr.s > kg.s - 2) {
        const pt = TRAIL_LINE.pointAt(pr.s + 10, { x: 0, z: 0 });
        x = pt.x; z = pt.z;
      } else if (pr.d >= 25 && Math.hypot(px - GATE_SPOT.x, pz - GATE_SPOT.z) > 60) {
        // somewhere in the city without having met her: she waits at the guardhouse instead
        x = VILLAGER_HOME.x; z = VILLAGER_HOME.z;
      }
    }
    this.killaHome.set(x, this.ground(x, z, 200), z);
    this.killaPos.copyFrom(this.killaHome);
    // face back towards the Sun Gate / approaching explorer
    this.killaHomeHeading = Math.atan2(px - x, pz - z);
    if (x === VILLAGER_HOME.x) this.killaHomeHeading = Math.atan2(0 - VILLAGER_HOME.x, -112 - VILLAGER_HOME.z);
    this.killaHeading = this.killaHomeHeading;
    this.killa.root.position.copyFrom(this.killaPos);
    this.killa.root.rotation.y = this.killaHeading;
  }

  /** The explorer walked on past Killa without coming close (e.g. around her). */
  private passedKilla() {
    const p = this.d.player.pos;
    const pr = TRAIL_LINE.project(p.x, p.z, this.tmpProj);
    const ps = pr.s;
    const pd = pr.d;
    const ks = TRAIL_LINE.project(this.killaPos.x, this.killaPos.z, this.tmpProj).s;
    return pd < 30 && ps > ks + 6 && Math.hypot(p.x - this.killaPos.x, p.z - this.killaPos.z) < 40;
  }
  private tmpProj = { s: 0, d: 0 };

  private buildBubble(): Mesh {
    const { scene } = this.d;
    const t = new DynamicTexture('bubbleTex', 128, scene, true);
    const c = t.getContext() as unknown as CanvasRenderingContext2D;
    c.clearRect(0, 0, 128, 128);
    c.fillStyle = 'rgba(255,248,230,0.95)';
    c.strokeStyle = 'rgba(154,109,23,1)';
    c.lineWidth = 6;
    c.beginPath();
    c.ellipse(64, 54, 54, 40, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.beginPath();
    c.moveTo(48, 88); c.lineTo(40, 118); c.lineTo(70, 92);
    c.fill();
    c.fillStyle = '#c8901f';
    for (const x of [38, 64, 90]) { c.beginPath(); c.arc(x, 54, 8, 0, Math.PI * 2); c.fill(); }
    t.hasAlpha = true;
    t.update();
    const m = new StandardMaterial('bubbleMat', scene);
    m.diffuseTexture = t;
    m.useAlphaFromDiffuseTexture = true;
    m.emissiveColor = new Color3(1, 1, 1);
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.fogEnabled = false;
    const p = MeshBuilder.CreatePlane('killaBubble', { size: 0.6 }, scene);
    p.material = m;
    p.billboardMode = Mesh.BILLBOARDMODE_ALL;
    p.parent = this.killa.root;
    p.position.y = 2.25;
    p.isPickable = false;
    return p;
  }

  private updateKilla(dt: number, time: number) {
    const { player, world } = this.d;
    const k = this.killaPos;
    const dx = player.pos.x - k.x;
    const dz = player.pos.z - k.z;
    const d = Math.hypot(dx, dz) || 0.001;

    // after the first meeting she goes ahead to the guardhouse, out of the explorer's sight
    if (this.relocateToGuardhouse && this.meeting === 'none' && this.cine < 0) {
      const cam = this.d.camera.cam;
      const fx = cam.target.x - cam.position.x;
      const fz = cam.target.z - cam.position.z;
      const behind = fx * (k.x - cam.position.x) + fz * (k.z - cam.position.z) < 0;
      if ((d > 35 && behind) || d > 70) {
        this.relocateToGuardhouse = false;
        this.killaHome.set(VILLAGER_HOME.x, this.ground(VILLAGER_HOME.x, VILLAGER_HOME.z, VILLAGER_HOME.y + 2), VILLAGER_HOME.z);
        this.killaHomeHeading = Math.atan2(0 - VILLAGER_HOME.x, -112 - VILLAGER_HOME.z);
        k.copyFrom(this.killaHome);
        this.killaHeading = this.killaHomeHeading;
        this.killaSpeed = 0;
      }
    }
    const kd = Math.hypot(player.pos.x - k.x, player.pos.z - k.z);
    const on = kd < 140 || this.cine >= 0;
    this.killa.root.setEnabled(on);
    if (!on) return;

    const talking = this.meeting === 'talk' || this.modal === 'dialogue';
    let tx = this.killaHome.x;
    let tz = this.killaHome.z;
    if (this.meeting === 'approach') {
      // walk up to the explorer and stop at a comfortable distance
      tx = player.pos.x - (dx / d) * 1.9;
      tz = player.pos.z - (dz / d) * 1.9;
    } else if (talking || this.cine >= 0) {
      tx = k.x; tz = k.z;
    }
    const mx = tx - k.x;
    const mz = tz - k.z;
    const md = Math.hypot(mx, mz);
    let want = 0;
    let face = this.killaHomeHeading;
    if (md > 0.3) {
      want = Math.min(this.meeting === 'approach' ? 1.7 : 1.4, md * 1.4);
      face = Math.atan2(mx, mz);
    } else if (d < 14 || talking) {
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
    // greeting wave while the explorer approaches for the first time; gestures while she speaks
    const waving = !this.save.flags.introDialogue && this.meeting !== 'talk' && d < 32 && d > 2.6 && this.cine < 0;
    this.killa.wave += ((waving ? 1 : 0) - this.killa.wave) * Math.min(1, dt * 4);
    const speaking = this.modal === 'dialogue' && this.meeting !== 'approach' && (this.voice.status === 'speaking' || this.advanceTimer > 0);
    this.killa.talk += ((speaking ? 1 : 0) - this.killa.talk) * Math.min(1, dt * 4);
    this.killa.animate(dt, this.killaSpeed, true, 0, time + 1.7);
    // speech bubble: someone to talk to
    const bubble = this.modal === 'none' && this.cine < 0 && (!this.save.flags.introDialogue || d < 22);
    if (this.bubble.isEnabled() !== bubble) this.bubble.setEnabled(bubble);
    if (bubble) this.bubble.position.y = 2.25 + Math.sin(time * 2.4) * 0.06;
  }

  // =====================================================================
  // Meeting Killa and conversations (spoken + subtitles)
  // =====================================================================

  private beginMeeting() {
    this.meeting = 'approach';
    this.meetT = 0;
    this.setModal('dialogue');
    this.voice.stop();
    this.pickFrameSide();
    this.setCamMode('frame');
    this.dialogueTree = this.save.flags.transformed ? MEET_LATE_DIALOGUE : MEET_DIALOGUE;
  }

  private updateMeetingApproach(dt: number) {
    if (this.meeting !== 'approach') return;
    this.meetT += dt;
    const p = this.d.player;
    // the explorer turns to face Killa
    const want = Math.atan2(this.killaPos.x - p.pos.x, this.killaPos.z - p.pos.z);
    p.heading += wrapA(want - p.heading) * Math.min(1, dt * 5);
    const d = Math.hypot(p.pos.x - this.killaPos.x, p.pos.z - this.killaPos.z);
    if ((d < 2.2 && this.killaSpeed < 0.3) || this.meetT > 3.5) {
      this.meeting = 'talk';
      $('dialogue').hidden = false;
      this.showNode('start');
    }
  }

  /** Later conversations (TALK prompt). */
  openDialogue() {
    const f = this.save.flags;
    this.dialogueTree = f.treasure || this.save.puzzles.includes(PUZZLE_ID) ? AFTER_DIALOGUE : REPEAT_DIALOGUE;
    const p = this.d.player;
    this.killaHeading = Math.atan2(p.pos.x - this.killaPos.x, p.pos.z - this.killaPos.z);
    p.heading = Math.atan2(this.killaPos.x - p.pos.x, this.killaPos.z - p.pos.z);
    this.setModal('dialogue');
    this.pickFrameSide();
    this.setCamMode('frame');
    $('dialogue').hidden = false;
    this.showNode('start');
  }

  private get firstMeeting() {
    return this.dialogueTree === MEET_DIALOGUE || this.dialogueTree === MEET_LATE_DIALOGUE;
  }

  /** Subtitles are shown when chosen, or whenever the voice cannot be heard. */
  private get subtitlesVisible() {
    return this.prefs.subs || !this.voice.audible;
  }

  private showNode(id: string) {
    const n = this.dialogueTree[id];
    if (!n) { this.closeDialogue(); return; }
    this.nodeId = id;
    this.advanceTimer = 0;
    $('dlg-speaker').textContent = n.speaker;
    $('dlg-text').textContent = n.text;
    const note = $('dlg-note');
    note.hidden = !n.note;
    if (n.note) note.innerHTML = noteHtml(n.note);
    if (id === 'mystery' || id === 'stones') this.unlockNote('The three worlds');
    $('dlg-skip').hidden = !this.firstMeeting;
    const box = $('dlg-choices');
    box.innerHTML = '';
    const choices = n.choices.length ? n.choices : [{ text: 'Next ▸', next: n.next ?? null, effect: undefined }];
    this.choiceHandlers = choices.map((c, i) => {
      const run = () => {
        if (this.nodeId !== id || this.modal !== 'dialogue') return;
        this.d.audio.click();
        this.leaveNode(n, c.next, c.effect);
      };
      const b = document.createElement('button');
      b.className = n.choices.length ? 'choice' : 'choice next';
      b.innerHTML = n.choices.length ? `<span class="num">${i + 1}</span>${esc(c.text)}` : esc(c.text);
      b.addEventListener('click', run);
      box.appendChild(b);
      return run;
    });
    // speak the line; continue automatically when it has been heard
    const heard = this.voice.speak({ text: n.text, clip: n.clip }, () => {
      if (this.nodeId === id && this.modal === 'dialogue' && !n.choices.length) this.advanceTimer = 0.6;
    });
    void heard;
    this.refreshVoiceUi();
  }

  /** Leave the current node via a choice / Next / auto-advance. */
  private leaveNode(n: DialogueNode, next: string | null, choiceEffect?: string) {
    this.voice.stop();
    this.advanceTimer = 0;
    const effect = choiceEffect ?? n.effect;
    if (effect === 'finishIntro') this.finishIntro();
    if (effect === 'transform') {
      if (!this.save.flags.transformed) { this.startTransformation(next); return; }
    }
    if (next) this.showNode(next);
    else this.closeDialogue();
  }

  private updateDialogueTimer(dt: number) {
    this.updateMeetingApproach(dt);
    if (this.advanceTimer <= 0 || this.modal !== 'dialogue') return;
    this.advanceTimer -= dt;
    if (this.advanceTimer <= 0) {
      this.advanceTimer = 0;
      const n = this.dialogueTree[this.nodeId];
      if (n && !n.choices.length) this.leaveNode(n, n.next ?? null);
    }
  }

  /** Skip the rest of the first meeting (the transformation still plays, and can be skipped too). */
  skipIntro() {
    if (!this.firstMeeting || this.modal !== 'dialogue') return;
    this.voice.stop();
    this.finishIntro();
    this.meeting = 'none';
    this.dialogueTree = REPEAT_DIALOGUE;
    $('dialogue').hidden = true;
    if (!this.save.flags.transformed) {
      this.setModal('none');
      this.startTransformation(null);
    } else {
      this.closeDialogue();
      this.toast('Follow the arrow at the top of the screen ▲');
    }
  }

  private finishIntro() {
    if (this.save.flags.introDialogue) return;
    this.save.flags.introDialogue = true;
    this.unlockNote('Killa');
    if (['meet', 'walk'].includes(this.save.objective)) this.setObjective('gold');
    this.save.checkpoint = 'sungate';
    this.relocateToGuardhouse = true;
    this.persist();
  }

  private closeDialogue() {
    this.voice.stop();
    this.advanceTimer = 0;
    this.meeting = 'none';
    $('dialogue').hidden = true;
    const wasFirst = this.firstMeeting;
    this.dialogueTree = REPEAT_DIALOGUE;
    this.setModal('none');
    this.setCamMode('release');
    if (wasFirst && this.save.flags.introDialogue) this.toast('Follow the arrow at the top of the screen ▲');
  }

  // ---- voice / subtitle preferences ----

  private refreshVoiceUi() {
    const blocked = this.voice.status === 'blocked' && this.prefs.voice && this.voice.supported;
    $('dlg-play').hidden = !blocked || this.modal !== 'dialogue';
    const subs = this.subtitlesVisible;
    $('dlg-text').classList.toggle('hidden-subs', !subs);
    $('dlg-speaking').hidden = subs || this.voice.status !== 'speaking';
    this.refreshPrefsUi();
  }

  private refreshPrefsUi() {
    const p = this.prefs;
    const cc = $('btn-cc');
    cc.classList.toggle('off', !p.subs);
    cc.setAttribute('aria-pressed', String(p.subs));
    cc.title = p.subs ? 'Subtitles on' : 'Subtitles off';
    const v = $('btn-voice');
    const canSpeak = this.voice.supported;
    v.textContent = p.voice && canSpeak ? '🔊' : '🔇';
    v.classList.toggle('off', !p.voice || !canSpeak);
    v.setAttribute('aria-pressed', String(p.voice && canSpeak));
    v.title = !canSpeak ? 'Spoken dialogue is not supported in this browser' : p.voice ? 'Killa’s voice on' : 'Killa’s voice off';
    $('set-voice').textContent = !canSpeak ? 'Not supported' : p.voice ? 'On' : 'Off';
    $('set-subs').textContent = p.subs ? 'On' : 'Off (shown when voice is off)';
    $('set-sound').textContent = p.sound ? 'On' : 'Off';
    $('set-voice-name').textContent = canSpeak
      ? `Killa’s voice is generated by your browser’s built-in speech synthesis${this.voice.voiceName ? ` (${this.voice.voiceName})` : ''}. It is not a recorded actor.`
      : 'This browser has no speech synthesis, so Killa’s lines are shown as text.';
  }

  setVoice(on: boolean) {
    this.prefs.voice = on;
    this.voice.enabled = on;
    savePrefs(this.prefs);
    if (!on) this.voice.stop();
    else {
      this.voice.resetBlocked();
      // speak the current line again so the player hears it (this runs inside a tap)
      const n = this.dialogueTree[this.nodeId];
      if (this.modal === 'dialogue' && n && this.meeting !== 'approach') {
        this.voice.speak({ text: n.text, clip: n.clip }, () => {
          if (this.dialogueTree[this.nodeId] === n && !n.choices.length) this.advanceTimer = 0.6;
        });
      }
    }
    this.refreshVoiceUi();
  }

  setSubtitles(on: boolean) {
    this.prefs.subs = on;
    savePrefs(this.prefs);
    this.refreshVoiceUi();
  }

  setSound(on: boolean) {
    this.prefs.sound = on;
    this.d.audio.setMuted(!on);
    savePrefs(this.prefs);
    this.refreshPrefsUi();
  }

  /** Revisit the Sun Gate: watch the city come to life again (progress is unaffected). */
  replayTransformation() {
    if (!this.save.flags.transformed || this.modal !== 'none') return;
    this.startTransformation(null, true);
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
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i];
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
    }
    // Performance: update the existing GPU buffer. (Milestone C called thinInstanceSetBuffer here,
    // which disposes and re-creates the vertex buffer every frame.)
    this.coinMesh.thinInstanceBufferUpdated('matrix');
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
    this.setObjectiveMarkers(false);
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
    this.setObjectiveMarkers(false);
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
  // The carved doorway: a landmark that makes the first puzzle easy to find
  // (painted lintel, carved jambs, torches, banners; a light beacon and marker until it is solved)
  // =====================================================================

  private buildDoorway(): { beacon: Mesh; marker: Mesh } {
    const { scene, site, world, env } = this.d;
    const { door, zFront } = CHAMBER;
    const fine = site.builder.mats.fine;
    const front = zFront + 0.02;
    const parts: Mesh[] = [];
    // carved jambs either side of the door, and a deep lintel
    for (const sx of [-1, 1]) {
      const j = MeshBuilder.CreateBox('jamb', { width: 0.55, height: 2.9, depth: 0.5, wrap: true }, scene);
      j.position.set(door.x + sx * (door.w / 2 + 0.32), 2.9 / 2 - 0.35, front + 0.2);
      parts.push(j);
      world.addBox(j.position.x, j.position.z, 0.55, 0.5, -0.4, 2.55, 0);
    }
    const lintel = MeshBuilder.CreateBox('lintel', { width: door.w + 1.5, height: 0.5, depth: 0.55, wrap: true }, scene);
    lintel.position.set(door.x, 2.3, front + 0.22);
    parts.push(lintel);
    const frame = Mesh.MergeMeshes(parts, true, true)!;
    frame.name = 'doorwayFrame';
    frame.material = fine;
    frame.receiveShadows = true;
    frame.isPickable = false;
    env.shadows?.addShadowCaster(frame, false);

    // painted decoration: stepped (chakana-like) and zig-zag patterns in ochre, red and gold.
    // Purely decorative: they do not reveal the wheel combination.
    const paint = new DynamicTexture('doorPaint', { width: 512, height: 128 }, scene, true);
    const c = paint.getContext() as unknown as CanvasRenderingContext2D;
    c.fillStyle = '#7a2a1c';
    c.fillRect(0, 0, 512, 128);
    c.fillStyle = '#d9a43a';
    for (let i = 0; i < 8; i++) {
      const x = i * 64 + 32;
      c.fillRect(x - 6, 24, 12, 80);
      c.fillRect(x - 22, 46, 44, 36);
      c.fillRect(x - 14, 34, 28, 60);
    }
    c.fillStyle = '#2d4a5c';
    for (let i = 0; i < 8; i++) c.fillRect(i * 64 + 26, 58, 12, 12);
    c.strokeStyle = '#e8c25a';
    c.lineWidth = 6;
    c.strokeRect(4, 4, 504, 120);
    paint.update();
    const pm = new StandardMaterial('doorPaintMat', scene);
    pm.diffuseTexture = paint;
    pm.specularColor = new Color3(0.05, 0.05, 0.05);
    pm.emissiveColor = new Color3(0.12, 0.08, 0.05);
    const band = MeshBuilder.CreatePlane('doorBand', { width: door.w + 1.4, height: 0.4 }, scene);
    band.position.set(door.x, 2.3, front + 0.505);
    band.rotation.y = Math.PI;
    band.material = pm;
    band.isPickable = false;
    const jt = new DynamicTexture('jambPaint', { width: 64, height: 256 }, scene, true);
    const jc = jt.getContext() as unknown as CanvasRenderingContext2D;
    jc.fillStyle = '#7a2a1c';
    jc.fillRect(0, 0, 64, 256);
    jc.strokeStyle = '#d9a43a';
    jc.lineWidth = 9;
    jc.beginPath();
    for (let y = 0; y <= 256; y += 32) jc.lineTo(y % 64 === 0 ? 14 : 50, y);
    jc.stroke();
    jt.update();
    const jm = new StandardMaterial('jambPaintMat', scene);
    jm.diffuseTexture = jt;
    jm.specularColor = new Color3(0.05, 0.05, 0.05);
    jm.emissiveColor = new Color3(0.1, 0.07, 0.04);
    for (const sx of [-1, 1]) {
      const p = MeshBuilder.CreatePlane('jambBand', { width: 0.3, height: 1.6 }, scene);
      p.position.set(door.x + sx * (door.w / 2 + 0.32), 1.05, front + 0.47);
      p.rotation.y = Math.PI;
      p.material = jm;
      p.isPickable = false;
    }

    // torches in bronze brackets on the jambs
    const flameTex = new DynamicTexture('flameTex', { width: 64, height: 128 }, scene, false);
    const fc = flameTex.getContext() as unknown as CanvasRenderingContext2D;
    const grd = fc.createRadialGradient(32, 92, 2, 32, 80, 60);
    grd.addColorStop(0, 'rgba(255,250,210,1)');
    grd.addColorStop(0.25, 'rgba(255,200,80,0.95)');
    grd.addColorStop(0.6, 'rgba(240,110,20,0.6)');
    grd.addColorStop(1, 'rgba(200,60,10,0)');
    fc.fillStyle = grd;
    fc.beginPath();
    fc.moveTo(32, 2);
    fc.quadraticCurveTo(62, 80, 40, 124);
    fc.lineTo(24, 124);
    fc.quadraticCurveTo(2, 80, 32, 2);
    fc.fill();
    flameTex.hasAlpha = true;
    flameTex.update();
    const fm = new StandardMaterial('flameMat', scene);
    fm.diffuseTexture = flameTex;
    fm.opacityTexture = flameTex;
    fm.emissiveColor = new Color3(1, 0.75, 0.4);
    fm.disableLighting = true;
    fm.backFaceCulling = false;
    fm.alphaMode = 1; // additive
    const bronze = new StandardMaterial('bronzeMat', scene);
    bronze.diffuseColor = new Color3(0.45, 0.3, 0.14);
    bronze.specularColor = new Color3(0.5, 0.4, 0.2);
    for (const sx of [-1, 1]) {
      const x = door.x + sx * (door.w / 2 + 0.32);
      const holder = MeshBuilder.CreateCylinder('torch', { height: 0.5, diameterTop: 0.16, diameterBottom: 0.06, tessellation: 8 }, scene);
      holder.position.set(x, 1.85, front + 0.62);
      holder.material = bronze;
      holder.isPickable = false;
      const f = MeshBuilder.CreatePlane('flame', { width: 0.36, height: 0.62 }, scene);
      f.position.set(x, 2.32, front + 0.64);
      f.billboardMode = Mesh.BILLBOARDMODE_Y;
      f.material = fm;
      f.isPickable = false;
      this.flames.push(f);
    }

    // tall poles with woven banners, visible from the terraces above
    const cloth = new DynamicTexture('bannerTex', { width: 64, height: 256 }, scene, true);
    const bc = cloth.getContext() as unknown as CanvasRenderingContext2D;
    const stripes = ['#b3261e', '#e0a530', '#b3261e', '#2f5d7a', '#b3261e', '#e0a530', '#6b2f6b', '#b3261e'];
    stripes.forEach((col, i) => { bc.fillStyle = col; bc.fillRect(0, i * 32, 64, 32); });
    bc.fillStyle = '#f2dfa0';
    for (let i = 0; i < 8; i++) { bc.beginPath(); bc.moveTo(8, i * 32 + 16); bc.lineTo(32, i * 32 + 4); bc.lineTo(56, i * 32 + 16); bc.lineTo(32, i * 32 + 28); bc.fill(); }
    cloth.update();
    const cm = new StandardMaterial('bannerMat', scene);
    cm.diffuseTexture = cloth;
    cm.backFaceCulling = false;
    cm.twoSidedLighting = true;
    cm.specularColor = new Color3(0.02, 0.02, 0.02);
    cm.emissiveColor = new Color3(0.15, 0.1, 0.08);
    const wood = new StandardMaterial('poleMat', scene);
    wood.diffuseColor = new Color3(0.36, 0.25, 0.14);
    for (const sx of [-1, 1]) {
      const x = door.x + sx * 3.2;
      const z = front + 1.4;
      const pole = MeshBuilder.CreateCylinder('bannerPole', { height: 5.2, diameter: 0.12, tessellation: 6 }, scene);
      pole.position.set(x, 2.6, z);
      pole.material = wood;
      pole.isPickable = false;
      world.addBox(x, z, 0.2, 0.2, -0.5, 5, 0);
      const flag = MeshBuilder.CreatePlane('banner', { width: 0.75, height: 2.6 }, scene);
      flag.setPivotPoint(new Vector3(-0.375, 0, 0));
      flag.position.set(x + 0.43, 3.75, z);
      flag.material = cm;
      flag.isPickable = false;
      this.banners.push(flag);
      env.shadows?.addShadowCaster(flag, false);
    }

    // objective beacon: a soft column of golden light, plus a floating marker over the stones
    const bt = new DynamicTexture('beaconTex', { width: 8, height: 128 }, scene, false);
    const bctx = bt.getContext() as unknown as CanvasRenderingContext2D;
    const bg = bctx.createLinearGradient(0, 0, 0, 128);
    bg.addColorStop(0, 'rgba(255,220,120,0)');
    bg.addColorStop(0.55, 'rgba(255,210,110,0.32)');
    bg.addColorStop(0.88, 'rgba(255,225,150,0.45)');
    bg.addColorStop(1, 'rgba(255,230,160,0)');
    bctx.fillStyle = bg;
    bctx.fillRect(0, 0, 8, 128);
    bt.hasAlpha = true;
    bt.update();
    const bm = new StandardMaterial('beaconMat', scene);
    bm.diffuseTexture = bt;
    bm.opacityTexture = bt;
    bm.emissiveColor = new Color3(1, 0.82, 0.45);
    bm.disableLighting = true;
    bm.backFaceCulling = false;
    bm.alphaMode = 1;
    const beacon = MeshBuilder.CreateCylinder('beacon', { height: 34, diameterTop: 1.4, diameterBottom: 0.6, tessellation: 12, cap: Mesh.NO_CAP }, scene);
    beacon.position.set(MECHANISM.x, 17 + 2.6, MECHANISM.z - 2.3);
    beacon.material = bm;
    beacon.isPickable = false;
    const mm = new StandardMaterial('markerMat2', scene);
    mm.diffuseColor = new Color3(1, 0.78, 0.25);
    mm.emissiveColor = new Color3(0.7, 0.48, 0.1);
    mm.specularColor = new Color3(1, 0.9, 0.6);
    const marker = MeshBuilder.CreatePolyhedron('objMarker', { type: 1, size: 0.28 }, scene);
    marker.scaling.y = 1.6;
    marker.position.set(MECHANISM.x, 3.4, MECHANISM.z);
    marker.material = mm;
    marker.isPickable = false;
    return { beacon, marker };
  }

  private setObjectiveMarkers(on: boolean) {
    if (this.beacon.isEnabled() === on) return;
    this.beacon.setEnabled(on);
    this.marker.setEnabled(on);
  }

  private updateDoorway(time: number) {
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const n = Math.sin(time * 13 + i * 2) * 0.5 + Math.sin(time * 23 + i) * 0.3;
      f.scaling.set(1 + n * 0.08, 1 + n * 0.16, 1);
    }
    for (let i = 0; i < this.banners.length; i++) {
      this.banners[i].rotation.y = Math.sin(time * 0.9 + i * 1.7) * 0.25;
    }
    if (this.marker.isEnabled()) {
      this.marker.rotation.y = time * 1.4;
      this.marker.position.y = 3.4 + Math.sin(time * 2) * 0.12;
    }
  }

  // =====================================================================
  // Interactions, HUD, journal
  // =====================================================================

  private readonly actTalk: Interaction = { label: 'TALK', text: 'Talk to Killa', act: () => this.openDialogue() };
  private readonly actExamine: Interaction = { label: 'EXAMINE', text: 'Examine the turning stones', act: () => this.openPuzzle() };
  private readonly actTake: Interaction = { label: 'TAKE', text: 'Take the golden llama', act: () => this.takeRelic() };
  private readonly actWatch: Interaction = { label: 'WATCH', text: 'Watch Machu Picchu come to life', act: () => this.replayTransformation() };

  private findInteraction(): Interaction | null {
    const p = this.d.player.pos;
    const s = this.save;
    if (s.flags.introDialogue && this.killa.root.isEnabled() && Math.hypot(p.x - this.killaPos.x, p.z - this.killaPos.z) < 2.8) {
      return this.actTalk;
    }
    if (!s.puzzles.includes(PUZZLE_ID) && Math.hypot(p.x - MECH_FRONT.x, p.z - MECH_FRONT.z) < 2.0 && p.y < 10) {
      return this.actExamine;
    }
    if (!s.flags.treasure && s.puzzles.includes(PUZZLE_ID) && Math.hypot(p.x - RELIC_SPOT.x, p.z - RELIC_SPOT.z) < 1.9) {
      return this.actTake;
    }
    if (s.flags.transformed && s.flags.introDialogue && Math.hypot(p.x - SUN_GATE.x, p.z - SUN_GATE.z) < 4.5) {
      return this.actWatch;
    }
    return null;
  }

  private lastPrompt: Interaction | null = null;
  private showPrompt(i: Interaction | null) {
    if (i === this.lastPrompt) return; // interactions are preallocated: compare by identity
    this.lastPrompt = i;
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
    document.body.classList.toggle('cine', m === 'cinematic');
    document.body.classList.toggle('talking', m === 'dialogue');
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
  private settingsOverlay = false;

  openSettings() {
    if (!$('settings').hidden) { this.closeSettings(); return; }
    this.refreshPrefsUi();
    $('settings').hidden = false;
    if (this.modal === 'none') this.setModal('settings');
    else this.settingsOverlay = true; // over a conversation or cinematic: leave that running
  }

  closeSettings() {
    $('settings').hidden = true;
    if (this.settingsOverlay) this.settingsOverlay = false;
    else if (this.modal === 'settings') this.setModal('none');
  }

  private wireUi() {
    const { input } = this.d;
    this.cineEls.skip.addEventListener('click', () => this.skipTransformation());
    $('btn-journal').addEventListener('click', () => this.toggleJournal());
    $('journal-close').addEventListener('click', () => this.closeJournal());
    $('pz-close').addEventListener('click', () => this.closePuzzle());
    $('dlg-skip').addEventListener('click', () => this.skipIntro());
    $('dlg-play').addEventListener('click', () => { this.voice.retry(); this.refreshVoiceUi(); });
    $('btn-cc').addEventListener('click', () => this.setSubtitles(!this.prefs.subs));
    $('btn-voice').addEventListener('click', () => {
      if (this.voice.supported) this.setVoice(!this.prefs.voice);
      else this.toast('Spoken dialogue is not supported in this browser: subtitles are shown instead');
    });
    $('btn-settings').addEventListener('click', () => this.openSettings());
    $('settings-close').addEventListener('click', () => this.closeSettings());
    $('set-voice').addEventListener('click', () => { if (this.voice.supported) this.setVoice(!this.prefs.voice); });
    $('set-subs').addEventListener('click', () => this.setSubtitles(!this.prefs.subs));
    $('set-sound').addEventListener('click', () => this.setSound(!this.prefs.sound));
    $('set-help').addEventListener('click', () => { $('help').hidden = false; });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (!$('settings').hidden) this.closeSettings();
        else if (this.modal === 'cinematic') this.skipTransformation();
        else if (this.modal === 'journal') this.closeJournal();
        else if (this.modal === 'puzzle') this.closePuzzle();
        else if (this.modal === 'dialogue') {
          if (this.firstMeeting) this.skipIntro();
          else this.closeDialogue();
        }
      }
      if (this.modal === 'dialogue' && this.meeting !== 'approach') {
        const n = Number(e.key);
        const node = this.dialogueTree[this.nodeId];
        if (n >= 1 && n <= this.choiceHandlers.length) this.choiceHandlers[n - 1]();
        else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && node && !node.choices.length) this.choiceHandlers[0]?.();
      }
      if (this.modal === 'journal' && e.code === 'KeyJ') { e.preventDefault(); input.consumeKey('KeyJ'); this.closeJournal(); }
    });
    // only once the game is running: leaving from the loading screen must not overwrite the save
    const flush = () => { if (!this.resetting && this.started) this.persist(); };
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
      killa: { x: this.killaPos.x, z: this.killaPos.z, enabled: this.killa.root.isEnabled(), heading: this.killaHeading },
      interaction: this.interaction?.text ?? null,
      meeting: this.meeting,
      node: this.nodeId,
      voice: this.voice.status,
      voiceName: this.voice.voiceName,
      subtitles: this.subtitlesVisible,
      prefs: { ...this.prefs },
      camMode: this.camMode,
      nav: { shown: !$('nav').hidden, bearing: this.nav.bearing, arrowDeg: this.nav.arrowDeg, distance: this.nav.distance, label: $('nav-label').textContent },
      beacon: this.beacon.isEnabled(),
    };
  }

  /** test hook: complete the opening (meeting + transformation) immediately. */
  completeOpening() {
    if (this.cine >= 0) this.skipTransformation();
    this.cine = -1;
    this.cineEls.title.hidden = true;
    this.cineEls.skip.hidden = true;
    this.voice.stop();
    $('dialogue').hidden = true;
    this.meeting = 'none';
    this.dialogueTree = REPEAT_DIALOGUE;
    this.save.flags.transformed = true;
    this.applyEra(1);
    this.finishIntro();
    this.relocateToGuardhouse = false;
    this.placeKilla(this.d.player.pos.x, this.d.player.pos.z);
    this.d.camera.pose = null;
    this.camMode = 'none';
    this.shadowFocus = null;
    this.setModal('none');
    this.persist();
  }

  /** test hook: wheel display check (which glyph is at the top marker) */
  wheelRotation(i: number) {
    return this.wheelNodes[i].rotation.y;
  }
}

const WARM_SUN = new Color3(1.0, 0.84, 0.62);
const WARM_SKY = new Color3(0.88, 0.84, 0.9);
const WARM_FOG = new Color3(0.8, 0.76, 0.72);
const newPoseTmp = newPose();

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
