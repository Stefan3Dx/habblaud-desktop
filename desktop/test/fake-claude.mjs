#!/usr/bin/env node
// `claude` de mentira para os testes do Habblaud Desktop: fala o protocolo stream-json (mensagens, stream parcial,
// pedidos can_use_tool, initialize, interrupt) e grava a sessão em <CLAUDE_CONFIG_DIR>/projects/ como o de verdade.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';

const args = process.argv.slice(2);
if (args[0] === 'plugin' || args[0] === '--version') {
  if (args[0] === '--version') console.log('9.9.9 (Claude Code, fake)');
  process.exit(0);
}
const resume = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : undefined;
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'claude-fake';
const sessionId = resume || randomUUID();
const cwd = process.cwd();
const cfg = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || '.', '.claude');
const dir = join(cfg, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
mkdirSync(dir, { recursive: true });
const file = join(dir, `${sessionId}.jsonl`);
const log = (o) => appendFileSync(file, JSON.stringify({ ...o, sessionId, cwd, timestamp: new Date().toISOString() }) + '\n');

const out = (o) => process.stdout.write(JSON.stringify({ ...o, session_id: sessionId }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pending = new Map();
let n = 0;
let interrupted = false;

function ask(tool_name, input) {
  const request_id = `req_${++n}`;
  out({ type: 'control_request', request_id, request: { subtype: 'can_use_tool', tool_name, input, tool_use_id: `tu_${n}` } });
  return new Promise((r) => pending.set(request_id, r));
}

async function streamText(id, text) {
  out({ type: 'stream_event', event: { type: 'message_start', message: { id } }, parent_tool_use_id: null });
  out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, parent_tool_use_id: null });
  for (const part of text.match(/.{1,12}/gs) || []) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } }, parent_tool_use_id: null });
    await sleep(15);
  }
  out({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, parent_tool_use_id: null });
  const msg = { id, role: 'assistant', content: [{ type: 'text', text }] };
  out({ type: 'assistant', message: msg, parent_tool_use_id: null });
  log({ type: 'assistant', message: msg });
}

async function toolUse(id, name, input) {
  const msg = { id: `msg_${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] };
  out({ type: 'assistant', message: msg, parent_tool_use_id: null });
  log({ type: 'assistant', message: msg });
}

function toolResult(id, content, is_error = false) {
  const msg = { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] };
  out({ type: 'user', message: msg, parent_tool_use_id: null });
  log({ type: 'user', message: msg });
}

function result(extra = {}) {
  out({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1234, num_turns: 2, result: 'ok', usage: { input_tokens: 10, output_tokens: 42 }, ...extra });
}

async function onUser(message) {
  interrupted = false;
  log({ type: 'user', message });
  const content = Array.isArray(message.content) ? message.content : [{ type: 'text', text: String(message.content) }];
  const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const images = content.filter((b) => b.type === 'image').length;
  const docs = content.filter((b) => b.type === 'document').length;
  out({ type: 'system', subtype: 'init', model, cwd, tools: ['Bash', 'Edit'], slash_commands: ['compact', 'clear', 'review'] });
  const low = text.toLowerCase();

  if (low.startsWith('/compact')) {
    out({ type: 'system', subtype: 'compact_boundary' });
    return result();
  }
  if (low.includes('bash')) {
    await streamText(`m_${++n}`, 'Rulez comanda.');
    const id = `tu_bash_${n}`;
    await toolUse(id, 'Bash', { command: 'echo salut', description: 'Salut' });
    const r = await ask('Bash', { command: 'echo salut', description: 'Salut' });
    if (r.behavior === 'allow') {
      toolResult(id, 'salut');
      await streamText(`m_${++n}`, 'Gata: **salut**.');
    } else {
      toolResult(id, `Refuzat: ${r.message}`, true);
      await streamText(`m_${++n}`, 'Bine, nu o rulez.');
    }
    return result();
  }
  if (low.includes('editeaza')) {
    const id = `tu_edit_${++n}`;
    const input = { file_path: join(cwd, 'src', 'app.js'), old_string: 'const a = 1;', new_string: 'const a = 2;' };
    await toolUse(id, 'Edit', input);
    const r = await ask('Edit', input);
    toolResult(id, r.behavior === 'allow' ? 'Fișier actualizat.' : 'Refuzat', r.behavior !== 'allow');
    await streamText(`m_${++n}`, 'Am schimbat `a` în 2.');
    return result();
  }
  if (low.includes('intreaba')) {
    const input = { questions: [{ question: 'Ce culoare?', header: 'Culoare', multiSelect: false, options: [{ label: 'Roșu', description: 'cald' }, { label: 'Albastru', description: 'rece' }] }] };
    const r = await ask('AskUserQuestion', input);
    const ans = r.behavior === 'allow' ? JSON.stringify(r.updatedInput?.answers ?? {}) : 'fără răspuns';
    await streamText(`m_${++n}`, `Răspunsul tău: ${ans}`);
    return result();
  }
  if (low.includes('lung')) {
    for (let i = 0; i < 40 && !interrupted; i++) await sleep(100);
    if (interrupted) return out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '[Request interrupted by user]' });
  }
  await streamText(`m_${++n}`, `Ai scris: ${text}\n\n- imagini: ${images}\n- documente: ${docs}\n\n\`\`\`js\nconsole.log("salut");\n\`\`\``);
  result();
}

let chain = Promise.resolve();
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.type === 'control_request') {
    if (m.request?.subtype === 'initialize') {
      out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: { commands: [
        { name: 'compact', description: 'Compactează conversația', argumentHint: '' },
        { name: 'review', description: 'Revizuiește un PR', argumentHint: '<pr>' },
        { name: 'init', description: 'Creează CLAUDE.md', argumentHint: '' },
      ] } } });
    } else if (m.request?.subtype === 'interrupt') {
      interrupted = true;
      out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id } });
    }
    return;
  }
  if (m.type === 'control_response') {
    const r = pending.get(m.response?.request_id);
    if (r) {
      pending.delete(m.response.request_id);
      r(m.response.response);
    }
    return;
  }
  if (m.type === 'user') chain = chain.then(() => onUser(m.message));
});
