/* global hb */
// Tabul „Terminal” din panoul din dreapta: PowerShell sau `claude` interactiv (autentificare).
(() => {
  const XTerm = window.Terminal?.Terminal ?? window.Terminal;
  const Fit = window.FitAddon?.FitAddon ?? window.FitAddon;
  const host = document.getElementById('term-host');
  const tabsBar = document.getElementById('term-tabs');
  const terms = new Map();
  let active;
  let defaultCwd = '';

  const THEME = {
    background: '#1a1a19', foreground: '#e8e6dc', cursor: '#d97757', selectionBackground: '#4a4a46',
    black: '#262624', red: '#e5736a', green: '#7bc47f', yellow: '#e3b55c', blue: '#7aa7e8', magenta: '#c792ea', cyan: '#78c8d8', white: '#e8e6dc',
    brightBlack: '#6b6963', brightRed: '#f09a92', brightGreen: '#a5dba8', brightYellow: '#f0cd85', brightBlue: '#a3c3f0', brightMagenta: '#ddb6f2', brightCyan: '#a6dfe9', brightWhite: '#ffffff',
  };

  function fit(t) {
    if (!t || !t.el.classList.contains('active') || !host.offsetWidth) return;
    try {
      t.fit.fit();
      if (t.id) hb.ptyResize(t.id, t.term.cols, t.term.rows);
    } catch {}
  }

  function activate(key) {
    active = key;
    for (const [k, t] of terms) {
      t.el.classList.toggle('active', k === key);
      t.tab.classList.toggle('active', k === key);
    }
    const t = terms.get(key);
    if (t)
      requestAnimationFrame(() => {
        fit(t);
        t.term.focus();
      });
  }

  function close(key) {
    const t = terms.get(key);
    if (!t) return;
    if (t.id && !t.dead) hb.ptyKill(t.id);
    t.term.dispose();
    t.el.remove();
    t.tab.remove();
    terms.delete(key);
    activate([...terms.keys()].pop());
  }

  async function open(kind = 'shell', cwd = defaultCwd) {
    const key = `t${Date.now()}${Math.random()}`;
    const el = document.createElement('div');
    el.className = 'term active';
    host.appendChild(el);
    const term = new XTerm({ fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, monospace", fontSize: 13, cursorBlink: true, scrollback: 10000, theme: THEME, allowProposedApi: true });
    const f = new Fit();
    term.loadAddon(f);
    term.open(el);
    try {
      f.fit();
    } catch {}
    const tab = document.createElement('div');
    tab.className = 'tt';
    const label = document.createElement('span');
    const x = document.createElement('button');
    x.className = 'x';
    x.textContent = '×';
    tab.append(label, x);
    tabsBar.insertBefore(tab, addBtn);
    const t = { term, fit: f, el, tab, kind, dead: false };
    terms.set(key, t);
    tab.addEventListener('click', () => activate(key));
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      close(key);
    });
    activate(key);

    const r = await hb.ptyCreate({ kind, cwd, cols: term.cols, rows: term.rows });
    if (r.error) {
      term.write(`\x1b[31m${r.error}\x1b[0m\r\n`);
      t.dead = true;
      label.textContent = 'Eroare';
      return;
    }
    t.id = r.id;
    const base = (r.cwd || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    label.textContent = kind === 'claude' ? 'claude' : base || 'Terminal';
    tab.title = r.cwd || '';
    term.onData((d) => !t.dead && hb.ptyWrite(t.id, d));
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === 'c' && term.hasSelection()) {
        hb.writeClip(term.getSelection());
        term.clearSelection();
        return false;
      }
      if (e.ctrlKey && k === 'v') {
        hb.readClip().then((txt) => txt && hb.ptyWrite(t.id, txt));
        e.preventDefault();
        return false;
      }
      return true;
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (term.hasSelection()) {
        hb.writeClip(term.getSelection());
        term.clearSelection();
      } else hb.readClip().then((txt) => txt && hb.ptyWrite(t.id, txt));
    });
  }

  hb.onPtyData((id, d) => {
    for (const t of terms.values()) if (t.id === id) t.term.write(d);
  });
  hb.onPtyExit((id, code) => {
    for (const t of terms.values())
      if (t.id === id) {
        t.dead = true;
        t.term.write(`\r\n\x1b[90m[proces încheiat, cod ${code}]\x1b[0m\r\n`);
        t.tab.style.opacity = '.55';
      }
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'add';
  addBtn.textContent = '＋ PowerShell';
  addBtn.addEventListener('click', () => open('shell'));
  tabsBar.appendChild(addBtn);

  new ResizeObserver(() => fit(terms.get(active))).observe(host);

  window.TERM = {
    open,
    setCwd: (c) => (defaultCwd = c || ''),
    ensure: () => {
      if (!terms.size) open('shell');
      else fit(terms.get(active));
    },
    fit: () => fit(terms.get(active)),
  };
})();
