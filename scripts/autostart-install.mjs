// Adaugă (sau scoate) hook-ul SessionStart care pornește Habblaud odată cu Claude Code.
//   npm run autostart:install     # în <conta>/settings.json (backup înainte)
//   npm run autostart:uninstall
// Conturi: CLAUDE_CONFIG_DIR, altfel toate ~/.claude* cu settings.json sau projects/.
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'autostart.mjs').replace(/\\/g, '/');
const MARK = 'autostart.mjs';
const mode = process.argv[2] ?? 'install';

function accounts() {
  const env = (process.env.CLAUDE_CONFIG_DIR ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (env.length) return env;
  const home = homedir();
  return readdirSync(home)
    .filter((n) => n.startsWith('.claude') && !n.includes('.json'))
    .map((n) => join(home, n))
    .filter((d) => existsSync(join(d, 'settings.json')) || existsSync(join(d, 'projects')));
}

for (const dir of accounts()) {
  const file = join(dir, 'settings.json');
  let s = {};
  if (existsSync(file)) {
    try {
      s = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      console.log(`✗ ${file}: JSON invalid, sărit`);
      continue;
    }
    copyFileSync(file, `${file}.habblaud-backup-${Date.now()}`);
  }
  s.hooks ??= {};
  const groups = (s.hooks.SessionStart ?? []).filter((g) => !(g.hooks ?? []).some((h) => String(h.command ?? '').includes(MARK)));
  if (mode === 'install') {
    groups.push({ matcher: 'startup|resume', hooks: [{ type: 'command', command: `node "${SCRIPT}"`, timeout: 10 }] });
  }
  if (groups.length) s.hooks.SessionStart = groups;
  else delete s.hooks.SessionStart;
  if (!Object.keys(s.hooks).length) delete s.hooks;
  writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
  console.log(`${mode === 'install' ? '✓ instalat' : '✓ scos'}: ${file}`);
}
