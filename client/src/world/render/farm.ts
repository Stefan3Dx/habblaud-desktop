// Tema Fazenda no renderer: troca de pisos, tapetes (viram hortas de flores) e móveis (art/farm.ts).
// Nenhuma colisão, assento ou caminho muda: só o desenho.
import type { FloorKind, FurnitureKind, FurnitureSprites, Sprite } from '../../art/api';
import { renderFarmFurniture } from '../../art/farm';
import type { BufSprite } from '../../art/core/sprite';

/** Piso de fazenda no lugar do piso do escritório. 'dirt' e 'cobble' são desenhados aqui; o resto pela arte. */
export type FarmFloor = FloorKind | 'dirt' | 'cobble';

export function farmFloor(kind: FloorKind, area?: string): FarmFloor {
  // Salas de projeto (piso claro com a cor do tema): campo.
  if (area === 'room' && (kind === 'marble' || kind === 'carpet')) return 'grass';
  switch (kind) {
    case 'carpet':
      return 'grass';
    case 'concrete':
      return 'dirt'; // corredor: estrada de terra
    case 'marble':
      return 'cobble'; // recepção: pátio de pedras
    case 'street':
      return 'dirt';
    case 'sidewalk':
      return 'grass';
    case 'tile_check':
    case 'tile_white':
      return 'wood'; // copa e banheiro: assoalho de celeiro
    default:
      return kind;
  }
}

function hash(a: number, b: number, seed: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(seed | 0, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Terra batida / pedras em coordenadas de mundo (sem emendas entre áreas vizinhas). */
export function drawFarmGround(ctx: CanvasRenderingContext2D, kind: 'dirt' | 'cobble', x: number, y: number, w: number, h: number, seed: number): void {
  ctx.save();
  if (kind === 'dirt') {
    ctx.fillStyle = '#b08a5e';
    ctx.fillRect(x, y, w, h);
    for (let yy = Math.floor(y); yy < y + h; yy += 2) {
      for (let xx = Math.floor(x); xx < x + w; xx += 2) {
        const r = hash(xx, yy, seed + 3);
        if (r < 0.16) {
          ctx.fillStyle = r < 0.06 ? '#94704a' : r < 0.11 ? '#c19c6e' : '#a07c52';
          ctx.fillRect(xx, yy, r < 0.03 ? 2 : 1, 1);
        } else if (r > 0.995) {
          ctx.fillStyle = '#d8c7a6';
          ctx.fillRect(xx, yy, 2, 1);
        }
      }
    }
  } else {
    ctx.fillStyle = '#8f8a80';
    ctx.fillRect(x, y, w, h);
    const S = 8;
    for (let gy = Math.floor(y / S) * S; gy < y + h; gy += S) {
      const off = (gy / S) % 2 ? S / 2 : 0;
      for (let gx = Math.floor(x / S) * S - off; gx < x + w; gx += S) {
        const r = hash(gx, gy, seed + 9);
        ctx.fillStyle = r < 0.33 ? '#b3ada1' : r < 0.66 ? '#a8a296' : '#bdb7ab';
        ctx.fillRect(Math.max(x, gx + 1), Math.max(y, gy + 1), Math.min(S - 2, x + w - gx - 1), Math.min(S - 2, y + h - gy - 1));
        ctx.fillStyle = '#cfc9bd';
        if (gx + 1 >= x && gy + 1 >= y) ctx.fillRect(gx + 1, gy + 1, S - 3, 1);
      }
    }
  }
  ctx.restore();
}

const PLOT_FLOWERS = ['#d94848', '#e46aa6', '#f2c443', '#8d63c9', '#f1ede4', '#ec8a3c', '#5b8fe0'];

/** Tapete vira horta: terra arada em fileiras, com mudas e flores. */
export function drawFarmPlot(ctx: CanvasRenderingContext2D, rug: { x: number; y: number; w: number; h: number }, seed: number): void {
  const x = Math.round(rug.x), y = Math.round(rug.y), w = Math.floor(rug.w), h = Math.floor(rug.h);
  ctx.save();
  ctx.fillStyle = '#6e4a33';
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = '#5a3c29';
  ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
  ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
  let row = 0;
  for (let yy = y + 4; yy < y + h - 3; yy += 6, row++) {
    ctx.fillStyle = '#86593c';
    ctx.fillRect(x + 3, yy, w - 6, 2);
    ctx.fillStyle = '#4f3424';
    ctx.fillRect(x + 3, yy + 2, w - 6, 1);
    const color = PLOT_FLOWERS[(seed + row) % PLOT_FLOWERS.length];
    for (let xx = x + 5 + (row % 2) * 3; xx < x + w - 5; xx += 6) {
      const r = hash(xx, yy, seed);
      ctx.fillStyle = '#4f9443';
      ctx.fillRect(xx, yy - 2, 1, 3);
      ctx.fillStyle = '#77bd58';
      ctx.fillRect(xx - 1, yy - 1, 1, 1);
      if (r < 0.7) {
        ctx.fillStyle = color;
        ctx.fillRect(xx - 1, yy - 4, 3, 2);
        ctx.fillRect(xx, yy - 5, 1, 1);
        ctx.fillStyle = '#ffe27a';
        ctx.fillRect(xx, yy - 4, 1, 1);
      }
    }
  }
  ctx.restore();
}

function toSprite(s: BufSprite): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = s.buf.w;
  canvas.height = s.buf.h;
  canvas.getContext('2d')!.putImageData(new ImageData(s.buf.data, s.buf.w, s.buf.h), 0, 0);
  return { canvas, ax: s.ax, ay: s.ay };
}

const cache = new Map<string, FurnitureSprites | null>();

/** Sprites de fazenda de um móvel (cache por kind/variante/semente); null = fica o do escritório. */
export function farmFurniture(kind: FurnitureKind, variant: string | undefined, seed: number, state = 0): FurnitureSprites | null {
  const key = `${kind}|${variant ?? ''}|${Math.abs(Math.floor(seed)) % 997}|${state}`;
  if (cache.has(key)) return cache.get(key)!;
  let out: FurnitureSprites | null = null;
  try {
    const f = renderFarmFurniture(kind, variant, seed, state);
    if (f) out = { base: toSprite(f.base), front: f.front ? toSprite(f.front) : undefined };
  } catch {
    out = null;
  }
  cache.set(key, out);
  return out;
}
