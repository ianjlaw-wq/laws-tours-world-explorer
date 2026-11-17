// Headless smoke test: loads the game, starts it, drives the explorer and takes screenshots.
// Usage: node scripts/smoke-test.mjs [url]
// Requires a Chromium binary (set CHROME_PATH, or uses the Playwright cache).
import { chromium } from 'playwright-core';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:4173/laws-tours-world-explorer/';
const out = 'test-output';
mkdirSync(out, { recursive: true });

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = join(homedir(), '.cache/ms-playwright');
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse() : [];
  for (const d of dirs) {
    const p = join(base, d, 'chrome-linux64/chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('No Chromium found; set CHROME_PATH');
}

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const results = {};

async function run(name, contextOpts, script) {
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#start-btn:not([hidden])', { timeout: 120000 });
  results[name + '_loadSeconds'] = (Date.now() - t0) / 1000;
  await page.screenshot({ path: `${out}/${name}-0-loading.png` });
  await page.click('#start-btn');
  await page.waitForTimeout(800);
  if (await page.isVisible('#help')) {
    await page.screenshot({ path: `${out}/${name}-1-help.png` });
    await page.click('#help-close');
  }
  await script(page);
  await ctx.close();
}

const wait = (page, ms) => page.waitForTimeout(ms);
const state = (page) => page.evaluate(() => {
  const g = window.__ltwe;
  return { x: +g.player.pos.x.toFixed(2), y: +g.player.pos.y.toFixed(2), z: +g.player.pos.z.toFixed(2), grounded: g.player.grounded };
});

await run('desktop', { viewport: { width: 1280, height: 720 } }, async (page) => {
  await wait(page, 2500);
  await page.screenshot({ path: `${out}/desktop-2-sungate.png` });
  const s0 = await state(page);
  // walk forward with keyboard, then run
  await page.keyboard.down('KeyW');
  await wait(page, 2500);
  await page.keyboard.down('ShiftLeft');
  await wait(page, 2500);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await wait(page, 400);
  const s1 = await state(page);
  results.keyboardMove = { from: s0, to: s1, dist: Math.hypot(s1.x - s0.x, s1.z - s0.z).toFixed(1) };
  await page.screenshot({ path: `${out}/desktop-3-trail.png` });
  // jump
  await page.keyboard.press('Space');
  await wait(page, 220);
  const sj = await state(page);
  results.jump = { before: s1.y, during: sj.y, grounded: sj.grounded };
  await wait(page, 900);
  // mouse look
  await page.mouse.move(640, 360);
  await page.mouse.down();
  await page.mouse.move(400, 330, { steps: 10 });
  await page.mouse.up();
  await wait(page, 300);
  await page.screenshot({ path: `${out}/desktop-4-look.png` });

  // Tour: teleport to key spots and screenshot
  const spots = [
    ['guardhouse', -4, -118, Math.atan2(0, 1)],
    ['terraces', -2, -60, Math.atan2(0, 1)],
    ['plaza', 4, -10, Math.atan2(-0.1, 1)],
    ['torreon', -24, -14, -Math.PI / 2],
    ['sacred-plaza', -30, 24, 0],
    ['east-sector', 36, 0, 0],
    ['intihuatana-base', -32, 46, 0],
  ];
  for (const [n, x, z, h] of spots) {
    await page.evaluate(([x, z, h]) => window.__ltwe.teleport(x, z, h), [x, z, h]);
    await wait(page, 1200);
    await page.screenshot({ path: `${out}/desktop-tour-${n}.png` });
    results['at_' + n] = await state(page);
  }
  // Stairs test: walk up the terrace staircase from the plaza
  await page.evaluate(() => window.__ltwe.teleport(-2, -38, Math.PI));
  await wait(page, 500);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await wait(page, 6000);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await wait(page, 400);
  results.stairClimb = await state(page);
  await page.screenshot({ path: `${out}/desktop-5-stairs.png` });
  results.fps = await page.evaluate(() => window.__ltwe.fps());
});

await run('mobile', {
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
}, async (page) => {
  await wait(page, 1500);
  const s0 = await state(page);
  // Drive the virtual joystick: half deflection (walk) then full (run)
  const box = await page.locator('#joystick-zone').boundingBox();
  const cx = box.x + 110;
  const cy = box.y + box.height - 90;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await touch('touchStart', cx, cy);
  for (let i = 1; i <= 5; i++) await touch('touchMove', cx, cy - i * 6);
  await wait(page, 2000);
  const sWalk = await state(page);
  for (let i = 1; i <= 6; i++) await touch('touchMove', cx, cy - 30 - i * 8);
  await wait(page, 2000);
  await page.screenshot({ path: `${out}/mobile-1-running.png` });
  await touch('touchEnd', cx, cy);
  await wait(page, 300);
  const sRun = await state(page);
  results.mobileJoystick = {
    walkDist: Math.hypot(sWalk.x - s0.x, sWalk.z - s0.z).toFixed(1),
    runDist: Math.hypot(sRun.x - sWalk.x, sRun.z - sWalk.z).toFixed(1),
  };
  await page.tap('#btn-jump');
  await wait(page, 200);
  results.mobileJump = await state(page);
  await page.screenshot({ path: `${out}/mobile-2-jump.png` });
});

await browser.close();
console.log(JSON.stringify(results, null, 2));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors.');
process.exit(errors.length ? 1 : 0);
