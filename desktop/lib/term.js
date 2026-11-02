// Terminal (tabul din dreapta): PowerShell sau `claude` interactiv (pentru autentificare) prin node-pty.
const fs = require('node:fs');
const os = require('node:os');
const { IS_WIN, which, cleanEnv } = require('./util');

let pty;
try {
  pty = require('node-pty');
} catch {
  pty = undefined;
}

const terms = new Map();
let nextId = 1;

function create(wc, { kind, cwd, cols, rows, claude }) {
  if (!pty) return { error: 'Terminalul nu e disponibil (node-pty nu s-a încărcat).' };
  let file;
  let args = [];
  if (kind === 'claude' && claude) {
    if (IS_WIN && /\.(cmd|bat)$/i.test(claude)) {
      file = 'cmd.exe';
      args = ['/c', claude];
    } else file = claude;
  } else if (IS_WIN) {
    file = which('pwsh') || 'powershell.exe';
    args = ['-NoLogo'];
  } else file = process.env.SHELL || '/bin/bash';
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const p = pty.spawn(file, args, { name: 'xterm-256color', cols: cols || 100, rows: rows || 30, cwd: dir, env: cleanEnv({ COLORTERM: 'truecolor' }), useConpty: true });
  const id = nextId++;
  terms.set(id, p);
  p.onData((d) => !wc.isDestroyed() && wc.send('pty:data', id, d));
  p.onExit(({ exitCode }) => {
    terms.delete(id);
    if (!wc.isDestroyed()) wc.send('pty:exit', id, exitCode);
  });
  return { id, cwd: dir };
}

function write(id, data) {
  terms.get(id)?.write(data);
}
function resize(id, cols, rows) {
  try {
    if (cols > 0 && rows > 0) terms.get(id)?.resize(cols, rows);
  } catch {}
}
function kill(id) {
  try {
    terms.get(id)?.kill();
  } catch {}
  terms.delete(id);
}
function killAll() {
  for (const id of [...terms.keys()]) kill(id);
}

module.exports = { create, write, resize, kill, killAll };
