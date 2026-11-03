// Iconița de lângă ceas: deschide aplicația, chat nou, pornire cu Windows, ieșire.
const { Menu, Tray, nativeImage } = require('electron');
const path = require('node:path');
const settings = require('./settings');

let tray;

function create({ show, newChat, quit }) {
  if (tray) return tray;
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'icon.png')).resize({ width: 16, height: 16, quality: 'best' });
  tray = new Tray(icon);
  tray.setToolTip('Habblaud');
  const build = () => {
    const s = settings.get();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Deschide Habblaud', click: show },
        { label: 'Conversație nouă', click: newChat },
        { type: 'separator' },
        { label: 'Pornește cu Windows', type: 'checkbox', checked: !!s.openAtLogin, click: (i) => (settings.set({ openAtLogin: i.checked }), build()) },
        { label: 'La închidere rămâi aici, lângă ceas', type: 'checkbox', checked: !!s.keepInTray, click: (i) => (settings.set({ keepInTray: i.checked }), build()) },
        { type: 'separator' },
        { label: 'Ieșire', click: quit },
      ]),
    );
  };
  build();
  tray.on('click', show);
  tray.rebuild = build;
  return tray;
}

function refresh() {
  tray?.rebuild?.();
}

function balloon(title, content) {
  try {
    tray?.displayBalloon({ title, content, iconType: 'info' });
  } catch {}
}

module.exports = { create, refresh, balloon };
