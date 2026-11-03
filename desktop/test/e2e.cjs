// Teste de ponta a ponta do Habblaud Desktop: a aplicação Electron de verdade, com o `claude` de mentira
// (test/fake-claude.mjs) e o servidor Habblaud do repositório (rode `npm run build` na raiz antes).
// Linux: xvfb-run -a node test/e2e.cjs
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');

const root = path.resolve(__dirname, '..');
const shots = process.env.SHOTS || path.join(os.tmpdir(), 'hbd-shots');
fs.mkdirSync(shots, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hbd-home-'));
const project = path.join(home, 'proiect');
fs.mkdirSync(path.join(project, 'src'), { recursive: true });
fs.writeFileSync(path.join(project, 'src', 'app.js'), 'const a = 1;\n');
const fake = path.join(__dirname, 'fake-claude.mjs');
fs.chmodSync(fake, 0o755);

const env = {
  ...process.env,
  HOME: home,
  CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
  HABBLAUD_CLAUDE: fake,
  ANTHROPIC_API_KEY: 'test',
  HABBLAUD_PORT: process.env.HABBLAUD_PORT || '4799',
  HABBLAUD_E2E_DIR: project,
  ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
};

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');

async function launch() {
  const app = await electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox'], env });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  win.on('console', (m) => m.type() === 'error' && console.log('console.error', m.text()));
  await win.waitForSelector('#composer');
  await win.waitForFunction(() => document.querySelector('#setup')?.hidden !== false, null, { timeout: 30000 });
  return { app, win };
}

async function send(win, text) {
  await win.fill('#input', text);
  await win.press('#input', 'Enter');
}

async function lastAssistant(win) {
  return win.evaluate(() => [...document.querySelectorAll('.msgs.active .msg.assistant')].pop()?.innerText ?? '');
}

async function waitIdle(win) {
  await win.waitForFunction(() => !document.body.classList.contains('busy'), null, { timeout: 20000 });
}

(async () => {
  let { app, win } = await launch();
  // proiectul de test ca folder curent
  await win.evaluate((d) => window.__setCwd?.(d), project);
  await win.screenshot({ path: path.join(shots, '01-start.png') });

  // 1) mesaj simplu, cu stream
  await send(win, 'Salut, ce faci?');
  await waitIdle(win);
  assert.match(await lastAssistant(win), /Ai scris: Salut/);

  // 2) permisiune Bash: permis
  await send(win, 'ruleaza bash');
  await win.waitForSelector('.perm .btn.primary', { timeout: 10000 });
  await win.screenshot({ path: path.join(shots, '02-permisiune.png') });
  await win.click('.perm .btn.primary');
  await waitIdle(win);
  assert.match(await lastAssistant(win), /salut/);

  // 3) permisiune refuzată
  await send(win, 'inca un bash');
  await win.waitForSelector('.perm:not(.done) .btn.danger');
  await win.click('.perm:not(.done) .btn.danger');
  await waitIdle(win);
  assert.match(await lastAssistant(win), /nu o rulez/);

  // 4) întrebare
  await send(win, 'intreaba-ma ceva');
  await win.waitForSelector('.perm:not(.done) .opt');
  await win.click('.perm:not(.done) .opt >> text=Albastru');
  await win.click('.perm:not(.done) .btn.primary');
  await waitIdle(win);
  assert.match(await lastAssistant(win), /Albastru/);

  // 5) imagine lipită (Ctrl+V) și trasă în fereastră
  await win.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'captura.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.querySelector('#input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    const dt2 = new DataTransfer();
    dt2.items.add(new File([bytes], 'trasa.png', { type: 'image/png' }));
    const target = document.querySelector('#sidebar') || document.body;
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt2, bubbles: true, cancelable: true }));
  }, PNG.toString('base64'));
  await win.waitForFunction(() => document.querySelectorAll('#attachments .pend:not(.loading)').length === 2, null, { timeout: 10000 });
  await win.screenshot({ path: path.join(shots, '03-atasamente.png') });
  await send(win, 'uite pozele');
  await waitIdle(win);
  assert.match(await lastAssistant(win), /imagini: 2/);

  // 6) întrerupere
  await send(win, 'raspuns lung');
  await win.waitForTimeout(400);
  await win.click('#btn-send');
  await waitIdle(win);

  await win.screenshot({ path: path.join(shots, '04-chat.png') });
  const sessions = await win.evaluate(async () => (await window.hb.historyList()).length);
  assert.ok(sessions >= 1, 'sesiunea apare în istoric');
  for (const m of [path.join(__dirname, 'e2e-more.cjs'), process.env.E2E_EXTRA].filter(Boolean)) await require(m)({ app, win, send, waitIdle, lastAssistant, shots, project, PNG });
  await app.close();

  // 7) istoric: o pornire nouă deschide conversația din listă
  ({ app, win } = await launch());
  await win.waitForSelector('.sess');
  await win.click('.sess');
  await win.waitForSelector('.msgs.active .msg.user');
  const users = await win.evaluate(() => document.querySelectorAll('.msgs.active .msg.user').length);
  assert.ok(users >= 4, `mesaje din istoric: ${users}`);
  await win.screenshot({ path: path.join(shots, '05-istoric.png') });
  // continuă conversația reluată
  await send(win, 'continuam');
  await waitIdle(win);
  assert.match(await lastAssistant(win), /Ai scris: continuam/);
  await app.close();
  console.log('E2E OK', shots);
})().catch(async (e) => {
  console.error('E2E FAIL', e);
  process.exit(1);
});
