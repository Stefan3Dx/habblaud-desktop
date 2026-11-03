// Habblaud Desktop: chat Claude Code (stânga) + panoul Habblaud (dreapta).
// Totul rulează în fundal, fără ferestre de consolă: serverul Habblaud, procesele `claude`, instalările.
const { app, BrowserWindow, Menu, clipboard, desktopCapturer, dialog, ipcMain, screen, session, shell, nativeTheme } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const server = require('./lib/server');
const setup = require('./lib/setup');
const history = require('./lib/history');
const attach = require('./lib/attach');
const term = require('./lib/term');
const { ClaudeChat } = require('./lib/claude');
const settings = require('./lib/settings');
const tray = require('./lib/tray');
const updater = require('./lib/updater');

const startHidden = process.argv.includes('--hidden');

nativeTheme.themeSource = 'dark';
let win;
const chats = new Map(); // chatId -> ClaudeChat

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}
const log = (text) => send('setup:log', text);

// ---------------------------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------------------------

ipcMain.handle('chat:open', (_e, { chatId, cwd, model, mode, resume }) => {
  const claude = setup.findClaude();
  if (!claude) return { error: 'Claude Code nu e instalat încă.' };
  chats.get(chatId)?.kill();
  const c = new ClaudeChat({
    claude,
    cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(),
    model,
    mode,
    resume,
    onEvent: (ev) => send('chat:event', chatId, ev),
    onExit: (info) => send('chat:exit', chatId, info),
  });
  chats.set(chatId, c);
  c.start();
  return { ok: true };
});
ipcMain.handle('chat:send', (_e, chatId, content) => !!chats.get(chatId)?.send(content));
ipcMain.on('chat:answer', (_e, chatId, requestId, result) => chats.get(chatId)?.answer(requestId, result));
ipcMain.on('chat:interrupt', (_e, chatId) => chats.get(chatId)?.interrupt());
ipcMain.on('chat:close', (_e, chatId) => {
  chats.get(chatId)?.kill();
  chats.delete(chatId);
});

ipcMain.handle('history:list', () => history.list());
ipcMain.handle('history:load', (_e, file) => {
  try {
    return history.load(file);
  } catch (e) {
    return { error: e.message };
  }
});

// ---------------------------------------------------------------------------------------------
// Atașamente, dialoguri, clipboard
// ---------------------------------------------------------------------------------------------

ipcMain.handle('attach:paths', async (_e, paths) => Promise.all(paths.map((p) => attach.fromPath(p))));
ipcMain.handle('attach:buffer', (_e, item) => attach.fromBuffer(item));
ipcMain.handle('attach:url', async (_e, url) => {
  // Imagine trasă dintr-un browser: o descărcăm (max. 25 MB).
  try {
    if (!/^https?:\/\//i.test(url)) return { kind: 'error', name: url, error: 'adresă nesuportată' };
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return { kind: 'error', name: url, error: `HTTP ${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) return { kind: 'error', name: url, error: 'fișier prea mare' };
    const mime = (r.headers.get('content-type') || '').split(';')[0];
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'descarcat') || 'descarcat';
    return attach.fromBuffer({ name, mime, bytes: buf });
  } catch (e) {
    return { kind: 'error', name: url, error: e.message };
  }
});
ipcMain.handle('clip:image', async () => {
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  return attach.fromBuffer({ name: 'clipboard.png', mime: 'image/png', bytes: img.toPNG() });
});

/** Captură: 'region' = instrumentul de decupare din Windows (Win+Shift+S), 'screen' = tot ecranul. */
ipcMain.handle('capture', async (_e, mode) => {
  if (!win) return null;
  const restore = () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  try {
    if (mode === 'region' && process.platform === 'win32') {
      const before = clipboard.readImage().toDataURL();
      win.minimize();
      await new Promise((r) => setTimeout(r, 250));
      await shell.openExternal('ms-screenclip:');
      const t0 = Date.now();
      while (Date.now() - t0 < 90000) {
        await new Promise((r) => setTimeout(r, 350));
        const img = clipboard.readImage();
        if (!img.isEmpty() && img.toDataURL() !== before) {
          restore();
          return attach.fromBuffer({ name: `captura-${Date.now()}.png`, mime: 'image/png', bytes: img.toPNG() });
        }
      }
      restore();
      return null;
    }
    // Tot ecranul (și decuparea pe Linux/macOS): ascundem fereastra o clipă.
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
    win.hide();
    await new Promise((r) => setTimeout(r, 300));
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    restore();
    const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) return null;
    return attach.fromBuffer({ name: `ecran-${Date.now()}.png`, mime: 'image/png', bytes: src.thumbnail.toPNG() });
  } catch (e) {
    restore();
    return { kind: 'error', name: 'captură', error: e.message };
  }
});
ipcMain.handle('dialog:files', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Atașează fișiere', properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('dialog:folder', async (_e, start) => {
  const r = await dialog.showOpenDialog(win, { title: 'Alege folderul proiectului', defaultPath: start || os.homedir(), properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? undefined : r.filePaths[0];
});
ipcMain.handle('clip:read', () => clipboard.readText());
ipcMain.on('clip:write', (_e, t) => clipboard.writeText(String(t)));
ipcMain.on('app:focus', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});
ipcMain.on('shell:reveal', (_e, p) => p && shell.showItemInFolder(p));
ipcMain.on('shell:open', (_e, p) => {
  if (/^https?:\/\//.test(p)) shell.openExternal(p);
  else if (p) shell.openPath(p);
});

// ---------------------------------------------------------------------------------------------
// Setup + server + terminal
// ---------------------------------------------------------------------------------------------

ipcMain.handle('app:info', async () => {
  const s = setup.status();
  return { home: os.homedir(), version: app.getVersion(), platform: process.platform, ...s, claudeVersion: s.claude ? await setup.version(s.claude) : '' };
});
ipcMain.handle('setup:ensure', () => setup.ensure(log));
ipcMain.handle('settings:get', () => settings.get());
ipcMain.handle('settings:set', (_e, patch) => {
  const s = settings.set(patch || {});
  tray.refresh();
  return s;
});
ipcMain.handle('update:status', () => updater.status());
ipcMain.handle('update:install', () => {
  app.isQuitting = true;
  return updater.install();
});
ipcMain.handle('server:ensure', () => server.ensure());

ipcMain.handle('pty:create', (e, opts) => term.create(e.sender, { ...opts, claude: setup.findClaude() }));
ipcMain.on('pty:write', (_e, id, d) => term.write(id, d));
ipcMain.on('pty:resize', (_e, id, c, r) => term.resize(id, c, r));
ipcMain.on('pty:kill', (_e, id) => term.kill(id));

// ---------------------------------------------------------------------------------------------
// Fereastra
// ---------------------------------------------------------------------------------------------

function windowState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'window.json'), 'utf8'));
  } catch {
    return {};
  }
}

function createWindow() {
  const st = windowState();
  win = new BrowserWindow({
    width: st.width || 1600,
    height: st.height || 960,
    x: st.x,
    y: st.y,
    minWidth: 960,
    minHeight: 560,
    title: 'Habblaud',
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#262624',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, webviewTag: true, spellcheck: false },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (ev, url) => {
    ev.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  const save = () => {
    try {
      const b = win.getNormalBounds();
      fs.writeFileSync(path.join(app.getPath('userData'), 'window.json'), JSON.stringify({ ...b, maximized: win.isMaximized() }));
    } catch {}
  };
  win.on('close', (e) => {
    save();
    // Închis din X: rămâne lângă ceas (conversațiile și serverul merg mai departe), dacă așa e setat.
    if (!app.isQuitting && settings.get().keepInTray) {
      e.preventDefault();
      win.hide();
      if (!settings.get().trayHintShown) {
        tray.balloon('Habblaud rulează în continuare', 'L-am mutat lângă ceas. Click pe iconiță ca să-l deschizi; Ieșire din meniul ei îl oprește.');
        settings.set({ trayHintShown: true });
      }
    }
  });
  win.on('closed', () => (win = undefined));
}

// Linkurile din panoul Habblaud care ies din aplicație se deschid în browser.
app.on('web-contents-created', (_e, wc) => {
  if (wc.getType() !== 'webview') return;
  wc.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(server.URL)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (ev, url) => {
    if (!url.startsWith(server.URL)) {
      ev.preventDefault();
      shell.openExternal(url);
    }
  });
});

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function quit() {
  app.isQuitting = true;
  app.quit();
}

function shutdown() {
  for (const c of chats.values()) c.kill();
  chats.clear();
  term.killAll();
  server.stop();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showWindow());
  Menu.setApplicationMenu(null);
  app.setAppUserModelId('ro.stormvault.habblaud');
  app.whenReady().then(() => {
    attach.cleanup();
    // Camera (poză din chat) și captura de ecran: doar pentru pagina aplicației, nu pentru panoul Habblaud.
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(wc.getType() !== 'webview' && (permission === 'media' || permission === 'notifications' || permission === 'clipboard-read'));
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission) => !!wc && wc.getType() !== 'webview' && ['media', 'notifications', 'clipboard-read'].includes(permission));
    createWindow();
    settings.apply();
    try {
      tray.create({
        show: showWindow,
        newChat: () => {
          showWindow();
          send('app:newChat');
        },
        quit,
      });
    } catch {}
    updater.start((s) => send('update', s));
  });
  app.on('window-all-closed', () => {
    shutdown();
    app.quit();
  });
  app.on('before-quit', () => {
    app.isQuitting = true;
    shutdown();
  });
}
