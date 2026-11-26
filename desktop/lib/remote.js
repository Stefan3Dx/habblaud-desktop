// Remote control (Claude Fleet) on the main-process side: tracks every chat (cwd, model, mode, Claude session id, busy,
// pending permissions), serves the control API (lib/control.js) and routes remote actions through the renderer – so a
// message sent from Fleet / the phone appears in the window exactly like one typed here.
//
// Ownership: one Claude session id = one live process. A second `--resume` of an id that is alive in another tab is
// refused, and a lock file ~/.claude-fleet/locks/<id> ({ pid, owner }) tells the Fleet agent (and vice versa) who runs it.
// Permissions: first answer wins – from the window or from the API; the other side is told (perm_resolved).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createControl, HttpError } = require('./control');

const LOCK_DIR = path.join(os.homedir(), '.claude-fleet', 'locks');
const alivePid = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
/** who holds a Claude session id right now (null = free / stale lock) */
function lockHolder(sid) {
  try {
    const l = JSON.parse(fs.readFileSync(path.join(LOCK_DIR, sid.replace(/[^\w-]/g, '')), 'utf8'));
    return l.pid && alivePid(l.pid) ? l : null;
  } catch {
    return null;
  }
}
function takeLock(sid) {
  try {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOCK_DIR, sid.replace(/[^\w-]/g, '')), JSON.stringify({ pid: process.pid, owner: 'habblaud', at: Date.now() }));
  } catch {}
}
function dropLock(sid) {
  try {
    const f = path.join(LOCK_DIR, sid.replace(/[^\w-]/g, ''));
    const l = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (l.pid === process.pid) fs.rmSync(f, { force: true });
  } catch {}
}

function setupRemote({ app, ipcMain, chats, send, showWindow, history, log = () => {} }) {
  /** chatId -> { chatId, cwd, model, mode, title, claudeSessionId, busy, perms: Map(requestId -> {toolName, input}) } */
  const meta = new Map();
  const m = (chatId) => {
    if (!meta.has(chatId)) meta.set(chatId, { chatId, cwd: '', model: '', mode: 'default', title: '', claudeSessionId: null, busy: false, perms: new Map() });
    return meta.get(chatId);
  };
  let control = null;
  let creating = 0; // a create with a prompt in flight: its first message counts as sent through the API
  const emit = (obj) => control?.broadcast(obj);
  const pub = (x) => ({
    chatId: x.chatId, claudeSessionId: x.claudeSessionId, cwd: x.cwd, title: x.title, model: x.model || null, mode: x.mode || 'default',
    busy: x.busy, alive: !!chats.get(x.chatId)?.alive,
    pendingPermissions: [...x.perms].map(([requestId, p]) => ({ requestId, toolName: p.toolName, input: p.input, toolUseId: p.toolUseId })),
  });

  // ---- renderer round trips: remote actions run through the window's own code
  let rid = 0;
  const waiting = new Map();
  ipcMain.on('remote:result', (_e, r) => {
    const w = waiting.get(r.rid);
    if (!w) return;
    waiting.delete(r.rid);
    clearTimeout(w.timer);
    r.ok ? w.resolve(r.result) : w.reject(new HttpError(r.status || 409, r.code || 'refused', r.error || 'refuzat'));
  });
  function remote(op, args, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const id = ++rid;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new HttpError(504, 'ui_timeout', 'Fereastra Habblaud nu a răspuns'));
      }, timeout);
      waiting.set(id, { resolve, reject, timer });
      send('remote:command', { rid: id, op, args });
    });
  }
  // the renderer reports title / model / mode / cwd changes
  ipcMain.on('chat:meta', (_e, chatId, patch) => {
    const x = m(chatId);
    for (const k of ['title', 'cwd', 'model', 'mode']) if (patch && typeof patch[k] === 'string') x[k] = patch[k];
    emit({ type: 'chat_state', session: pub(x) });
  });

  /** chat id or Claude session id -> meta */
  function find(id) {
    if (meta.has(id)) return meta.get(id);
    for (const x of meta.values()) if (x.claudeSessionId === id) return x;
    return null;
  }

  const handlers = {
    list: () => [...meta.values()].filter((x) => chats.has(x.chatId) || x.claudeSessionId).map(pub),
    async create(b) {
      const cwd = String(b.cwd || '');
      if (!cwd || !fs.existsSync(cwd)) throw new HttpError(400, 'bad_cwd', `Folderul nu există: ${cwd || '(gol)'}`);
      showWindow(); // decision: a session started from Fleet opens as a new tab and takes focus
      creating++;
      let r;
      try {
        r = await remote('create', { cwd, model: b.model || '', mode: b.mode || 'default', prompt: typeof b.prompt === 'string' ? b.prompt : '' });
      } finally {
        creating--;
      }
      return { chatId: r.chatId, session: meta.has(r.chatId) ? pub(meta.get(r.chatId)) : null };
    },
    async open(id) {
      const x = find(id);
      showWindow();
      if (x) {
        await remote('activate', { chatId: x.chatId });
        return { chatId: x.chatId, opened: false };
      }
      const holder = lockHolder(id);
      if (holder && holder.pid !== process.pid) throw new HttpError(409, 'locked', `Conversația rulează deja în ${holder.owner || 'alt proces'} (pid ${holder.pid}).`);
      const s = history.list(5000).find((h) => h.sessionId === id);
      if (!s) throw new HttpError(404, 'not_found', 'Conversația nu există pe acest calculator');
      const r = await remote('openSession', { sessionId: s.sessionId, cwd: s.cwd, title: s.title, file: s.file });
      return { chatId: r.chatId, opened: true };
    },
    async send(id, b) {
      const x = find(id);
      if (!x) throw new HttpError(404, 'not_found', 'Chat necunoscut');
      const text = String(b.text || '').trim();
      if (!text) throw new HttpError(400, 'empty');
      x.remoteSending = true;
      try {
        await remote('send', { chatId: x.chatId, text });
      } finally {
        x.remoteSending = false;
      }
      return { ok: true, chatId: x.chatId };
    },
    async interrupt(id) {
      const x = find(id);
      if (!x) throw new HttpError(404, 'not_found');
      chats.get(x.chatId)?.interrupt();
      return { ok: true };
    },
    async permission(id, b) {
      const x = find(id);
      if (!x) throw new HttpError(404, 'not_found');
      const p = x.perms.get(String(b.requestId || ''));
      if (!p) throw new HttpError(409, 'already_answered', 'Cererea nu mai așteaptă (răspunsă deja sau anulată)');
      const allow = b.behavior === 'allow';
      const result = allow ? { behavior: 'allow', updatedInput: b.updatedInput && typeof b.updatedInput === 'object' ? b.updatedInput : p.input } : { behavior: 'deny', message: String(b.message || 'Refuzat din Claude Fleet') };
      x.perms.delete(String(b.requestId));
      chats.get(x.chatId)?.answer(String(b.requestId), result);
      send('remote:permResolved', x.chatId, String(b.requestId), allow ? 'Permis din Fleet' : 'Refuzat din Fleet');
      emit({ type: 'perm_resolved', chatId: x.chatId, claudeSessionId: x.claudeSessionId, requestId: String(b.requestId), behavior: allow ? 'allow' : 'deny', via: 'api' });
      return { ok: true };
    },
  };

  return {
    async start() {
      const file = process.env.HABBLAUD_CONTROL_FILE || path.join(app.getPath('userData'), 'control.json');
      control = createControl({ file, version: app.getVersion(), handlers, log });
      try {
        await control.start();
      } catch (e) {
        log(`control API: ${e.message}`);
        control = null;
      }
    },
    stop() {
      control?.stop();
      for (const x of meta.values()) if (x.claudeSessionId) dropLock(x.claudeSessionId);
    },
    /** chat:open – null when fine, else an error message (double resume) */
    checkOpen(chatId, { cwd, model, mode, resume }) {
      if (resume) {
        for (const [id, x] of meta) if (id !== chatId && x.claudeSessionId === resume && chats.get(id)?.alive) return 'Conversația e deja deschisă în alt tab.';
        const holder = lockHolder(resume);
        if (holder && holder.pid !== process.pid) return `Conversația rulează deja în ${holder.owner === 'fleet' ? 'Claude Fleet (agentul de pe acest calculator)' : holder.owner || 'alt proces'} – nu o pornesc a doua oară.`;
      }
      const x = m(chatId);
      Object.assign(x, { cwd: cwd || x.cwd, model: model || '', mode: mode || 'default' });
      if (resume) x.claudeSessionId = resume;
      return null;
    },
    opened(chatId) {
      const x = m(chatId);
      if (x.claudeSessionId) takeLock(x.claudeSessionId);
      emit({ type: 'chat_opened', session: pub(x) });
    },
    event(chatId, ev) {
      const x = m(chatId);
      if (ev.session_id && ev.session_id !== x.claudeSessionId) {
        if (x.claudeSessionId) dropLock(x.claudeSessionId);
        x.claudeSessionId = ev.session_id;
        takeLock(x.claudeSessionId);
        emit({ type: 'chat_state', session: pub(x) });
      }
      if (ev.type === 'result' && x.busy) {
        x.busy = false;
        emit({ type: 'chat_state', session: pub(x) });
      }
      emit({ type: 'event', chatId, claudeSessionId: x.claudeSessionId, event: ev });
      if (ev.type === 'control_request' && ev.request?.subtype === 'can_use_tool') {
        const p = { toolName: ev.request.tool_name, input: ev.request.input || {}, toolUseId: ev.request.tool_use_id };
        x.perms.set(ev.request_id, p);
        emit({ type: 'perm_req', chatId, claudeSessionId: x.claudeSessionId, requestId: ev.request_id, ...p });
      }
    },
    sending(chatId, content) {
      const x = m(chatId);
      // what was typed (prompts are not echoed by Claude's stream): source api = sent through this API, ui = typed here
      const text = Array.isArray(content) ? content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : String(content || '');
      emit({ type: 'user_input', chatId, claudeSessionId: x.claudeSessionId, text, images: Array.isArray(content) ? content.filter((b) => b && b.type === 'image').length : 0, source: x.remoteSending || creating ? 'api' : 'ui' });
      if (!x.busy) {
        x.busy = true;
        emit({ type: 'chat_state', session: pub(x) });
      }
    },
    exited(chatId) {
      const x = m(chatId);
      x.busy = false;
      for (const requestId of x.perms.keys()) emit({ type: 'perm_resolved', chatId, claudeSessionId: x.claudeSessionId, requestId, behavior: 'deny', via: 'exit' });
      x.perms.clear();
      if (x.claudeSessionId) dropLock(x.claudeSessionId);
      emit({ type: 'chat_state', session: pub(x) });
    },
    closed(chatId) {
      const x = meta.get(chatId);
      if (!x) return;
      if (x.claudeSessionId) dropLock(x.claudeSessionId);
      meta.delete(chatId);
      emit({ type: 'chat_closed', chatId, claudeSessionId: x.claudeSessionId });
    },
    /** an answer typed in the window: false when the API already answered it (first wins) */
    answeredInUi(chatId, requestId, result) {
      const x = m(chatId);
      if (!x.perms.has(requestId)) return false;
      x.perms.delete(requestId);
      emit({ type: 'perm_resolved', chatId, claudeSessionId: x.claudeSessionId, requestId, behavior: result?.behavior === 'allow' ? 'allow' : 'deny', via: 'ui' });
      return true;
    },
  };
}

module.exports = { setupRemote, lockHolder, LOCK_DIR };
