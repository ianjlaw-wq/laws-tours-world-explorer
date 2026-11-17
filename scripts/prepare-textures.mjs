// Downloads CC0 textures from Poly Haven (https://polyhaven.com, licence: CC0 1.0)
// and converts them to compact WebP files in public/textures/.
// Resizing/encoding uses headless Chromium's canvas, so no extra image tooling is needed.
// Usage: node scripts/prepare-textures.mjs
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// [polyhaven asset id, map, output name, size]
const TEXTURES = [
  ['stone_wall', 'diff', 'wall_rough_diff', 1024],
  ['stone_wall', 'nor_gl', 'wall_rough_nor', 512],
  ['japanese_stone_wall', 'diff', 'wall_fine_diff', 1024],
  ['japanese_stone_wall', 'nor_gl', 'wall_fine_nor', 512],
  ['leafy_grass', 'diff', 'grass_diff', 1024],
  ['rocky_terrain_02', 'diff', 'meadow_diff', 512],
  ['aerial_rocks_02', 'diff', 'cliff_diff', 1024],
  ['mossy_rock', 'diff', 'boulder_diff', 512],
  ['mossy_rock', 'nor_gl', 'boulder_nor', 512],
  ['rocky_trail', 'diff', 'trail_diff', 512],
  ['reed_roof_04', 'diff', 'thatch_diff', 512],
  ['reed_roof_04', 'nor_gl', 'thatch_nor', 512],
];

const out = 'public/textures';
mkdirSync(out, { recursive: true });

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = join(homedir(), '.cache/ms-playwright');
  for (const d of readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    const p = join(base, d, 'chrome-linux64/chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('No Chromium found; set CHROME_PATH');
}

const browser = await chromium.launch({ executablePath: findChrome() });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

for (const [asset, map, name, size] of TEXTURES) {
  const url = `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${asset}/${asset}_${map}_1k.jpg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');
  const dataUrl = await page.evaluate(async ({ b64, size }) => {
    const img = new Image();
    img.src = 'data:image/jpeg;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, size, size);
    return c.toDataURL('image/webp', 0.82);
  }, { b64, size });
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  writeFileSync(join(out, `${name}.webp`), buf);
  console.log(`${name}.webp  ${(buf.length / 1024).toFixed(0)} KB  <- ${asset} (${map})`);
}
await browser.close();
