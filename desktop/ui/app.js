/* global hb, R, TERM */
(() => {
  const $ = (s) => document.querySelector(s);
  const el = R.el;
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(`hbd:${k}`);
        return v === null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(`hbd:${k}`, JSON.stringify(v));
      } catch {}
    },
  };

  const S = {
    info: { home: '' },
    sessions: [],
    chats: new Map(),
    active: undefined,
    pending: [],
    lastDir: store.get('lastDir', ''),
    commands: store.get('commands', []),
  };
  /** Comenzi rezolvate aici, fără Claude. */
  const LOCAL_COMMANDS = [
    { name: 'clear', description: 'Conversație nouă, în același folder', local: true },
    { name: 'new', description: 'Conversație nouă, în același folder', local: true },
  ];
  let seq = 0;
  const base = (p) => (p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p || '';
  const sameDir = (a, b) => (a || '').replace(/[\\/]+$/, '').toLowerCase() === (b || '').replace(/[\\/]+$/, '').toLowerCase();

  // =============================================================================================
  // Conversații
  // =============================================================================================

  function makeChat({ cwd, sessionId, title, file }) {
    const id = `c${++seq}`;
    const root = el('div', 'msgs');
    const inner = el('div', 'inner');
    root.appendChild(inner);
    $('#chats').appendChild(root);
    const chat = {
      id,
      cwd: cwd || S.lastDir || S.info.home,
      sessionId,
      file,
      title: title || '',
      model: store.get('model', ''),
      mode: store.get('mode', 'default'),
      root,
      inner,
      alive: false,
      busy: false,
      hasMsgs: false,
      stick: true,
      blocks: new Map(),
      tools: new Map(),
      streamed: new Set(),
      allow: new Set(),
      files: new Map(),
      pendingEdits: new Map(),
      badge: null,
      cur: '',
      working: null,
    };
    root.addEventListener('scroll', () => {
      chat.stick = root.scrollHeight - root.scrollTop - root.clientHeight < 140;
    });
    new ResizeObserver(() => {
      if (chat.stick) root.scrollTop = root.scrollHeight;
    }).observe(inner);
    S.chats.set(id, chat);
    return chat;
  }

  function add(chat, node) {
    chat.hasMsgs = true;
    if (chat.working && chat.working.parentNode === chat.inner) chat.inner.insertBefore(node, chat.working);
    else chat.inner.appendChild(node);
    if (chat === S.active) document.body.classList.add('has-chat');
    return node;
  }

  function setBusy(chat, busy) {
    chat.busy = busy;
    if (busy && !chat.working) {
      chat.working = el('div', 'working');
      chat.working.append(el('i'), el('span', '', 'Claude lucrează…'));
      chat.inner.appendChild(chat.working);
    } else if (!busy && chat.working) {
      chat.working.remove();
      chat.working = null;
    }
    if (chat === S.active) refreshComposer();
    renderSessions();
  }

  function activate(chat) {
    S.active = chat;
    chat.badge = null;
    for (const c of S.chats.values()) c.root.classList.toggle('active', c === chat);
    document.body.classList.toggle('has-chat', !!(chat.hasMsgs || chat.sessionId));
    R.setCwd(chat.cwd);
    TERM.setCwd(chat.cwd);
    $('#sel-model').value = chat.model || '';
    $('#sel-mode').value = chat.mode || 'default';
    refreshHead();
    refreshComposer();
    renderSessions();
    renderWelcome();
    renderFiles();
    requestAnimationFrame(() => {
      if (chat.stick) chat.root.scrollTop = chat.root.scrollHeight;
      $('#input').focus();
    });
  }

  function refreshHead() {
    const c = S.active;
    if (!c) return;
    $('#title').textContent = c.title || 'Chat nou';
    const chip = $('#cwd');
    chip.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>';
    chip.appendChild(el('span', '', base(c.cwd) || 'Alege folderul'));
    chip.title = `${c.cwd}\n${c.hasMsgs ? 'Click: deschide folderul' : 'Click: schimbă folderul'}`;
    const dot = $('#status-dot');
    dot.className = c.busy ? 'busy' : c.alive ? 'ok' : '';
    dot.title = c.busy ? 'Lucrează' : c.alive ? 'Conectat' : 'Inactiv';
  }

  function refreshComposer() {
    const c = S.active;
    document.body.classList.toggle('busy', !!c?.busy);
    refreshHead();
  }

  function newChat(cwd) {
    // Refolosește un chat nou, încă gol.
    for (const c of S.chats.values()) {
      if (!c.hasMsgs && !c.sessionId) {
        if (cwd) c.cwd = cwd;
        activate(c);
        return c;
      }
    }
    const c = makeChat({ cwd });
    activate(c);
    return c;
  }

  async function openSession(s) {
    for (const c of S.chats.values()) if (c.sessionId === s.sessionId) return activate(c);
    const c = makeChat({ cwd: s.cwd, sessionId: s.sessionId, title: s.title, file: s.file });
    c.hasMsgs = true;
    activate(c);
    const entries = await hb.historyLoad(s.file);
    if (entries.error) {
      add(c, el('div', 'errbox', `Nu am putut citi conversația: ${entries.error}`));
      return;
    }
    c.history = true;
    for (const ev of entries) handle(c, ev);
    c.history = false;
    for (const t of c.tools.values()) if (t.node.classList.contains('run')) t.node.classList.remove('run');
    c.root.scrollTop = c.root.scrollHeight;
  }

  async function ensureProc(chat) {
    if (chat.alive) return true;
    const r = await hb.chatOpen({ chatId: chat.id, cwd: chat.cwd, model: chat.model, mode: chat.mode, resume: chat.sessionId });
    if (r.error) {
      add(chat, el('div', 'errbox', r.error));
      return false;
    }
    chat.alive = true;
    refreshHead();
    return true;
  }

  function restartLater(chat) {
    // Model / mod schimbat: procesul se repornește (cu --resume) la următorul mesaj.
    if (!chat.alive) return;
    if (chat.busy) {
      chat.restartAfter = true;
      return;
    }
    chat.closing = true;
    hb.chatClose(chat.id);
    chat.alive = false;
    refreshHead();
  }

  // =============================================================================================
  // Evenimente de la Claude Code
  // =============================================================================================

  function ensureTool(chat, id, name, input) {
    let t = chat.tools.get(id);
    if (!t) {
      t = R.toolCard(name, input || {});
      chat.tools.set(id, t);
      add(chat, t.node);
    }
    return t;
  }

  function isInternalText(t) {
    const s = (t || '').trim();
    return !s || s.startsWith('<') || s.startsWith('Caveat:') || s.startsWith('[Request interrupted');
  }

  function handle(chat, ev) {
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init') {
          chat.sessionId = ev.session_id;
          chat.modelName = ev.model;
          for (const name of ev.slash_commands || []) if (!S.commands.some((c) => c.name === name)) S.commands.push({ name, description: '', argumentHint: '' });
        } else if (ev.subtype === 'compact_boundary') add(chat, el('div', 'msg compact', 'Conversația a fost compactată'));
        break;
      case 'stream_event':
        onStream(chat, ev);
        break;
      case 'assistant':
        onAssistant(chat, ev);
        break;
      case 'user':
        onUser(chat, ev);
        break;
      case 'result':
        onResult(chat, ev);
        break;
      case 'control_request':
        if (ev.request?.subtype === 'can_use_tool') onPermission(chat, ev);
        break;
      case 'control_response': {
        const cmds = ev.response?.response?.commands;
        if (Array.isArray(cmds) && cmds.length) {
          S.commands = cmds.filter((c) => c && c.name).map((c) => ({ name: String(c.name), description: String(c.description || ''), argumentHint: String(c.argumentHint || '') }));
          store.set('commands', S.commands);
        }
        break;
      }
      default:
        break;
    }
  }

  function onStream(chat, ev) {
    if (ev.parent_tool_use_id) return;
    const e = ev.event || {};
    if (e.type === 'message_start') chat.cur = e.message?.id || `m${Date.now()}`;
    else if (e.type === 'content_block_start') {
      const key = `${chat.cur}:${e.index}`;
      const cb = e.content_block || {};
      if (cb.type === 'text') {
        const b = R.textBlock();
        add(chat, b.node);
        chat.blocks.set(key, b);
        chat.streamed.add(`${chat.cur}:text`);
        if (cb.text) b.append(cb.text);
      } else if (cb.type === 'thinking') {
        const b = R.thinkBlock();
        add(chat, b.node);
        chat.blocks.set(key, b);
        chat.streamed.add(`${chat.cur}:thinking`);
      } else if (cb.type === 'tool_use') ensureTool(chat, cb.id, cb.name, {});
    } else if (e.type === 'content_block_delta') {
      const b = chat.blocks.get(`${chat.cur}:${e.index}`);
      const d = e.delta || {};
      if (!b) return;
      if (d.type === 'text_delta') b.append(d.text);
      else if (d.type === 'thinking_delta') b.append(d.thinking);
    } else if (e.type === 'content_block_stop') {
      const key = `${chat.cur}:${e.index}`;
      chat.blocks.get(key)?.finish();
      chat.blocks.delete(key);
    }
  }

  function onAssistant(chat, ev) {
    const msg = ev.message || {};
    const content = Array.isArray(msg.content) ? msg.content : [];
    if (ev.parent_tool_use_id) {
      const parent = chat.tools.get(ev.parent_tool_use_id);
      if (!parent) return;
      for (const b of content) {
        if (b.type === 'tool_use') {
          const d = R.describe(b.name, b.input);
          parent.addSub(`• ${d.name}  ${d.sum}`);
        } else if (b.type === 'text' && b.text?.trim()) parent.addSub(`💬 ${b.text.trim().slice(0, 160)}`);
      }
      return;
    }
    for (const b of content) {
      if (b.type === 'text') {
        if (!chat.history && chat.streamed.has(`${msg.id}:text`)) continue;
        if (!b.text?.trim()) continue;
        const t = R.textBlock();
        add(chat, t.node);
        t.set(b.text);
      } else if (b.type === 'thinking') {
        if (!chat.history && chat.streamed.has(`${msg.id}:thinking`)) continue;
        if (!b.thinking?.trim()) continue;
        const t = R.thinkBlock();
        add(chat, t.node);
        t.set(b.thinking);
        t.finish();
      } else if (b.type === 'tool_use') {
        ensureTool(chat, b.id, b.name, b.input).setInput(b.input, b.name);
        if ((b.name === 'Edit' || b.name === 'MultiEdit' || b.name === 'Write' || b.name === 'NotebookEdit') && b.input) chat.pendingEdits.set(b.id, { name: b.name, input: b.input });
      }
    }
  }

  function onUser(chat, ev) {
    if (ev.parent_tool_use_id) return;
    const content = ev.message?.content;
    if (ev.isCompactSummary) {
      add(chat, el('div', 'msg compact', 'Conversația a fost compactată'));
      return;
    }
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b.type !== 'tool_result') continue;
        chat.tools.get(b.tool_use_id)?.setResult(b.content, b.is_error);
        const pe = chat.pendingEdits.get(b.tool_use_id);
        if (pe) {
          chat.pendingEdits.delete(b.tool_use_id);
          if (!b.is_error) recordEdit(chat, pe);
        }
      }
    }
    if (!chat.history) return;
    // Din istoric: mesajele scrise de om.
    const parts = typeof content === 'string' ? [{ type: 'text', text: content }] : (content || []).filter((b) => b.type !== 'tool_result');
    const visible = parts.filter((b) => (b.type === 'text' ? !isInternalText(b.text) : b.type === 'image' || b.type === 'document'));
    if (visible.length) add(chat, R.userFromContent(visible));
  }

  function onResult(chat, ev) {
    for (const b of chat.blocks.values()) b.finish?.();
    chat.blocks.clear();
    setBusy(chat, false);
    const meta = el('div', 'meta');
    if (ev.duration_ms) meta.appendChild(el('span', '', `${(ev.duration_ms / 1000).toFixed(1)} s`));
    if (ev.num_turns) meta.appendChild(el('span', '', `${ev.num_turns} ${ev.num_turns === 1 ? 'pas' : 'pași'}`));
    if (ev.usage?.output_tokens) meta.appendChild(el('span', '', `${ev.usage.output_tokens.toLocaleString('ro-RO')} tokeni generați`));
    if (meta.children.length) add(chat, meta);
    if (ev.is_error || (ev.subtype && ev.subtype !== 'success')) {
      const msg = ev.result || (ev.errors || []).join('\n') || ev.subtype;
      if (msg && /interrupt/i.test(msg)) add(chat, el('div', 'meta', 'Oprit de tine.'));
      else if (msg) add(chat, el('div', 'errbox', msg));
    }
    if (/not logged in|run \/login|authentication error|invalid api key|oauth token/i.test(`${ev.result || ''} ${(ev.errors || []).join(' ')}`)) showLoginBanner();
    else if (!ev.is_error) hideBanner();
    if (!chat.title && chat.firstText) chat.title = chat.firstText.slice(0, 80);
    refreshHead();
    if (chat.restartAfter) {
      chat.restartAfter = false;
      restartLater(chat);
    }
    if (!chat.history) attention(chat, 'done', 'Claude a terminat', chat.title || base(chat.cwd));
    scheduleSessions();
  }

  // ---------------------------------------------------------------------------------------------
  // Permisiuni și întrebări
  // ---------------------------------------------------------------------------------------------

  function answer(chat, reqId, result) {
    hb.chatAnswer(chat.id, reqId, result);
  }

  function onPermission(chat, ev) {
    const req = ev.request;
    const tool = req.tool_name;
    const input = req.input || {};
    const reqId = ev.request_id;
    if (chat.allow.has(tool)) return answer(chat, reqId, { behavior: 'allow', updatedInput: input });
    attention(chat, 'wait', tool === 'AskUserQuestion' ? 'Claude are o întrebare' : 'Claude are nevoie de aprobarea ta', `${chat.title || base(chat.cwd)}: ${R.describe(tool, input).name}`);

    const card = el('div', 'perm');
    const done = (label) => {
      card.classList.add('done');
      card.appendChild(el('div', 'meta', label));
    };

    if (tool === 'AskUserQuestion') {
      const answers = {};
      const qs = input.questions || [];
      for (const q of qs) {
        card.appendChild(el('div', 'q', q.question));
        const opts = el('div', 'opts');
        const chosen = new Set();
        for (const o of q.options || []) {
          const b = el('button', 'opt');
          b.append(el('span', '', o.label));
          if (o.description) b.appendChild(el('small', '', o.description));
          b.addEventListener('click', () => {
            if (q.multiSelect) {
              chosen.has(o.label) ? chosen.delete(o.label) : chosen.add(o.label);
              b.classList.toggle('sel');
              answers[q.question] = [...chosen].join(', ');
            } else {
              for (const x of opts.querySelectorAll('.opt')) x.classList.remove('sel');
              b.classList.add('sel');
              answers[q.question] = o.label;
              other.value = '';
            }
          });
          opts.appendChild(b);
        }
        const other = el('input', 'other');
        other.placeholder = 'Alt răspuns…';
        other.addEventListener('input', () => {
          if (other.value.trim()) {
            for (const x of opts.querySelectorAll('.opt')) x.classList.remove('sel');
            answers[q.question] = other.value.trim();
          }
        });
        opts.appendChild(other);
        card.appendChild(opts);
      }
      const btns = el('div', 'btns');
      const ok = el('button', 'btn primary', 'Trimite răspunsul');
      const no = el('button', 'btn', 'Sari peste');
      ok.addEventListener('click', () => {
        answer(chat, reqId, { behavior: 'allow', updatedInput: { ...input, answers } });
        done('Răspuns trimis');
      });
      no.addEventListener('click', () => {
        answer(chat, reqId, { behavior: 'deny', message: 'Utilizatorul nu a răspuns la întrebări.' });
        done('Sărit');
      });
      btns.append(ok, no);
      card.appendChild(btns);
      add(chat, card);
      return;
    }

    if (tool === 'ExitPlanMode') {
      card.appendChild(el('div', 'q', 'Planul lui Claude'));
      const body = el('div', 'md');
      R.fillMd(body, input.plan || '');
      card.appendChild(body);
      const btns = el('div', 'btns');
      const ok = el('button', 'btn primary', 'Aprobă și începe');
      const no = el('button', 'btn', 'Continuă planificarea');
      ok.addEventListener('click', () => {
        answer(chat, reqId, { behavior: 'allow', updatedInput: input });
        chat.mode = 'default';
        $('#sel-mode').value = 'default';
        done('Plan aprobat');
      });
      no.addEventListener('click', () => {
        answer(chat, reqId, { behavior: 'deny', message: 'Utilizatorul vrea să mai lucrați la plan.' });
        done('Planificarea continuă');
      });
      btns.append(ok, no);
      card.appendChild(btns);
      add(chat, card);
      return;
    }

    const d = R.describe(tool, input);
    card.appendChild(el('div', 'q', `Claude vrea să folosească ${d.name}`));
    let detail = '';
    if (tool === 'Bash') detail = `$ ${input.command || ''}${input.description ? `\n\n# ${input.description}` : ''}`;
    else if (tool === 'Write') detail = `${input.file_path}\n\n${String(input.content || '').slice(0, 3000)}`;
    else if (tool === 'Edit') detail = `${input.file_path}\n\n- ${String(input.old_string || '').slice(0, 1500)}\n+ ${String(input.new_string || '').slice(0, 1500)}`;
    else if (tool === 'WebFetch') detail = input.url;
    else detail = JSON.stringify(input, null, 2).slice(0, 3000);
    if (detail) card.appendChild(el('pre', '', detail));
    const btns = el('div', 'btns');
    const ok = el('button', 'btn primary', 'Permite');
    const always = el('button', 'btn', `Permite mereu ${d.name} în acest chat`);
    const no = el('button', 'btn danger', 'Refuză');
    ok.addEventListener('click', () => {
      answer(chat, reqId, { behavior: 'allow', updatedInput: input });
      done('Permis');
    });
    always.addEventListener('click', () => {
      chat.allow.add(tool);
      answer(chat, reqId, { behavior: 'allow', updatedInput: input });
      done(`Permis mereu (${d.name})`);
    });
    no.addEventListener('click', () => {
      answer(chat, reqId, { behavior: 'deny', message: 'Utilizatorul a refuzat această acțiune.' });
      done('Refuzat');
    });
    btns.append(ok, always, no);
    card.appendChild(btns);
    add(chat, card);
    ok.focus();
  }

  // ---------------------------------------------------------------------------------------------
  // Atenție: insignă în listă + notificare Windows când chat-ul nu e în față
  // ---------------------------------------------------------------------------------------------

  function attention(chat, kind, title, body) {
    const away = chat !== S.active || !document.hasFocus();
    if (!away) return;
    if (chat !== S.active) chat.badge = kind;
    renderSessions();
    if (!store.get('notify', true)) return;
    try {
      const n = new Notification(title, { body, silent: kind === 'done' });
      n.onclick = () => {
        hb.focus();
        activate(chat);
      };
    } catch {}
  }

  // ---------------------------------------------------------------------------------------------
  // Fișiere modificate în conversație (tabul „Fișiere”)
  // ---------------------------------------------------------------------------------------------

  function recordEdit(chat, { name, input }) {
    const p = input.file_path || input.notebook_path;
    if (!p) return;
    let f = chat.files.get(p);
    if (!f) chat.files.set(p, (f = { path: p, changes: [], created: false, at: 0 }));
    f.at = Date.now();
    if (name === 'Write') {
      if (!f.changes.length) f.created = true;
      f.changes.push({ write: String(input.content ?? '') });
    } else if (name === 'MultiEdit') for (const e of input.edits || []) f.changes.push({ old: e.old_string, new: e.new_string });
    else if (name === 'NotebookEdit') f.changes.push({ write: String(input.new_source ?? '') });
    else f.changes.push({ old: input.old_string, new: input.new_string });
    if (chat === S.active) renderFiles();
  }

  function renderFiles() {
    const box = $('#files');
    const chat = S.active;
    const files = chat ? [...chat.files.values()].sort((a, b) => b.at - a.at) : [];
    $('#files-count').textContent = files.length ? String(files.length) : '';
    box.textContent = '';
    if (!files.length) {
      box.appendChild(el('div', 'empty', 'Fișierele pe care Claude le modifică în conversația asta apar aici, cu diferențele.'));
      return;
    }
    for (const f of files) {
      const item = el('div', 'file');
      const head = el('div', 'fh');
      const rel = chat.cwd && f.path.toLowerCase().startsWith(chat.cwd.toLowerCase()) ? f.path.slice(chat.cwd.length).replace(/^[\\/]+/, '') : f.path;
      head.append(el('span', 'p', rel));
      if (f.created) head.append(el('span', 'new', 'nou'));
      head.append(el('span', 'n', `${f.changes.length} ${f.changes.length === 1 ? 'modificare' : 'modificări'}`));
      const open = el('button', '', 'Deschide');
      open.addEventListener('click', (e) => {
        e.stopPropagation();
        hb.open(f.path);
      });
      const reveal = el('button', '', 'Folder');
      reveal.addEventListener('click', (e) => {
        e.stopPropagation();
        hb.reveal(f.path);
      });
      head.append(open, reveal);
      head.addEventListener('click', () => item.classList.toggle('open'));
      const body = el('div', 'fb');
      for (const c of f.changes) {
        if (c.write !== undefined) {
          const d = el('div', 'diff');
          for (const l of c.write.split('\n').slice(0, 400)) d.appendChild(el('div', 'add', `+ ${l}`));
          body.appendChild(d);
        } else body.appendChild(R.diffView(c.old, c.new));
      }
      item.append(head, body);
      box.appendChild(item);
    }
  }

  hb.onChatEvent((chatId, ev) => {
    const chat = S.chats.get(chatId);
    if (chat) handle(chat, ev);
  });
  hb.onChatExit((chatId, info) => {
    const chat = S.chats.get(chatId);
    if (!chat) return;
    chat.alive = false;
    const wasBusy = chat.busy;
    setBusy(chat, false);
    if (chat.closing) {
      chat.closing = false;
      return;
    }
    if (wasBusy || (info.code && info.code !== 0)) {
      const msg = info.error || (info.stderr || '').trim().split('\n').slice(-6).join('\n') || `Claude Code s-a oprit (cod ${info.code}).`;
      add(chat, el('div', 'errbox', msg));
      if (/login|authenticat|api key|oauth/i.test(msg)) showLoginBanner();
    }
    refreshHead();
  });

  // =============================================================================================
  // Compozitor
  // =============================================================================================

  const input = $('#input');
  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(280, input.scrollHeight)}px`;
  }
  input.addEventListener('input', autosize);

  function renderPending() {
    const box = $('#attachments');
    box.textContent = '';
    for (const p of S.pending) {
      const wrap = el('div', `pend${p.loading ? ' loading' : ''}`);
      if (p.loading) {
        const f = el('div', 'att-file');
        f.append(el('span', '', p.name), el('small', '', 'pregătesc…'));
        wrap.appendChild(f);
      } else {
        wrap.appendChild(R.attView(p.att));
        if (p.att.kind === 'video') wrap.appendChild(el('span', 'badge', `video · ${p.att.frames.length} cadre`));
        if (p.att.kind === 'pdf') wrap.appendChild(el('span', 'badge', 'PDF'));
      }
      const x = el('button', 'x', '×');
      x.addEventListener('click', () => {
        S.pending = S.pending.filter((q) => q !== p);
        renderPending();
      });
      wrap.appendChild(x);
      box.appendChild(wrap);
    }
  }

  async function addAttachments(promiseOrItems, names) {
    const holders = names.map((name) => ({ name, loading: true }));
    S.pending.push(...holders);
    renderPending();
    let res = [];
    try {
      res = await promiseOrItems;
    } catch (e) {
      res = holders.map((h) => ({ kind: 'error', name: h.name, error: e.message }));
    }
    holders.forEach((h, i) => {
      const a = res[i];
      if (!a || a.kind === 'error') {
        S.pending = S.pending.filter((q) => q !== h);
        if (a?.error && S.active) add(S.active, el('div', 'errbox', `${a.name}: ${a.error}`));
        return;
      }
      h.loading = false;
      h.att = a;
    });
    renderPending();
  }

  function attachPaths(paths) {
    if (!paths.length) return;
    addAttachments(hb.attachPaths(paths), paths.map(base));
  }

  async function attachFiles(files) {
    const paths = [];
    const bufs = [];
    for (const f of files) {
      const p = hb.pathOf(f);
      if (p) paths.push(p);
      else bufs.push(f);
    }
    attachPaths(paths);
    for (const f of bufs) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      addAttachments(hb.attachBuffer({ name: f.name || 'imagine.png', mime: f.type, bytes }).then((a) => [a]), [f.name || 'imagine']);
    }
  }

  function buildContent(text, atts) {
    const content = [];
    const files = [];
    for (const a of atts) {
      if (a.kind === 'image') content.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } });
      else if (a.kind === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name });
      else if (a.kind === 'video') {
        for (const f of a.frames) content.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.data } });
        content.push({
          type: 'text',
          text: `[Imaginile de mai sus sunt ${a.frames.length} cadre din video-ul „${a.name}” (${a.duration ? `${a.duration.toFixed(1)} s` : 'durată necunoscută'}), câte unul la ~${a.step.toFixed(1)} s, în ordine cronologică. Fișierul video: ${a.path}]`,
        });
      } else if (a.kind === 'text') content.push({ type: 'text', text: `Fișier atașat: ${a.path}\n\`\`\`\n${a.text}\n\`\`\`` });
      else files.push(`- ${a.path}${a.note ? ` (${a.note})` : ''}`);
    }
    if (files.length) content.push({ type: 'text', text: `Fișiere atașate (le poți citi de pe disc):\n${files.join('\n')}` });
    content.push({ type: 'text', text: text || 'Uită-te la atașamente.' });
    return content;
  }

  async function sendMessage() {
    const chat = S.active || newChat();
    if (/^\/(clear|new)\s*$/i.test(input.value.trim())) {
      input.value = '';
      autosize();
      hideSlash();
      activate(makeChat({ cwd: chat.cwd }));
      return;
    }
    if (chat.busy) return;
    if (S.pending.some((p) => p.loading)) return;
    const text = input.value.trim();
    const atts = S.pending.map((p) => p.att);
    if (!text && !atts.length) return;
    input.value = '';
    autosize();
    S.pending = [];
    renderPending();
    if (!chat.title) chat.title = (text || atts[0]?.name || 'Chat').replace(/\s+/g, ' ').slice(0, 80);
    S.lastDir = chat.cwd;
    store.set('lastDir', chat.cwd);
    chat.stick = true;
    add(chat, R.userMsg(text, atts));
    document.body.classList.add('has-chat');
    renderWelcome();
    setBusy(chat, true);
    if (!(await ensureProc(chat))) return setBusy(chat, false);
    const ok = await hb.chatSend(chat.id, buildContent(text, atts));
    if (!ok) {
      setBusy(chat, false);
      add(chat, el('div', 'errbox', 'Nu am putut trimite mesajul (Claude Code nu rulează).'));
    }
    refreshHead();
    renderSessions();
  }

  // Comenzi cu „/”: lista vine de la Claude Code (inclusiv comenzile și skill-urile tale) + /clear.
  const slash = $('#slash');
  let slashItems = [];
  let slashSel = 0;
  function hideSlash() {
    slash.hidden = true;
    slashItems = [];
  }
  function showSlash() {
    const m = /^\/(\S*)$/.exec(input.value);
    if (!m) return hideSlash();
    const q = m[1].toLowerCase();
    const all = [...LOCAL_COMMANDS, ...S.commands.filter((c) => !LOCAL_COMMANDS.some((l) => l.name === c.name))];
    slashItems = all
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
      .slice(0, 40);
    if (!slashItems.length) return hideSlash();
    slashSel = Math.min(slashSel, slashItems.length - 1);
    slash.textContent = '';
    slashItems.forEach((c, i) => {
      const b = el('button', i === slashSel ? 'sel' : '');
      const name = el('b', '', `/${c.name}`);
      if (c.argumentHint) name.appendChild(el('i', '', c.argumentHint));
      b.appendChild(name);
      if (c.description) b.appendChild(el('small', '', c.description));
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pickSlash(i, false);
      });
      slash.appendChild(b);
    });
    slash.hidden = false;
    slash.children[slashSel]?.scrollIntoView({ block: 'nearest' });
  }
  function pickSlash(i, run) {
    const c = slashItems[i];
    if (!c) return;
    input.value = `/${c.name}${c.local || !c.argumentHint ? '' : ' '}`;
    hideSlash();
    autosize();
    if (run && (c.local || !c.argumentHint)) sendMessage();
    else input.focus();
  }
  input.addEventListener('input', () => {
    slashSel = 0;
    showSlash();
  });
  input.addEventListener('blur', () => setTimeout(hideSlash, 150));

  input.addEventListener('keydown', (e) => {
    if (!slash.hidden && slashItems.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        slashSel = (slashSel + (e.key === 'ArrowDown' ? 1 : slashItems.length - 1)) % slashItems.length;
        showSlash();
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        pickSlash(slashSel, e.key === 'Enter');
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideSlash();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });
  input.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    let files = [...(cd?.files || [])];
    if (!files.length) files = [...(cd?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) {
      e.preventDefault();
      attachFiles(files);
      return;
    }
    // Captură din Windows (Win+Shift+S / PrtScn): uneori ajunge doar în clipboard-ul sistemului.
    if (!cd?.getData('text/plain')) {
      e.preventDefault();
      addAttachments(hb.clipImage().then((a) => (a ? [a] : [])), ['clipboard']);
    }
  });
  $('#btn-send').addEventListener('click', () => {
    if (S.active?.busy) hb.chatInterrupt(S.active.id);
    else sendMessage();
  });
  // Meniul de atașare: fișiere, captură de ecran (zonă / tot ecranul), poză cu camera.
  const menu = $('#attach-menu');
  $('#btn-attach').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
  });
  menu.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    menu.hidden = true;
    if (act === 'files') attachPaths(await hb.pickFiles());
    else if (act === 'region' || act === 'screen') addAttachments(hb.capture(act).then((a) => (a ? [a] : [])), [act === 'region' ? 'captură' : 'ecran']);
    else if (act === 'camera') openCamera();
    input.focus();
  });

  // Camera
  let camStream;
  async function startCam(deviceId) {
    camStream?.getTracks().forEach((t) => t.stop());
    camStream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, width: 1920, height: 1080 } : { width: 1920, height: 1080 }, audio: false });
    $('#cam-video').srcObject = camStream;
  }
  async function openCamera() {
    $('#camera').hidden = false;
    try {
      await startCam();
      const sel = $('#cam-select');
      sel.textContent = '';
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      cams.forEach((d, i) => {
        const o = el('option', '', d.label || `Camera ${i + 1}`);
        o.value = d.deviceId;
        sel.appendChild(o);
      });
      sel.hidden = cams.length < 2;
    } catch (err) {
      closeCamera();
      if (S.active) add(S.active, el('div', 'errbox', `Camera nu a pornit: ${err.message}`));
    }
  }
  function closeCamera() {
    camStream?.getTracks().forEach((t) => t.stop());
    camStream = undefined;
    $('#camera').hidden = true;
  }
  $('#cam-select').addEventListener('change', (e) => startCam(e.target.value).catch(() => {}));
  $('#cam-cancel').addEventListener('click', closeCamera);
  $('#cam-shoot').addEventListener('click', () => {
    const v = $('#cam-video');
    if (!v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(async (blob) => {
      closeCamera();
      if (!blob) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      addAttachments(hb.attachBuffer({ name: `poza-${Date.now()}.jpg`, mime: 'image/jpeg', bytes }).then((a) => [a]), ['poză']);
      input.focus();
    }, 'image/jpeg', 0.9);
  });
  $('#sel-model').addEventListener('change', (e) => {
    store.set('model', e.target.value);
    if (S.active) {
      S.active.model = e.target.value;
      restartLater(S.active);
    }
  });
  $('#sel-mode').addEventListener('change', (e) => {
    store.set('mode', e.target.value);
    if (S.active) {
      S.active.mode = e.target.value;
      restartLater(S.active);
    }
  });

  // Drag & drop oriunde în fereastră (fișiere din Explorer, poze trase din browser). Cât timp tragi, un strat
  // acoperă tot, inclusiv panoul Habblaud, ca să prindă și picăturile de deasupra lui.
  const droppable = (dt) => {
    const types = [...(dt?.types || [])];
    return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/html');
  };
  const endDrag = () => document.body.classList.remove('dragover');
  document.addEventListener('dragenter', (e) => {
    if (!droppable(e.dataTransfer)) return;
    e.preventDefault();
    document.body.classList.add('dragover');
  });
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (droppable(e.dataTransfer)) document.body.classList.add('dragover');
  });
  $('#drop').addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) endDrag();
  });
  window.addEventListener('blur', endDrag);
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    endDrag();
    const dt = e.dataTransfer;
    const files = [...(dt?.files || [])];
    if (files.length) return attachFiles(files);
    // Imagine trasă dintr-o pagină: adresa ei.
    let url = (dt?.getData('text/uri-list') || '').split('\n').find((l) => l && !l.startsWith('#'));
    if (!url) {
      const m = /<img[^>]+src="([^"]+)"/i.exec(dt?.getData('text/html') || '');
      if (m) url = m[1];
    }
    if (url && /^https?:/i.test(url.trim())) addAttachments(hb.attachUrl(url.trim()).then((a) => [a]), [url.trim().split('/').pop() || 'imagine']);
    else if (url && /^data:image\//i.test(url)) {
      const [head, b64] = url.split(',');
      const mime = /data:([^;]+)/.exec(head)?.[1] || 'image/png';
      const bytes = Uint8Array.from(atob(b64 || ''), (c) => c.charCodeAt(0));
      attachFiles([new File([bytes], `imagine.${mime.split('/')[1] || 'png'}`, { type: mime })]);
    }
  });

  // =============================================================================================
  // Bara laterală
  // =============================================================================================

  let sessTimer;
  function scheduleSessions() {
    clearTimeout(sessTimer);
    sessTimer = setTimeout(loadSessions, 800);
  }
  async function loadSessions() {
    try {
      S.sessions = await hb.historyList();
    } catch {
      S.sessions = [];
    }
    // Titlul chat-urilor deschise din istoric.
    for (const c of S.chats.values()) {
      const s = S.sessions.find((x) => x.sessionId === c.sessionId);
      if (s && !c.file) c.file = s.file;
    }
    renderSessions();
    renderWelcome();
  }

  function dayGroup(ms) {
    const d = new Date(ms);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ms >= start) return 'Azi';
    if (ms >= start - 86400000) return 'Ieri';
    if (ms >= start - 6 * 86400000) return 'Ultimele 7 zile';
    if (ms >= start - 29 * 86400000) return 'Ultimele 30 de zile';
    return d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
  }

  function renderSessions() {
    const box = $('#sessions');
    const q = $('#search').value.trim().toLowerCase();
    box.textContent = '';
    const live = new Map();
    for (const c of S.chats.values()) if (c.sessionId) live.set(c.sessionId, c);

    // Chat-uri noi, fără sesiune încă.
    const fresh = [...S.chats.values()].filter((c) => !c.sessionId && c.hasMsgs);
    const items = [
      ...fresh.map((c) => ({ chat: c, title: c.title, cwd: c.cwd, mtime: Date.now() })),
      ...S.sessions.map((s) => ({ s, chat: live.get(s.sessionId), title: live.get(s.sessionId)?.title || s.title, cwd: s.cwd, mtime: s.mtime })),
    ].filter((it) => !q || (it.title || '').toLowerCase().includes(q) || (it.cwd || '').toLowerCase().includes(q));

    let group = '';
    for (const it of items) {
      const g = dayGroup(it.mtime);
      if (g !== group) {
        group = g;
        box.appendChild(el('div', 'group', g));
      }
      const b = el('button', 'sess');
      if (it.chat && it.chat === S.active) b.classList.add('active');
      if (it.chat?.alive) b.classList.add('live');
      if (it.chat?.busy) b.classList.add('live', 'busy');
      b.append(el('span', 't', it.title || 'Fără titlu'), el('span', 'p', base(it.cwd)));
      if (it.chat?.badge) b.appendChild(el('span', `badge ${it.chat.badge}`, it.chat.badge === 'wait' ? 'te așteaptă' : 'gata'));
      b.title = `${it.title}\n${it.cwd || ''}`;
      b.addEventListener('click', () => (it.chat ? activate(it.chat) : openSession(it.s)));
      box.appendChild(b);
    }
    if (!items.length) box.appendChild(el('div', 'group', q ? 'Nimic găsit' : 'Nicio conversație încă'));
  }
  $('#search').addEventListener('input', renderSessions);

  function recentDirs() {
    const out = [];
    for (const d of [S.lastDir, ...S.sessions.map((s) => s.cwd)]) {
      if (d && !out.some((x) => sameDir(x, d))) out.push(d);
      if (out.length >= 8) break;
    }
    return out;
  }

  function renderWelcome() {
    const box = $('#recent-dirs');
    box.textContent = '';
    const c = S.active;
    for (const d of recentDirs()) {
      const b = el('button', 'chip');
      b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>';
      b.appendChild(el('span', '', base(d)));
      b.title = d;
      if (c && sameDir(c.cwd, d)) b.style.outline = '1px solid var(--accent)';
      b.addEventListener('click', () => {
        if (!S.active) return;
        S.active.cwd = d;
        R.setCwd(d);
        TERM.setCwd(d);
        refreshHead();
        renderWelcome();
        input.focus();
      });
      box.appendChild(b);
    }
    const other = el('button', 'chip', 'Alt folder…');
    other.addEventListener('click', pickDir);
    box.appendChild(other);
  }

  async function pickDir() {
    const c = S.active;
    if (!c) return;
    const d = await hb.pickFolder(c.cwd);
    if (!d) return;
    c.cwd = d;
    S.lastDir = d;
    store.set('lastDir', d);
    R.setCwd(d);
    TERM.setCwd(d);
    refreshHead();
    renderWelcome();
  }

  $('#cwd').addEventListener('click', () => {
    const c = S.active;
    if (!c) return;
    if (c.hasMsgs || c.sessionId) hb.open(c.cwd);
    else pickDir();
  });
  $('#btn-new').addEventListener('click', () => newChat(S.lastDir));

  // =============================================================================================
  // Panou dreapta (Habblaud / Terminal), separator, scurtături
  // =============================================================================================

  const panel = $('#panel');
  const app = $('#app');
  const pw = store.get('panelW', 0);
  if (pw) app.style.setProperty('--panel-w', `${pw}px`);
  if (store.get('noPanel', false)) document.body.classList.add('no-panel');
  if (store.get('noSide', false)) document.body.classList.add('no-side');

  function showTab(name) {
    for (const b of document.querySelectorAll('#ptabs [data-tab]')) b.classList.toggle('active', b.dataset.tab === name);
    for (const p of document.querySelectorAll('.pt')) p.classList.toggle('active', p.id === `pt-${name}`);
    if (name === 'terminal') TERM.ensure();
    document.body.classList.remove('no-panel');
  }
  for (const b of document.querySelectorAll('#ptabs [data-tab]')) b.addEventListener('click', () => showTab(b.dataset.tab));

  const togglePanel = () => {
    document.body.classList.toggle('no-panel');
    store.set('noPanel', document.body.classList.contains('no-panel'));
    TERM.fit();
  };
  const toggleSide = () => {
    document.body.classList.toggle('no-side');
    store.set('noSide', document.body.classList.contains('no-side'));
  };
  $('#btn-panel').addEventListener('click', togglePanel);
  $('#btn-side').addEventListener('click', toggleSide);

  const split = $('#split');
  split.addEventListener('pointerdown', (e) => {
    split.setPointerCapture(e.pointerId);
    split.classList.add('drag');
    document.body.classList.add('dragging');
    const move = (ev) => {
      const w = Math.min(window.innerWidth - 420, Math.max(340, window.innerWidth - ev.clientX));
      app.style.setProperty('--panel-w', `${w}px`);
      store.set('panelW', w);
    };
    const up = () => {
      split.classList.remove('drag');
      document.body.classList.remove('dragging');
      split.removeEventListener('pointermove', move);
      split.removeEventListener('pointerup', up);
      TERM.fit();
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up);
  });
  split.addEventListener('dblclick', () => {
    app.style.removeProperty('--panel-w');
    store.set('panelW', 0);
  });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === 'n') {
      e.preventDefault();
      newChat(S.lastDir);
    } else if (e.ctrlKey && k === 'b') {
      e.preventDefault();
      toggleSide();
    } else if (e.ctrlKey && k === 'j') {
      e.preventDefault();
      togglePanel();
    } else if (e.ctrlKey && k === 'k') {
      e.preventDefault();
      if (document.body.classList.contains('no-side')) toggleSide();
      $('#search').focus();
    } else if (e.key === 'Escape' && S.active?.busy) {
      hb.chatInterrupt(S.active.id);
    }
  });

  // Habblaud în webview.
  const wv = $('#hb');
  wv.addEventListener('dom-ready', () => {
    wv.executeJavaScript("try{if(!localStorage.getItem('habblaud:locale')){localStorage.setItem('habblaud:locale','ro');location.reload()}}catch(e){}").catch(() => {});
  });
  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return;
    setTimeout(() => wv.reload(), 2500);
  });
  $('#btn-reload').addEventListener('click', async () => {
    const r = await hb.server();
    if (r.ok) {
      if (wv.getURL && wv.getURL().startsWith(r.url)) wv.reload();
      else wv.src = r.url;
      $('#hb-loading').style.display = 'none';
    }
  });

  async function startServer() {
    const l = $('#hb-loading');
    const r = await hb.server();
    if (r.ok) {
      l.style.display = 'none';
      wv.src = r.url;
    } else {
      l.textContent = r.msg;
      l.classList.add('err');
    }
  }

  // =============================================================================================
  // Banner, setup, pornire
  // =============================================================================================

  function showBanner(text, btnText, onClick) {
    const b = $('#banner');
    b.textContent = '';
    b.appendChild(el('span', 'grow', text));
    if (btnText) {
      const btn = el('button', '', btnText);
      btn.addEventListener('click', onClick);
      b.appendChild(btn);
    }
    b.hidden = false;
  }
  function hideBanner() {
    $('#banner').hidden = true;
  }
  function showLoginBanner() {
    showBanner('Nu ești autentificat în Claude Code. Deschide terminalul din dreapta, scrie /login și urmează pașii din browser.', 'Autentifică-te', () => {
      showTab('terminal');
      TERM.open('claude', S.info.home);
    });
  }

  function renderFoot() {
    const f = $('#side-foot');
    f.textContent = '';
    f.appendChild(el('span', '', S.info.claude ? `Claude Code ${S.info.claudeVersion || ''}`.trim() : 'Claude Code nu e instalat'));
    const t = el('button', '', 'Deschide un terminal');
    t.addEventListener('click', () => showTab('terminal'));
    f.appendChild(t);
    const sb = el('button', '', 'Setări');
    sb.addEventListener('click', (e) => {
      e.stopPropagation();
      openSettings();
    });
    f.appendChild(sb);
    f.appendChild(el('span', '', `Habblaud Desktop ${S.info.version || ''}`));
  }

  hb.onSetupLog((t) => {
    const logBox = $('#setup-log');
    logBox.textContent += `${t}\n`;
    logBox.scrollTop = logBox.scrollHeight;
    $('#setup-step').textContent = t;
  });

  async function runSetup(blocking) {
    const modal = $('#setup');
    if (blocking) modal.hidden = false;
    await hb.setup();
    S.info = await hb.info();
    modal.hidden = true;
  }

  async function boot() {
    S.info = await hb.info();
    renderFoot();
    newChat(S.lastDir || S.info.home);
    loadSessions();
    startServer();
    setInterval(loadSessions, 30000);

    const needBlocking = !S.info.claude || !S.info.git;
    if (needBlocking || !S.info.mod) await runSetup(needBlocking);
    renderFoot();
    if (!S.info.claude) {
      showBanner('Claude Code nu s-a putut instala automat.', 'Încearcă din nou', async () => {
        await runSetup(true);
        renderFoot();
        if (S.info.claude) hideBanner();
      });
    } else if (!S.info.loggedIn) showLoginBanner();
    if (S.active && !S.active.cwd) S.active.cwd = S.info.home;
    refreshHead();
  }

  // Setări (pornire cu Windows, tray, notificări)
  const setMenu = $('#settings-menu');
  async function openSettings() {
    const s = await hb.settingsGet();
    $('#set-login').checked = !!s.openAtLogin;
    $('#set-tray').checked = !!s.keepInTray;
    $('#set-notify').checked = store.get('notify', true);
    setMenu.hidden = !setMenu.hidden;
  }
  document.addEventListener('click', (e) => {
    if (!setMenu.hidden && !setMenu.contains(e.target)) setMenu.hidden = true;
  });
  $('#set-login').addEventListener('change', (e) => hb.settingsSet({ openAtLogin: e.target.checked }));
  $('#set-tray').addEventListener('change', (e) => hb.settingsSet({ keepInTray: e.target.checked }));
  $('#set-notify').addEventListener('change', (e) => {
    store.set('notify', e.target.checked);
    if (e.target.checked && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  });

  // Actualizare: descărcată în fundal, instalată la un click (sau la următoarea ieșire).
  function onUpdate(s) {
    if (s?.state !== 'ready') return;
    showBanner(`Versiunea nouă ${s.version || ''} e gata.`.replace('  ', ' '), 'Repornește acum', () => hb.installUpdate());
  }
  hb.onUpdate(onUpdate);
  hb.updateStatus().then(onUpdate).catch(() => {});
  hb.onNewChat(() => newChat(S.lastDir));

  // Para os testes: muda o folder do chat ativo.
  window.__setCwd = (d) => {
    if (!S.active) return;
    S.active.cwd = d;
    R.setCwd(d);
    TERM.setCwd(d);
    refreshHead();
  };

  boot();
})();
