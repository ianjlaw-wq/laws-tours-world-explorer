// Milestone D checks: Killa's spoken welcome beyond the Sun Gate, the transformation cinematic,
// voice/subtitle controls and fallbacks, the route-following objective arrow, saving, and
// compatibility with Milestone C saves. Also captures the inspection screenshots.
//
// Speech synthesis cannot produce real audio in headless Chromium, so the browser's
// speechSynthesis is replaced by a small fake (mode 'ok' / 'blocked' / 'none') to exercise the
// game's logic. Real voices, timing and audibility must be checked on a real phone.
//
// Usage: node scripts/milestone-d-test.mjs [url]
import { chromium } from 'playwright-core';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:4173/laws-tours-world-explorer/';
const url = base + '?quality=low';
mkdirSync('test-output', { recursive: true });
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const dir = join(homedir(), '.cache/ms-playwright');
  for (const d of readdirSync(dir).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    const p = join(dir, d, 'chrome-linux64/chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('No Chromium found; set CHROME_PATH');
}
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

/** Fake speechSynthesis. mode: 'ok' speaks (fires start/end), 'blocked' refuses until a tap, 'none' = unsupported. */
function speechMock(mode) {
  window.__speech = { spoken: [], overlaps: 0, mode };
  if (mode === 'none') {
    try { delete window.speechSynthesis; } catch {}
    try { delete window.SpeechSynthesisUtterance; } catch {}
    Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: undefined, configurable: true });
    return;
  }
  class U { constructor(t) { this.text = t; this.onstart = null; this.onend = null; this.onerror = null; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1; this.lang = ''; } }
  const voices = [
    { name: 'Microsoft David - English (United States)', lang: 'en-US', default: true, localService: true },
    { name: 'Google UK English Female', lang: 'en-GB', default: false, localService: false },
    { name: 'Google Deutsch', lang: 'de-DE', default: false, localService: false },
  ];
  let unlocked = mode === 'ok';
  let cur = null;
  const synth = {
    speaking: false, pending: false,
    getVoices: () => voices,
    addEventListener() {},
    cancel() {
      const c = cur; cur = null; synth.speaking = false;
      if (c) setTimeout(() => c.onerror?.({ error: 'interrupted' }), 0);
    },
    speak(u) {
      if (!u.text.trim()) return; // silent unlock utterance
      const ev = window.event && window.event.type;
      if (!unlocked && ['click', 'pointerup', 'pointerdown', 'touchend'].includes(ev)) unlocked = true;
      if (!unlocked) { setTimeout(() => u.onerror?.({ error: 'not-allowed' }), 5); return; }
      if (synth.speaking) window.__speech.overlaps++;
      window.__speech.spoken.push({ text: u.text, voice: u.voice?.name ?? null, rate: u.rate, t: performance.now() });
      cur = u; synth.speaking = true;
      setTimeout(() => { if (cur === u) u.onstart?.({}); }, 20);
      setTimeout(() => { if (cur === u) { cur = null; synth.speaking = false; u.onend?.({}); } }, 2500 + u.text.length * 25);
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: U, configurable: true });
}

async function newPhone(mode) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript(speechMock, mode);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${mode}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${mode} console: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}
async function boot(page, fresh) {
  if (fresh) {
    await page.goto(url);
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ltwe.seenHelp', '1'); });
  }
  await page.goto(url);
  await page.waitForSelector('#start-btn:not([hidden])', { timeout: 180000 });
}
const S = (page) => page.evaluate(() => window.__ltwe.adventure.debugState());
const waitFor = (page, fn, arg, timeout = 120000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const tp = (page, x, z, h) => page.evaluate(([x, z, h]) => window.__ltwe.teleport(x, z, h), [x, z, h]);
const pos = (page) => page.evaluate(() => ({ x: window.__ltwe.player.pos.x, y: window.__ltwe.player.pos.y, z: window.__ltwe.player.pos.z }));
const frames = (page, n = 3) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const visible = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e || e.hidden) return false; const st = getComputedStyle(e); return st.display !== 'none' && st.visibility !== 'hidden' && e.getBoundingClientRect().width > 0; }, sel);

// ===================== A. First meeting with working speech (phone) =====================
{
  const { ctx, page } = await newPhone('ok');
  await boot(page, true);
  await page.tap('#start-btn');
  await page.waitForTimeout(1500);
  let s = await S(page);
  const p0 = await pos(page);
  const gate = { x: 150, z: -239 };
  const kd = Math.hypot(s.killa.x - gate.x, s.killa.z - gate.z);
  const startToGate = Math.hypot(p0.x - gate.x, p0.z - gate.z);
  const startToKilla = Math.hypot(p0.x - s.killa.x, p0.z - s.killa.z);
  check('A1 Killa waits just beyond the Sun Gate', s.killa.enabled && kd > 5 && kd < 11 && startToKilla > startToGate, `gate→Killa ${kd.toFixed(1)} m`);
  const scr = await page.evaluate(([kx, kz]) => {
    const g = window.__ltwe;
    const ky = g.world.groundAt(kx, kz, 200, 0.6).y;
    const head = g.project(kx, ky + 1.6, kz);
    const feet = g.project(kx, ky + 0.2, kz);
    const p = g.player.pos;
    const ex = g.project(p.x, p.y + 1.75, p.z);
    return { head, feet, ex, w: innerWidth, h: innerHeight };
  }, [s.killa.x, s.killa.z]);
  const inFrame = scr.head.x > 0 && scr.head.x < scr.w && scr.head.y > 0 && scr.feet.y < scr.h && scr.head.depth < 1;
  const clearOfExplorer = Math.abs(scr.head.x - scr.ex.x) > 10 || scr.feet.y < scr.ex.y;
  check('A2 Killa is in view from the start, not hidden behind the explorer', inFrame && clearOfExplorer, JSON.stringify({ killa: [Math.round(scr.head.x), Math.round(scr.head.y), Math.round(scr.feet.y)], explorerHead: [Math.round(scr.ex.x), Math.round(scr.ex.y)] }));
  check('A3 speech bubble marks Killa', await page.evaluate(() => window.__ltwe.adventure.killa.root.getScene().getMeshByName('killaBubble').isEnabled()));
  await page.screenshot({ path: 'test-output/d1-killa-waiting.png' });

  // walk through the gate with the joystick
  await page.evaluate(() => window.__ltwe.input.setVirtualStick(0, 1));
  await waitFor(page, () => window.__ltwe.adventure.modal === 'dialogue', null, 180000);
  const pMeet = await pos(page);
  check('A4 meeting starts automatically after passing through the gate', Math.hypot(pMeet.x - p0.x, pMeet.z - p0.z) > startToGate - 1, `walked ${Math.hypot(pMeet.x - p0.x, pMeet.z - p0.z).toFixed(1)} m (gate at ${startToGate.toFixed(1)} m)`);
  await page.waitForTimeout(1000);
  const pHeld = await pos(page);
  check('A5 movement pauses during the introduction', Math.hypot(pHeld.x - pMeet.x, pHeld.z - pMeet.z) < 0.3);
  await page.evaluate(() => window.__ltwe.input.setVirtualStick(0, 0));
  await waitFor(page, () => !document.getElementById('dialogue').hidden, null, 120000);
  await waitFor(page, () => window.__speech.spoken.length > 0, null, 30000).catch(() => {});
  s = await S(page);
  const sp = await page.evaluate(() => window.__speech);
  const pk = await pos(page);
  const dK = Math.hypot(pk.x - s.killa.x, pk.z - s.killa.z);
  const faceK = Math.atan2(pk.x - s.killa.x, pk.z - s.killa.z);
  const faceErr = Math.abs(Math.atan2(Math.sin(faceK - s.killa.heading), Math.cos(faceK - s.killa.heading)));
  check('A6 Killa walks up and turns to face the explorer', dK > 1.3 && dK < 2.8 && faceErr < 0.5, `distance ${dK.toFixed(2)} m, facing error ${faceErr.toFixed(2)} rad`);
  check('A7 Killa speaks automatically', sp.spoken.length > 0 && sp.spoken[0].text.startsWith('Allillanchu'), sp.spoken[0]?.text ?? 'nothing spoken');
  check('A8 a natural English voice is preferred, conversational rate', /Google UK English Female/.test(sp.spoken[0]?.voice ?? '') && sp.spoken[0].rate > 0.85 && sp.spoken[0].rate <= 1, `${sp.spoken[0]?.voice} @ ${sp.spoken[0]?.rate}`);
  const fr = await page.evaluate(([kx, kz]) => {
    const g = window.__ltwe;
    const p = g.player.pos;
    const ky = g.world.groundAt(kx, kz, 200, 0.6).y;
    return { e: g.project(p.x, p.y + 1.6, p.z), k: g.project(kx, ky + 1.5, kz), panelTop: document.getElementById('dialogue').getBoundingClientRect().top, w: innerWidth };
  }, [s.killa.x, s.killa.z]);
  const framed = [fr.e, fr.k].every((q) => q.x > 20 && q.x < fr.w - 20 && q.y > 0 && q.y < fr.panelTop && q.depth < 1);
  check('A9 camera frames Killa and the explorer above the dialogue panel', s.camMode === 'frame' && framed, JSON.stringify({ e: [Math.round(fr.e.x), Math.round(fr.e.y)], k: [Math.round(fr.k.x), Math.round(fr.k.y)], panelTop: Math.round(fr.panelTop) }));
  check('A10 subtitles off by default while the voice is heard (speaking indicator shown)', !s.prefs.subs && s.voice === 'speaking' && !(await visible(page, '#dlg-text')) && (await visible(page, '#dlg-speaking')));
  await page.tap('#btn-cc');
  await page.waitForTimeout(150);
  check('A11 CC turns subtitles on', (await S(page)).prefs.subs && (await visible(page, '#dlg-text')));
  await page.screenshot({ path: 'test-output/d2-killa-speaking.png' });
  await page.tap('#btn-cc');
  await page.waitForTimeout(150);
  check('A12 CC turns subtitles off again', !(await S(page)).prefs.subs && !(await visible(page, '#dlg-text')));
  // mute: speech stops and subtitles appear automatically (never both off)
  await page.tap('#btn-voice');
  await page.waitForTimeout(200);
  s = await S(page);
  check('A13 mute stops speech and shows subtitles automatically', !s.prefs.voice && s.subtitles && (await visible(page, '#dlg-text')) && !(await page.evaluate(() => window.speechSynthesis.speaking)));
  const nBefore = (await page.evaluate(() => window.__speech.spoken.length));
  await page.tap('#btn-voice');
  await page.waitForTimeout(300);
  const nAfter = (await page.evaluate(() => window.__speech.spoken.length));
  check('A14 unmute speaks the current line again', (await S(page)).prefs.voice && nAfter === nBefore + 1);
  // lines advance by themselves once spoken; the third leads into the transformation
  await waitFor(page, () => window.__ltwe.adventure.debugState().node === 'ruins', null, 60000);
  check('A15 dialogue continues automatically after each spoken line', true);
  await waitFor(page, () => window.__ltwe.adventure.modal === 'cinematic', null, 120000);
  check('A16 transformation follows Killa\'s introduction', (await S(page)).flags.transformed === false);
  await waitFor(page, () => window.__ltwe.adventure.debugState().cine >= 2.0, null, 120000);
  s = await S(page);
  const before = await page.evaluate(() => {
    const sc = window.__ltwe.adventure.killa.root.getScene();
    return { roofs: sc.getMeshByName('eraRoofs').isEnabled(), rubble: sc.getMeshByName('rubble').isEnabled(), soil: sc.getMeshByName('eraSoil').isEnabled() };
  });
  check('A17 cinematic shows the present-day ruins first (elevated view)', s.eraK < 0.05 && before.rubble && !before.roofs && !before.soil && (await page.evaluate(() => window.__ltwe.camera.cam.radius)) > 60);
  await page.screenshot({ path: 'test-output/d3-ruins-before.png' });
  await waitFor(page, () => window.__ltwe.adventure.debugState().cine >= 5.7, null, 180000);
  await page.screenshot({ path: 'test-output/d4-living-city.png' });
  await waitFor(page, () => window.__ltwe.adventure.debugState().cine < 0, null, 180000);
  s = await S(page);
  const after = await page.evaluate(() => {
    const sc = window.__ltwe.adventure.killa.root.getScene();
    const m = (n) => sc.getMeshByName(n);
    return {
      roofs: m('eraRoofs').isEnabled() && Math.abs(m('eraRoofs').position.y) < 1e-6,
      courses: m('eraCourses').isEnabled() && Math.abs(m('eraCourses').position.y) < 1e-6,
      crops: m('eraCrops').isEnabled() && Math.abs(m('eraCrops').position.y) < 1e-6,
      soil: m('eraSoil').isEnabled(),
      rubble: m('rubble').isEnabled(),
      people: m('villagerBodies').isEnabled(),
      smoke: sc.particleSystems.find((p) => p.name === 'hearthSmoke').isStarted(),
    };
  });
  check('A18 city rebuilt: walls, roofs, tilled terraces, crops, people, smoke', after.roofs && after.courses && after.crops && after.soil && !after.rubble && after.people && after.smoke, JSON.stringify(after));
  check('A19 conversation resumes with Killa after the cinematic', s.modal === 'dialogue' && s.node === 'living' && s.flags.transformed);
  await waitFor(page, () => window.__ltwe.adventure.debugState().node === 'door', null, 120000);
  const spoken = (await page.evaluate(() => window.__speech)).spoken.map((x) => x.text).join(' | ');
  check('A20 Killa gives spoken directions to the first puzzle', /gold coins/.test(spoken) && /carved doorway/.test(spoken));
  check('A21 speech never overlaps', (await page.evaluate(() => window.__speech.overlaps)) === 0);
  await page.tap('#dlg-choices .choice >> nth=0'); // I'm on my way
  await waitFor(page, () => window.__ltwe.adventure.modal === 'none');
  await waitFor(page, () => window.__ltwe.adventure.debugState().camMode === 'none', null, 60000).catch(() => {});
  s = await S(page);
  check('A22 intro complete: objective + arrow + beacon; camera handed back', s.flags.introDialogue && s.objective === 'gold' && s.nav.shown && s.beacon && s.camMode === 'none');
  const q0 = await pos(page);
  await page.evaluate(() => window.__ltwe.input.setVirtualStick(0, 1));
  const moved = await waitFor(page, (q0) => Math.hypot(window.__ltwe.player.pos.x - q0.x, window.__ltwe.player.pos.z - q0.z) > 0.5, q0, 20000).then(() => true, () => false);
  await page.evaluate(() => window.__ltwe.input.setVirtualStick(0, 0));
  const q1 = await pos(page);
  check('A23 movement resumes after the conversation', moved, `${Math.hypot(q1.x - q0.x, q1.z - q0.z).toFixed(2)} m`);
  // touch safety: the arrow does not capture touches, the HUD buttons do not grab the joystick
  const hit = await page.evaluate(() => { const r = document.getElementById('nav').getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id; });
  check('A24 objective arrow lets touches through to the camera', hit === 'game', `element under arrow: ${hit}`);
  await page.tap('#btn-cc');
  check('A25 tapping CC never engages the joystick', !(await page.evaluate(() => window.__ltwe.input.joystickActive())));
  await page.tap('#btn-cc'); // back to the default
  await ctx.close();
}

// ===================== B. No speech synthesis: text fallback, intro skip, cinematic skip =====================
{
  const { ctx, page } = await newPhone('none');
  await boot(page, true);
  await page.tap('#start-btn');
  await page.waitForTimeout(1000);
  const k = (await S(page)).killa;
  await tp(page, k.x + 3.5, k.z - 3.5, -Math.PI * 0.75);
  await waitFor(page, () => !document.getElementById('dialogue').hidden, null, 120000);
  let s = await S(page);
  check('B1 without speech synthesis, subtitles appear automatically', s.subtitles && (await visible(page, '#dlg-text')) && (await page.textContent('#dlg-text')).includes('Killa'));
  check('B2 voice control shows speech unavailable', (await page.textContent('#btn-voice')) === '🔇' && /not supported/.test(await page.getAttribute('#btn-voice', 'title')));
  await page.tap('#dlg-choices .choice >> nth=0'); // Next
  await page.waitForTimeout(200);
  check('B3 Next advances the text-only dialogue', (await S(page)).node === 'ruins');
  await page.tap('#dlg-skip');
  await waitFor(page, () => window.__ltwe.adventure.modal === 'cinematic');
  check('B4 skipping the introduction still shows the transformation', (await S(page)).flags.introDialogue);
  await waitFor(page, () => window.__ltwe.adventure.debugState().cine > 0.5, null, 60000);
  await page.tap('#era-skip');
  await frames(page, 2);
  s = await S(page);
  const st = await page.evaluate(() => {
    const sc = window.__ltwe.adventure.killa.root.getScene();
    return { roofsY: sc.getMeshByName('eraRoofs').position.y, rubble: sc.getMeshByName('rubble').isEnabled(), camPose: !!window.__ltwe.camera.pose };
  });
  check('B5 skip leaves the city in its final state immediately', s.eraK === 1 && s.cine < 0 && s.modal === 'none' && st.roofsY === 0 && !st.rubble && !st.camPose, JSON.stringify(st));
  check('B6 joystick visible again after skipping', await visible(page, '#joystick-zone'));
  await ctx.close();
}

// ===================== C. Autoplay refused: Play Voice button =====================
{
  const { ctx, page } = await newPhone('blocked');
  await boot(page, true);
  await page.tap('#start-btn');
  await page.waitForTimeout(1000);
  const k = (await S(page)).killa;
  await tp(page, k.x + 3.5, k.z - 3.5, -Math.PI * 0.75);
  await waitFor(page, () => !document.getElementById('dialogue').hidden, null, 120000);
  await waitFor(page, () => window.__ltwe.adventure.debugState().voice === 'blocked', null, 30000).catch(() => {});
  let s = await S(page);
  check('C1 refused autoplay shows a Play Voice button and the subtitles', s.voice === 'blocked' && (await visible(page, '#dlg-play')) && (await visible(page, '#dlg-text')));
  await page.screenshot({ path: 'test-output/d-play-voice.png' });
  await page.tap('#dlg-play');
  await page.waitForTimeout(150);
  s = await S(page);
  const sp = await page.evaluate(() => window.__speech.spoken);
  check('C2 one tap on Play Voice speaks the line', s.voice === 'speaking' && sp.length === 1 && sp[0].text.startsWith('Allillanchu') && !(await visible(page, '#dlg-play')));
  await ctx.close();
}

// ===================== D. Navigation, doorway, puzzle, replay, saving, old saves (phone, speech ok) =====================
{
  const { ctx, page } = await newPhone('ok');
  await boot(page, true);
  await page.tap('#start-btn');
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__ltwe.skipIntro());
  await frames(page, 3);
  // walking where the arrow points always gets closer to the doorway (along the real route)
  const samples = [[152, -241], [120, -209], [60, -158], [12, -118], [-2, -98], [-2, -60], [-12, -30], [2, -10]];
  let okAll = true;
  const det = [];
  for (const [x, z] of samples) {
    await tp(page, x, z, 0);
    await frames(page, 2);
    const a = await S(page);
    const before = a.nav.distance;
    await page.evaluate((b) => { window.__ltwe.teleport(window.__ltwe.player.pos.x, window.__ltwe.player.pos.z, b); }, a.nav.bearing);
    await frames(page, 2);
    const arrowAhead = Math.abs((await S(page)).nav.arrowDeg) <= 6;
    await page.evaluate(() => window.__ltwe.simulate(4, 0, 1));
    await frames(page, 2);
    const after = (await S(page)).nav.distance;
    det.push(`${x},${z}: ${before.toFixed(0)}→${after.toFixed(0)}m${arrowAhead ? '' : ' (arrow not ahead)'}`);
    if (!(after < before - 1) || !arrowAhead) okAll = false;
  }
  check('D1 following the arrow always leads closer to the doorway', okAll, det.join('; '));
  // the arrow responds to camera direction
  await tp(page, -2, -98, 0);
  await frames(page, 2);
  const a1 = (await S(page)).nav.arrowDeg;
  await page.evaluate(() => { window.__ltwe.camera.cam.alpha += Math.PI / 2; window.__ltwe.input.lastLookTime = performance.now(); });
  await frames(page, 2);
  const a2 = (await S(page)).nav.arrowDeg;
  const turned = Math.abs(((a2 - a1 + 540) % 360) - 180);
  check('D2 arrow rotates when the camera turns', Math.abs(turned - 90) < 15, `${a1}° → ${a2}°`);
  // approach of the doorway (from the stairway) and the doorway itself
  await page.evaluate(() => { const g = window.__ltwe; g.teleport(-2, -60, 0); g.camera.cam.beta = 1.15; g.camera.setZoom(8); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-output/d5a-puzzle-approach.png' });
  await page.evaluate(() => { const g = window.__ltwe; g.teleport(14, -27, Math.PI); g.camera.cam.beta = 1.35; g.camera.setZoom(7); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-output/d5b-puzzle-entrance.png' });
  check('D3 doorway landmark present (painted frame, torches, banners, beacon)', await page.evaluate(() => {
    const sc = window.__ltwe.adventure.killa.root.getScene();
    return ['doorwayFrame', 'doorBand', 'flame', 'banner', 'beacon', 'objMarker'].every((n) => sc.getMeshByName(n)?.isEnabled());
  }));
  await page.evaluate(() => window.__ltwe.simulate(4, 0, 1));
  await frames(page, 4);
  await page.waitForTimeout(800);
  let s = await S(page);
  check('D4 discovering the doorway updates objective and journal', s.objective === 'puzzle' && s.discovered.includes('The Carved Doorway'), s.objective);
  // solve the puzzle by touch
  await tp(page, 14, -37.3, Math.PI);
  await page.waitForSelector('#btn-action:not([hidden])', { timeout: 60000 });
  await page.tap('#btn-action');
  await waitFor(page, () => !document.getElementById('puzzle').hidden);
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 4; k++) {
      if ((await S(page)).wheels[i] === i) break;
      await page.tap(`#pz-wheels .wheel-row >> nth=${i} >> .wheel-btn >> nth=1`);
    }
  }
  await waitFor(page, () => document.getElementById('puzzle').hidden, null, 60000);
  await frames(page, 3);
  s = await S(page);
  check('D5 after solving, the arrow and beacon are removed', s.doorOpen && !s.nav.shown && !s.beacon);
  // collect a coin and the golden llama for the save test
  await tp(page, 14, -40.5, Math.PI);
  await page.evaluate(() => window.__ltwe.simulate(3, 0, 1));
  await waitFor(page, () => window.__ltwe.adventure.debugState().interaction === 'Take the golden llama', null, 60000);
  await page.tap('#btn-action');
  await waitFor(page, () => window.__ltwe.adventure.debugState().flags.treasure, null, 30000);
  const coins = await page.evaluate(() => window.__ltwe.adventure.coins.map((c) => ({ x: c.x, z: c.z })));
  for (const c of coins.slice(0, 3)) { await tp(page, c.x, c.z); await frames(page, 3); }
  // replay the transformation at the Sun Gate
  const g0 = await S(page);
  await tp(page, 151.5, -240.5, -0.77);
  await waitFor(page, () => window.__ltwe.adventure.debugState().interaction === 'Watch Machu Picchu come to life', null, 60000);
  await page.tap('#btn-action');
  await waitFor(page, () => window.__ltwe.adventure.modal === 'cinematic');
  const mid = await S(page);
  await page.tap('#era-skip');
  await waitFor(page, () => window.__ltwe.adventure.modal === 'none');
  s = await S(page);
  check('D6 Sun Gate replays the transformation without resetting progress', mid.modal === 'cinematic' && s.eraK === 1 && s.gold === g0.gold && s.flags.treasure && s.puzzles.length === 1 && s.meeting === 'none');
  // walk back to a known spot and save
  await tp(page, 0, -110, 0);
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__ltwe.adventure.persist());
  const saved = await S(page);
  saved.pos = await pos(page);
  await page.tap('#btn-cc'); // subtitles on
  await page.tap('#btn-voice'); // voice off
  // Continue
  await boot(page, false);
  check('D7 Continue offered', (await page.textContent('#start-btn')).includes('Continue'));
  await page.tap('#start-btn');
  await page.waitForTimeout(1500);
  s = await S(page);
  const pr = await pos(page);
  check('D8 Continue restores position, coins, puzzle, llama, journal', Math.hypot(pr.x - saved.pos.x, pr.z - saved.pos.z) < 1.5 && s.gold === saved.gold && s.coinsLeft === saved.coinsLeft && s.doorOpen && s.flags.treasure && s.discovered.length >= saved.discovered.length, JSON.stringify({ pos: [pr.x.toFixed(1), pr.z.toFixed(1)], savedPos: saved.pos, gold: [s.gold, saved.gold], coins: [s.coinsLeft, saved.coinsLeft], disc: [s.discovered.length, saved.discovered.length], door: s.doorOpen, tre: s.flags.treasure }));
  check('D9 Killa\'s introduction is not replayed', s.flags.introDialogue && s.meeting === 'none' && s.modal === 'none');
  check('D10 subtitle and voice preferences restored', s.prefs.subs === true && s.prefs.voice === false && (await page.textContent('#btn-voice')) === '🔇' && !(await page.getAttribute('#btn-cc', 'class')).includes('off'));
  // New journey resets progress (but keeps preferences)
  await boot(page, false);
  await Promise.all([page.waitForEvent('load', { timeout: 180000 }), page.tap('#newgame-btn')]);
  await page.waitForSelector('#start-btn:not([hidden])', { timeout: 180000 });
  check('D11 New journey offers a fresh start', (await page.textContent('#start-btn')).includes('Begin'));
  await page.tap('#start-btn');
  await page.waitForTimeout(1000);
  s = await S(page);
  check('D12 New journey resets all adventure progress', s.gold === 0 && !s.flags.transformed && !s.flags.introDialogue && !s.flags.treasure && s.puzzles.length === 0 && s.coins.length === 0 && s.objective === 'walk' && s.eraK === 0);
  check('D13 preferences survive a new journey', s.prefs.subs === true && s.prefs.voice === false);
  await page.evaluate(() => localStorage.removeItem('ltwe.prefs.v1'));

  // ---- Milestone C saves ----
  // write the save from an idle loading screen, so the running game cannot autosave over it on exit
  const cSave = async (o) => { await page.goto(url); await page.evaluate((o) => {
    localStorage.setItem('ltwe.save.v1', JSON.stringify(Object.assign({
      v: 1, pos: null, checkpoint: 'sungate', coins: [], gold: 0, puzzles: [], discovered: [],
      flags: { transformed: false, introDialogue: false, treasure: false }, objective: 'walk', savedAt: 1,
    }, o)));
  }, o); };
  // (a) C save: transformed, Killa not met yet, standing at the guardhouse
  await cSave({ pos: { x: -2, y: 25, z: -112, heading: 0 }, checkpoint: 'guardhouse', flags: { transformed: true, introDialogue: false, treasure: false }, objective: 'meet', coins: ['mp-coin-01'], gold: 10, discovered: ['The Guardhouse'] });
  await boot(page, false);
  await page.tap('#start-btn');
  await page.waitForTimeout(1500);
  check('D14a C save (transformed, Killa unmet): Killa waits at the guardhouse', Math.hypot((await S(page)).killa.x - 5, (await S(page)).killa.z + 116) < 2);
  await tp(page, 2, -113, 2.2);
  await waitFor(page, () => !document.getElementById('dialogue').hidden, null, 120000);
  s = await S(page);
  check('D14 C save (transformed, Killa unmet): Killa greets without repeating the cinematic', s.eraK === 1 && s.gold === 10 && s.coinsLeft === coins.length - 1 && (await page.textContent('#dlg-text')).includes('time of the Inca'));
  await page.tap('#dlg-skip');
  await frames(page, 3);
  s = await S(page);
  check('D15 …and the intro completes with the objective set', s.modal === 'none' && s.flags.introDialogue && s.objective === 'gold' && s.cine < 0);
  // (b) C save: finished adventure
  await cSave({ pos: { x: 0, y: 0, z: 0, heading: 0 }, checkpoint: 'chamber', flags: { transformed: true, introDialogue: true, treasure: true }, objective: 'explore', puzzles: ['mp-turning-stones'], gold: 210, coins: coins.map((_, i) => `mp-coin-${String(i + 1).padStart(2, '0')}`) });
  await boot(page, false);
  await page.tap('#start-btn');
  await page.waitForTimeout(1500);
  s = await S(page);
  check('D16 completed C save loads: door open, treasure kept, no intro, no arrow', s.doorOpen && s.flags.treasure && s.gold === 210 && s.modal === 'none' && !s.nav.shown && s.eraK === 1);
  // (c) C save before the transformation, part-way down the trail (past Killa's usual spot)
  await page.goto(url);
  await page.waitForSelector('#start-btn:not([hidden])', { timeout: 180000 });
  const trailY = await page.evaluate(() => window.__ltwe.world.groundAt(120, -209, 1000, 2000).y);
  await cSave({ pos: { x: 120, y: trailY, z: -209, heading: -0.8 }, checkpoint: 'sungate' });
  await boot(page, false);
  await page.tap('#start-btn');
  await page.waitForTimeout(1500);
  s = await S(page);
  const p3 = await pos(page);
  const ahead = Math.hypot(s.killa.x - p3.x, s.killa.z - p3.z);
  check('D17 C save on the trail: Killa waits a little ahead, not behind', s.killa.enabled && ahead < 14 && s.killa.z > p3.z - 1, `Killa ${ahead.toFixed(1)} m away`);
  // (d) corrupted save is ignored safely
  await page.goto(url);
  await page.evaluate(() => localStorage.setItem('ltwe.save.v1', '{not json'));
  await boot(page, false);
  check('D18 corrupt save falls back to a fresh start', (await page.textContent('#start-btn')).includes('Begin'));
  await ctx.close();
}

// ===================== E. Maize close-up (desktop) =====================
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('desktop: ' + e.message));
  await boot(page, true);
  await page.click('#start-btn');
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__ltwe.skipIntro());
  await page.evaluate(() => { const g = window.__ltwe; g.teleport(-12, -54.5, Math.PI * 0.85); g.camera.cam.beta = 1.42; g.camera.setZoom(4.5); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-output/d6-maize.png' });
  await page.evaluate(() => { const g = window.__ltwe; g.teleport(10, -60, -Math.PI / 2); g.camera.cam.beta = 1.15; g.camera.setZoom(9); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-output/d6b-terraces.png' });
  const cnt = await page.evaluate(() => {
    const sc = window.__ltwe.adventure.killa.root.getScene();
    return ['eraCrops', 'eraMaizeRipe', 'eraPotatoes'].map((n) => sc.getMeshByName(n).thinInstanceCount);
  });
  check('E1 maize (plain + ripe ears) and potatoes planted in rows', cnt[0] > 300 && cnt[1] > 80 && cnt[2] > 300, cnt.join(' / '));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
if (errors.length) console.log('Errors:\n  ' + errors.join('\n  '));
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
