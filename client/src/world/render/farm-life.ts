// Viața da fazenda: galinhas ciscando, um gato dormindo no feno, um cachorro na estrada de terra, cestos que enchem
// com o trabalho de cada agente, vaga-lumes à noite e orvalho de manhã. Só desenho: nada disso entra na simulação
// (colisões, caminhos e lugares dos agentes não mudam).
import { TILE } from '../../art/api';
import type { AreaVis, FurnVis } from './scene';

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

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type AnimalKind = 'chicken' | 'dog' | 'cat';

export interface Animal {
  kind: AnimalKind;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: 1 | -1;
  /** Até quando fica parado (ciscando / farejando), ms. */
  restUntil: number;
  speed: number;
  ph: number;
  area: string;
  rnd: () => number;
  /** Gato: em cima de qual móvel dorme. */
  on?: FurnVis;
}

interface Pt {
  x: number;
  y: number;
}

/** Pontos livres (centro dos tiles caminháveis) de uma área. */
function freePoints(vis: AreaVis): Pt[] {
  const out: Pt[] = [];
  const blocked = new Set<string>();
  for (const f of vis.furniture) {
    const tx = Math.floor(f.ax / TILE);
    const ty = Math.floor((f.ay - 1) / TILE);
    for (let dx = -2; dx <= 1; dx++) for (let dy = -1; dy <= 0; dy++) blocked.add(`${tx + dx},${ty + dy}`);
  }
  for (const r of vis.layout.walkable) {
    for (let ty = r.y; ty < r.y + r.h; ty++) {
      for (let tx = r.x; tx < r.x + r.w; tx++) {
        if (blocked.has(`${tx},${ty}`)) continue;
        out.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE - 3 });
      }
    }
  }
  return out;
}

export class FarmLife {
  private animals: Animal[] = [];
  private key = '';
  private points = new Map<string, Pt[]>();
  private last = 0;

  /** Recria os bichos quando o conjunto de áreas muda. */
  sync(areas: ReadonlyMap<string, AreaVis>): void {
    const key = [...areas.keys()].sort().join('|');
    if (key === this.key) return;
    this.key = key;
    const old = new Map(this.animals.map((a) => [`${a.area}:${a.kind}:${a.ph.toFixed(3)}`, a]));
    this.animals = [];
    this.points.clear();
    for (const vis of areas.values()) {
      const kind = vis.layout.kind;
      if (kind === 'restroom' || kind === 'reception') continue;
      const pts = freePoints(vis);
      this.points.set(vis.id, pts);
      if (!pts.length) continue;
      const r = rng(hashStr(vis.id));
      const add = (k: AnimalKind, speed: number) => {
        const p = pts[Math.floor(r() * pts.length)]!;
        const ph = r();
        const prev = old.get(`${vis.id}:${k}:${ph.toFixed(3)}`);
        this.animals.push(prev ?? { kind: k, x: p.x, y: p.y, tx: p.x, ty: p.y, dir: r() < 0.5 ? 1 : -1, restUntil: 0, speed, ph, area: vis.id, rnd: rng(hashStr(vis.id) + Math.floor(ph * 1e6)) });
      };
      if (kind === 'room') {
        const n = 1 + (hashStr(vis.id) % 3);
        for (let i = 0; i < n; i++) add('chicken', 9 + r() * 5);
      } else if (kind === 'corridor') {
        for (let i = 0; i < 4; i++) add('chicken', 9 + r() * 5);
        add('dog', 22);
      }
      // Gato dormindo no primeiro fardo de feno (sofá, poltrona ou pufe) da área.
      const bale = vis.furniture.find((f) => f.kind === 'sofa' || f.kind === 'armchair' || f.kind === 'beanbag');
      if (bale && (kind === 'lounge' || hashStr(vis.id) % 2 === 0)) {
        this.animals.push({ kind: 'cat', x: bale.ax + (bale.kind === 'sofa' ? 10 : 0), y: bale.ay - 8, tx: 0, ty: 0, dir: 1, restUntil: Infinity, speed: 0, ph: r(), area: vis.id, rnd: r, on: bale });
      }
    }
  }

  update(now: number): void {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    for (const a of this.animals) {
      if (a.kind === 'cat') continue;
      if (now < a.restUntil) continue;
      const dx = a.tx - a.x;
      const dy = a.ty - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) {
        // chegou: cisca / fareja um pouco e escolhe outro ponto por perto
        a.restUntil = now + 800 + a.rnd() * (a.kind === 'dog' ? 2500 : 3200);
        const pts = this.points.get(a.area) ?? [];
        const near = pts.filter((p) => Math.abs(p.x - a.x) < 80 && Math.abs(p.y - a.y) < 48);
        const pool = near.length > 2 ? near : pts;
        const p = pool[Math.floor(a.rnd() * pool.length)];
        if (p) {
          a.tx = p.x + (a.rnd() - 0.5) * 6;
          a.ty = p.y + (a.rnd() - 0.5) * 3;
        }
        continue;
      }
      const step = Math.min(d, a.speed * dt);
      a.x += (dx / d) * step;
      a.y += (dy / d) * step;
      if (Math.abs(dx) > 0.5) a.dir = dx > 0 ? 1 : -1;
    }
  }

  /** Para a ordenação por profundidade junto com móveis e pessoas. */
  list(): readonly Animal[] {
    return this.animals;
  }

  draw(ctx: CanvasRenderingContext2D, a: Animal, now: number): void {
    const x = Math.round(a.x);
    const y = Math.round(a.y);
    const moving = now >= a.restUntil && Math.hypot(a.tx - a.x, a.ty - a.y) > 1;
    const f = (c: string, px: number, py: number, w: number, h: number) => {
      ctx.fillStyle = c;
      ctx.fillRect(a.dir === 1 ? x + px : x - px - w + 1, y + py, w, h);
    };
    ctx.save();
    ctx.fillStyle = 'rgba(28,32,52,0.18)';
    if (a.kind !== 'cat') ctx.fillRect(x - 3, y, 7, 1);
    if (a.kind === 'chicken') {
      const peck = !moving && Math.floor(now / 260 + a.ph * 10) % 3 === 0;
      const step = moving && Math.floor(now / 140) % 2 === 0;
      f('#e0a43c', -1, -1, 1, 1 + (step ? 0 : 0));
      f('#e0a43c', 1, -1, 1, 1);
      f('#ffffff', -3, -6, 6, 5); // corpo
      f('#e9e4da', -3, -3, 5, 2);
      f('#d8d1c4', -4, -5, 2, 2); // rabo
      const hx = peck ? 3 : 2;
      const hy = peck ? -4 : -8;
      f('#ffffff', hx, hy, 3, 3); // cabeça
      f('#d94848', hx + 1, hy - 1, 2, 1); // crista
      f('#e0a43c', hx + 3, hy + 1, 1, 1); // bico
      f('#2b2b2b', hx + 1, hy + 1, 1, 1); // olho
    } else if (a.kind === 'dog') {
      const step = moving ? Math.floor(now / 120) % 2 : 0;
      const wag = Math.floor(now / 160) % 2;
      f('#6b4429', -5, -2, 1, 2 - step);
      f('#6b4429', -2, -2, 1, 2 - (1 - step));
      f('#6b4429', 2, -2, 1, 2 - step);
      f('#6b4429', 4, -2, 1, 2 - (1 - step));
      f('#9a6236', -6, -7, 12, 5); // corpo
      f('#b47a46', -5, -7, 10, 2);
      f('#9a6236', 4, -11, 5, 5); // cabeça
      f('#6b4429', 4, -11, 2, 3); // orelha
      f('#2b2b2b', 8, -9, 1, 1); // focinho
      f('#2b2b2b', 6, -10, 1, 1); // olho
      f('#9a6236', -8, wag ? -10 : -9, 2, 3); // rabo
    } else {
      // gato enrolado, respirando; de vez em quando um "z"
      const breathe = Math.floor(now / 900 + a.ph * 4) % 2;
      ctx.fillStyle = '#e08a3c';
      ctx.fillRect(x - 5, y - 4 - breathe, 10, 4 + breathe);
      ctx.fillRect(x - 4, y - 5 - breathe, 8, 1);
      ctx.fillStyle = '#f0a85a';
      ctx.fillRect(x - 3, y - 4 - breathe, 5, 1);
      ctx.fillStyle = '#b8632a';
      ctx.fillRect(x - 2, y - 2, 1, 1);
      ctx.fillRect(x + 1, y - 3, 1, 1);
      ctx.fillStyle = '#e08a3c';
      ctx.fillRect(x + 3, y - 7 - breathe, 4, 3); // cabeça
      ctx.fillRect(x + 3, y - 8 - breathe, 1, 1); // orelhas
      ctx.fillRect(x + 6, y - 8 - breathe, 1, 1);
      ctx.fillStyle = '#5a3b26';
      ctx.fillRect(x + 4, y - 6 - breathe, 1, 1);
      ctx.fillRect(x + 6, y - 6 - breathe, 1, 1);
      const zph = ((now / 2600 + a.ph) % 1 + 1) % 1;
      if (zph < 0.5) {
        ctx.globalAlpha = 1 - zph * 2;
        ctx.fillStyle = '#ffffff';
        const zx = x + 8 + Math.round(zph * 8);
        const zy = y - 12 - Math.round(zph * 10);
        ctx.fillRect(zx, zy, 3, 1);
        ctx.fillRect(zx + 1, zy + 1, 1, 1);
        ctx.fillRect(zx, zy + 2, 3, 1);
      }
    }
    ctx.restore();
  }

  /** Vaga-lumes sobre o campo das salas (k = 0..1, força da noite). */
  drawFireflies(ctx: CanvasRenderingContext2D, areas: ReadonlyMap<string, AreaVis>, now: number, k: number): void {
    ctx.save();
    for (const vis of areas.values()) {
      if (vis.layout.kind !== 'room' && vis.layout.kind !== 'corridor') continue;
      const p = vis.px;
      const r = rng(hashStr(vis.id) + 77);
      const n = vis.layout.kind === 'room' ? 7 : 10;
      for (let i = 0; i < n; i++) {
        const bx = p.x + 8 + r() * (p.w - 16);
        const by = p.y + 30 + r() * (p.h - 40);
        const ph = r() * Math.PI * 2;
        const x = bx + Math.sin(now / 1700 + ph) * 10;
        const y = by + Math.cos(now / 2300 + ph * 1.3) * 6;
        const blink = 0.5 + 0.5 * Math.sin(now / (500 + r() * 400) + ph);
        if (blink < 0.25) continue;
        ctx.globalAlpha = k * blink * 0.35;
        ctx.fillStyle = '#d8ff7a';
        ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
        ctx.globalAlpha = k * blink;
        ctx.fillStyle = '#f4ffb8';
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
    ctx.restore();
  }

  /** Orvalho: brilhinhos na grama das salas nas primeiras horas da manhã (k = 0..1). */
  drawDew(ctx: CanvasRenderingContext2D, areas: ReadonlyMap<string, AreaVis>, now: number, k: number): void {
    ctx.save();
    for (const vis of areas.values()) {
      if (vis.layout.kind !== 'room') continue;
      const p = vis.px;
      const r = rng(hashStr(vis.id) + 5);
      for (let i = 0; i < 26; i++) {
        const x = Math.round(p.x + 6 + r() * (p.w - 12));
        const y = Math.round(p.y + 36 + r() * (p.h - 44));
        const tw = Math.sin(now / 420 + i * 1.7);
        if (tw < 0.55) continue;
        ctx.globalAlpha = k * (tw - 0.55) * 2;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, 1, 1);
        ctx.globalAlpha *= 0.5;
        ctx.fillStyle = '#cfefff';
        ctx.fillRect(x - 1, y, 1, 1);
        ctx.fillRect(x + 1, y, 1, 1);
      }
    }
    ctx.restore();
  }
}

/** Nível do cesto (0..4) pelo trabalho do agente: chamadas de ferramenta da sessão. */
export function basketLevel(toolCalls: number | undefined): number {
  const n = toolCalls ?? 0;
  return n >= 120 ? 4 : n >= 50 ? 3 : n >= 15 ? 2 : n >= 1 ? 1 : 0;
}

const BASKET_FLOWERS = ['#d94848', '#e46aa6', '#f2c443', '#8d63c9', '#ffffff', '#ec8a3c', '#5b8fe0'];

/** Cesto de vime no canto do canteiro, com as flores colhidas (x, y = canto superior esquerdo). */
export function drawBasket(ctx: CanvasRenderingContext2D, x: number, y: number, level: number, seed: number): void {
  x = Math.round(x);
  y = Math.round(y);
  ctx.save();
  // flores (atrás da borda da frente)
  const heap = [0, 2, 4, 7, 10][Math.max(0, Math.min(4, level))]!;
  for (let i = 0; i < heap; i++) {
    const fx = x + 1 + ((i * 3 + seed) % 6);
    const fy = y - 1 - Math.floor(i / 3) - ((i + seed) % 2);
    ctx.fillStyle = '#4f9443';
    ctx.fillRect(fx, fy + 1, 1, 1);
    ctx.fillStyle = BASKET_FLOWERS[(seed + i * 5) % BASKET_FLOWERS.length]!;
    ctx.fillRect(fx, fy, 1, 1);
    if (i % 3 === 0) ctx.fillRect(fx + 1, fy, 1, 1);
  }
  // alça
  ctx.fillStyle = '#9a6a35';
  ctx.fillRect(x, y - 5, 1, 5);
  ctx.fillRect(x + 7, y - 5, 1, 5);
  ctx.fillRect(x + 1, y - 6, 6, 1);
  // corpo trançado
  ctx.fillStyle = '#c08a4a';
  ctx.fillRect(x, y, 8, 6);
  ctx.fillStyle = '#e0b071';
  ctx.fillRect(x, y, 8, 1);
  ctx.fillStyle = '#9a6a35';
  for (let i = 0; i < 4; i++) ctx.fillRect(x + 1 + i * 2, y + 1, 1, 5);
  ctx.fillRect(x, y + 3, 8, 1);
  ctx.fillStyle = 'rgba(28,32,52,0.22)';
  ctx.fillRect(x, y + 6, 8, 1);
  ctx.restore();
}
