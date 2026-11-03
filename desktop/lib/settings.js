// Setările aplicației (userData/settings.json): pornire cu Windows, rămâne în tray la închidere.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = { openAtLogin: true, keepInTray: true, trayHintShown: false };
let cache;

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function get() {
  if (!cache) {
    try {
      cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
    } catch {
      cache = { ...DEFAULTS };
    }
  }
  return cache;
}

function set(patch) {
  cache = { ...get(), ...patch };
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch {}
  apply();
  return cache;
}

/** Pornirea cu Windows (ascunsă, direct în tray). Doar în aplicația instalată. */
function apply() {
  if (!app.isPackaged || (process.platform !== 'win32' && process.platform !== 'darwin')) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!get().openAtLogin, args: ['--hidden'] });
  } catch {}
}

module.exports = { get, set, apply };
