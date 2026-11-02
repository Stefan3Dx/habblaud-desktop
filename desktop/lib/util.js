// Utilitare comune procesului principal.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IS_WIN = process.platform === 'win32';

/** Calea unei comenzi din PATH (pe Windows preferă .exe, apoi .cmd). */
function which(cmd) {
  try {
    const out = execFileSync(IS_WIN ? 'where' : 'which', [cmd], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const all = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return all.find((p) => /\.exe$/i.test(p)) ?? all.find((p) => /\.(cmd|bat)$/i.test(p)) ?? all[0];
  } catch {
    return undefined;
  }
}

/** Prima cale care există. */
function firstExisting(paths) {
  return paths.find((p) => p && fs.existsSync(p));
}

/** Mediu curat pentru procesele copil: fără variabilele unei sesiuni Claude Code / Electron părinte. */
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'CLAUDE_PROJECT_DIR' || k === 'ELECTRON_RUN_AS_NODE') delete env[k];
  }
  // Căile obișnuite ale uneltelor, chiar dacă PATH-ul aplicației e vechi (instalate după pornire).
  const extraPath = IS_WIN
    ? [path.join(os.homedir(), '.local', 'bin'), path.join(process.env.APPDATA || '', 'npm'), 'C:\\Program Files\\Git\\cmd', 'C:\\Program Files\\nodejs']
    : [path.join(os.homedir(), '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin'];
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  const cur = (env[key] || '').split(path.delimiter);
  env[key] = [...cur, ...extraPath.filter((p) => !cur.includes(p))].join(path.delimiter);
  return env;
}

/** Folderele de configurare Claude Code (conturi). */
function claudeConfigDirs() {
  const env = (process.env.CLAUDE_CONFIG_DIR || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (env.length) return env;
  return [path.join(os.homedir(), '.claude')];
}

module.exports = { IS_WIN, which, firstExisting, cleanEnv, claudeConfigDirs };
