// Scene-cost probe: real WebGL draw calls per frame at fixed viewpoints (counted by wrapping the
// GL draw functions, so it works on any build), plus frame-time spikes reported by the game.
// Usage: node scripts/perf-probe.mjs [url]
// Headless software rendering: compare COUNTS between builds; frame times here are NOT phone timings.
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:4173/laws-tours-world-explorer/';
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const dir = join(homedir(), '.cache/ms-playwright');
  for (const d of readdirSync(dir).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    const p = join(dir, d, 'chrome-linux64/chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('No Chromium found');
}
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  const w = window;
  w.__draws = 0;
  for (const C of [w.WebGL2RenderingContext, w.WebGLRenderingContext]) {
    if (!C) continue;
    for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = C.prototype[f];
      if (!orig) continue;
      C.prototype[f] = function (...a) { w.__draws++; return orig.apply(this, a); };
    }
  }
});
const page = await ctx.newPage();
await page.goto(base);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ltwe.seenHelp', '1'); });
await page.goto(base);
await page.waitForSelector('#start-btn:not([hidden])', { timeout: 180000 });
await page.tap('#start-btn');
await page.waitForTimeout(1500);
// complete the opening on either build (D: skipIntro completes Killa's welcome too)
await page.evaluate(() => window.__ltwe.skipIntro?.());
await page.waitForTimeout(1500);
const perFrame = () => page.evaluate(() => new Promise((res) => {
  let n = 0; const start = window.__draws;
  const f = () => { if (++n > 10) res((window.__draws - start) / 10); else requestAnimationFrame(f); };
  requestAnimationFrame(f);
}));
const views = [['sungate', 159.57, -249.42, -0.77], ['terraces', -2, -100, 0], ['plaza', 0, 0, 0], ['doorway', 14, -30, Math.PI]];
const out = {};
for (const [name, x, z, h] of views) {
  await page.evaluate(([x, z, h]) => window.__ltwe.teleport(x, z, h), [x, z, h]);
  await page.waitForTimeout(2500);
  out[name] = await perFrame();
  console.log(name.padEnd(10), `draw calls/frame ${out[name].toFixed(0)}`);
}
const st = await page.evaluate(() => window.__ltwe.sceneStats?.() ?? null);
if (st) console.log('scene', JSON.stringify(st));
const pf = await page.evaluate(() => window.__ltwe.perfStats?.() ?? null);
if (pf) console.log('frames', JSON.stringify(pf));
await browser.close();
