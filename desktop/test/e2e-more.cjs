// Comenzi „/”, tabul Fișiere, insignă pentru chat-ul din fundal.
const assert = require('node:assert');
module.exports = async ({ win, send, waitIdle, lastAssistant, shots }) => {
  // comenzi: lista vine din initialize
  await win.fill('#input', '');
  await win.type('#input', '/re');
  await win.waitForSelector('#slash:not([hidden]) button');
  const items = await win.$$eval('#slash button b', (bs) => bs.map((b) => b.textContent));
  assert.ok(items.some((t) => t.startsWith('/review')), `comenzi: ${items}`);
  await win.screenshot({ path: shots + '/07-comenzi.png' });
  await win.press('#input', 'Escape');
  await win.fill('#input', '');

  // fișiere modificate
  await send(win, 'editeaza fisierul');
  await win.waitForSelector('.perm:not(.done) .btn.primary');
  await win.click('.perm:not(.done) .btn.primary');
  await waitIdle(win);
  await win.click('#ptabs [data-tab="files"]');
  await win.waitForSelector('#files .file');
  await win.click('#files .fh');
  await win.screenshot({ path: shots + '/08-fisiere.png' });
  assert.strictEqual(await win.textContent('#files-count'), '1');

  // /clear: chat nou în același folder; răspunsul din chat-ul vechi apare ca insignă
  const first = await win.evaluate(() => document.querySelector('#title').textContent);
  await send(win, 'raspuns lung');
  await win.waitForTimeout(300);
  await win.fill('#input', '/clear');
  await win.press('#input', 'Enter');
  await win.waitForFunction(() => document.querySelector('#title').textContent === 'Chat nou');
  await win.waitForSelector('.sess .badge.done', { timeout: 15000 });
  await win.screenshot({ path: shots + '/09-insigna.png' });
  await win.click('.sess >> nth=0');
  assert.notStrictEqual(first, 'Chat nou');
  await win.click('#ptabs [data-tab="habblaud"]');
};
