/* global marked, DOMPurify, hljs, hb */
// Desenarea mesajelor: markdown, gândire, unelte, permisiuni.
(() => {
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  marked.setOptions({ gfm: true, breaks: false });

  function md(text) {
    const html = DOMPurify.sanitize(marked.parse(text || ''), { ADD_ATTR: ['target'] });
    return html;
  }

  /** Pune markdown-ul în nod, cu evidențiere de cod și butoane de copiere. */
  function fillMd(node, text, final = true) {
    node.innerHTML = md(text);
    for (const a of node.querySelectorAll('a')) a.setAttribute('target', '_blank');
    if (!final) return;
    for (const code of node.querySelectorAll('pre code')) {
      try {
        hljs.highlightElement(code);
      } catch {}
      const pre = code.parentElement;
      const b = el('button', 'copy', 'Copiază');
      b.addEventListener('click', () => {
        hb.writeClip(code.innerText);
        b.textContent = 'Copiat ✓';
        setTimeout(() => (b.textContent = 'Copiază'), 1200);
      });
      pre.appendChild(b);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Unelte
  // ---------------------------------------------------------------------------------------------

  const ICONS = {
    Bash: '<svg viewBox="0 0 24 24"><path d="M4 17l6-5-6-5M12 19h8"/></svg>',
    Read: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    Write: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6M12 18v-6M9 15h6"/></svg>',
    Edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
    Search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    Web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></svg>',
    Agent: '<svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01"/></svg>',
    Todo: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/></svg>',
    Tool: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/></svg>',
  };

  let cwdBase = '';
  const rel = (p) => {
    if (!p) return '';
    const s = String(p);
    if (cwdBase && s.toLowerCase().startsWith(cwdBase.toLowerCase())) return s.slice(cwdBase.length).replace(/^[\\/]+/, '') || '.';
    return s;
  };

  /** Titlu, rezumat și icon pentru o unealtă. */
  function describe(name, input = {}) {
    const n = name || '';
    if (n === 'Bash') return { icon: 'Bash', name: 'Bash', sum: input.description || input.command || '' };
    if (n === 'BashOutput' || n === 'KillShell' || n === 'KillBash') return { icon: 'Bash', name: n, sum: input.bash_id || input.shell_id || '' };
    if (n === 'Read') return { icon: 'Read', name: 'Citește', sum: rel(input.file_path) };
    if (n === 'Write') return { icon: 'Write', name: 'Scrie', sum: rel(input.file_path) };
    if (n === 'Edit' || n === 'MultiEdit') return { icon: 'Edit', name: 'Editează', sum: rel(input.file_path) };
    if (n === 'NotebookEdit') return { icon: 'Edit', name: 'Notebook', sum: rel(input.notebook_path) };
    if (n === 'Grep') return { icon: 'Search', name: 'Caută', sum: `${input.pattern || ''}${input.path ? `  în ${rel(input.path)}` : ''}` };
    if (n === 'Glob') return { icon: 'Search', name: 'Fișiere', sum: input.pattern || '' };
    if (n === 'LS') return { icon: 'Search', name: 'Listează', sum: rel(input.path) };
    if (n === 'WebFetch') return { icon: 'Web', name: 'Web', sum: input.url || '' };
    if (n === 'WebSearch') return { icon: 'Web', name: 'Caută pe web', sum: input.query || '' };
    if (n === 'Task' || n === 'Agent') return { icon: 'Agent', name: `Agent${input.subagent_type ? ` · ${input.subagent_type}` : ''}`, sum: input.description || '' };
    if (n === 'TodoWrite') return { icon: 'Todo', name: 'Sarcini', sum: '' };
    if (n.startsWith('mcp__')) {
      const parts = n.split('__');
      return { icon: 'Tool', name: parts.slice(1).join(' · '), sum: shortJson(input) };
    }
    return { icon: 'Tool', name: n, sum: shortJson(input) };
  }

  function shortJson(o) {
    try {
      const s = JSON.stringify(o);
      return s === '{}' ? '' : s.slice(0, 200);
    } catch {
      return '';
    }
  }

  function diffView(oldS, newS) {
    const box = el('div', 'diff');
    for (const l of String(oldS ?? '').split('\n')) box.appendChild(el('div', 'del', `- ${l}`));
    for (const l of String(newS ?? '').split('\n')) box.appendChild(el('div', 'add', `+ ${l}`));
    return box;
  }

  function resultText(content) {
    if (content == null) return { text: '', images: [] };
    if (typeof content === 'string') return { text: content, images: [] };
    const images = [];
    const text = (Array.isArray(content) ? content : [content])
      .map((b) => {
        if (b.type === 'text') return b.text;
        if (b.type === 'image' && b.source?.data) images.push(`data:${b.source.media_type};base64,${b.source.data}`);
        return '';
      })
      .filter(Boolean)
      .join('\n');
    return { text, images };
  }

  function clip(s, n = 20000) {
    s = String(s ?? '');
    return s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} caractere tăiate)` : s;
  }

  /** Card de unealtă. Întoarce { node, setInput, setResult, addSub }. */
  function toolCard(name, input) {
    const node = el('div', 'tool run');
    const th = el('div', 'th');
    const ic = el('span', 'ic');
    const nm = el('span', 'name');
    const sum = el('span', 'sum');
    const st = el('span', 'st');
    th.append(ic, nm, sum, st);
    const tb = el('div', 'tb');
    node.append(th, tb);
    th.addEventListener('click', () => node.classList.toggle('open'));
    const inBox = el('div');
    const outBox = el('div');
    const subBox = el('div', 'sub');
    tb.append(inBox, outBox, subBox);
    let curName = name;
    let curInput = input || {};

    function setInput(inp, nameOverride) {
      if (nameOverride) curName = nameOverride;
      curInput = inp || {};
      const d = describe(curName, curInput);
      ic.innerHTML = ICONS[d.icon] || ICONS.Tool;
      nm.textContent = d.name;
      sum.textContent = d.sum;
      sum.title = d.sum;
      inBox.textContent = '';
      node.classList.toggle('todo', curName === 'TodoWrite');
      if (curName === 'Bash') {
        inBox.appendChild(el('pre', 'cmd', `$ ${curInput.command || ''}`));
      } else if (curName === 'Edit') {
        inBox.appendChild(diffView(curInput.old_string, curInput.new_string));
      } else if (curName === 'MultiEdit') {
        for (const e of curInput.edits || []) inBox.appendChild(diffView(e.old_string, e.new_string));
      } else if (curName === 'Write') {
        inBox.appendChild(el('div', 'lbl', rel(curInput.file_path)));
        inBox.appendChild(el('pre', '', clip(curInput.content, 8000)));
      } else if (curName === 'TodoWrite') {
        const ul = el('ul', 'todos');
        for (const t of curInput.todos || []) {
          const li = el('li', t.status);
          li.append(el('span', '', t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'), el('span', '', t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content));
          ul.appendChild(li);
        }
        inBox.appendChild(ul);
      } else if (curName === 'Task' || curName === 'Agent') {
        if (curInput.prompt) {
          inBox.appendChild(el('div', 'lbl', 'Instrucțiuni'));
          inBox.appendChild(el('pre', '', clip(curInput.prompt, 4000)));
        }
      } else if (curName === 'Read' || curName === 'Glob' || curName === 'Grep' || curName === 'LS') {
        // rezumatul spune tot
      } else if (Object.keys(curInput).length) {
        inBox.appendChild(el('div', 'lbl', 'Parametri'));
        inBox.appendChild(el('pre', '', clip(JSON.stringify(curInput, null, 2), 6000)));
      }
    }

    function setResult(content, isError) {
      node.classList.remove('run');
      node.classList.add(isError ? 'err' : 'ok');
      if (curName === 'TodoWrite' && !isError) return;
      const { text, images } = resultText(content);
      outBox.textContent = '';
      if (curName === 'Edit' || curName === 'MultiEdit' || curName === 'Write') {
        if (!isError) return;
      }
      if (text) {
        outBox.appendChild(el('div', 'lbl', isError ? 'Eroare' : 'Rezultat'));
        outBox.appendChild(el('pre', '', clip(text)));
      }
      for (const src of images) {
        const img = el('img', 'res');
        img.src = src;
        outBox.appendChild(img);
      }
      if (isError) node.classList.add('open');
    }

    function addSub(line) {
      subBox.appendChild(el('div', '', line));
      while (subBox.children.length > 40) subBox.firstChild.remove();
    }

    setInput(curInput);
    return { node, setInput, setResult, addSub };
  }

  // ---------------------------------------------------------------------------------------------
  // Mesaje utilizator
  // ---------------------------------------------------------------------------------------------

  function fmtSize(n) {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function lightbox(src) {
    const lb = el('div');
    lb.id = 'lightbox';
    const img = el('img');
    img.src = src;
    lb.appendChild(img);
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
  }

  /** Previzualizare atașament (și în compozitor, și în mesaj). */
  function attView(a) {
    const thumb = a.thumb || (a.kind === 'image' && a.data ? `data:${a.mediaType};base64,${a.data}` : '');
    if (thumb) {
      const img = el('img', 'att-thumb');
      img.src = thumb;
      img.title = a.name || '';
      img.addEventListener('click', () => lightbox(a.kind === 'image' && a.data ? `data:${a.mediaType};base64,${a.data}` : thumb));
      return img;
    }
    const f = el('div', 'att-file');
    const label = a.kind === 'pdf' ? 'PDF' : a.kind === 'text' ? 'Text' : a.kind === 'video' ? 'Video' : a.dir ? 'Folder' : 'Fișier';
    f.append(el('span', '', `📄 ${a.name || ''}`), el('small', '', `${label}${a.size ? ` · ${fmtSize(a.size)}` : ''}`));
    f.title = a.path || a.name || '';
    if (a.path) f.addEventListener('click', () => hb.open(a.path));
    return f;
  }

  function userMsg(text, atts = []) {
    const m = el('div', 'msg user');
    if (atts.length) {
      const box = el('div', 'atts');
      for (const a of atts) box.appendChild(attView(a));
      m.appendChild(box);
    }
    if (text) m.appendChild(el('div', 'bubble', text));
    return m;
  }

  /** Mesaj de utilizator din istoric (content API). */
  function userFromContent(content) {
    if (typeof content === 'string') return userMsg(content);
    const atts = [];
    const texts = [];
    for (const b of content || []) {
      if (b.type === 'text') texts.push(b.text);
      else if (b.type === 'image' && b.source?.data) atts.push({ kind: 'image', mediaType: b.source.media_type, data: b.source.data });
      else if (b.type === 'document') atts.push({ kind: 'pdf', name: b.title || 'document.pdf' });
    }
    return userMsg(texts.join('\n\n').trim(), atts);
  }

  // ---------------------------------------------------------------------------------------------
  // Asistent
  // ---------------------------------------------------------------------------------------------

  function textBlock() {
    const node = el('div', 'msg assistant md');
    let text = '';
    let pending = false;
    let done = false;
    return {
      node,
      append(t) {
        text += t;
        if (pending || done) return;
        pending = true;
        requestAnimationFrame(() => {
          pending = false;
          if (done) return;
          fillMd(node, text, false);
          node.classList.add('cursor');
        });
      },
      set(t) {
        text = t;
        done = true;
        fillMd(node, text, true);
      },
      finish() {
        done = true;
        node.classList.remove('cursor');
        fillMd(node, text, true);
      },
      get text() {
        return text;
      },
    };
  }

  function thinkBlock() {
    const node = el('details', 'think');
    const s = el('summary', '', 'Gândire…');
    const body = el('div', 'md');
    node.append(s, body);
    let text = '';
    return {
      node,
      append(t) {
        text += t;
        body.textContent = text;
      },
      set(t) {
        text = t;
        body.textContent = t;
      },
      finish() {
        s.textContent = 'Gândire';
      },
    };
  }

  window.R = { el, md, fillMd, diffView, toolCard, describe, userMsg, userFromContent, attView, textBlock, thinkBlock, fmtSize, lightbox, setCwd: (c) => (cwdBase = c || '') };
})();
