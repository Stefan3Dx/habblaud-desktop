// Serverul Habblaud: pornit ascuns, cu Node-ul din Electron (ELECTRON_RUN_AS_NODE), din resursele aplicației.
const { app } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanEnv } = require('./util');

const PORT = Number.parseInt(process.env.HABBLAUD_PORT ?? '', 10) || 4747;
const URL = `http://127.0.0.1:${PORT}`;
let child;

/** Rădăcina Habblaud: în aplicația instalată resources/habblaud, în dezvoltare folderul repo-ului. */
function habblaudRoot() {
  if (process.env.HABBLAUD_ROOT) return process.env.HABBLAUD_ROOT;
  if (app.isPackaged) return path.join(process.resourcesPath, 'habblaud');
  return path.resolve(__dirname, '..', '..');
}

async function isUp() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 800);
    await fetch(`${URL}/api/mod/summary`, { signal: ctl.signal });
    clearTimeout(t);
    return true;
  } catch {
    return false;
  }
}

function start() {
  const root = habblaudRoot();
  const entry = path.join(root, 'dist', 'server', 'index.js');
  if (!fs.existsSync(entry)) return `Lipsește serverul Habblaud (${entry}).`;
  const dir = path.join(os.homedir(), '.habblaud');
  fs.mkdirSync(dir, { recursive: true });
  const log = fs.openSync(path.join(dir, 'server.log'), 'a');
  const env = cleanEnv({
    ELECTRON_RUN_AS_NODE: '1',
    HABBLAUD_PTY: process.env.HABBLAUD_PTY ?? '1',
    HABBLAUD_LANG: process.env.HABBLAUD_LANG ?? 'ro',
    HABBLAUD_PORT: String(PORT),
  });
  env.ELECTRON_RUN_AS_NODE = '1';
  child = spawn(process.execPath, [entry], { cwd: root, env, stdio: ['ignore', log, log], windowsHide: true });
  child.on('exit', () => (child = undefined));
  return undefined;
}

/** Pornește serverul dacă nu rulează deja (al aplicației sau unul pornit de mână) și așteaptă să răspundă. */
async function ensure() {
  if (await isUp()) return { ok: true, url: URL };
  const err = start();
  if (err) return { ok: false, msg: err };
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isUp()) return { ok: true, url: URL };
    if (!child) break;
  }
  return { ok: false, msg: 'Serverul Habblaud nu a pornit. Vezi %USERPROFILE%\\.habblaud\\server.log' };
}

function stop() {
  if (!child) return;
  try {
    child.kill();
  } catch {}
  child = undefined;
}

module.exports = { URL, PORT, habblaudRoot, ensure, stop, isUp };
