const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, fn) => ipcRenderer.on(channel, (_e, ...args) => fn(...args));

contextBridge.exposeInMainWorld('hb', {
  info: () => ipcRenderer.invoke('app:info'),
  setup: () => ipcRenderer.invoke('setup:ensure'),
  onSetupLog: (fn) => on('setup:log', fn),
  server: () => ipcRenderer.invoke('server:ensure'),

  chatOpen: (o) => ipcRenderer.invoke('chat:open', o),
  chatSend: (id, content) => ipcRenderer.invoke('chat:send', id, content),
  chatAnswer: (id, reqId, result) => ipcRenderer.send('chat:answer', id, reqId, result),
  chatInterrupt: (id) => ipcRenderer.send('chat:interrupt', id),
  chatClose: (id) => ipcRenderer.send('chat:close', id),
  onChatEvent: (fn) => on('chat:event', fn),
  onChatExit: (fn) => on('chat:exit', fn),

  historyList: () => ipcRenderer.invoke('history:list'),
  historyLoad: (file) => ipcRenderer.invoke('history:load', file),

  pathOf: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  attachPaths: (paths) => ipcRenderer.invoke('attach:paths', paths),
  attachBuffer: (item) => ipcRenderer.invoke('attach:buffer', item),
  attachUrl: (url) => ipcRenderer.invoke('attach:url', url),
  clipImage: () => ipcRenderer.invoke('clip:image'),
  capture: (mode) => ipcRenderer.invoke('capture', mode),
  pickFiles: () => ipcRenderer.invoke('dialog:files'),
  pickFolder: (start) => ipcRenderer.invoke('dialog:folder', start),
  readClip: () => ipcRenderer.invoke('clip:read'),
  writeClip: (t) => ipcRenderer.send('clip:write', t),
  open: (p) => ipcRenderer.send('shell:open', p),
  reveal: (p) => ipcRenderer.send('shell:reveal', p),
  focus: () => ipcRenderer.send('app:focus'),
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (fn) => on('update', fn),
  onNewChat: (fn) => on('app:newChat', fn),

  ptyCreate: (o) => ipcRenderer.invoke('pty:create', o),
  ptyWrite: (id, d) => ipcRenderer.send('pty:write', id, d),
  ptyResize: (id, c, r) => ipcRenderer.send('pty:resize', id, c, r),
  ptyKill: (id) => ipcRenderer.send('pty:kill', id),
  onPtyData: (fn) => on('pty:data', fn),
  onPtyExit: (fn) => on('pty:exit', fn),
});
