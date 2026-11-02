// Pune serverul Habblaud (deja construit cu `npm run build` în rădăcină) în desktop/build/habblaud,
// de unde electron-builder îl copiază în resources/habblaud.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(desktop, '..');
const out = join(desktop, 'build', 'habblaud');

if (!existsSync(join(root, 'dist', 'server', 'index.js'))) {
  console.error('Lipsește dist/. Rulează mai întâi `npm run build` în rădăcina repo-ului.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const copy = (rel, opt = {}) => {
  const src = join(root, rel);
  if (!existsSync(src)) {
    if (!opt.optional) console.warn(`(lipsește ${rel})`);
    return;
  }
  cpSync(src, join(out, rel), { recursive: true, dereference: true, filter: (p) => !/[\\/]node_modules[\\/].*[\\/](test|tests|__tests__)$/.test(p) });
  console.log(`  ${rel}`);
};

for (const f of ['package.json', 'LICENSE', 'README.md', 'CHANGELOG.md', 'dist', 'mod', '.claude-plugin']) copy(f);
// Dependențele serverului la rulare (terminalul interactiv); restul e în dist/server/index.js.
for (const m of ['node-pty', '@xterm/headless', '@xterm/addon-serialize']) copy(join('node_modules', m), { optional: true });
console.log(`✓ ${out}`);
