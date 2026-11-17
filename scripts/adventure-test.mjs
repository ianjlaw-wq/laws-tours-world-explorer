// End-to-end test of the Milestone C adventure (desktop keyboard + phone touch).
// Usage: node scripts/adventure-test.mjs [url]
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

async function boot(page, fresh) {
  if (fresh) {
    await page.goto(url);
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ltwe.seenHelp', '1'); });
  }
  await page.goto(url);
  await page.waitForSelector('#start-btn:not([hidden])', { timeout: 180000 });
}
const S = (page) => page.evaluate(() => window.__ltwe.adventure.debugState());
const waitFor = async (page, fn, arg, timeout = 90000) => {
  await page.waitForFunction(fn, arg, { timeout, polling: 250 });
};
const tp = (page, x, z, h) => page.evaluate(([x, z, h]) => window.__ltwe.teleport(x, z, h), [x, z, h]);
const frames = (page, n = 3) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

// =========================== Desktop ===========================
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('desktop: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('desktop console: ' + m.text()); });
  await boot(page, true);
  check('fresh start button says Begin', (await page.textContent('#start-btn')).includes('Begin'));
  await page.click('#start-btn');
  await page.waitForTimeout(800);
  let s = await S(page);
  check('fresh: objective walk, not transformed', s.objective === 'walk' && !s.flags.transformed && s.eraK === 0);
  const p0 = await page.evaluate(() => ({ x: window.__ltwe.player.pos.x, z: window.__ltwe.player.pos.z }));
  check('fresh: starts at the Sun Gate', Math.hypot(p0.x - 160, p0.z + 249) < 2, JSON.stringify(p0));

  // 1. transformation plays to completion at the overlook (no skip)
  await tp(page, 104, -197, 0);
  await waitFor(page, () => window.__ltwe.adventure.modal === 'cinematic');
  check('transformation triggers at overlook', true);
  check('skip button visible during cinematic', await page.isVisible('#era-skip'));
  await waitFor(page, () => window.__ltwe.adventure.debugState().cine > 1.7, null, 120000);
  await page.screenshot({ path: 'test-output/adv-1-transform-mid.png' });
  await waitFor(page, () => window.__ltwe.adventure.debugState().cine < 0, null, 180000);
  s = await S(page);
  check('transformation completes: era 1, flag saved, objective meet', s.eraK === 1 && s.flags.transformed && s.objective === 'meet');
  check('roofs/crops shown, rubble hidden', await page.evaluate(() => {
    const sc = window.__ltwe.player; void sc;
    const scene = window.__ltwe.adventure.killa.root.getScene();
    return scene.getMeshByName('eraRoofs').isEnabled() && scene.getMeshByName('eraCrops').isEnabled() && !scene.getMeshByName('rubble').isEnabled();
  }));
  check('input unblocked after cinematic', !(await page.evaluate(() => window.__ltwe.adventure.blocking)));
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-output/adv-2-living-city.png' });

  // 2. Killa approaches and talks
  await tp(page, 1, -109, Math.PI);
  await waitFor(page, () => window.__ltwe.adventure.debugState().interaction === 'Talk to Killa', null, 120000);
  s = await S(page);
  check('Killa approaches the explorer', Math.hypot(s.killa.x - 5, s.killa.z + 116) > 0.5 && s.killa.enabled, JSON.stringify(s.killa));
  check('desktop prompt shows E key', (await page.textContent('#prompt')).includes('Talk to Killa'));
  await page.screenshot({ path: 'test-output/adv-3-killa.png' });
  await page.keyboard.press('KeyE');
  await waitFor(page, () => !document.getElementById('dialogue').hidden);
  check('dialogue opens with subtitles + 3 choices', (await page.textContent('#dlg-text')).includes('Welcome') && (await page.$$('#dlg-choices .choice')).length === 3);
  await page.screenshot({ path: 'test-output/adv-4-dialogue.png' });
  await page.keyboard.press('3'); // hidden...
  check('choice leads to the mystery', (await page.textContent('#dlg-text')).includes('three worlds'));
  await page.click('#dlg-choices .choice >> nth=0'); // where should I look
  await page.click('#dlg-choices .choice >> nth=0'); // thank you
  await waitFor(page, () => document.getElementById('dialogue').hidden);
  s = await S(page);
  check('intro dialogue saved; objective gold', s.flags.introDialogue && s.objective === 'gold');

  // 3. gold coins
  const coins = await page.evaluate(() => window.__ltwe.adventure.coins.map((c) => ({ id: c.id, x: c.x, z: c.z })));
  check('coin trail exists', coins.length >= 10, `${coins.length} coins`);
  let goldBefore = (await S(page)).gold;
  // walk into the first coin for real (not teleport onto it)
  await tp(page, coins[0].x, coins[0].z + 3, Math.PI);
  await page.keyboard.down('KeyW');
  await waitFor(page, () => window.__ltwe.adventure.debugState().coinsLeft < window.__ltwe.adventure.coins.length, null, 60000).catch(() => {});
  await page.keyboard.up('KeyW');
  s = await S(page);
  check('walking into a coin collects it', s.gold === goldBefore + 10 && (await page.textContent('#gold-count')) === String(s.gold), `gold ${s.gold}`);
  for (const c of coins.slice(1)) {
    await tp(page, c.x, c.z);
    await frames(page, 3);
  }
  await page.waitForTimeout(500);
  s = await S(page);
  check('all coins collected once', s.coinsLeft === 0 && s.coins.length === coins.length && s.gold === coins.length * 10, `gold ${s.gold}, left ${s.coinsLeft}`);
  for (const c of coins.slice(0, 4)) { await tp(page, c.x, c.z); await frames(page, 2); }
  check('revisiting coins gives nothing', (await S(page)).gold === coins.length * 10);
  await page.evaluate(() => { window.__ltwe.player.respawn(); });
  await frames(page, 3);
  check('coins stay collected after respawn', (await S(page)).coinsLeft === 0);

  // 4. reload: coins + dialogue + era persist
  await page.evaluate(() => window.__ltwe.adventure.persist());
  await boot(page, false);
  check('resumed: start says Continue + New journey offered', (await page.textContent('#start-btn')).includes('Continue') && await page.isVisible('#newgame-btn'));
  await page.click('#start-btn');
  await page.waitForTimeout(800);
  s = await S(page);
  check('reload: gold/coins/dialogue/era restored', s.gold === coins.length * 10 && s.coinsLeft === 0 && s.flags.introDialogue && s.eraK === 1 && s.modal === 'none');
  const pr = await page.evaluate(() => ({ x: window.__ltwe.player.pos.x, z: window.__ltwe.player.pos.z }));
  check('reload: explorer restored near last safe position', Math.hypot(pr.x - 160, pr.z + 249) > 20, JSON.stringify(pr));
  for (const c of coins) { await tp(page, c.x, c.z); await frames(page, 2); }
  check('reload: coins never respawn', (await S(page)).gold === coins.length * 10);

  // 5. puzzle
  await tp(page, 14, -37.3, Math.PI);
  await waitFor(page, () => window.__ltwe.adventure.debugState().interaction === 'Examine the turning stones', null, 60000);
  check('objective advanced to puzzle near the mechanism', (await S(page)).objective === 'puzzle');
  await page.keyboard.press('KeyE');
  await waitFor(page, () => !document.getElementById('puzzle').hidden);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-output/adv-5-puzzle.png' });
  // a wrong combination does not open it
  await page.click('#pz-wheels .wheel-row >> nth=0 >> .wheel-btn >> nth=0');
  s = await S(page);
  check('wrong combination keeps door shut', !s.doorOpen && !s.puzzles.length, JSON.stringify(s.wheels));
  // set: condor(0), puma(1), serpent(2)
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 4; k++) {
      const w = (await S(page)).wheels[i];
      if (w === i) break;
      await page.click(`#pz-wheels .wheel-row >> nth=${i} >> .wheel-btn >> nth=1`);
    }
  }
  s = await S(page);
  check('puzzle solved: door open, objective chamber, saved', s.doorOpen && s.puzzles.includes('mp-turning-stones') && s.objective === 'chamber');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-output/adv-6-solved.png' });
  await waitFor(page, () => document.getElementById('puzzle').hidden, null, 60000);
  // walk into the chamber
  await tp(page, 14, -40.5, Math.PI);
  const inside = await page.evaluate(() => window.__ltwe.simulate(3, 0, 1));
  check('explorer can walk into the hidden chamber', inside.z < -45.2, `z ${inside.z.toFixed(2)}`);
  await waitFor(page, () => window.__ltwe.adventure.debugState().interaction === 'Take the golden llama', null, 60000);
  await page.screenshot({ path: 'test-output/adv-7-chamber.png' });
  await page.keyboard.press('KeyE');
  // software rendering can take ~1 s per frame: wait for the state change, not a fixed delay
  await waitFor(page, () => window.__ltwe.adventure.debugState().flags.treasure, null, 30000).catch(() => {});
  s = await S(page);
  check('treasure taken: +50 gold, objective explore', s.flags.treasure && s.gold === coins.length * 10 + 50 && s.objective === 'explore');
  check('landmark discovered: Hidden Chamber', s.discovered.includes('The Hidden Chamber'));

  // 6. reload: puzzle stays solved, door stays open
  await page.evaluate(() => window.__ltwe.adventure.persist());
  await boot(page, false);
  await page.click('#start-btn');
  await page.waitForTimeout(800);
  s = await S(page);
  check('reload: puzzle solved + treasure persisted', s.doorOpen && s.wheels.join() === '0,1,2' && s.flags.treasure);
  await tp(page, 14, -40.5, Math.PI);
  const inside2 = await page.evaluate(() => window.__ltwe.simulate(3, 0, 1));
  check('reload: chamber still accessible', inside2.z < -45.2, `z ${inside2.z.toFixed(2)}`);
  await tp(page, 14, -40.5, Math.PI);
  await frames(page, 3);
  check('reload: no puzzle prompt once solved', (await S(page)).interaction === null);

  // 7. journal
  await page.keyboard.press('KeyJ');
  await waitFor(page, () => !document.getElementById('journal').hidden);
  const jt = await page.textContent('#journal-body');
  check('journal shows objective, gold, puzzle, landmarks, labelled notes',
    jt.includes('Current objective') && jt.includes(String(s.gold)) && jt.includes('Solved') && jt.includes('Hidden Chamber') && jt.includes('History') && jt.includes('Story'));
  await page.screenshot({ path: 'test-output/adv-8-journal-desktop.png' });
  await page.keyboard.press('Escape');
  check('journal closes with Esc', await page.evaluate(() => document.getElementById('journal').hidden));
  await ctx.close();
}

// =========================== Phone (touch, landscape) ===========================
{
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('mobile: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('mobile console: ' + m.text()); });
  await boot(page, true);
  await page.tap('#start-btn');
  await page.waitForTimeout(800);
  await tp(page, 104, -197, 0);
  await waitFor(page, () => window.__ltwe.adventure.modal === 'cinematic');
  check('phone: joystick hidden during cinematic', !(await page.isVisible('#joystick-zone')));
  await page.tap('#era-skip');
  await waitFor(page, () => window.__ltwe.adventure.debugState().eraK === 1 && window.__ltwe.adventure.modal === 'none', null, 60000);
  check('phone: skip button completes the transformation', (await S(page)).flags.transformed);
  check('phone: joystick back after cinematic', await page.isVisible('#joystick-zone'));

  await tp(page, 1, -109, Math.PI);
  await page.waitForSelector('#btn-action:not([hidden])', { timeout: 120000 });
  check('phone: TALK button appears near Killa', (await page.textContent('#btn-action')) === 'TALK');
  await page.tap('#btn-action');
  await waitFor(page, () => !document.getElementById('dialogue').hidden);
  await page.screenshot({ path: 'test-output/adv-m1-dialogue.png' });
  await page.tap('#dlg-choices .choice >> nth=2');
  await page.tap('#dlg-choices .choice >> nth=1'); // legend
  await page.tap('#dlg-choices .choice >> nth=0');
  await waitFor(page, () => document.getElementById('dialogue').hidden);
  check('phone: dialogue by touch completes', (await S(page)).flags.introDialogue);

  await tp(page, 14, -37.3, Math.PI);
  await page.waitForSelector('#btn-action:not([hidden])', { timeout: 60000 });
  check('phone: EXAMINE button at mechanism', (await page.textContent('#btn-action')) === 'EXAMINE');
  await page.tap('#btn-action');
  await waitFor(page, () => !document.getElementById('puzzle').hidden);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-output/adv-m2-puzzle.png' });
  const fits = await page.evaluate(() => { const r = document.getElementById('puzzle').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; });
  check('phone: puzzle panel fits landscape screen', fits);
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 4; k++) {
      if ((await S(page)).wheels[i] === i) break;
      await page.tap(`#pz-wheels .wheel-row >> nth=${i} >> .wheel-btn >> nth=1`);
    }
  }
  check('phone: puzzle solvable by touch', (await S(page)).doorOpen);
  await waitFor(page, () => document.getElementById('puzzle').hidden, null, 60000);
  await page.tap('#btn-journal');
  await waitFor(page, () => !document.getElementById('journal').hidden);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-output/adv-m3-journal.png' });
  const jfit = await page.evaluate(() => { const r = document.querySelector('.journal-book').getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1; });
  check('phone: journal fits landscape screen', jfit);
  await page.tap('#journal-close');
  check('phone: journal closes', await page.evaluate(() => document.getElementById('journal').hidden));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
if (errors.length) console.log('Errors:\n  ' + errors.join('\n  '));
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
