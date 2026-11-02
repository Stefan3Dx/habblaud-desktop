// Istoricul conversațiilor Claude Code: <config>/projects/<proiect>/<sesiune>.jsonl
const fs = require('node:fs');
const path = require('node:path');
const { claudeConfigDirs } = require('./util');

const cache = new Map(); // file -> { mtimeMs, info }

function readHead(file, bytes = 256 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function readTail(file, bytes = 64 * 1024) {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, 'r');
  try {
    const start = Math.max(0, st.size - bytes);
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** Textul unui mesaj de utilizator, fără mesajele interne (comenzi, avertizări). */
function userText(msg) {
  if (!msg) return '';
  const c = msg.content;
  let t = '';
  if (typeof c === 'string') t = c;
  else if (Array.isArray(c)) {
    if (c.some((b) => b.type === 'tool_result')) return '';
    t = c.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
  }
  t = t.trim();
  if (!t || t.startsWith('<') || t.startsWith('Caveat:') || t.startsWith('[Request interrupted')) return '';
  return t;
}

function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

function infoOf(file, st) {
  const lines = parseLines(readHead(file));
  let cwd;
  let title;
  let summary;
  for (const l of lines) {
    if (!cwd && l.cwd) cwd = l.cwd;
    if (l.type === 'summary' && l.summary && !summary) summary = l.summary;
    if (!title && l.type === 'user' && !l.isMeta && !l.isSidechain) title = userText(l.message);
    if (cwd && title) break;
  }
  // Titlu personalizat (/rename) sau rezumat: de obicei spre final.
  for (const l of parseLines(readTail(file))) {
    if ((l.type === 'custom-title' || l.type === 'customTitle') && (l.customTitle || l.title)) title = l.customTitle || l.title;
    else if (l.type === 'summary' && l.summary) summary = summary || l.summary;
  }
  if (!title && !summary) return undefined;
  return {
    sessionId: path.basename(file, '.jsonl'),
    file,
    cwd,
    title: (title || summary || '').replace(/\s+/g, ' ').slice(0, 120),
    mtime: st.mtimeMs,
  };
}

/** Sesiunile recente din toate proiectele, cele mai noi primele. */
function list(limit = 300) {
  const out = [];
  for (const cfg of claudeConfigDirs()) {
    const root = path.join(cfg, 'projects');
    let dirs = [];
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      continue;
    }
    for (const d of dirs) {
      const dir = path.join(root, d.name);
      let files = [];
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const f of files) {
        const file = path.join(dir, f);
        try {
          const st = fs.statSync(file);
          if (st.size < 50) continue;
          const c = cache.get(file);
          if (c && c.mtimeMs === st.mtimeMs) {
            if (c.info) out.push(c.info);
            continue;
          }
          const info = infoOf(file, st);
          cache.set(file, { mtimeMs: st.mtimeMs, info });
          if (info) out.push(info);
        } catch {}
      }
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, limit);
}

/** Toate intrările unei sesiuni, în forma evenimentelor stream-json (user / assistant), fără subagenți. */
function load(file) {
  const entries = [];
  for (const l of parseLines(fs.readFileSync(file, 'utf8'))) {
    if (l.isSidechain) continue;
    if (l.type === 'user' && l.message) {
      if (l.isMeta) continue;
      entries.push({ type: 'user', message: l.message, history: true, isCompactSummary: !!l.isCompactSummary });
    } else if (l.type === 'assistant' && l.message) {
      entries.push({ type: 'assistant', message: l.message, history: true });
    } else if (l.type === 'system' && l.subtype === 'compact_boundary') {
      entries.push({ type: 'system', subtype: 'compact_boundary', history: true });
    }
  }
  return entries;
}

module.exports = { list, load };
