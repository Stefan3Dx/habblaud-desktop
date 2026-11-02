// Tot ce îi trebuie aplicației, verificat și instalat în fundal (PowerShell ascuns):
// Claude Code, Git for Windows, autentificarea și mod-ul Habblaud în Claude Code.
const { app } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { IS_WIN, which, firstExisting, cleanEnv, claudeConfigDirs } = require('./util');
const server = require('./server');

function findClaude() {
  const home = os.homedir();
  return firstExisting([
    process.env.HABBLAUD_CLAUDE,
    IS_WIN ? path.join(home, '.local', 'bin', 'claude.exe') : path.join(home, '.local', 'bin', 'claude'),
    which('claude'),
    IS_WIN ? path.join(process.env.APPDATA || '', 'npm', 'claude.cmd') : undefined,
    IS_WIN ? undefined : '/usr/local/bin/claude',
    IS_WIN ? undefined : '/opt/homebrew/bin/claude',
  ]);
}

function findGit() {
  if (!IS_WIN) return which('git') || '/usr/bin/git';
  return firstExisting([process.env.CLAUDE_CODE_GIT_BASH_PATH, which('git'), 'C:\\Program Files\\Git\\cmd\\git.exe', path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe')]);
}

function loggedIn() {
  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) return true;
  for (const dir of claudeConfigDirs()) {
    if (fs.existsSync(path.join(dir, '.credentials.json'))) return true;
    for (const f of [path.join(dir, '.claude.json'), path.join(path.dirname(dir), '.claude.json')]) {
      try {
        const j = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (j.oauthAccount || j.primaryApiKey) return true;
      } catch {}
    }
  }
  return process.platform === 'darwin'; // pe macOS e în Keychain: presupunem că da, eroarea apare în chat
}

function run(cmd, args, log, opts = {}) {
  return new Promise((resolve) => {
    const isCmd = IS_WIN && /\.(cmd|bat)$/i.test(cmd);
    const p = spawn(isCmd ? `"${cmd}"` : cmd, args, { env: cleanEnv(), windowsHide: true, shell: isCmd, ...opts });
    let out = '';
    const on = (d) => {
      const s = String(d);
      out += s;
      for (const line of s.split(/\r?\n/)) if (line.trim()) log(line.trim());
    };
    p.stdout?.on('data', on);
    p.stderr?.on('data', on);
    p.on('error', (e) => resolve({ code: -1, out: e.message }));
    p.on('exit', (code) => resolve({ code, out }));
  });
}

function powershell(script, log) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], log);
}

async function installClaude(log) {
  log('Instalez Claude Code…');
  const r = IS_WIN
    ? await powershell('irm https://claude.ai/install.ps1 | iex', log)
    : await run('bash', ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'], log);
  return r.code === 0 && !!findClaude();
}

async function installGit(log) {
  if (!IS_WIN) return true;
  log('Instalez Git for Windows (necesar pentru Claude Code)…');
  const r = await powershell('winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity', log);
  return r.code === 0 || !!findGit();
}

function stateFile() {
  return path.join(app.getPath('userData'), 'setup.json');
}
function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}
function writeState(s) {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2));
  } catch {}
}

function modKey() {
  const root = server.habblaudRoot();
  let v = '';
  try {
    v = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  } catch {}
  return `${root}|${v}|${app.getVersion()}`;
}

/** Mod-ul Habblaud (uz 5h/săptămânal, mesaje, /habblaud) în Claude Code, din resursele aplicației. */
async function installMod(claude, log) {
  const root = server.habblaudRoot();
  if (!fs.existsSync(path.join(root, '.claude-plugin', 'marketplace.json'))) return false;
  log('Instalez mod-ul Habblaud în Claude Code…');
  // Marketplace-ul poate fi deja adăugat din alt folder (instalarea de mână): îl refacem de aici.
  await run(claude, ['plugin', 'marketplace', 'remove', 'habblaud'], () => {});
  const add = await run(claude, ['plugin', 'marketplace', 'add', root], log);
  if (add.code !== 0) return false;
  let ok = true;
  for (const id of ['habblaud@habblaud', 'habblaud-permissoes@habblaud', 'habblaud-mensagens@habblaud']) {
    const r = await run(claude, ['plugin', 'install', id, '--scope', 'user'], log);
    if (r.code !== 0) ok = false;
  }
  return ok;
}

/** Starea fără să instaleze nimic. */
function status() {
  const claude = findClaude();
  return {
    claude,
    git: IS_WIN ? !!findGit() : true,
    loggedIn: loggedIn(),
    mod: readState().mod === modKey(),
  };
}

/**
 * Instalează ce lipsește. log(text) pentru mesajele de progres.
 * Întoarce starea finală.
 */
let running;
function ensure(log) {
  if (running) return running;
  running = (async () => {
    let s = status();
    if (IS_WIN && !s.git) await installGit(log);
    if (!s.claude) await installClaude(log);
    s = status();
    if (s.claude && !s.mod) {
      if (await installMod(s.claude, log)) {
        writeState({ ...readState(), mod: modKey() });
        log('Mod-ul Habblaud e instalat.');
      } else log('Mod-ul Habblaud nu s-a putut instala (merge și fără el).');
    }
    return status();
  })().finally(() => (running = undefined));
  return running;
}

function version(claude) {
  return new Promise((res) => execFile(claude, ['--version'], { windowsHide: true, shell: IS_WIN && /\.(cmd|bat)$/i.test(claude) }, (e, out) => res(e ? '' : String(out).trim())));
}

module.exports = { findClaude, status, ensure, version };
