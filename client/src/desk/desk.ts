// Vista "Escritório simples" (?view=desk): só os agentes, cada um na sua mesa, e quanto do computador eles usam.
// Sem prédio, corredores, copa nem cidade: uma grade de mesas em pixel art com CPU, memória e o que cada um faz,
// e no topo o PC inteiro (CPU, RAM, GPU) e o uso do plano. Os números vêm de GET /api/resources.
import * as art from '../art';
import type { Pose, Sprite } from '../art/api';
import { getLocale, tr } from '../../../shared/i18n';
import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../../shared/types';
import type { OfficeStore } from '../net/store';
import { CSS } from './style';

interface AgentResources {
  cpu: number;
  mem: number;
  procs: number;
  shared?: boolean;
}

interface Resources {
  at: number;
  system: { cpu: number; cores: number; memUsed: number; memTotal: number; host: string; gpu?: { name: string; util: number; memUsed: number; memTotal: number; temp?: number } };
  agents: Record<string, AgentResources>;
}

const W = 64;
const H = 72;
const SCALE = 2;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

export function fmtDuration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return tr('agora');
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

function fmtTokens(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
}

/** Ordem das mesas: quem precisa de você, quem trabalha, quem espera um shell, o resto. */
export function deskOrder(a: AgentInfo): number {
  return a.status === 'waiting' ? 0 : a.status === 'working' ? 1 : a.status === 'shell' ? 2 : a.status === 'idle' ? 3 : 4;
}

const STATUS_LABEL = (): Record<AgentInfo['status'], string> => ({
  working: tr('trabalhando'),
  waiting: tr('precisa de você'),
  shell: tr('esperando um comando'),
  idle: tr('parado'),
  done: tr('terminou'),
  offline: tr('desconectado'),
});

function poseFor(a: AgentInfo): { pose: Pose; held?: 'popcorn' } {
  if (a.status === 'waiting') return { pose: 'raise_hand' };
  if (a.status === 'working') return { pose: 'type' };
  if (a.status === 'shell') return { pose: 'wait', held: 'popcorn' };
  return { pose: 'sleep' };
}

/** Uma mesa: cena em pixel art + cartão com os números. */
class Desk {
  readonly root = el('article', 'desk');
  private canvas = el('canvas', 'scene');
  private ctx: CanvasRenderingContext2D;
  private bg?: HTMLCanvasElement;
  private name = el('div', 'name');
  private project = el('div', 'project');
  private status = el('span', 'status');
  private activity = el('div', 'activity');
  private cpuBar = el('i');
  private cpuText = el('b');
  private memBar = el('i');
  private memText = el('b');
  private meta = el('div', 'meta');
  private agent!: AgentInfo;
  private room?: RoomInfo;

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.style.width = `${W * SCALE}px`;
    this.canvas.style.height = `${H * SCALE}px`;
    this.ctx = this.canvas.getContext('2d')!;
    const info = el('div', 'info');
    const head = el('div', 'head');
    head.append(this.name, this.status);
    const bars = el('div', 'bars');
    const row = (label: string, bar: HTMLElement, val: HTMLElement) => {
      const r = el('div', 'bar-row');
      const track = el('span', 'track');
      track.appendChild(bar);
      r.append(el('span', 'lbl', label), track, val);
      return r;
    };
    bars.append(row('CPU', this.cpuBar, this.cpuText), row(tr('Memória'), this.memBar, this.memText));
    info.append(head, this.project, this.activity, bars, this.meta);
    this.root.append(this.canvas, info);
  }

  update(a: AgentInfo, room: RoomInfo | undefined, res: AgentResources | undefined, memTotal: number): void {
    const roomChanged = this.room?.id !== room?.id;
    this.agent = a;
    this.room = room;
    if (roomChanged || !this.bg) this.bg = undefined;
    this.root.dataset.status = a.status;
    this.root.classList.toggle('sub', a.kind === 'sub');
    this.name.textContent = a.name;
    this.name.title = a.title || a.name;
    this.project.textContent = room ? `${room.name}${a.kind === 'sub' ? ` · ${a.role}` : ''}` : a.role;
    this.project.title = room?.path ?? '';
    this.status.textContent = STATUS_LABEL()[a.status];
    const act = a.status === 'waiting' && a.waitingFor ? `⏳ ${a.waitingFor}` : a.activity ? `${a.activity.icon} ${a.activity.text}` : a.title || '';
    this.activity.textContent = act;
    this.activity.title = a.activity?.detail || act;
    if (res) {
      const cpu = Math.max(0, res.cpu);
      this.cpuBar.style.width = `${Math.min(100, cpu * 4)}%`; // escala: 25% do PC já enche a barra
      this.cpuBar.className = cpu >= 20 ? 'hi' : cpu >= 8 ? 'mid' : '';
      this.cpuText.textContent = `${cpu.toFixed(cpu < 10 ? 1 : 0)}%`;
      const memPct = memTotal ? (res.mem / memTotal) * 100 : 0;
      this.memBar.style.width = `${Math.min(100, memPct * 8)}%`;
      this.memBar.className = memPct >= 8 ? 'hi' : memPct >= 4 ? 'mid' : '';
      this.memText.textContent = fmtBytes(res.mem);
      this.root.classList.toggle('shared', !!res.shared);
      this.cpuText.title = res.shared ? tr('Subagente: roda dentro do processo do agente principal (mesmos números).') : `${res.procs} ${tr('processos')}`;
    } else {
      this.cpuBar.style.width = '0';
      this.memBar.style.width = '0';
      this.cpuText.textContent = '—';
      this.memText.textContent = '—';
      this.cpuText.title = tr('Sem processo local para medir (ex.: Codex ou outro computador).');
    }
    const s = a.stats;
    const parts = [`⏱ ${fmtDuration(Date.now() - a.startedAt)}`, `🔧 ${s.toolCalls}`, `↑ ${fmtTokens(s.tokensIn)} ↓ ${fmtTokens(s.tokensOut)}`];
    if (s.linesAdded || s.linesRemoved) parts.push(`+${s.linesAdded ?? 0} −${s.linesRemoved ?? 0}`);
    this.meta.textContent = parts.join('   ');
    this.meta.title = `${tr('Tempo de sessão')} · ${tr('chamadas de ferramenta')} · ${tr('tokens de entrada / saída')}`;
  }

  /** Fundo (parede, piso, cadeira) em cache: muda só com a sala. */
  private background(): HTMLCanvasElement {
    if (this.bg) return this.bg;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    const seed = this.room?.seed ?? this.agent.seed;
    const theme = art.roomTheme(seed);
    art.drawFloor(ctx, 'carpet', 0, 32, W, H - 32, { seed, tint: theme.carpet, tint2: theme.carpet2 });
    art.drawWallFace(ctx, 0, 0, W, theme.wall);
    const chair = art.furnitureSprites('office_chair_front', theme.chairVariant, 0, { seed });
    draw(ctx, chair.base, 32, 48);
    this.bg = c;
    return c;
  }

  draw(now: number): void {
    const a = this.agent;
    if (!a) return;
    const { ctx } = this;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.background(), 0, 0);
    const seed = this.room?.seed ?? a.seed;
    const theme = art.roomTheme(seed);
    // personagem sentado, de frente
    const { pose, held } = poseFor(a);
    const n = art.poseFrameCount(pose);
    const frame = Math.floor((now + (a.seed % 997) * 13) / art.poseFrameDuration(pose)) % n;
    const appearance = art.appearanceFromSeed(a.seed, { look: a.look, sub: a.kind === 'sub', parts: a.parts });
    const sprite = art.characterSprite({ appearance, dir: 'down', pose, frame, held, seated: true });
    draw(ctx, sprite, 32, 45);
    // mesa na frente (vemos a traseira do monitor)
    const desk = art.furnitureSprites('desk_back', theme.deskVariant, 0, { seed });
    draw(ctx, desk.base, 32, 64);
    // ícone sobre a cabeça
    const icon = a.status === 'waiting' ? 'alert' : a.status === 'shell' ? (Math.floor(now / 600) % 2 ? 'hourglass' : 'hourglass_flip') : a.status === 'idle' ? 'zzz' : undefined;
    if (icon) {
      const s = art.iconSprite(icon);
      const bob = Math.round(Math.sin(now / 300) * 1.5);
      draw(ctx, s, 32, 14 + bob);
    }
  }
}

function draw(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number): void {
  ctx.drawImage(s.canvas, Math.round(x - s.ax), Math.round(y - s.ay));
}

function meter(label: string): { root: HTMLElement; set: (pct: number, text: string, title?: string) => void } {
  const root = el('div', 'meter');
  const top = el('div', 'mtop');
  const val = el('b');
  top.append(el('span', '', label), val);
  const track = el('div', 'track');
  const fill = el('i');
  track.appendChild(fill);
  root.append(top, track);
  return {
    root,
    set(pct, text, title) {
      fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      fill.className = pct >= 85 ? 'hi' : pct >= 60 ? 'mid' : '';
      val.textContent = text;
      root.title = title ?? '';
    },
  };
}

export function startDesk(store: OfficeStore, root: HTMLElement): void {
  document.documentElement.lang = getLocale();
  document.body.classList.add('desk-mode');
  const style = el('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  root.textContent = '';
  const app = el('div', 'desk-app');
  const bar = el('header', 'pc');
  const title = el('div', 'title');
  title.append(el('strong', '', 'Habblaud'), el('span', 'host', ''));
  const cpu = meter('CPU');
  const ram = meter('RAM');
  const gpu = meter('GPU');
  const vram = meter('VRAM');
  gpu.root.hidden = true;
  vram.root.hidden = true;
  const plan = el('div', 'plan');
  const full = el('a', 'full', tr('Prédio completo'));
  full.href = `${location.pathname}?view=office`;
  full.title = tr('Volta para o escritório completo (prédio, salas e corredores)');
  bar.append(title, cpu.root, ram.root, gpu.root, vram.root, plan, full);
  const counts = el('div', 'counts');
  const grid = el('main', 'grid');
  const empty = el('div', 'empty', tr('Nenhum agente aberto. Quando você abrir o Claude Code, ele senta numa mesa aqui.'));
  app.append(bar, counts, grid, empty);
  root.appendChild(app);

  const desks = new Map<string, Desk>();
  let snap: OfficeSnapshot | undefined;
  let res: Resources | undefined;

  const render = () => {
    if (!snap) return;
    const rooms = new Map(snap.rooms.map((r) => [r.id, r]));
    const agents = snap.agents.filter((a) => a.status !== 'offline' && a.status !== 'done').sort((x, y) => deskOrder(x) - deskOrder(y) || x.startedAt - y.startedAt);
    const seen = new Set<string>();
    let i = 0;
    for (const a of agents) {
      seen.add(a.id);
      let d = desks.get(a.id);
      if (!d) {
        d = new Desk();
        desks.set(a.id, d);
      }
      d.update(a, rooms.get(a.roomId), res?.agents[a.id], res?.system.memTotal ?? 0);
      if (grid.children[i] !== d.root) grid.insertBefore(d.root, grid.children[i] ?? null);
      i++;
    }
    for (const [id, d] of desks) {
      if (seen.has(id)) continue;
      d.root.remove();
      desks.delete(id);
    }
    empty.hidden = agents.length > 0;
    const working = agents.filter((a) => a.status === 'working').length;
    const waiting = agents.filter((a) => a.status === 'waiting').length;
    counts.textContent = '';
    const chip = (n: number, label: string, cls: string) => {
      const c = el('span', `chip ${cls}`);
      c.append(el('b', '', String(n)), document.createTextNode(` ${label}`));
      return c;
    };
    counts.append(chip(agents.length, tr('agentes'), ''), chip(working, tr('trabalhando'), 'working'), chip(waiting, tr('precisam de você'), waiting ? 'waiting' : ''));
    // plano (5 h / semana) da primeira conta com números
    plan.textContent = '';
    for (const acc of snap.accounts) {
      const u = acc.usage;
      if (!u?.fiveHour && !u?.sevenDay) continue;
      const box = el('div', 'acc');
      box.title = acc.name;
      if (u.fiveHour) box.appendChild(planRow('5h', u.fiveHour.utilization));
      if (u.sevenDay) box.appendChild(planRow(tr('Sem.'), u.sevenDay.utilization));
      plan.appendChild(box);
      if (plan.children.length >= 2) break;
    }
  };

  const renderPc = () => {
    if (!res) return;
    const s = res.system;
    cpu.set(s.cpu, `${Math.round(s.cpu)}%`, `${s.cores} ${tr('núcleos')}`);
    ram.set((s.memUsed / s.memTotal) * 100, `${fmtBytes(s.memUsed)} / ${fmtBytes(s.memTotal)}`);
    (title.lastChild as HTMLElement).textContent = s.host;
    if (s.gpu) {
      gpu.root.hidden = false;
      vram.root.hidden = false;
      gpu.set(s.gpu.util, `${Math.round(s.gpu.util)}%${s.gpu.temp ? ` · ${s.gpu.temp}°C` : ''}`, s.gpu.name);
      vram.set((s.gpu.memUsed / s.gpu.memTotal) * 100, `${fmtBytes(s.gpu.memUsed)} / ${fmtBytes(s.gpu.memTotal)}`, s.gpu.name);
    }
  };

  store.on('snapshot', (s) => {
    snap = s;
    render();
  });
  const poll = async () => {
    try {
      const r = await fetch('/api/resources', { cache: 'no-store' });
      if (r.ok) {
        res = (await r.json()) as Resources;
        renderPc();
        render();
      }
    } catch {
      /* servidor reiniciando: tenta de novo no próximo ciclo */
    }
  };
  void poll();
  setInterval(() => {
    if (!document.hidden) void poll();
  }, 2500);

  const loop = (t: number) => {
    for (const d of desks.values()) d.draw(t);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function planRow(label: string, pct: number): HTMLElement {
  const r = el('div', 'prow');
  const track = el('span', 'track');
  const fill = el('i', pct >= 85 ? 'hi' : pct >= 60 ? 'mid' : '');
  fill.style.width = `${Math.min(100, pct)}%`;
  track.appendChild(fill);
  r.append(el('span', 'lbl', label), track, el('b', '', `${Math.round(pct)}%`));
  return r;
}
