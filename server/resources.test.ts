import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../shared/types';
import { agentPid, parseCpuTime, parsePs, parseWinCsv, ResourceMonitor, treeTotals, type Proc } from './resources';

const agent = (id: string, extra: Partial<AgentInfo> = {}): AgentInfo =>
  ({ id, kind: 'main', status: 'working', seed: 1, name: id, roomId: 'r', look: 'f', role: 'Agente principal', sessionId: 's', account: '.claude', recent: [], tasks: [], startedAt: 0, lastEventAt: 0, statusSince: 0, stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 }, ...extra }) as AgentInfo;

describe('recursos do computador', () => {
  it('lê o tempo de CPU do ps', () => {
    expect(parseCpuTime('00:01:05')).toBe(65_000);
    expect(parseCpuTime('1-02:00:00')).toBe((86400 + 7200) * 1000);
    expect(parseCpuTime('3:07.50')).toBe(187_500);
  });

  it('lê ps e o CSV do Windows', () => {
    expect(parsePs('  10     1  2048 00:00:02\n  11    10  1024 00:00:01\n')).toEqual([
      { pid: 10, ppid: 1, mem: 2048 * 1024, cpuMs: 2000 },
      { pid: 11, ppid: 10, mem: 1024 * 1024, cpuMs: 1000 },
    ]);
    expect(parseWinCsv('4242,100,52428800,10000000,20000000\r\nlixo\r\n')).toEqual([{ pid: 4242, ppid: 100, mem: 52428800, cpuMs: 3000 }]);
  });

  it('soma o processo do claude e os filhos (e só eles)', () => {
    const procs: Proc[] = [
      { pid: 1, ppid: 0, mem: 999, cpuMs: 999 },
      { pid: 10, ppid: 1, mem: 100, cpuMs: 10 },
      { pid: 11, ppid: 10, mem: 50, cpuMs: 5 },
      { pid: 12, ppid: 11, mem: 25, cpuMs: 1 },
      { pid: 20, ppid: 1, mem: 70, cpuMs: 7 },
    ];
    expect(treeTotals(procs, 10)).toMatchObject({ mem: 175, cpuMs: 16, procs: 3 });
    expect(treeTotals(procs, 99).procs).toBe(0);
  });

  it('pid só para o principal do Claude Code', () => {
    expect(agentPid({ id: '.claude:4242', kind: 'main' })).toBe(4242);
    expect(agentPid({ id: 'sess:agent-1', kind: 'sub' })).toBeUndefined();
    expect(agentPid({ id: '.codex:abc', kind: 'main', provider: 'codex' })).toBeUndefined();
  });

  it('CPU pela diferença entre amostras; o subagente herda os números do principal', async () => {
    let cpu = 0;
    const procs = (): Promise<Proc[]> => Promise.resolve([
      { pid: 4242, ppid: 1, mem: 300 * 1024 * 1024, cpuMs: cpu },
      { pid: 5000, ppid: 4242, mem: 100 * 1024 * 1024, cpuMs: cpu / 2 },
    ]);
    const agents = [agent('.claude:4242'), agent('s:sub', { kind: 'sub', parentId: '.claude:4242' }), agent('demo:x-1')];
    const mon = new ResourceMonitor(() => agents, { minIntervalMs: 0, listProcesses: procs });
    const first = await mon.get();
    expect(first.agents['.claude:4242']).toMatchObject({ mem: 400 * 1024 * 1024, procs: 2, cpu: 0 });
    cpu = 60_000;
    await new Promise((r) => setTimeout(r, 20));
    const second = await mon.get();
    expect(second.agents['.claude:4242']!.cpu).toBeGreaterThan(0);
    expect(second.agents['s:sub']).toMatchObject({ shared: true, mem: 400 * 1024 * 1024 });
    expect(second.agents['demo:x-1']!.mem).toBeGreaterThan(0);
    expect(second.system.memTotal).toBeGreaterThan(0);
  });
});
