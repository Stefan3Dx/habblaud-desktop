// O conversație = un proces `claude -p` în modul stream-json (ascuns, fără fereastră de consolă).
// Permisiunile vin pe stdio (--permission-prompt-tool stdio) și sunt răspunse din chat.
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { IS_WIN, cleanEnv } = require('./util');

class ClaudeChat {
  /**
   * @param {object} o
   * @param {string} o.claude calea către claude(.exe/.cmd)
   * @param {string} o.cwd folderul proiectului
   * @param {string} [o.model] alias (opus, sonnet, haiku) sau gol = implicit
   * @param {string} [o.mode] default | acceptEdits | plan | bypassPermissions
   * @param {string} [o.resume] id-ul sesiunii de reluat
   * @param {(ev: object) => void} o.onEvent
   * @param {(info: object) => void} o.onExit
   */
  constructor(o) {
    this.o = o;
    this.sessionId = o.resume;
    this.reqId = 0;
    this.stderr = [];
  }

  start() {
    const o = this.o;
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-prompt-tool', 'stdio',
    ];
    if (o.model) args.push('--model', o.model);
    if (o.mode) args.push('--permission-mode', o.mode);
    if (this.sessionId) args.push('--resume', this.sessionId);

    const isCmd = IS_WIN && /\.(cmd|bat)$/i.test(o.claude);
    this.proc = spawn(isCmd ? `"${o.claude}"` : o.claude, args, {
      cwd: o.cwd,
      env: cleanEnv({ HABBLAUD_NO_PERMISSION_HOOK: '1' }),
      windowsHide: true,
      shell: isCmd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.on('error', (e) => o.onExit({ code: -1, error: e.message }));
    this.proc.on('exit', (code) => {
      this.proc = undefined;
      o.onExit({ code, stderr: this.stderr.join('').slice(-4000) });
    });
    this.proc.stderr.on('data', (d) => {
      this.stderr.push(String(d));
      if (this.stderr.length > 50) this.stderr.shift();
    });
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      if (!line.trim()) return;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.session_id) this.sessionId = ev.session_id;
      o.onEvent(ev);
    });
    this.control({ subtype: 'initialize', hooks: null });
  }

  get alive() {
    return !!this.proc;
  }

  write(obj) {
    if (!this.proc) return false;
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
    return true;
  }

  control(request) {
    return this.write({ type: 'control_request', request_id: `hb_${++this.reqId}`, request });
  }

  /** Trimite un mesaj al utilizatorului (content = blocuri text/image/document). */
  send(content) {
    if (!this.proc) this.start();
    return this.write({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: this.sessionId || '' });
  }

  /** Răspunsul la o cerere can_use_tool. result = {behavior:'allow', updatedInput} | {behavior:'deny', message}. */
  answer(requestId, result) {
    return this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: result } });
  }

  interrupt() {
    return this.control({ subtype: 'interrupt' });
  }

  kill() {
    if (!this.proc) return;
    try {
      if (IS_WIN) spawn('taskkill', ['/pid', String(this.proc.pid), '/T', '/F'], { windowsHide: true });
      else this.proc.kill();
    } catch {}
  }
}

module.exports = { ClaudeChat };
