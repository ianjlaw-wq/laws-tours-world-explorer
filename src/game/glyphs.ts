// Stylised Andean-inspired symbols drawn with Canvas 2D. Used for the stone wheels (3D texture)
// and the touchscreen puzzle panel, so both always match.

export type Glyph = 'condor' | 'puma' | 'serpent' | 'sun';
export const GLYPHS: Glyph[] = ['condor', 'puma', 'serpent', 'sun'];
export const GLYPH_NAMES: Record<Glyph, string> = { condor: 'Condor', puma: 'Puma', serpent: 'Serpent', sun: 'Sun' };

/** Draw a glyph centred at (cx, cy), fitting in a box of `size`. */
export function drawGlyph(g: CanvasRenderingContext2D, kind: Glyph, cx: number, cy: number, size: number, color: string) {
  const s = size / 100; // design space: -50..50
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = 7;
  g.beginPath();
  switch (kind) {
    case 'sun': {
      g.arc(0, 0, 18, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        g.beginPath();
        g.moveTo(Math.cos(a - 0.2) * 25, Math.sin(a - 0.2) * 25);
        g.lineTo(Math.cos(a) * 45, Math.sin(a) * 45);
        g.lineTo(Math.cos(a + 0.2) * 25, Math.sin(a + 0.2) * 25);
        g.closePath();
        g.fill();
      }
      break;
    }
    case 'condor': {
      // stepped wings, body, head with ruff, fanned tail
      const wing = (sx: number) => {
        g.beginPath();
        g.moveTo(sx * 6, -10);
        g.lineTo(sx * 46, -18);
        g.lineTo(sx * 46, -8);
        g.lineTo(sx * 36, -8);
        g.lineTo(sx * 36, 2);
        g.lineTo(sx * 24, 2);
        g.lineTo(sx * 24, 10);
        g.lineTo(sx * 6, 8);
        g.closePath();
        g.fill();
      };
      wing(-1);
      wing(1);
      g.beginPath();
      g.ellipse(0, 2, 9, 20, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(0, -26, 8, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(-7, 18);
      g.lineTo(-14, 40);
      g.lineTo(0, 34);
      g.lineTo(14, 40);
      g.lineTo(7, 18);
      g.closePath();
      g.fill();
      break;
    }
    case 'puma': {
      // frontal cat face
      g.beginPath();
      g.moveTo(-34, -30);
      g.lineTo(-20, -44);
      g.lineTo(-10, -30);
      g.lineTo(10, -30);
      g.lineTo(20, -44);
      g.lineTo(34, -30);
      g.lineTo(36, 4);
      g.quadraticCurveTo(30, 38, 0, 42);
      g.quadraticCurveTo(-30, 38, -36, 4);
      g.closePath();
      g.lineWidth = 8;
      g.stroke();
      g.beginPath();
      g.ellipse(-14, -6, 6, 4, 0, 0, Math.PI * 2);
      g.ellipse(14, -6, 6, 4, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(-7, 10);
      g.lineTo(7, 10);
      g.lineTo(0, 19);
      g.closePath();
      g.fill();
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(0, 19); g.lineTo(-8, 28);
      g.moveTo(0, 19); g.lineTo(8, 28);
      g.moveTo(-14, 16); g.lineTo(-40, 12);
      g.moveTo(-14, 22); g.lineTo(-40, 26);
      g.moveTo(14, 16); g.lineTo(40, 12);
      g.moveTo(14, 22); g.lineTo(40, 26);
      g.stroke();
      break;
    }
    case 'serpent': {
      // stepped zigzag body with a diamond head
      g.lineWidth = 10;
      g.beginPath();
      g.moveTo(-44, 30);
      g.lineTo(-30, 30);
      g.lineTo(-30, 10);
      g.lineTo(-10, 10);
      g.lineTo(-10, -10);
      g.lineTo(10, -10);
      g.lineTo(10, 10);
      g.lineTo(26, 10);
      g.lineTo(26, -14);
      g.stroke();
      g.beginPath();
      g.moveTo(26, -42);
      g.lineTo(40, -26);
      g.lineTo(26, -12);
      g.lineTo(12, -26);
      g.closePath();
      g.fill();
      break;
    }
  }
  g.restore();
}

/** Small swatch canvas for the HTML puzzle panel. */
export function glyphCanvas(kind: Glyph, px = 108): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  paintGlyphCanvas(c, kind);
  return c;
}

export function paintGlyphCanvas(c: HTMLCanvasElement, kind: Glyph) {
  const g = c.getContext('2d')!;
  const px = c.width;
  g.clearRect(0, 0, px, px);
  drawGlyph(g, kind, px / 2, px / 2, px * 0.72, '#f1d58a');
}
