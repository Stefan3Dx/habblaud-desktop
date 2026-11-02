// Atașamente: imagini (micșorate), PDF, video (cadre cu ffmpeg), text; restul ca fișier pe disc.
const { app, nativeImage } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_SIDE = 1568;
const MAX_IMAGE_BYTES = 3.7 * 1024 * 1024; // base64 crește cu ~33%; limita API e 5 MB
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_BYTES = 400 * 1024;
const VIDEO_FRAMES = 12;

const IMAGE_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.wmv', '.flv', '.3gp']);
const TEXT_EXT = new Set([
  '.txt', '.md', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.kt', '.kts', '.c', '.h', '.cpp', '.hpp', '.cs',
  '.go', '.rs', '.rb', '.php', '.html', '.htm', '.css', '.scss', '.xml', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.ps1',
  '.bat', '.cmd', '.sql', '.csv', '.tsv', '.log', '.env', '.gradle', '.properties', '.swift', '.dart', '.lua', '.vue', '.svelte', '.ino',
]);

function attachDir() {
  const d = path.join(app.getPath('userData'), 'attachments', String(Date.now()));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function ffmpegPath() {
  try {
    const p = require('ffmpeg-static');
    return p ? p.replace('app.asar', 'app.asar.unpacked') : undefined;
  } catch {
    return undefined;
  }
}

/** Imagine pentru API: JPEG/PNG micșorată la MAX_SIDE dacă e nevoie. */
function imageFromBuffer(buf, mime) {
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) {
    // Format pe care nativeImage nu-l citește (ex. webp/gif animat): îl trimitem ca atare dacă încape.
    if (buf.length <= MAX_IMAGE_BYTES && /image\/(png|jpeg|gif|webp)/.test(mime)) return { mediaType: mime, data: buf.toString('base64') };
    return undefined;
  }
  const { width, height } = img.getSize();
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const keep = scale === 1 && buf.length <= MAX_IMAGE_BYTES && /image\/(png|jpeg|gif|webp)/.test(mime);
  if (keep) return { mediaType: mime, data: buf.toString('base64'), width, height };
  const r = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' }) : img;
  let out = mime === 'image/png' ? r.toPNG() : r.toJPEG(88);
  let mediaType = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  if (out.length > MAX_IMAGE_BYTES) {
    out = r.toJPEG(75);
    mediaType = 'image/jpeg';
  }
  const s = r.getSize();
  return { mediaType, data: out.toString('base64'), width: s.width, height: s.height };
}

function thumbOf(buf) {
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return undefined;
  const { width, height } = img.getSize();
  const s = Math.min(1, 160 / Math.max(width, height));
  return img.resize({ width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) }).toDataURL();
}

function run(file, args) {
  return new Promise((res) => execFile(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => res({ err, stdout: String(stdout), stderr: String(stderr) })));
}

async function videoFrames(file) {
  const ff = ffmpegPath();
  if (!ff || !fs.existsSync(ff)) return { error: 'ffmpeg lipsește' };
  const probe = await run(ff, ['-hide_banner', '-i', file]);
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(probe.stderr);
  const dur = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  const dir = attachDir();
  const step = dur > 0 ? Math.max(0.5, dur / VIDEO_FRAMES) : 2;
  await run(ff, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `fps=1/${step.toFixed(3)},scale='min(1024,iw)':-2`, '-frames:v', String(VIDEO_FRAMES), '-q:v', '4', path.join(dir, 'f_%02d.jpg')]);
  const frames = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f, i) => {
      const buf = fs.readFileSync(path.join(dir, f));
      return { t: +(i * step).toFixed(1), ...imageFromBuffer(buf, 'image/jpeg') };
    })
    .filter((f) => f.data);
  if (!frames.length) return { error: 'nu am putut extrage cadre din video' };
  return { frames, duration: dur, step, thumb: thumbOf(Buffer.from(frames[0].data, 'base64')) };
}

function looksText(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return true;
}

/** Pregătește un fișier de pe disc. */
async function fromPath(p) {
  const name = path.basename(p);
  const ext = path.extname(p).toLowerCase();
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return { kind: 'error', name, error: 'fișierul nu există' };
  }
  if (st.isDirectory()) return { kind: 'file', name, path: p, size: 0, dir: true };
  if (IMAGE_EXT[ext]) {
    const buf = fs.readFileSync(p);
    const img = imageFromBuffer(buf, IMAGE_EXT[ext]);
    if (img) return { kind: 'image', name, path: p, ...img, thumb: thumbOf(buf) || `data:${img.mediaType};base64,${img.data}` };
  }
  if (ext === '.pdf' && st.size <= MAX_PDF_BYTES) {
    return { kind: 'pdf', name, path: p, size: st.size, data: fs.readFileSync(p).toString('base64') };
  }
  if (VIDEO_EXT.has(ext)) {
    const v = await videoFrames(p);
    if (!v.error) return { kind: 'video', name, path: p, size: st.size, ...v };
    return { kind: 'file', name, path: p, size: st.size, note: v.error };
  }
  if (st.size <= MAX_TEXT_BYTES && (TEXT_EXT.has(ext) || !ext)) {
    const buf = fs.readFileSync(p);
    if (looksText(buf)) return { kind: 'text', name, path: p, size: st.size, text: buf.toString('utf8') };
  }
  return { kind: 'file', name, path: p, size: st.size };
}

/** Date lipite din clipboard / trase din browser (fără cale): salvate pe disc, apoi ca fromPath. */
async function fromBuffer({ name, mime, bytes }) {
  const dir = attachDir();
  const ext = path.extname(name || '') || (mime && Object.entries(IMAGE_EXT).find(([, m]) => m === mime)?.[0]) || '.bin';
  const file = path.join(dir, (path.basename(name || '', path.extname(name || '')) || 'lipit') + ext);
  fs.writeFileSync(file, Buffer.from(bytes));
  return fromPath(file);
}

function cleanup() {
  try {
    const root = path.join(app.getPath('userData'), 'attachments');
    const old = Date.now() - 7 * 24 * 3600 * 1000;
    for (const d of fs.readdirSync(root)) if (Number(d) < old) fs.rmSync(path.join(root, d), { recursive: true, force: true });
  } catch {}
}

module.exports = { fromPath, fromBuffer, cleanup, ffmpegPath };
