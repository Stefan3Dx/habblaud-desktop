// Local control API: lets Claude Fleet (its agent on this machine) drive Habblaud instead of running its own hidden Claude
// processes – Habblaud stays the single owner of the `claude` processes and every remote action shows up in the window.
//
// - 127.0.0.1 only, random port, 32-byte token; both written to <userData>/control.json ({ port, token, pid, version })
//   readable by the current user only (0600 / icacls).
// - Every request: `Authorization: Bearer <token>` (constant-time compare), Host must be 127.0.0.1/localhost:<port>,
//   any Origin header is refused (no browser page can call it), no CORS headers. Versioned under /v1.
// - Routes: GET /v1/sessions · POST /v1/sessions {cwd, model, mode, prompt} · POST /v1/sessions/:id/open ·
//   POST /v1/sessions/:id/send {text} · POST /v1/sessions/:id/interrupt · POST /v1/sessions/:id/permission
//   {requestId, behavior, message?, updatedInput?} · GET /v1/health · WS /v1/events (stream-json events + perm_req /
//   perm_resolved / chat_opened / chat_closed / chat_state).
//   `:id` is a chat id (c1, c2…) or a Claude session id.
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const API = 'v1';

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** owner-only permissions on the control file (Windows: icacls, others: 0600) */
function restrict(file) {
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
  if (process.platform !== 'win32') return Promise.resolve();
  const user = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${os.userInfo().username}` : os.userInfo().username;
  return new Promise((resolve) => execFile('icacls', [file, '/inheritance:r', '/grant:r', `${user}:F`], { windowsHide: true }, () => resolve()));
}

// ---- minimal WebSocket server side (RFC 6455): text frames out, close / ping in
function wsAccept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) return false;
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  return true;
}
function wsFrame(text, opcode = 0x1) {
  const data = Buffer.from(text);
  const len = data.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len]) : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255]) : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
  return Buffer.concat([head, data]);
}
/** parse client frames (masked): returns { frames: [{opcode, payload}], rest } */
function wsParse(buf) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b1 = buf[off + 1];
    let len = b1 & 0x7f, p = off + 2;
    if (len === 126) { if (buf.length - p < 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length - p < 8) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    const masked = !!(b1 & 0x80);
    const mask = masked ? buf.subarray(p, p + 4) : null;
    if (masked) p += 4;
    if (buf.length - p < len) break;
    const payload = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    frames.push({ opcode: buf[off] & 0x0f, payload });
    off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

function readJson(req, limit = 4 << 20) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'too_large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'bad_json'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {object} o
 * @param {string} o.file where control.json goes
 * @param {string} o.version app version
 * @param {object} o.handlers { list(), create(body), open(id), send(id, body), interrupt(id), permission(id, body) } – may throw
 *   errors with .status / .code; may return promises
 * @param {(…a) => void} [o.log]
 */
function createControl({ file, version, handlers, log = () => {} }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const clients = new Set();
  let server, port;

  function hostOk(req) {
    const h = String(req.headers.host || '').toLowerCase();
    return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
  }
  function authOk(req) {
    const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    return !!m && safeEqual(m[1].trim(), token);
  }
  /** null when fine, else [status, code] */
  function gate(req) {
    if (!hostOk(req)) return [403, 'bad_host'];
    if (req.headers.origin) return [403, 'origin_not_allowed'];
    if (!authOk(req)) return [401, 'unauthorized'];
    return null;
  }
  function reply(res, status, body) {
    const s = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s), 'cache-control': 'no-store' });
    res.end(s);
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean); // ['v1', 'sessions', ':id', 'send']
    if (parts[0] !== API) throw new HttpError(404, 'not_found');
    const m = req.method;
    if (parts[1] === 'health' && m === 'GET') return { ok: true, version, pid: process.pid };
    if (parts[1] !== 'sessions') throw new HttpError(404, 'not_found');
    if (parts.length === 2 && m === 'GET') return { sessions: await handlers.list() };
    if (parts.length === 2 && m === 'POST') return handlers.create(await readJson(req));
    const id = decodeURIComponent(parts[2] || '');
    if (!id) throw new HttpError(404, 'not_found');
    if (parts.length === 4 && m === 'POST') {
      const body = await readJson(req);
      if (parts[3] === 'open') return handlers.open(id, body);
      if (parts[3] === 'send') return handlers.send(id, body);
      if (parts[3] === 'interrupt') return handlers.interrupt(id, body);
      if (parts[3] === 'permission') return handlers.permission(id, body);
    }
    throw new HttpError(404, 'not_found');
  }

  function onRequest(req, res) {
    const bad = gate(req);
    if (bad) return reply(res, bad[0], { error: bad[1] });
    route(req, res).then(
      (r) => reply(res, 200, r ?? { ok: true }),
      (e) => reply(res, e.status || 500, { error: e.code || 'error', message: e.message }),
    );
  }

  function onUpgrade(req, socket) {
    const url = new URL(req.url, 'http://x');
    const bad = url.pathname !== `/${API}/events` ? [404, 'not_found'] : gate(req);
    if (bad) {
      socket.write(`HTTP/1.1 ${bad[0]} ${bad[1]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return socket.destroy();
    }
    if (!wsAccept(req, socket)) return socket.destroy();
    socket.setNoDelay(true);
    clients.add(socket);
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      const r = wsParse(Buffer.concat([buf, d]));
      buf = r.rest;
      for (const f of r.frames) {
        if (f.opcode === 0x8) { try { socket.end(wsFrame('', 0x8)); } catch {} clients.delete(socket); }
        else if (f.opcode === 0x9) { try { socket.write(wsFrame(f.payload.toString(), 0xa)); } catch {} }
        else if (f.opcode === 0x1) {
          // only {type:"ping"} from clients
          try { if (JSON.parse(f.payload.toString()).type === 'ping') socket.write(wsFrame(JSON.stringify({ type: 'pong' }))); } catch {}
        }
      }
    });
    const drop = () => clients.delete(socket);
    socket.on('close', drop);
    socket.on('error', drop);
    socket.write(wsFrame(JSON.stringify({ type: 'hello', version, api: API })));
  }

  function broadcast(obj) {
    if (!clients.size) return;
    const frame = wsFrame(JSON.stringify(obj));
    for (const s of clients) {
      try { s.write(frame); } catch { clients.delete(s); }
    }
  }

  async function start() {
    server = http.createServer(onRequest);
    server.on('upgrade', onUpgrade);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    port = server.address().port;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ port, token, pid: process.pid, version, api: API }), { mode: 0o600 });
    await restrict(tmp);
    fs.renameSync(tmp, file);
    log(`control API on 127.0.0.1:${port}`);
    return { port };
  }
  function stop() {
    try {
      const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cur.pid === process.pid) fs.rmSync(file, { force: true });
    } catch {}
    for (const s of clients) try { s.destroy(); } catch {}
    clients.clear();
    try { server?.close(); } catch {}
  }
  return { start, stop, broadcast, HttpError, get port() { return port; } };
}

module.exports = { createControl, HttpError, safeEqual, wsParse, wsFrame };
