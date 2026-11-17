import { Scene } from '@babylonjs/core/scene';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { rng } from './noise';

// All textures are generated procedurally at load time: no external image assets,
// so there are no licensing or download concerns.

function makeTex(name: string, scene: Scene, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): DynamicTexture {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  draw(ctx, size);
  tex.update(true);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 4;
  return tex;
}

/** Light, near-white speckle so terrain vertex colours show through with surface detail. */
export function groundDetailTexture(scene: Scene): DynamicTexture {
  return makeTex('groundDetail', scene, 256, (ctx, s) => {
    const r = rng(11);
    ctx.fillStyle = 'rgb(225,225,225)';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const v = 150 + Math.floor(r() * 105);
      ctx.fillStyle = `rgba(${v},${v},${v - 10},${0.35 + r() * 0.4})`;
      const x = r() * s;
      const y = r() * s;
      const w = 1 + r() * 3;
      // tiling-safe: draw wrapped copies
      for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) ctx.fillRect(x + ox, y + oy, w, 1 + r() * 4);
    }
  });
}

/**
 * Inca granite masonry: irregular fitted blocks in staggered courses.
 * Rendered as light-grey with darker joints; tinted per-material.
 */
export function stoneTexture(scene: Scene, seed = 3, fine = false): DynamicTexture {
  return makeTex('stone' + seed, scene, 512, (ctx, s) => {
    const r = rng(seed);
    ctx.fillStyle = 'rgb(70,66,60)';
    ctx.fillRect(0, 0, s, s);
    const rows = fine ? 8 : 6;
    const rowH = s / rows;
    for (let row = 0; row < rows; row++) {
      let x = -r() * 60;
      const y0 = row * rowH;
      while (x < s) {
        const w = (fine ? 50 : 60) + r() * (fine ? 50 : 90);
        const tone = 150 + Math.floor(r() * 50);
        const warm = Math.floor(r() * 12);
        const jitter = () => (r() - 0.5) * (fine ? 3 : 8);
        ctx.fillStyle = `rgb(${tone + warm},${tone + warm - 4},${tone - 6})`;
        ctx.beginPath();
        const gap = fine ? 1.5 : 3;
        ctx.moveTo(x + gap + jitter(), y0 + gap + jitter());
        ctx.lineTo(x + w - gap + jitter(), y0 + gap + jitter());
        ctx.lineTo(x + w - gap + jitter(), y0 + rowH - gap + jitter());
        ctx.lineTo(x + gap + jitter(), y0 + rowH - gap + jitter());
        ctx.closePath();
        ctx.fill();
        // weathering speckle & lichen
        for (let k = 0; k < 18; k++) {
          const v = tone - 40 + Math.floor(r() * 60);
          const lichen = r() < 0.15;
          ctx.fillStyle = lichen ? `rgba(150,160,110,0.35)` : `rgba(${v},${v},${v},0.35)`;
          ctx.fillRect(x + r() * w, y0 + r() * rowH, 2 + r() * 6, 2 + r() * 5);
        }
        // subtle top highlight
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x + gap, y0 + gap, w - gap * 2, rowH * 0.18);
        x += w;
      }
    }
    // copy left edge to right edge region for horizontal tiling
    const strip = ctx.getImageData(0, 0, 4, s);
    ctx.putImageData(strip, s - 4, 0);
  });
}

export function thatchTexture(scene: Scene): DynamicTexture {
  return makeTex('thatch', scene, 256, (ctx, s) => {
    const r = rng(21);
    ctx.fillStyle = 'rgb(140,110,60)';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 1800; i++) {
      const v = 110 + Math.floor(r() * 90);
      ctx.strokeStyle = `rgba(${v + 30},${v + 10},${v - 40},0.7)`;
      ctx.lineWidth = 1 + r();
      const x = r() * s;
      const y = r() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (r() - 0.5) * 6, y + 14 + r() * 20);
      ctx.stroke();
    }
  });
}

/** Soft cloud puff with alpha. */
export function cloudTexture(scene: Scene): DynamicTexture {
  const tex = makeTex('cloud', scene, 256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const r = rng(5);
    for (let i = 0; i < 22; i++) {
      const cx = s * (0.25 + r() * 0.5);
      const cy = s * (0.35 + r() * 0.3);
      const rad = s * (0.12 + r() * 0.16);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.32)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  });
  tex.hasAlpha = true;
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}
