// Tema Fazenda: móveis do escritório redesenhados como coisas de fazenda, na mesma escala e com as mesmas
// pegadas (nenhuma colisão, assento ou caminho muda). Mesas viram canteiros de flores; cadeiras, tocos; sofás,
// fardos de feno; divisórias de vidro, cercas de madeira. Puro: só desenha em PixelBuf.
import type { FurnitureKind } from './api';
import { PixelBuf } from './core/pixbuf';
import { floorSheet, trim, type BufFurniture, type BufSprite } from './core/sprite';
import { contact } from './furniture/kit';

const WOOD = { dd: '#5a3820', dk: '#6f4729', base: '#946139', lt: '#b8834f', hi: '#d3a466' };
const SOIL = { dk: '#4f3424', base: '#674430', lt: '#7f573b' };
const LEAF = { dk: '#356b34', base: '#4f9443', lt: '#77bd58' };
const HAY = { dk: '#b0862f', base: '#d6ad48', lt: '#eccd73', hi: '#f6e3a0', twine: '#8a5a2b' };

/** Pétala / miolo de cada flor. */
const FLOWERS: readonly (readonly [string, string, string])[] = [
  ['#d94848', '#f07b6e', '#ffd36a'], // vermelha
  ['#e46aa6', '#f5a3c8', '#ffe27a'], // rosa
  ['#f2c443', '#ffe27a', '#7a4b26'], // amarela
  ['#8d63c9', '#b993ea', '#ffe27a'], // roxa
  ['#f1ede4', '#ffffff', '#f2c443'], // branca
  ['#ec8a3c', '#f8b26a', '#7a4b26'], // laranja
  ['#5b8fe0', '#93b8f2', '#ffffff'], // azul
];

function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uma flor: caule de `top` até `base`, cabeça em (x, top). size 1 = pequena (cruz), 2 = grande. */
function flower(b: PixelBuf, x: number, base: number, top: number, pal: readonly [string, string, string], size = 1): void {
  b.vline(x, top + 1, base, LEAF.base);
  if (base - top > 4) {
    b.set(x - 1, base - 2, LEAF.lt);
    b.set(x + 1, base - 3, LEAF.base);
  }
  if (size >= 2) {
    b.rect(x - 2, top - 1, 5, 3, pal[0]);
    b.rect(x - 1, top - 2, 3, 5, pal[0]);
    b.set(x - 1, top - 1, pal[1]);
    b.set(x, top - 2, pal[1]);
    b.rect(x, top, 1, 1, pal[2]);
    b.set(x - 1, top, pal[2]);
  } else {
    b.set(x, top - 1, pal[1]);
    b.set(x - 1, top, pal[0]);
    b.set(x + 1, top, pal[0]);
    b.set(x, top + 1, pal[0]);
    b.set(x, top, pal[2]);
  }
}

function tulip(b: PixelBuf, x: number, base: number, top: number, pal: readonly [string, string, string]): void {
  b.vline(x, top + 2, base, LEAF.base);
  b.set(x - 1, base - 2, LEAF.lt);
  b.rect(x - 1, top, 3, 3, pal[0]);
  b.set(x - 1, top - 1, pal[0]);
  b.set(x + 1, top - 1, pal[0]);
  b.set(x, top, pal[1]);
}

function lavender(b: PixelBuf, x: number, base: number, top: number): void {
  b.vline(x, top + 3, base, LEAF.dk);
  for (let y = top; y < top + 4; y++) b.set(x + (y % 2 ? 0 : 0), y, y % 2 ? '#8d63c9' : '#b993ea');
}

function sunflowerHead(b: PixelBuf, cx: number, cy: number, r = 3): void {
  b.ellipse(cx, cy, r + 1, r + 1, '#f2c443');
  for (const [dx, dy] of [[-(r + 2), 0], [r + 2, 0], [0, -(r + 2)], [0, r + 2]]) b.set(cx + dx, cy + dy, '#ffe27a');
  b.ellipse(cx, cy, r - 1, r - 1, '#7a4b26');
  b.set(cx - 1, cy - 1, '#9a6534');
}

/** Tábuas de madeira com veio (face frontal de caixas e canteiros). */
function planks(b: PixelBuf, x: number, y: number, w: number, h: number, seed: number): void {
  b.rect(x, y, w, h, WOOD.base);
  b.hline(x, x + w - 1, y, WOOD.lt);
  for (let yy = y + 3; yy < y + h; yy += 3) b.hline(x, x + w - 1, yy, WOOD.dk);
  const r = rng(seed);
  for (let i = 0; i < Math.floor(w / 6); i++) b.set(x + 1 + Math.floor(r() * (w - 2)), y + 1 + Math.floor(r() * (h - 2)), WOOD.dk);
  b.hline(x, x + w - 1, y + h - 1, WOOD.dd);
}

function pickFlower(r: () => number): readonly [string, string, string] {
  return FLOWERS[Math.floor(r() * FLOWERS.length)]!;
}

// ------------------------------------------------------------------ canteiros (mesas)

/** Canteiro elevado de 2x1 com flores. `low`: flores baixas (desk_back: o rosto de quem cuida fica visível). */
function flowerBed(seed: number, low: boolean): BufFurniture {
  const s = floorSheet(2, 1, low ? 10 : 16);
  const b = s.buf;
  const r = rng(seed * 7 + 3);
  contact(b, -1, 12, 34, 4, 0.2);
  // borda de trás, terra, borda da frente, face frontal
  b.hline(1, 30, -1, WOOD.lt);
  b.rect(0, -1, 2, 8, WOOD.dk);
  b.rect(30, -1, 2, 8, WOOD.dk);
  b.rect(2, 0, 28, 6, SOIL.base);
  for (let i = 0; i < 18; i++) b.set(2 + Math.floor(r() * 28), Math.floor(r() * 6), r() < 0.5 ? SOIL.dk : SOIL.lt);
  b.rect(0, 6, 32, 2, WOOD.lt);
  b.hline(0, 31, 6, WOOD.hi);
  planks(b, 1, 8, 30, 6, seed);
  b.rect(1, 8, 2, 6, WOOD.dk);
  b.rect(29, 8, 2, 6, WOOD.dk);
  // flores em duas fileiras
  const basket = seed % 3 === 0;
  const kind = seed % 4; // 0 mista, 1 tulipas, 2 girassóis, 3 lavanda
  const maxH = low ? 6 : 11;
  for (let row = 0; row < 2; row++) {
    const base = row === 0 ? 2 : 5;
    for (let x = 4 + row * 2; x < (basket ? 23 : 29); x += 4) {
      const h = 3 + Math.floor(r() * (maxH - 3)) - row;
      const top = base - h;
      if (kind === 1) tulip(b, x, base, top, pickFlower(r));
      else if (kind === 3) lavender(b, x, base, top);
      else if (kind === 2 && !low && row === 0 && x % 8 === 4) {
        b.vline(x, top + 2, base, LEAF.base);
        b.set(x + 1, top + 5, LEAF.lt);
        sunflowerHead(b, x, top, 2);
      } else flower(b, x, base, top, pickFlower(r), r() < 0.25 ? 2 : 1);
    }
  }
  if (basket) {
    // cesto com as flores já colhidas
    b.rect(24, -1, 7, 6, '#c08a4a');
    b.hline(24, 30, -1, '#e0b071');
    for (let x = 24; x <= 30; x += 2) b.vline(x, 0, 4, '#9a6a35');
    b.hline(24, 30, 2, '#9a6a35');
    for (const [x, y] of [[25, -3], [27, -4], [29, -2], [26, -2]] as const) {
      const p = pickFlower(r);
      b.set(x, y, p[0]);
      b.set(x, y + 1, p[2]);
    }
    b.vline(23, -5, -1, '#9a6a35');
    b.vline(31, -5, -1, '#9a6a35');
    b.hline(23, 31, -6, '#9a6a35');
  }
  b.outline();
  return { base: s };
}

// ------------------------------------------------------------------ assentos

function stump(): BufFurniture {
  const s = floorSheet(1, 1, 4);
  const b = s.buf;
  contact(b, 1, 12, 14, 3, 0.22);
  b.rect(3, 5, 10, 8, '#7a5134');
  b.vline(5, 6, 12, '#694329');
  b.vline(9, 7, 12, '#8d6040');
  b.vline(11, 6, 11, '#694329');
  b.ellipse(8, 5, 5, 2, '#c99b63');
  b.ellipse(8, 5, 3, 1, '#b5864f');
  b.set(8, 5, '#9a6c3c');
  b.outline();
  return { base: s };
}

function hayBale(w: number, seed: number): BufFurniture {
  const s = floorSheet(w, 1, 6);
  const b = s.buf;
  const W = w * 16;
  contact(b, 0, 12, W, 4, 0.22);
  b.rect(1, 0, W - 2, 6, HAY.lt);
  b.hline(1, W - 2, 0, HAY.hi);
  b.rect(1, 6, W - 2, 8, HAY.base);
  const r = rng(seed + 11);
  for (let i = 0; i < W; i++) {
    const x = 1 + Math.floor(r() * (W - 2));
    const y = Math.floor(r() * 14);
    b.set(x, y, y < 6 ? HAY.base : HAY.dk);
    b.set(x + 1, y, y < 6 ? HAY.hi : HAY.lt);
  }
  b.hline(1, W - 2, 13, HAY.dk);
  for (let x = Math.floor(W / 3); x < W - 2; x += Math.floor(W / 3)) b.vline(x, 0, 13, HAY.twine);
  b.outline();
  return { base: s };
}

// ------------------------------------------------------------------ plantas

function flowerPot(seed: number): BufFurniture {
  const s = floorSheet(1, 1, 14);
  const b = s.buf;
  const r = rng(seed * 13 + 5);
  contact(b, 2, 12, 12, 3, 0.2);
  b.rect(4, 6, 8, 7, '#c4693f');
  b.rect(3, 5, 10, 2, '#d98457');
  b.vline(5, 7, 12, '#d98457');
  b.hline(4, 11, 12, '#9c4f2d');
  b.rect(4, 5, 8, 1, SOIL.base);
  const v = seed % 3;
  if (v === 0) {
    for (const x of [6, 8, 10]) tulip(b, x, 5, 5 - 4 - Math.floor(r() * 4), pickFlower(r));
  } else if (v === 1) {
    for (const x of [5, 7, 9, 11]) lavender(b, x, 5, 5 - 5 - Math.floor(r() * 3));
  } else {
    b.vline(8, -4, 5, LEAF.base);
    b.set(7, 1, LEAF.lt);
    b.set(9, 2, LEAF.lt);
    sunflowerHead(b, 8, -6, 2);
  }
  b.outline();
  return { base: s };
}

function tallSunflowers(seed: number): BufFurniture {
  const s = floorSheet(1, 1, 30, 6);
  const b = s.buf;
  contact(b, 1, 12, 14, 3, 0.2);
  b.ellipse(8, 11, 6, 2, SOIL.base);
  const two = seed % 2 === 0;
  const stems: [number, number][] = two ? [[5, -16], [11, -22]] : [[8, -22]];
  for (const [x, top] of stems) {
    b.vline(x, top + 3, 11, LEAF.dk);
    b.vline(x + 1, top + 4, 11, LEAF.base);
    for (let y = top + 8; y < 8; y += 6) {
      b.rect(x - 3, y, 3, 2, LEAF.base);
      b.set(x - 3, y, LEAF.lt);
      b.rect(x + 2, y + 3, 3, 2, LEAF.base);
      b.set(x + 4, y + 3, LEAF.lt);
    }
    sunflowerHead(b, x, top, 3);
  }
  b.outline();
  return { base: s };
}

// ------------------------------------------------------------------ armazenagem

function crateShelf(seed: number): BufFurniture {
  const s = floorSheet(2, 1, 24);
  const b = s.buf;
  const r = rng(seed + 31);
  contact(b, 0, 12, 32, 4, 0.2);
  b.rect(1, -22, 30, 35, WOOD.dk);
  b.rect(3, -20, 26, 31, '#4a2f1d');
  for (const y of [-11, -1, 9]) {
    b.rect(1, y, 30, 2, WOOD.lt);
    b.hline(1, 30, y, WOOD.hi);
  }
  // potes, sacos de sementes e regadores nas prateleiras
  for (const y of [-11, -1, 9]) {
    for (let x = 4; x < 28; x += 7) {
      const t = Math.floor(r() * 3);
      if (t === 0) {
        b.rect(x, y - 5, 5, 5, '#c4693f');
        b.hline(x, x + 4, y - 5, '#d98457');
        const p = pickFlower(r);
        b.set(x + 1, y - 7, p[0]);
        b.set(x + 3, y - 8, p[1]);
        b.vline(x + 2, y - 7, y - 6, LEAF.base);
      } else if (t === 1) {
        b.rect(x, y - 6, 5, 6, '#e8dcc0');
        b.hline(x, x + 4, y - 6, '#cbbd9c');
        b.rect(x + 1, y - 4, 3, 2, pickFlower(r)[0]);
      } else {
        b.rect(x, y - 4, 5, 4, '#7d8b96');
        b.hline(x, x + 4, y - 4, '#a3b0ba');
        b.set(x + 5, y - 3, '#7d8b96');
        b.set(x + 6, y - 4, '#7d8b96');
      }
    }
  }
  b.outline();
  return { base: s };
}

function barrel(): BufFurniture {
  const s = floorSheet(1, 1, 12);
  const b = s.buf;
  contact(b, 1, 12, 14, 3, 0.22);
  b.rect(3, -6, 10, 19, WOOD.base);
  b.vline(3, -5, 12, WOOD.dk);
  b.vline(12, -5, 12, WOOD.dk);
  b.vline(6, -6, 12, WOOD.lt);
  b.vline(9, -6, 12, WOOD.dk);
  for (const y of [-3, 4, 10]) b.hline(3, 12, y, '#5d636b');
  b.ellipse(8, -6, 5, 1, '#3d6fa0');
  b.hline(5, 10, -6, '#6aa0d0');
  b.outline();
  return { base: s };
}

function crates(seed: number): BufFurniture {
  const s = floorSheet(1, 1, 16);
  const b = s.buf;
  contact(b, 1, 12, 14, 3, 0.22);
  planks(b, 1, 3, 14, 10, seed);
  planks(b, 2, -8, 12, 10, seed + 1);
  b.line(2, 4, 14, 12, WOOD.dk);
  b.line(3, -7, 13, 1, WOOD.dk);
  b.outline();
  return { base: s };
}

function wheelbarrow(seed: number): BufFurniture {
  const s = floorSheet(1, 1, 8, 6);
  const b = s.buf;
  const r = rng(seed + 9);
  contact(b, -1, 12, 18, 3, 0.2);
  b.rect(-1, 2, 15, 6, '#3f7fd8');
  b.hline(-1, 13, 2, '#6aa0f0');
  b.hline(0, 12, 7, '#2f5fa8');
  for (let x = 0; x < 13; x += 2) {
    const p = pickFlower(r);
    b.set(x, 0, p[0]);
    b.set(x + 1, 1, p[1]);
    b.set(x, 1, LEAF.base);
  }
  b.ellipse(12, 10, 2, 2, '#2d2f36');
  b.set(12, 10, '#8b929e');
  b.line(-2, 8, -4, 12, WOOD.dk);
  b.line(4, 8, 2, 12, WOOD.dk);
  b.outline();
  return { base: s };
}

function wateringCan(): BufFurniture {
  const s = floorSheet(1, 1, 4);
  const b = s.buf;
  contact(b, 2, 12, 12, 3, 0.2);
  b.rect(4, 5, 7, 7, '#5f9a6e');
  b.hline(4, 10, 5, '#82bd8f');
  b.line(11, 7, 14, 3, '#5f9a6e');
  b.rect(13, 2, 2, 2, '#4a7d57');
  b.hline(5, 9, 3, '#4a7d57');
  b.set(5, 4, '#4a7d57');
  b.set(9, 4, '#4a7d57');
  b.outline();
  return { base: s };
}

function waterPump(): BufFurniture {
  const s = floorSheet(1, 1, 18);
  const b = s.buf;
  contact(b, 0, 12, 16, 3, 0.22);
  b.rect(1, 6, 14, 7, '#9aa1a8');
  b.hline(1, 14, 6, '#c2c7cc');
  for (const x of [4, 8, 12]) b.vline(x, 7, 12, '#7c838b');
  b.rect(6, -10, 4, 16, '#3d6b5a');
  b.vline(6, -10, 5, '#5a917c');
  b.rect(9, -6, 4, 2, '#3d6b5a');
  b.line(7, -10, 12, -14, '#3d6b5a');
  b.set(12, -3, '#6aa0d0');
  b.set(12, 0, '#6aa0d0');
  b.outline();
  return { base: s };
}

function lanternPost(): BufFurniture {
  const s = floorSheet(1, 1, 28);
  const b = s.buf;
  contact(b, 3, 12, 10, 3, 0.2);
  b.rect(7, -18, 2, 31, WOOD.dk);
  b.vline(7, -18, 12, WOOD.lt);
  b.hline(7, 12, -18, WOOD.dk);
  b.vline(12, -18, -15, '#3c3c40');
  b.rect(10, -15, 5, 6, '#3c3c40');
  b.rect(11, -14, 3, 4, '#ffd66b');
  b.set(11, -14, '#fff2b8');
  b.outline();
  return { base: s };
}

function picnicTable(seed: number): BufFurniture {
  const s = floorSheet(3, 2, 8);
  const b = s.buf;
  contact(b, 0, 28, 48, 4, 0.2);
  // bancos
  planks(b, 2, 0, 44, 3, seed);
  planks(b, 2, 26, 44, 3, seed + 2);
  // tampo
  b.rect(2, 6, 44, 16, WOOD.lt);
  for (let y = 9; y < 22; y += 4) b.hline(2, 45, y, WOOD.base);
  b.hline(2, 45, 6, WOOD.hi);
  b.rect(2, 22, 44, 3, WOOD.dk);
  for (const x of [6, 40]) b.rect(x, 25, 2, 4, WOOD.dd);
  // vaso com flores no meio
  const r = rng(seed + 3);
  b.rect(21, 10, 6, 6, '#e8dcc0');
  b.hline(21, 26, 10, '#ffffff');
  for (const x of [21, 23, 25, 27]) {
    const p = pickFlower(r);
    b.vline(x, 6, 9, LEAF.base);
    b.set(x, 5, p[0]);
    b.set(x, 4, p[1]);
  }
  b.outline();
  return { base: s };
}

function crateTable(seed: number): BufFurniture {
  const s = floorSheet(2, 1, 10);
  const b = s.buf;
  const r = rng(seed + 21);
  contact(b, 0, 12, 32, 4, 0.2);
  b.rect(2, -1, 28, 6, WOOD.lt);
  b.hline(2, 29, -1, WOOD.hi);
  b.hline(2, 29, 2, WOOD.base);
  planks(b, 2, 5, 28, 8, seed);
  b.rect(13, -6, 6, 6, '#c4693f');
  for (const x of [13, 15, 17, 19]) {
    const p = pickFlower(r);
    b.vline(x, -9, -7, LEAF.base);
    b.set(x, -10, p[0]);
  }
  b.outline();
  return { base: s };
}

function fence(variant: string | undefined): BufFurniture {
  const s = floorSheet(1, 1, 12, 2);
  const b = s.buf;
  const post = (x: number) => {
    b.rect(x, -8, 3, 20, WOOD.base);
    b.vline(x, -8, 11, WOOD.lt);
    b.hline(x, x + 2, -8, WOOD.hi);
    b.hline(x, x + 2, 11, WOOD.dd);
  };
  if (variant === 'v') {
    contact(b, 5, 12, 6, 3, 0.18);
    b.rect(7, -10, 2, 22, WOOD.lt);
    b.vline(8, -10, 11, WOOD.dk);
    post(6);
  } else if (variant === 'end') {
    contact(b, 4, 12, 8, 3, 0.18);
    post(6);
  } else {
    contact(b, 0, 12, 16, 3, 0.18);
    for (const y of [-4, 3]) {
      b.rect(-1, y, 18, 3, WOOD.lt);
      b.hline(-1, 16, y, WOOD.hi);
      b.hline(-1, 16, y + 2, WOOD.dk);
    }
    post(1);
    post(12);
  }
  b.outline();
  return { base: s };
}

function build(kind: FurnitureKind, variant: string | undefined, seed: number): BufFurniture | null {
  switch (kind) {
    case 'desk':
      return flowerBed(seed, false);
    case 'desk_back':
      return flowerBed(seed, true);
    case 'office_chair':
    case 'office_chair_front':
    case 'stool':
      return stump();
    case 'sofa':
      return hayBale(3, seed);
    case 'armchair':
    case 'beanbag':
      return hayBale(1, seed);
    case 'plant_small':
      return flowerPot(seed);
    case 'plant_tall':
      return tallSunflowers(seed);
    case 'bookshelf':
      return crateShelf(seed);
    case 'filing_cabinet':
      return barrel();
    case 'binder_shelf':
      return crates(seed);
    case 'printer':
      return wheelbarrow(seed);
    case 'trash_bin':
      return wateringCan();
    case 'water_cooler':
      return waterPump();
    case 'floor_lamp':
      return lanternPost();
    case 'meeting_table':
      return picnicTable(seed);
    case 'coffee_table':
      return crateTable(seed);
    case 'glass_partition':
      return fence(variant);
    default:
      return null;
  }
}

/**
 * Versão de fazenda de um móvel, ou null quando o kind fica como está (copa, banheiro, recepção, fliperama...).
 * Sem `front`: quem senta num toco ou fardo fica todo à mostra.
 */
export function renderFarmFurniture(kind: FurnitureKind, variant: string | undefined, seed: number): BufFurniture | null {
  const f = build(kind, variant, Math.abs(Math.floor(seed)) % 997);
  if (!f) return null;
  return { base: trim(f.base) };
}

/** Kinds que a fazenda redesenha (para testes e para quem precisa saber se há troca). */
export const FARM_KINDS: readonly FurnitureKind[] = [
  'desk', 'desk_back', 'office_chair', 'office_chair_front', 'stool', 'sofa', 'armchair', 'beanbag', 'plant_small', 'plant_tall',
  'bookshelf', 'filing_cabinet', 'binder_shelf', 'printer', 'trash_bin', 'water_cooler', 'floor_lamp', 'meeting_table', 'coffee_table',
  'glass_partition',
];

export type { BufSprite };
