// Habblaud Desktop: chat Claude Code (stânga) + panoul Habblaud (dreapta).
// Totul rulează în fundal, fără ferestre de consolă: serverul Habblaud, procesele `claude`, instalările.
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, shell, nativeTheme } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const server = require('./lib/server');
const setup = require('./lib/setup');
const history = require('./lib/history');
const attach = require('./lib/attach');
const term = require('./lib/term');
const { ClaudeChat } = require('./lib/claude');

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
  win.once('ready-to-show', () => win.show());
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
  win.on('close', save);
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

function shutdown() {
  for (const c of chats.values()) c.kill();
  chats.clear();
  term.killAll();
  server.stop();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  Menu.setApplicationMenu(null);
  app.setAppUserModelId('ro.stormvault.habblaud');
  app.whenReady().then(() => {
    attach.cleanup();
    createWindow();
  });
  app.on('window-all-closed', () => {
    shutdown();
    app.quit();
  });
  app.on('before-quit', shutdown);
}
