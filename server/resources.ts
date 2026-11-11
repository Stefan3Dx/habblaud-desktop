// Recursos do computador (GET /api/resources): CPU e memória do PC, a GPU NVIDIA quando existe, e quanto cada agente
// do Claude Code consome — o processo do `claude` mais tudo o que ele abriu (shells, builds, servidores de teste).
// Amostrado só quando alguém pede (com cache curto), sem dependências: PowerShell/CIM no Windows, `ps` no resto.
import { execFile } from 'node:child_process';
import os from 'node:os';
import type { AgentInfo } from '../shared/types';

export interface GpuInfo {
  name: string;
  /** 0–100 */
  util: number;
  memUsed: number;
  memTotal: number;
  temp?: number;
}

export interface AgentResources {
  /** % do PC inteiro (como o Gerenciador de Tarefas): 100 = todos os núcleos ocupados. */
  cpu: number;
  /** Bytes (working set / RSS) do processo e dos filhos. */
  mem: number;
  /** Processos na árvore (o próprio claude + filhos). */
  procs: number;
  /** O agente roda dentro do processo de outro (subagente): os números são os do principal. */
  shared?: boolean;
}

export interface ResourcesSnapshot {
  at: number;
  system: { cpu: number; cores: number; memUsed: number; memTotal: number; gpu?: GpuInfo; host: string };
  agents: Record<string, AgentResources>;
}

export interface Proc {
  pid: number;
  ppid: number;
  mem: number;
  /** Tempo de CPU acumulado (ms). */
  cpuMs: number;
}

function run(file: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

/** "[[dd-]hh:]mm:ss[.cc]" do ps -> ms. */
export function parseCpuTime(s: string): number {
  let days = 0;
  let rest = s.trim();
  const dash = rest.indexOf('-');
  if (dash > 0) {
    days = Number(rest.slice(0, dash)) || 0;
    rest = rest.slice(dash + 1);
  }
  const parts = rest.split(':').map(Number);
  let sec = 0;
  for (const p of parts) sec = sec * 60 + (Number.isFinite(p) ? p : 0);
  return (days * 86400 + sec) * 1000;
}

/** Saída do `ps -A -o pid=,ppid=,rss=,time=` -> processos. */
export function parsePs(out: string): Proc[] {
  const list: Proc[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)/.exec(line);
    if (m) list.push({ pid: Number(m[1]), ppid: Number(m[2]), mem: Number(m[3]) * 1024, cpuMs: parseCpuTime(m[4]!) });
  }
  return list;
}

/** CSV do Win32_Process (ProcessId, ParentProcessId, WorkingSetSize, KernelModeTime, UserModeTime; tempos em 100 ns). */
export function parseWinCsv(out: string): Proc[] {
  const list: Proc[] = [];
  for (const line of out.split(/\r?\n/)) {
    const cells = line.split(',').map((c) => c.replace(/^"|"$/g, ''));
    if (cells.length < 5 || !/^\d+$/.test(cells[0]!)) continue;
    const [pid, ppid, ws, k, u] = cells.map((c) => Number(c) || 0);
    list.push({ pid: pid!, ppid: ppid!, mem: ws!, cpuMs: (k! + u!) / 10_000 });
  }
  return list;
}

async function listProcesses(): Promise<Proc[]> {
  if (process.platform === 'win32') {
    const ps =
      "Get-CimInstance Win32_Process | ForEach-Object { '{0},{1},{2},{3},{4}' -f $_.ProcessId,$_.ParentProcessId,$_.WorkingSetSize,$_.KernelModeTime,$_.UserModeTime }";
    return parseWinCsv(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 12_000));
  }
  return parsePs(await run('ps', ['-A', '-o', 'pid=,ppid=,rss=,time=']));
}

let gpuMissing = false;
async function readGpu(): Promise<GpuInfo | undefined> {
  if (gpuMissing) return undefined;
  const out = await run('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu', '--format=csv,noheader,nounits'], 4000);
  const line = out.split(/\r?\n/).find((l) => l.trim());
  if (!line) {
    gpuMissing = true;
    return undefined;
  }
  const [name, util, used, total, temp] = line.split(',').map((s) => s.trim());
  return { name: name || 'GPU', util: Number(util) || 0, memUsed: (Number(used) || 0) * 1024 * 1024, memTotal: (Number(total) || 0) * 1024 * 1024, temp: Number(temp) || undefined };
}

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/** pid do processo do `claude` de um agente principal ("<conta>:<pid>"); undefined para os outros. */
export function agentPid(a: Pick<AgentInfo, 'id' | 'kind' | 'provider'>): number | undefined {
  if (a.kind !== 'main' || (a.provider && a.provider !== 'claude')) return undefined;
  const m = /:(\d+)$/.exec(a.id);
  return m ? Number(m[1]) : undefined;
}

/** Soma o processo e todos os descendentes. */
export function treeTotals(procs: readonly Proc[], root: number): { mem: number; cpuMs: number; procs: number; pids: number[] } {
  const kids = new Map<number, number[]>();
  for (const p of procs) {
    if (p.pid === p.ppid) continue;
    const l = kids.get(p.ppid);
    if (l) l.push(p.pid);
    else kids.set(p.ppid, [p.pid]);
  }
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  if (!byPid.has(root)) return { mem: 0, cpuMs: 0, procs: 0, pids: [] };
  const seen = new Set<number>();
  const stack = [root];
  let mem = 0;
  let cpuMs = 0;
  while (stack.length) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const p = byPid.get(pid);
    if (p) {
      mem += p.mem;
      cpuMs += p.cpuMs;
    }
    for (const k of kids.get(pid) ?? []) stack.push(k);
  }
  return { mem, cpuMs, procs: seen.size, pids: [...seen] };
}

/** Números plausíveis e estáveis para o modo demonstração (não há processos de verdade). */
function demoAgents(agents: readonly AgentInfo[], now: number): Record<string, AgentResources> {
  const out: Record<string, AgentResources> = {};
  for (const a of agents) {
    const wave = (Math.sin(now / 4000 + (a.seed % 100)) + 1) / 2;
    const busy = a.status === 'working' ? 1 : a.status === 'waiting' ? 0.2 : 0.05;
    out[a.id] = {
      cpu: Math.round((0.4 + busy * (2 + wave * 9)) * 10) / 10,
      mem: Math.round((180 + (a.seed % 220) + busy * wave * 400) * 1024 * 1024),
      procs: 1 + Math.round(busy * wave * 4),
      shared: a.kind === 'sub' || undefined,
    };
  }
  return out;
}

export class ResourceMonitor {
  private last?: ResourcesSnapshot;
  private pending?: Promise<ResourcesSnapshot>;
  private prevCpu = cpuTimes();
  private prevProcCpu = new Map<number, number>();
  private prevAt = Date.now();

  constructor(
    private readonly agents: () => readonly AgentInfo[],
    private readonly opts: { minIntervalMs?: number; listProcesses?: () => Promise<Proc[]> } = {},
  ) {}

  /** Amostra (no máx. uma a cada ~2 s; pedidos simultâneos dividem a mesma). */
  get(): Promise<ResourcesSnapshot> {
    const min = this.opts.minIntervalMs ?? 2000;
    if (this.last && Date.now() - this.last.at < min) return Promise.resolve(this.last);
    this.pending ??= this.sample().finally(() => (this.pending = undefined));
    return this.pending;
  }

  private async sample(): Promise<ResourcesSnapshot> {
    const now = Date.now();
    const agents = this.agents();
    const cur = cpuTimes();
    const dTotal = cur.total - this.prevCpu.total;
    const cpu = dTotal > 0 ? Math.max(0, Math.min(100, (1 - (cur.idle - this.prevCpu.idle) / dTotal) * 100)) : (this.last?.system.cpu ?? 0);
    this.prevCpu = cur;
    const cores = os.cpus().length || 1;
    const real = agents.some((a) => !a.id.startsWith('demo:'));
    const [procs, gpu] = await Promise.all([real ? (this.opts.listProcesses ?? listProcesses)() : Promise.resolve([] as Proc[]), readGpu()]);

    const byAgent: Record<string, AgentResources> = {};
    {
      const wall = Math.max(1, now - this.prevAt);
      const nextProcCpu = new Map<number, number>();
      for (const p of procs) nextProcCpu.set(p.pid, p.cpuMs);
      const pidOf = new Map<string, number>();
      for (const a of agents) {
        const pid = agentPid(a);
        if (pid) pidOf.set(a.id, pid);
      }
      for (const a of agents) {
        const pid = pidOf.get(a.id);
        if (!pid) continue;
        const t = treeTotals(procs, pid);
        if (!t.procs) continue;
        // CPU: só o que a árvore gastou desde a amostra anterior (processos novos contam do zero).
        let used = 0;
        for (const p of t.pids) {
          const before = this.prevProcCpu.get(p);
          const nowMs = nextProcCpu.get(p) ?? 0;
          used += before === undefined ? 0 : Math.max(0, nowMs - before);
        }
        byAgent[a.id] = { cpu: Math.round(Math.min(100, (used / wall / cores) * 100) * 10) / 10, mem: t.mem, procs: t.procs };
      }
      // subagentes: rodam dentro do processo do principal
      for (const a of agents) {
        if (byAgent[a.id] || !a.parentId) continue;
        let p: AgentInfo | undefined = agents.find((x) => x.id === a.parentId);
        while (p && !byAgent[p.id] && p.parentId) p = agents.find((x) => x.id === p!.parentId);
        if (p && byAgent[p.id]) byAgent[a.id] = { ...byAgent[p.id]!, shared: true };
      }
      this.prevProcCpu = nextProcCpu;
    }
    // modo demonstração: os agentes simulados não têm processo
    const demo = demoAgents(agents.filter((a) => a.id.startsWith('demo:') && !byAgent[a.id]), now);
    Object.assign(byAgent, demo);
    this.prevAt = now;
    this.last = {
      at: now,
      system: { cpu: Math.round(cpu * 10) / 10, cores, memUsed: os.totalmem() - os.freemem(), memTotal: os.totalmem(), gpu, host: os.hostname() },
      agents: byAgent,
    };
    return this.last;
  }
}
