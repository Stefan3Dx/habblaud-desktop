// End-to-end tests of the control API used by Claude Fleet (lib/control.js + lib/remote.js): the real Electron app with
// the fake `claude`, its own HOME / APPDATA (so it never touches an installed Habblaud), driven over HTTP + WebSocket.
//   node test/e2e-control.cjs
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const { wsParse } = require('../lib/control');

const root = path.resolve(__dirname, '..');
const shots = process.env.SHOTS || path.join(os.tmpdir(), 'hbd-control-shots');
fs.mkdirSync(shots, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hbd-ctl-'));
const appdata = path.join(home, 'AppData', 'Roaming');
fs.mkdirSync(appdata, { recursive: true });
const project = path.join(home, 'proiect');
fs.mkdirSync(path.join(project, 'src'), { recursive: true });
fs.writeFileSync(path.join(project, 'src', 'app.js'), 'const a = 1;\n');
const fake = path.join(__dirname, process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude.mjs');
const controlFile = path.join(home, 'control.json');

const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  APPDATA: appdata,
  LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
  CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
  HABBLAUD_CLAUDE: fake,
  HABBLAUD_CONTROL_FILE: controlFile,
  ANTHROPIC_API_KEY: 'test',
  HABBLAUD_PORT: process.env.HABBLAUD_PORT || '4798',
  HABBLAUD_E2E_DIR: project,
  ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ctl;

function req(method, p, { body, token = ctl.token, host = `127.0.0.1:${ctl.port}`, origin } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const headers = { host, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) };
    if (token) headers.authorization = `Bearer ${token}`;
    if (origin) headers.origin = origin;
    const r = http.request({ host: '127.0.0.1', port: ctl.port, method, path: p, headers }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => resolve({ status: res.statusCode, json: s ? JSON.parse(s) : null }));
    });
    r.on('error', reject);
    r.end(data);
  });
}

/** WebSocket client over a raw upgrade: collects every event */
function events({ token = ctl.token } = {}) {
  return new Promise((resolve, reject) => {
    const key = Buffer.from('hbd-test-key-123').toString('base64');
    const r = http.request({ host: '127.0.0.1', port: ctl.port, path: '/v1/events', headers: { host: `127.0.0.1:${ctl.port}`, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': key, authorization: `Bearer ${token}` } });
    r.on('response', (res) => resolve({ refused: res.statusCode }));
    r.on('upgrade', (_res, socket) => {
      const got = [];
      let buf = Buffer.alloc(0);
      socket.on('data', (d) => {
        const p = wsParse(Buffer.concat([buf, d]));
        buf = p.rest;
        for (const f of p.frames) if (f.opcode === 1) got.push(JSON.parse(f.payload.toString()));
      });
      resolve({
        got,
        close: () => socket.destroy(),
        async waitFor(pred, ms = 15000) {
          const t0 = Date.now();
          for (;;) {
            const hit = got.find(pred);
            if (hit) return hit;
            if (Date.now() - t0 > ms) throw new Error('timeout waiting for event');
            await sleep(50);
          }
        },
      });
    });
    r.on('error', reject);
    r.end();
  });
}

(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox'], env });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await win.waitForSelector('#composer');
  await win.waitForFunction(() => document.querySelector('#setup')?.hidden !== false, null, { timeout: 30000 });
  for (let i = 0; i < 100 && !fs.existsSync(controlFile); i++) await sleep(100);
  ctl = JSON.parse(fs.readFileSync(controlFile, 'utf8'));
  assert.ok(ctl.port && ctl.token && ctl.token.length >= 40, 'control.json has port + token');
  console.log('ok control.json', ctl.port);

  // ---- auth / origin / host
  assert.strictEqual((await req('GET', '/v1/health', { token: 'gresit' })).status, 401, 'wrong token -> 401');
  assert.strictEqual((await req('GET', '/v1/health', { token: '' })).status, 401, 'no token -> 401');
  assert.strictEqual((await req('GET', '/v1/health', { host: 'evil.example:80' })).status, 403, 'foreign Host -> 403');
  assert.strictEqual((await req('GET', '/v1/health', { origin: 'https://evil.example' })).status, 403, 'Origin -> 403');
  assert.strictEqual((await events({ token: 'gresit' })).refused, 401, 'WS wrong token -> 401');
  const h = await req('GET', '/v1/health');
  assert.strictEqual(h.status, 200);
  assert.ok(!('access-control-allow-origin' in h), 'no CORS');
  console.log('ok auth: 401 token, 403 host, 403 origin, WS 401');

  const ev = await events();
  await ev.waitFor((e) => e.type === 'hello');

  // ---- new session from Fleet: new tab, in front, message visible
  const c = await req('POST', '/v1/sessions', { body: { cwd: project, prompt: 'salut din Fleet' } });
  assert.strictEqual(c.status, 200, JSON.stringify(c.json));
  const chatId = c.json.chatId;
  await ev.waitFor((e) => e.type === 'event' && e.chatId === chatId && e.event.type === 'result');
  const shown = await win.evaluate(() => document.querySelector('.msgs.active')?.innerText || '');
  assert.ok(shown.includes('salut din Fleet'), 'the remote message is shown in the active tab');
  await win.screenshot({ path: path.join(shots, 'c1-remote-session.png') });
  const list = await req('GET', '/v1/sessions');
  const me = list.json.sessions.find((s) => s.chatId === chatId);
  assert.ok(me && me.claudeSessionId && me.cwd === project && me.busy === false, `listed: ${JSON.stringify(me)}`);
  console.log('ok create: tab + message + listed', me.claudeSessionId);
  const ui0 = await ev.waitFor((e) => e.type === 'user_input' && e.chatId === chatId);
  assert.strictEqual(ui0.source, 'api', 'a prompt sent through the API is tagged api');
  await win.fill('#input', 'scris in fereastra');
  await win.press('#input', 'Enter');
  const ui1 = await ev.waitFor((e) => e.type === 'user_input' && e.text === 'scris in fereastra');
  assert.strictEqual(ui1.source, 'ui', 'a prompt typed in the window is tagged ui');
  await ev.waitFor((e) => e.type === 'event' && e.chatId === chatId && e.event.type === 'result' && ev.got.indexOf(e) > ev.got.indexOf(ui1));
  console.log('ok user_input: api vs ui');
  assert.strictEqual((await req('POST', '/v1/sessions', { body: { cwd: path.join(home, 'nu-exista') } })).status, 400, 'missing cwd -> 400');

  // ---- permission answered from the API: card closes in the window, second answer refused
  await req('POST', `/v1/sessions/${chatId}/send`, { body: { text: 'ruleaza bash' } });
  const pr = await ev.waitFor((e) => e.type === 'perm_req' && e.chatId === chatId);
  const a1 = await req('POST', `/v1/sessions/${me.claudeSessionId}/permission`, { body: { requestId: pr.requestId, behavior: 'allow' } });
  assert.strictEqual(a1.status, 200);
  await ev.waitFor((e) => e.type === 'perm_resolved' && e.requestId === pr.requestId && e.via === 'api');
  await win.waitForFunction(() => [...document.querySelectorAll('.msgs.active .perm.done')].some((p) => p.innerText.includes('Permis din Fleet')), null, { timeout: 5000 });
  assert.strictEqual((await req('POST', `/v1/sessions/${chatId}/permission`, { body: { requestId: pr.requestId, behavior: 'deny' } })).status, 409, 'second answer -> 409');
  await ev.waitFor((e) => e.type === 'event' && e.chatId === chatId && e.event.type === 'result' && ev.got.indexOf(e) > ev.got.indexOf(pr));
  console.log('ok permission via API (first wins, card closed)');

  // ---- permission answered in the window: API sees perm_resolved via ui, then 409
  await req('POST', `/v1/sessions/${chatId}/send`, { body: { text: 'bash iar' } });
  const pr2 = await ev.waitFor((e) => e.type === 'perm_req' && e.requestId !== pr.requestId);
  await win.click('.msgs.active .perm:not(.done) .btn.primary');
  await ev.waitFor((e) => e.type === 'perm_resolved' && e.requestId === pr2.requestId && e.via === 'ui');
  assert.strictEqual((await req('POST', `/v1/sessions/${chatId}/permission`, { body: { requestId: pr2.requestId, behavior: 'allow' } })).status, 409);
  console.log('ok permission in the window -> perm_resolved(ui), API 409');

  // ---- open: already open -> focus only; double resume refused; foreign lock refused
  const o = await req('POST', `/v1/sessions/${me.claudeSessionId}/open`);
  assert.strictEqual(o.json.chatId, chatId);
  assert.strictEqual(o.json.opened, false);
  const dbl = await win.evaluate((sid) => window.hb.chatOpen({ chatId: 'c999', cwd: '', model: '', mode: 'default', resume: sid }), me.claudeSessionId);
  assert.ok(dbl.error && /alt tab/.test(dbl.error), `double resume refused: ${JSON.stringify(dbl)}`);
  const other = '99999999-aaaa-bbbb-cccc-000000000000';
  fs.mkdirSync(path.join(home, '.claude-fleet', 'locks'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude-fleet', 'locks', other), JSON.stringify({ pid: process.pid, owner: 'fleet' }));
  const lk = await win.evaluate((sid) => window.hb.chatOpen({ chatId: 'c998', cwd: '', model: '', mode: 'default', resume: sid }), other);
  assert.ok(lk.error && /Fleet/.test(lk.error), `lock held by Fleet refused: ${JSON.stringify(lk)}`);
  assert.strictEqual((await req('POST', `/v1/sessions/${other}/open`)).status, 409, 'open of a Fleet-locked session -> 409');
  assert.ok(fs.existsSync(path.join(home, '.claude-fleet', 'locks', me.claudeSessionId)), 'Habblaud holds the lock of its session');
  console.log('ok ownership: focus-only reopen, double resume refused, Fleet lock respected, own lock written');

  // ---- interrupt
  await req('POST', `/v1/sessions/${chatId}/send`, { body: { text: 'ceva lung' } });
  await sleep(400);
  assert.strictEqual((await req('POST', `/v1/sessions/${chatId}/interrupt`)).status, 200);
  await ev.waitFor((e) => e.type === 'event' && e.event.type === 'result' && e.event.is_error === true);
  console.log('ok interrupt');

  await win.screenshot({ path: path.join(shots, 'c2-after.png') });
  ev.close();
  await app.close();
  await sleep(500);
  assert.ok(!fs.existsSync(controlFile), 'control.json removed on exit');
  assert.ok(!fs.existsSync(path.join(home, '.claude-fleet', 'locks', me.claudeSessionId)), 'lock released on exit');
  console.log('ok shutdown: control.json + lock removed');
  console.log('ALL OK');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
