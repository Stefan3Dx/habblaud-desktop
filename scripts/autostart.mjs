// Hook SessionStart: pornește Habblaud dacă nu rulează deja. Nu scrie nimic pe stdout (ar intra în context).
// Dacă e instalat Habblaud Desktop îl deschide pe el; altfel pornește
// serverul ascuns. Instalare: npm run autostart:install
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number.parseInt(process.env.HABBLAUD_PORT ?? '', 10) || 4747;
const STATE = join(homedir(), '.habblaud');
const LOCK = join(STATE, 'autostart.lock');

async function isUp() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 800);
    await fetch(`http://127.0.0.1:${PORT}/api/mod/summary`, { signal: ctl.signal });
    clearTimeout(t);
    return true;
  } catch {
    return false;
  }
}

/** Mediul curat: fără variabilele sesiunii Claude Code curente (altfel agenții noi ar crede că sunt imbricați). */
export function cleanEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'CLAUDE_PROJECT_DIR' || k === 'CLAUDE_PLUGIN_ROOT' || k === 'CLAUDE_ENV_FILE') continue;
    out[k] = v;
  }
  out.HABBLAUD_PTY ??= '1';
  out.HABBLAUD_LANG ??= 'ro';
  return out;
}

export function desktopExe() {
  // Habblaud Desktop instalat (NSIS, per utilizator).
  const p = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'Habblaud', 'Habblaud.exe');
  return existsSync(p) ? p : undefined;
}

async function main() {
  if (process.env.HABBLAUD_AUTOSTART === '0') return;
  if (await isUp()) return;
  mkdirSync(STATE, { recursive: true });
  // Două sesiuni pornite deodată: doar prima lansează.
  try {
    if (Date.now() - statSync(LOCK).mtimeMs < 20_000) return;
  } catch {}
  writeFileSync(LOCK, String(process.pid));

  const env = cleanEnv(process.env);
  const exe = process.env.HABBLAUD_AUTOSTART === 'server' ? undefined : desktopExe();
  if (exe) {
    spawn(exe, [], { cwd: dirname(exe), env, detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const server = join(ROOT, 'dist', 'server', 'index.js');
  if (!existsSync(server)) return;
  const log = openSync(join(STATE, 'server.log'), 'a');
  spawn(process.execPath, [server], { cwd: ROOT, env, detached: true, stdio: ['ignore', log, log], windowsHide: true }).unref();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {}).finally(() => process.exit(0));
}
