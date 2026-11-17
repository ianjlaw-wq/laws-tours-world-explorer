// Multi-touch regression test for the fixed virtual joystick (real CDP touch events).
// Usage: node scripts/touch-test.mjs [url]
import { chromium } from 'playwright-core';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const url = (process.argv[2] ?? 'http://localhost:4173/laws-tours-world-explorer/') + '?quality=low';
mkdirSync('test-output', { recursive: true });
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = join(homedir(), '.cache/ms-playwright');
  for (const d of readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    const p = join(base, d, 'chrome-linux64/chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('No Chromium found; set CHROME_PATH');
}

const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.evaluate(() => { try { localStorage.clear(); localStorage.setItem('ltwe.seenHelp', '1'); } catch {} });
await page.reload();
await page.waitForSelector('#start-btn:not([hidden])', { timeout: 120000 });
await page.tap('#start-btn');
await page.waitForTimeout(1000);
await page.evaluate(() => window.__ltwe.skipIntro?.());

const cdp = await ctx.newCDPSession(page);
const active = new Map(); // id -> {x,y}
const send = async (type) => {
  const touchPoints = [...active.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
};
const down = async (id, x, y) => { active.set(id, { x, y }); await send('touchStart'); };
const move = async (id, x, y, steps = 6) => {
  const p = active.get(id);
  const sx = p.x, sy = p.y;
  for (let i = 1; i <= steps; i++) { p.x = sx + ((x - sx) * i) / steps; p.y = sy + ((y - sy) * i) / steps; await send('touchMove'); }
};
const up = async (id) => {
  const p = active.get(id);
  active.delete(id);
  // Chromium releases exactly the points listed in a touchEnd event
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] });
};

const baseRect = () => page.evaluate(() => { const r = document.getElementById('joystick-base').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }; });
const st = () => page.evaluate(() => {
  const g = window.__ltwe;
  return { x: g.player.pos.x, z: g.player.pos.z, y: g.player.pos.y, vy: g.player.vel.y, grounded: g.player.grounded,
    alpha: g.camera.cam.alpha, radius: g.camera.cam.radius, joy: g.input.joyId !== null,
    knob: document.getElementById('joystick-knob').style.transform };
});
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`); };

// put the explorer somewhere open (main plaza) facing north
await page.evaluate(() => window.__ltwe.teleport(0, 0, 0));
await page.waitForTimeout(800);

const base0 = await baseRect();
const vp = page.viewportSize();
check('joystick anchored bottom-left', base0.x < 60 && vp.height - (base0.y + base0.w) < 60, JSON.stringify(base0));
const jc = { x: base0.x + base0.w / 2, y: base0.y + base0.w / 2 };

// 1. one finger moves the explorer
let s0 = await st();
await down(1, jc.x, jc.y);
await move(1, jc.x, jc.y - 50);
await page.waitForTimeout(2500);
let s1 = await st();
check('1 joystick moves explorer', s1.joy && dist(s0, s1) > 0.3, `moved ${dist(s0, s1).toFixed(2)} m`);

// 2. second finger rotates camera while movement continues
await down(2, 600, 200);
await move(2, 450, 190, 8);
await page.waitForTimeout(1500);
let s2 = await st();
let b = await baseRect();
check('2 camera rotates with second finger', Math.abs(s2.alpha - s1.alpha) > 0.2, `dAlpha ${(s2.alpha - s1.alpha).toFixed(2)}`);
check('2 movement continues during camera drag', s2.joy && dist(s1, s2) > 0.2, `moved ${dist(s1, s2).toFixed(2)} m`);
check('2 base not displaced', b.x === base0.x && b.y === base0.y, JSON.stringify(b));

// 3. releasing the camera finger does not cancel movement
await up(2);
await page.waitForTimeout(1500);
let s3 = await st();
check('3 camera release keeps joystick', s3.joy && dist(s2, s3) > 0.2, `moved ${dist(s2, s3).toFixed(2)} m`);

// 4. joystick held + JUMP with another finger
const jb = await page.evaluate(() => { const r = document.getElementById('btn-jump').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
const yBefore = (await st()).y;
await down(3, jb.x, jb.y);
await page.waitForTimeout(150);
let s4 = await st();
await up(3);
let maxY = s4.y;
for (let i = 0; i < 6; i++) { await page.waitForTimeout(100); maxY = Math.max(maxY, (await st()).y); }
const s4b = await st();
check('4 jump while moving', !s4.grounded || maxY > yBefore + 0.2, `peak +${(maxY - yBefore).toFixed(2)} m`);
check('4 jump release keeps joystick', s4b.joy, '');

// 5. pinch with two fingers (joystick still held)
const r0 = (await st()).radius;
await down(4, 520, 200);
await down(5, 700, 200);
await move(5, 800, 200, 4);
await move(4, 420, 200, 4);
await page.waitForTimeout(800);
let s5 = await st();
b = await baseRect();
check('5 pinch zooms camera', Math.abs(s5.radius - r0) > 0.3, `radius ${r0.toFixed(2)} -> ${s5.radius.toFixed(2)}`);
check('5 pinch keeps joystick + base', s5.joy && b.x === base0.x && b.y === base0.y, JSON.stringify(b));
await up(5);
await up(4);

// 6. releasing joystick recentres knob without moving base, camera finger unaffected
await down(6, 600, 150);
await up(1);
await page.waitForTimeout(300);
let s6 = await st();
b = await baseRect();
check('6 joystick release recentres knob', !s6.joy && /translate\(0px, 0px\)/.test(s6.knob), s6.knob);
check('6 base unchanged after release', b.x === base0.x && b.y === base0.y, '');
const a6 = s6.alpha;
await move(6, 450, 150, 6);
await page.waitForTimeout(500);
check('6 camera finger still works after joystick release', Math.abs((await st()).alpha - a6) > 0.2, '');
await up(6);

// 7. a touch on the left side but outside the joystick rotates the camera, never grabs the joystick
await down(7, 60, 60);
await move(7, 200, 70, 6);
await page.waitForTimeout(400);
let s7 = await st();
b = await baseRect();
check('7 left-side touch outside joystick does not grab it', !s7.joy && b.x === base0.x && b.y === base0.y, '');
await up(7);

// 10. reported defect: a two-finger camera gesture with one finger on the lower-left of the screen
//     (near, but not on, the joystick) must neither move the base nor grab the joystick.
await down(10, 250, 300);
await down(11, 520, 220);
await move(10, 200, 300, 4);
await move(11, 650, 200, 4);
await page.waitForTimeout(400);
let s10 = await st();
b = await baseRect();
check('10 two-finger gesture on lower-left: base fixed', b.x === base0.x && b.y === base0.y, JSON.stringify(b));
check('10 two-finger gesture on lower-left: joystick not grabbed', !s10.joy, '');
await up(11);
await up(10);
// ...and while the joystick is held
await down(12, jc.x, jc.y);
await move(12, jc.x, jc.y - 45);
await down(13, 260, 320);
await move(13, 330, 300, 5);
await page.waitForTimeout(300);
b = await baseRect();
let s10b = await st();
check('10 extra finger near joystick while held: base fixed', b.x === base0.x && b.y === base0.y, JSON.stringify(b));
check('10 extra finger near joystick while held: still driving', s10b.joy && /-4\dpx|-45px/.test(s10b.knob), s10b.knob);
await up(13);
await up(12);

// 8. orientation changes keep the joystick anchored
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
let bp = await baseRect();
check('8 portrait: anchored bottom-left', bp.x < 60 && 844 - (bp.y + bp.w) < 60, JSON.stringify(bp));
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(600);
let bl = await baseRect();
check('8 landscape again: same position', bl.x === base0.x && bl.y === base0.y, JSON.stringify(bl));
// hold joystick across a rotation
await down(8, jc.x, jc.y);
await move(8, jc.x + 40, jc.y);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(400);
check('8 joystick survives rotation while held', (await st()).joy, '');
await up(8);
await page.screenshot({ path: 'test-output/touch-final.png' });

// 9. pointercancel releases joystick
await down(9, jc.x, jc.y);
await move(9, jc.x, jc.y - 40);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
active.clear();
await page.waitForTimeout(200);
check('9 touch cancel releases joystick', !(await st()).joy, '');

await browser.close();
const failed = results.filter((r) => !r.ok).length;
if (errors.length) console.log('Page errors:', errors);
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
