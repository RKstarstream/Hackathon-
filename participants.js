'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const STATUSES = ['registered', 'under-review', 'qualified', 'not-qualified', 'presenting', 'completed', 'disqualified'];

module.exports = function participants({ root, readContent, publicText, isAdmin, send, readBody, broadcast }) {
  const file = path.join(root, 'data', 'participants.private.json');
  const attempts = new Map();
  const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { users: [], sessions: [] };
  function save(data) {
    data.sessions = data.sessions.filter((session) => session.expiresAt > Date.now());
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  const googleSync = require('./apps-script-sync')({ root, read, save });
  if (googleSync.enabled) {
    setInterval(() => { googleSync.flush().catch(() => {}); }, 60000).unref();
    googleSync.flush().catch(() => {});
  }
  const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
  const safeUser = ({ id, name, email, teamName, teamId, status, note, createdAt, payment }) => ({ id, name, email, teamName, teamId, status, note, createdAt, ...(payment ? { payment: { amount: payment.amount, transactionId: payment.transactionId, status: payment.status, proofUrl: '/api/payment-proof?id=' + encodeURIComponent(id) } } : {}) });
  function current(req, data = read()) {
    const token = /(?:^|;\s*)tt-session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (!token) return null;
    const session = data.sessions.find((s) => s.tokenHash === hashToken(token) && s.expiresAt > Date.now());
    return session ? data.users.find((user) => user.id === session.userId) || null : null;
  }
  function cookie(req, res, token, maxAge = SESSION_MS / 1000) {
    const secure = process.env.COOKIE_SECURE === '1' || req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie', `tt-session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  }
  function loginSession(req, res, data, user) {
    const token = crypto.randomBytes(32).toString('hex');
    data.sessions.push({ tokenHash: hashToken(token), userId: user.id, expiresAt: Date.now() + SESSION_MS });
    save(data);
    cookie(req, res, token);
    return safeUser(user);
  }
  function limited(req) {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const key = req.socket.remoteAddress;
    const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    entry.count++;
    attempts.set(key, entry);
    return entry.count > 30;
  }
  async function json(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('Send JSON content'), { status: 415 });
    try { return JSON.parse((await readBody(req, 7 * 1024 * 1024 + 16384)).toString('utf8')); }
    catch { throw Object.assign(new Error('Invalid request'), { status: 400 }); }
  }
  const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  async function passwordHash(password, salt) {
    return (await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 })).toString('hex');
  }
  async function route(req, res, url) {
    const p = url.pathname;
    if (!['/api/account', '/api/account/register', '/api/account/login', '/api/account/logout', '/api/portal', '/api/participants', '/api/payment-proof'].includes(p)) return false;
    try {
      if (!['GET', 'POST', 'PUT'].includes(req.method)) { send(res, 405, { error: 'Method not allowed' }); return true; }
      if (req.method !== 'GET') {
        let crossOrigin = req.headers['sec-fetch-site'] === 'cross-site';
        if (req.headers.origin) {
          try { crossOrigin ||= new URL(req.headers.origin).host !== req.headers.host; } catch { crossOrigin = true; }
        }
        if (crossOrigin) { send(res, 403, { error: 'Use this website to submit the request' }); return true; }
      }
      if (p === '/api/payment-proof' && req.method === 'GET') {
        const user = read().users.find((u) => u.id === url.searchParams.get('id'));
        if (!isAdmin(req)) { send(res, 401, { error: 'Admin sign-in required' }); return true; }
        if (!user?.payment?.proofFile) { send(res, 404, { error: 'Payment proof not found' }); return true; }
        res.setHeader('X-Content-Type-Options', 'nosniff');
        send(res, 200, fs.readFileSync(path.join(root, 'data', 'payment-proofs', user.payment.proofFile)), user.payment.proofType); return true;
      }
      if (p === '/api/participants') {
        if (!isAdmin(req)) { send(res, 401, { error: 'Admin sign-in required' }); return true; }
        if (req.method === 'GET') {
          send(res, 200, { users: read().users.map(safeUser) }); return true;
        }
        if (req.method === 'PUT') {
          const input = await json(req);
          const data = read();
          const user = data.users.find((u) => u.id === input.id);
          if (!user) { send(res, 404, { error: 'Participant not found' }); return true; }
          const content = JSON.parse(readContent());
          if (!STATUSES.includes(input.status)) { send(res, 400, { error: 'Choose a valid status' }); return true; }
          if (input.teamId && !(content.teams || []).some((team) => team.id === input.teamId)) {
            send(res, 400, { error: 'Choose an existing team' }); return true;
          }
          Object.assign(user, { teamId: clean(input.teamId, 100), status: input.status, note: clean(input.note, 2000) });
          save(data);
          broadcast(readContent()); // Wake portals; private status is fetched through their session.
          send(res, 200, safeUser(user)); return true;
        }
      }
      if (p === '/api/account' && req.method === 'GET') {
        const user = current(req);
        send(res, user ? 200 : 401, user ? { user: safeUser(user) } : { error: 'Please sign in' }); return true;
      }
      if (p === '/api/portal' && req.method === 'GET') {
        const user = current(req);
        if (!user) { send(res, 401, { error: 'Please sign in' }); return true; }
        const raw = JSON.parse(readContent());
        const content = JSON.parse(publicText(JSON.stringify(raw)));
        const team = (raw.teams || []).find((item) => item.id === user.teamId);
        let result = { published: !!raw.results?.published, team: team?.name || user.teamName, linked: !!team };
        if (team && raw.results?.published) {
          const total = (t) => Math.round((raw.judging || []).reduce((sum, j) => sum + (Number(t.scores?.[j.name]) || 0) / 10 * (Number(j.weight) || 0), 0) * 10) / 10;
          result = { ...result, total: total(team), rank: 1 + (raw.teams || []).filter((t) => total(t) > total(team)).length,
            scores: team.scores || {}, awards: (raw.results.winners || []).filter((w) => w.team === team.name).map((w) => w.award) };
        }
        const assignedTwist = !content.crisis?.sealed && team ? (raw.crisis?.cards || []).find((card) => card.title === team.crisisCard) || null : null;
        send(res, 200, { user: safeUser(user), content, result, assignedTwist }); return true;
      }
      if (p === '/api/account/logout' && req.method === 'POST') {
        const token = /(?:^|;\s*)tt-session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
        const data = read();
        if (token) { data.sessions = data.sessions.filter((s) => s.tokenHash !== hashToken(token)); save(data); }
        cookie(req, res, '', 0); send(res, 200, { ok: true }); return true;
      }
      if (req.method === 'POST' && ['/api/account/register', '/api/account/login'].includes(p)) {
        if (limited(req)) { res.setHeader('Retry-After', '900'); send(res, 429, { error: 'Too many attempts. Please try again in 15 minutes.' }); return true; }
        const input = await json(req);
        const email = clean(input.email, 254).toLowerCase();
        const password = typeof input.password === 'string' ? input.password : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length > 128 || !password) {
          send(res, 400, { error: 'Enter a valid email and password' }); return true;
        }
        if (p === '/api/account/register') {
          const event = JSON.parse(readContent()).event;
          if (event.registrationOpen === false || Date.now() >= Date.parse(event.registrationDeadline)) {
            send(res, 403, { error: 'Registration is closed. Existing participants can still sign in.' }); return true;
          }
          const name = clean(input.name, 100), teamName = clean(input.teamName, 100);
          if (!name || !teamName || password.length < 10) { send(res, 400, { error: 'Enter your name, team name, and a password of at least 10 characters' }); return true; }
          const transactionId = clean(input.transactionId, 100);
          const proof = typeof input.paymentProof === 'string' && /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.paymentProof);
          if (!transactionId || !proof) { send(res, 400, { error: 'Enter your transaction ID and upload payment proof for ₹150' }); return true; }
          const bytes = Buffer.from(proof[2], 'base64');
          const validImage = proof[1] === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
            : proof[1] === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
              : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
          if (!validImage || bytes.length > 5 * 1024 * 1024) { send(res, 400, { error: 'Choose a PNG, JPG or WebP payment screenshot up to 5 MB' }); return true; }
          const salt = crypto.randomBytes(16).toString('hex');
          const hash = await passwordHash(password, salt);
          // Re-read after hashing: concurrent registrations must not overwrite each other.
          const data = read();
          if (data.users.some((u) => u.email === email)) { send(res, 409, { error: 'An account with this email already exists. Please sign in.' }); return true; }
          const user = { id: crypto.randomUUID(), name, email, teamName, teamId: '', status: 'registered', note: '', createdAt: new Date().toISOString(), salt, passwordHash: hash };
          const proofDir = path.join(root, 'data', 'payment-proofs');
          fs.mkdirSync(proofDir, { recursive: true });
          const proofFile = user.id + '.' + ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[proof[1]];
          fs.writeFileSync(path.join(proofDir, proofFile), bytes, { mode: 0o600 });
          user.payment = { amount: 150, transactionId, status: 'pending-review', proofFile, proofType: proof[1] };
          if (googleSync.enabled) user.googleSync = { status: 'pending' };
          data.users.push(user);
          send(res, 201, { user: loginSession(req, res, data, user) });
          googleSync.flush().catch(() => {}); return true;
        }
        const found = read().users.find((u) => u.email === email);
        // Hash even when the account is missing, to avoid a fast account-existence check.
        const hash = await passwordHash(password, found?.salt || 'missing-account-salt');
        if (!found || !crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(found.passwordHash, 'hex'))) {
          send(res, 401, { error: 'Email or password is incorrect' }); return true;
        }
        const data = read();
        const user = data.users.find((u) => u.id === found.id);
        send(res, 200, { user: loginSession(req, res, data, user) }); return true;
      }
      send(res, 405, { error: 'Method not allowed' }); return true;
    } catch (error) { send(res, error.status || 500, { error: error.status ? error.message : 'Could not complete the request. Please try again.' }); return true; }
  }
  return { route, current };
};
