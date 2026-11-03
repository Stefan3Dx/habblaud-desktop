// Actualizare automată: verifică release-ul „desktop-latest” din GitHub, descarcă în fundal și anunță chat-ul.
const { app } = require('electron');

let updater;
let readyVersion;

function start(notify) {
  if (!app.isPackaged || process.env.HABBLAUD_NO_UPDATE === '1') return;
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch {
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-available', (i) => notify({ state: 'downloading', version: i?.version }));
  updater.on('update-downloaded', (i) => {
    readyVersion = i?.version;
    notify({ state: 'ready', version: readyVersion });
  });
  updater.on('error', () => {});
  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 15000);
  setInterval(check, 4 * 3600 * 1000);
}

function status() {
  return readyVersion ? { state: 'ready', version: readyVersion } : null;
}

function install() {
  if (!updater || !readyVersion) return false;
  setImmediate(() => updater.quitAndInstall(true, true));
  return true;
}

module.exports = { start, status, install };
