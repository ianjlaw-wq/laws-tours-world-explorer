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

/** Alpha leaf-cluster card for tree crowns (procedural: overlapping leaves in varied greens). */
export function leafClusterTexture(scene: Scene): DynamicTexture {
  const t = makeTex('leafCluster', scene, 512, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const r = rng(17);
    for (let i = 0; i < 950; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * s * 0.46 * (0.75 + 0.25 * Math.sin(a * 5 + r()));
      const x = s / 2 + Math.cos(a) * d;
      const y = s / 2 + Math.sin(a) * d;
      const shade = 0.55 + (1 - d / (s * 0.46)) * 0.25 + r() * 0.3;
      const g = Math.floor(70 + shade * 90);
      ctx.fillStyle = `rgb(${Math.floor(g * (0.42 + r() * 0.2))},${g},${Math.floor(g * (0.25 + r() * 0.15))})`;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r() * Math.PI * 2);
      const L = 9 + r() * 12;
      ctx.beginPath();
      ctx.ellipse(0, 0, L, L * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(70,50,30,0.9)';
    for (let i = 0; i < 6; i++) {
      ctx.lineWidth = 2 + r() * 2;
      ctx.beginPath();
      ctx.moveTo(s / 2, s / 2);
      const a = r() * Math.PI * 2;
      ctx.lineTo(s / 2 + Math.cos(a) * s * 0.3, s / 2 + Math.sin(a) * s * 0.3);
      ctx.stroke();
    }
  });
  t.hasAlpha = true;
  t.wrapU = Texture.CLAMP_ADDRESSMODE;
  t.wrapV = Texture.CLAMP_ADDRESSMODE;
  return t;
}

/** Alpha card of grass blades (ichu bunch grass), base at the bottom edge. */
export function grassBladeTexture(scene: Scene): DynamicTexture {
  const t = makeTex('grassBlades', scene, 256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const r = rng(23);
    for (let i = 0; i < 140; i++) {
      const bx = s * (0.12 + r() * 0.76);
      const h = s * (0.45 + r() * 0.53);
      const lean = (bx - s / 2) * (0.6 + r() * 0.8) + (r() - 0.5) * 40;
      const w = 2 + r() * 3.5;
      const g = 110 + Math.floor(r() * 90);
      const dry = r();
      ctx.fillStyle = `rgb(${Math.floor(g * (0.55 + dry * 0.45))},${g},${Math.floor(g * (0.3 + dry * 0.15))})`;
      ctx.beginPath();
      ctx.moveTo(bx - w, s);
      ctx.quadraticCurveTo(bx + lean * 0.3, s - h * 0.6, bx + lean, s - h);
      ctx.quadraticCurveTo(bx + lean * 0.3 + w * 0.5, s - h * 0.6, bx + w, s);
      ctx.closePath();
      ctx.fill();
    }
  });
  t.hasAlpha = true;
  t.wrapU = Texture.CLAMP_ADDRESSMODE;
  t.wrapV = Texture.CLAMP_ADDRESSMODE;
  return t;
}

/** Soft cloud puff with alpha. */
export function cloudTexture(scene: Scene): DynamicTexture {
  const tex = makeTex('cloud', scene, 256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const r = rng(5);
    for (let i = 0; i < 60; i++) {
      const cx = s * (0.18 + r() * 0.64);
      const cy = s * (0.38 + r() * 0.24) - (cx > s * 0.3 && cx < s * 0.7 ? s * 0.06 : 0);
      const rad = s * (0.06 + r() * 0.14);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.18)');
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
