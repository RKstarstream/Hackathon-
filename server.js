// Tech Tank Hackathon — zero-dependency server.
// Serves the public site, the admin panel, a JSON content API and a live (SSE) update stream.
// Start:  node server.js        (PORT and ADMIN_PASSCODE can be set as environment variables)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PASSCODE = process.env.ADMIN_PASSCODE || 'techtank2026';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(PUBLIC, 'uploads');
const DATA = path.join(ROOT, 'data', 'content.json');
const MAX_UPLOAD = 60 * 1024 * 1024; // 60 MB

fs.mkdirSync(UPLOADS, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.pdf': 'application/pdf',
};

const clients = new Set();

function readContent() { return fs.readFileSync(DATA, 'utf8'); }

// The question stays sealed for the public until its reveal time (or until the admin reveals it).
function isSealed(q) { return !!q && !q.revealed && !(q.revealAt && Date.now() >= Date.parse(q.revealAt)); }
function isTwistSealed(c) { return c?.published === false || isSealed(c || {}); }
function cardTopic(m) {
  if (m.topic) return m.topic;
  if (/sample-crisis-card/i.test(m.url || '')) return 'twist';
  if (/sample-theme/i.test(m.url || '')) return 'theme';
  if (/sample-campaign/i.test(m.url || '')) return 'campaign';
  return 'media';
}
function publicText(text) {
  const obj = JSON.parse(text);
  const q = obj.question || {};
  obj.question = isSealed(q) ? { sealed: true, revealAt: q.revealAt || '', sample: !!q.sample } : { ...q, sealed: false };
  const c = obj.crisis || {};
  const sealed = isTwistSealed(c);
  obj.crisis = sealed ? { title: 'The twist', intro: '', tests: [], revealAt: c.published === false ? '' : c.revealAt || '', sealed: true }
    : { title: c.title || 'The twist', intro: c.intro || '', tests: c.tests || [], revealAt: c.revealAt || '', sealed: false, statement: c.statement || '' };
  obj.media = (obj.media || []).map((m) => {
    const topic = cardTopic(m);
    return topic === 'twist' && sealed ? { id: m.id, topic, locked: true, caption: 'The twist · Locked', type: 'image', url: '' } : { ...m, topic, locked: false };
  });
  // Team assignments and unpublished scores never travel over the public stream.
  obj.teams = (obj.teams || []).map(({ crisisCard, scores, members, project, ...team }) => ({ ...team, ...(obj.results?.published ? { scores } : {}) }));
  if (!obj.results?.published) obj.results = { published: false };
  return JSON.stringify(obj);
}

function writeContent(obj) {
  obj.updatedAt = new Date().toISOString();
  const text = JSON.stringify(obj, null, 2);
  const tmp = DATA + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, DATA);
  // keep a rolling backup so a bad save can be undone by hand
  fs.writeFileSync(path.join(ROOT, 'data', 'content.backup.json'), text);
  broadcast(text);
  return obj;
}

function broadcast(text) {
  const payload = 'event: content\ndata: ' + publicText(text) + '\n\n';
  for (const res of clients) res.write(payload);
}

function isAdmin(req) {
  const given = Buffer.from(String(req.headers['x-admin-passcode'] || ''));
  const real = Buffer.from(PASSCODE);
  return given.length === real.length && crypto.timingSafeEqual(given, real);
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Upload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';
  if (['/login', '/register'].includes(pathname)) pathname = '/account.html';
  if (pathname === '/portal' || pathname === '/portal/') pathname = '/portal.html';
  const file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
  const raw = JSON.parse(readContent());
  const isTwistAsset = (raw.media || []).some((m) => {
    if (cardTopic(m) !== 'twist' || !m.url || !m.url.startsWith('/')) return false;
    return path.normalize(path.join(PUBLIC, decodeURIComponent(new URL(m.url, 'http://localhost').pathname))) === file;
  });
  if (isTwistAsset && isTwistSealed(raw.crisis) && !isAdmin(req)) return send(res, 403, { error: 'The twist has not been published' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': isTwistAsset ? 'no-store' : 'no-cache', 'Accept-Ranges': 'bytes' };
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) { // videos need range requests to seek
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Number(range[2]) : st.size - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
      fs.createReadStream(file).pipe(res);
    }
  });
}

const participants = require('./participants')({ root: ROOT, readContent, publicText, isAdmin, send, readBody, broadcast });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (await participants.route(req, res, url)) return;
    if (['/portal', '/portal/', '/portal.html'].includes(p) && !participants.current(req)) {
      res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' }); res.end(); return;
    }
    if (['/login', '/register', '/account.html'].includes(p) && participants.current(req)) {
      res.writeHead(302, { Location: '/portal', 'Cache-Control': 'no-store' }); res.end(); return;
    }
    if (p === '/api/content' && req.method === 'GET') return send(res, 200, isAdmin(req) ? readContent() : publicText(readContent()));

    if (p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      clients.add(res);
      // Send the latest content on every connection, including reconnects.
      // A viewer may have missed publishes while offline or between its GET and this stream.
      res.write('event: content\ndata: ' + publicText(readContent()) + '\n\n');
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }

    if (p === '/api/login' && req.method === 'POST') {
      return isAdmin(req) ? send(res, 200, { ok: true }) : send(res, 401, { error: 'Wrong passcode' });
    }

    if (p === '/api/content' && req.method === 'PUT') {
      if (!isAdmin(req)) return send(res, 401, { error: 'Wrong passcode' });
      const body = await readBody(req, 5 * 1024 * 1024);
      let obj;
      try { obj = JSON.parse(body.toString('utf8')); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
      if (!obj || typeof obj !== 'object' || !obj.event) return send(res, 400, { error: 'Content must include "event"' });
      if (obj.portal && (!Number.isFinite(Number(obj.portal.demoMinutes)) || Number(obj.portal.demoMinutes) <= 0 || Number(obj.portal.demoMinutes) > 180 || !Number.isFinite(Number(obj.portal.qaMinutes)) || Number(obj.portal.qaMinutes) < 0 || Number(obj.portal.qaMinutes) > 60)) {
        return send(res, 400, { error: 'Presentation time must be between 1 and 180 minutes; Q&A must be between 0 and 60 minutes' });
      }
      return send(res, 200, writeContent(obj));
    }

    if (p === '/api/upload' && req.method === 'POST') {
      if (!isAdmin(req)) return send(res, 401, { error: 'Wrong passcode' });
      const original = String(url.searchParams.get('name') || 'file');
      const ext = path.extname(original).toLowerCase();
      if (!MIME[ext]) return send(res, 400, { error: 'Unsupported file type ' + ext });
      const base = path.basename(original, ext).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'media';
      const name = `${Date.now().toString(36)}-${base}${ext}`;
      const body = await readBody(req, MAX_UPLOAD);
      fs.writeFileSync(path.join(UPLOADS, name), body);
      return send(res, 200, { url: '/uploads/' + name });
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);
    send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// If someone edits content.json by hand, push it to viewers too.
let lastMtime = 0;
fs.watchFile(DATA, { interval: 1500 }, (cur) => {
  if (cur.mtimeMs !== lastMtime) { lastMtime = cur.mtimeMs; try { broadcast(readContent()); } catch {} }
});

// Push the reveal to every open screen the moment the question unseals.
let lastSealed = null;
setInterval(() => {
  try { const t = readContent(); const data = JSON.parse(t); const s = `${isSealed(data.question)}:${isTwistSealed(data.crisis)}`; if (lastSealed !== null && s !== lastSealed) broadcast(t); lastSealed = s; } catch {}
}, 1000);

server.listen(PORT, () => {
  console.log(`\n  Tech Tank Hackathon is live`);
  console.log(`  Website: http://localhost:${PORT}`);
  console.log(`  Admin:   http://localhost:${PORT}/admin   (passcode: ${PASSCODE === 'techtank2026' ? 'techtank2026 — change with ADMIN_PASSCODE' : 'set via ADMIN_PASSCODE'})\n`);
});
