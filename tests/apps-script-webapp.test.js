const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createGas } = require('../tools/gas-sim.cjs');

const root = path.join(__dirname, '..');
const paymentProof = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1sAAAAASUVORK5CYII=';
const account = { name: 'Test Participant', email: 'participant@example.com', teamName: 'Null Pointers', password: 'a-long-test-password', transactionId: 'UTR123456789', paymentProof };
const body = (value) => JSON.stringify(value);

// A deployed web app with open registration and future reveal times.
function deployed() {
  const gas = createGas();
  gas.run('setup');
  const pass = gas.props.get('ADMIN_PASSCODE');
  const admin = (req) => gas.api({ ...req, passcode: pass });
  const content = admin({ method: 'GET', path: '/api/content' }).body;
  Object.assign(content.event, { registrationOpen: true, registrationDeadline: '2099-01-01T00:00:00Z' });
  Object.assign(content.question, { revealAt: '2099-01-01T00:00:00Z', revealed: false, statement: 'SECRET question statement' });
  Object.assign(content.crisis, { revealAt: '', revealed: false, published: true, statement: 'SECRET global twist instructions' });
  content.results.published = false;
  const publish = (next = content) => admin({ method: 'PUT', path: '/api/content', body: body(next) });
  assert.equal(publish().status, 200);
  const register = (input = account) => gas.api({ method: 'POST', path: '/api/account/register', body: body(input) });
  return { gas, pass, admin, content, publish, register };
}
const configOf = (html) => JSON.parse(/window\.TT_CONFIG = (.*?);<\/script>/.exec(html)[1]);

test('apps-script/ pages are generated from the current public/ sources', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-apps-script-'));
  try {
    execFileSync(process.execPath, [path.join(root, 'tools/build-apps-script.js'), '--out', out]);
    for (const file of ['Index.html', 'Account.html', 'Portal.html', 'Admin.html', 'Seed.gs']) {
      const norm = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
      assert.equal(norm(path.join(out, file)), norm(path.join(root, 'apps-script', file)), `apps-script/${file} is out of date: run npm run build:apps-script`);
    }
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('setup creates private storage and every page is served with its own address', () => {
  const { gas, content } = deployed();
  const ids = gas.props;
  for (const key of ['DATA_FOLDER_ID', 'CONTENT_FILE_ID', 'BACKUP_FILE_ID', 'PRIVATE_FILE_ID', 'PROOF_FOLDER_ID', 'MEDIA_FOLDER_ID', 'SHEET_ID']) assert.ok(ids.get(key), key);
  assert.match(gas.props.get('ADMIN_PASSCODE'), /^[a-f0-9]{20}$/);
  assert.ok(gas.logs.some((l) => l.text.includes('Admin passcode:')));
  gas.run('setup'); // running again creates nothing new
  assert.equal(gas.props.get('CONTENT_FILE_ID'), ids.get('CONTENT_FILE_ID'));

  const pages = { '': 'home', home: 'home', index: 'home', register: 'register', login: 'login', account: 'login', portal: 'portal', admin: 'admin', ADMIN: 'admin' };
  for (const [param, page] of Object.entries(pages)) {
    const output = gas.doGet(param ? { page: param } : {});
    const html = output.getContent();
    const config = configOf(html);
    assert.equal(config.page, page, param);
    assert.equal(config.base, 'https://script.google.com/macros/s/TEST/exec');
    assert.equal(config.pollMs, 5000);
    assert.match(config.version, /\|/);
    assert.ok(!html.includes('__TT_CONFIG__'));
    assert.match(output.metas.viewport, /width=device-width/);
    assert.ok(output.getTitle());
    assert.equal('boot' in config, page !== 'admin' && page !== 'portal', `${page} preloads only public content`);
    assert.ok(!html.includes('SECRET'), `${page} must not include sealed content`);
  }
  assert.equal(gas.doGet({}).getTitle(), `${content.event.name} · ${content.event.theme}`);
  const missing = gas.doGet({ page: 'nope' });
  assert.match(missing.getContent(), /Page not found/);
  assert.match(missing.getContent(), /href="https:\/\/script\.google\.com\/macros\/s\/TEST\/exec" target="_top"/);
  gas.props.set('WEB_APP_URL', 'https://example.test/exec');
  assert.equal(configOf(gas.doGet({ page: 'login' }).getContent()).base, 'https://example.test/exec');
});

test('public content keeps the question, twist, assignments and unpublished scores sealed', () => {
  const { gas, admin, content, publish } = deployed();
  const pub = gas.api({ method: 'GET', path: '/api/content' }).body;
  assert.deepEqual(pub.question, { sealed: true, revealAt: '2099-01-01T00:00:00Z', sample: true });
  assert.equal(pub.crisis.sealed, true);
  assert.equal(pub.crisis.statement, undefined);
  assert.deepEqual(pub.results, { published: false });
  for (const team of pub.teams) for (const key of ['members', 'project', 'crisisCard', 'scores']) assert.equal(team[key], undefined);
  const twistCards = pub.media.filter((m) => m.topic === 'twist');
  assert.ok(twistCards.length >= 1, 'the sample twist card keeps its topic');
  assert.ok(twistCards.every((m) => m.locked && !m.url));
  assert.deepEqual(pub.media.map((m) => m.topic), ['twist', 'theme', 'campaign']);
  assert.ok(!JSON.stringify(gas.api({ method: 'GET', path: '/api/stream' }).body).includes('SECRET'));
  // Admins see everything.
  assert.equal(admin({ method: 'GET', path: '/api/content' }).body.question.statement, 'SECRET question statement');

  const first = gas.api({ method: 'GET', path: '/api/stream', query: { since: '' } }).body;
  assert.ok(first.content && first.version);
  assert.deepEqual(gas.api({ method: 'GET', path: '/api/stream', query: { since: first.version } }).body, { version: first.version });

  content.question.revealed = true; content.crisis.revealed = true; content.results.published = true;
  assert.equal(publish().status, 200);
  const changed = gas.api({ method: 'GET', path: '/api/stream', query: { since: first.version } }).body;
  assert.notEqual(changed.version, first.version);
  assert.equal(changed.content.question.statement, 'SECRET question statement');
  assert.equal(changed.content.crisis.statement, 'SECRET global twist instructions');
  assert.ok(changed.content.teams.some((t) => t.scores));
  assert.ok(changed.content.teams.every((t) => t.members === undefined && t.crisisCard === undefined));

  // A reveal time passing changes the public version without any publish.
  content.question.revealed = false; content.question.revealAt = new Date(Date.now() + 60_000).toISOString();
  publish();
  const before = gas.api({ method: 'GET', path: '/api/stream' }).body;
  assert.equal(before.content.question.sealed, true);
  content.question.revealAt = new Date(Date.now() - 1000).toISOString();
  publish();
  assert.equal(gas.api({ method: 'GET', path: '/api/content' }).body.question.sealed, false);
  // Unpublishing the twist overrides an elapsed reveal time.
  content.crisis.revealed = false; content.crisis.revealAt = '2020-01-01T00:00:00Z'; content.crisis.published = false;
  publish();
  assert.deepEqual(gas.api({ method: 'GET', path: '/api/content' }).body.crisis, { title: 'The twist', intro: '', tests: [], revealAt: '', sealed: true });
});

test('registration requires valid payment proof and keeps passwords, sessions and proofs private', () => {
  const { gas, admin, register } = deployed();
  assert.equal(register({ ...account, transactionId: '' }).status, 400);
  assert.equal(register({ ...account, paymentProof: '' }).status, 400);
  assert.equal(register({ ...account, paymentProof: 'data:image/png;base64,aGVsbG8=' }).status, 400, 'not a real PNG');
  assert.equal(register({ ...account, password: 'short' }).status, 400);
  assert.equal(register({ ...account, email: 'not-an-email' }).status, 400);
  const big = 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64');
  assert.equal(register({ ...account, paymentProof: big }).status, 400);

  const res = register({ ...account, teamId: 't1', status: 'qualified', amount: 1, payment: { status: 'paid' } });
  assert.equal(res.status, 201);
  assert.match(res.token, /^[a-f0-9]{64}$/);
  const { user } = res.body;
  assert.equal(user.teamId, '', 'registration cannot claim an existing team');
  assert.equal(user.status, 'registered', 'registration cannot set its own qualification');
  assert.equal(user.passwordHash, undefined);
  assert.equal(user.payment.amount, 150);
  assert.equal(user.payment.status, 'pending-review');
  assert.equal(user.payment.proofFileId, undefined);
  assert.equal(register({ ...account, email: account.email.toUpperCase() }).status, 409);

  const stored = gas.files.get(gas.props.get('PRIVATE_FILE_ID')).bytes.toString('utf8');
  assert.ok(!stored.includes(account.password));
  assert.ok(!stored.includes(res.token));
  assert.match(stored, /passwordHash/);
  const proofFile = [...gas.files.values()].find((f) => f.parent === gas.props.get('PROOF_FOLDER_ID'));
  assert.equal(proofFile.sharing, 'PRIVATE');
  assert.equal(proofFile.type, 'image/png');

  // Organisers get the proof and a spreadsheet row; participants and the public do not.
  assert.equal(gas.api({ method: 'GET', path: user.payment.proofUrl.split('?')[0], query: { id: user.id }, token: res.token }).status, 401);
  const proof = admin({ method: 'GET', path: '/api/payment-proof', query: { id: user.id } });
  assert.equal(proof.status, 200);
  assert.equal(proof.contentType, 'image/png');
  assert.equal(proof.base64, paymentProof.split(',')[1]);
  const sheet = gas.books.get(gas.props.get('SHEET_ID')).getSheetByName('Registrations');
  assert.equal(sheet.data.length, 2);
  assert.equal(sheet.data[1][0], user.id);
  assert.equal(sheet.data[1][6], "'UTR123456789");
  assert.ok(!JSON.stringify(gas.api({ method: 'GET', path: '/api/content' }).body).includes(account.transactionId));
  assert.equal(admin({ method: 'GET', path: '/api/participants' }).body.users[0].payment.transactionId, account.transactionId);
});

test('participant sessions: sign in, portal access, sign out and rate limiting', () => {
  const { gas, register } = deployed();
  assert.equal(gas.api({ method: 'GET', path: '/api/portal' }).status, 401);
  const { token } = register();
  assert.equal(gas.api({ method: 'GET', path: '/api/account', token }).body.user.email, account.email);
  assert.equal(gas.api({ method: 'GET', path: '/api/portal', token }).status, 200);
  const login = (password, email = account.email) => gas.api({ method: 'POST', path: '/api/account/login', body: body({ email, password }) });
  assert.equal(login('wrong-password').status, 401);
  assert.equal(login(account.password, 'missing@example.com').status, 401);
  const ok = login(account.password, ' PARTICIPANT@example.com ');
  assert.equal(ok.status, 200);
  assert.notEqual(ok.token, token);
  assert.equal(gas.api({ method: 'POST', path: '/api/account/logout', token: ok.token }).status, 200);
  assert.equal(gas.api({ method: 'GET', path: '/api/portal', token: ok.token }).status, 401, 'signed out session no longer works');
  assert.equal(gas.api({ method: 'GET', path: '/api/portal', token }).status, 200, 'other sessions stay signed in');
  assert.equal(gas.api({ method: 'GET', path: '/api/portal', token: 'f'.repeat(64) }).status, 401);
  let status = 0;
  for (let i = 0; i < 31; i++) status = login('wrong-password-' + i).status;
  assert.equal(status, 429);
});

test('registration follows the open switch and deadline', () => {
  const { content, publish, register } = deployed();
  content.event.registrationOpen = false; publish();
  assert.equal(register().status, 403);
  content.event.registrationOpen = true; content.event.registrationDeadline = '2020-01-01T00:00:00Z'; publish();
  assert.equal(register().status, 403);
});

test('admin controls: passcode, validation, participant status, results and assigned twist', () => {
  const { gas, admin, content, publish, register } = deployed();
  assert.equal(gas.api({ method: 'POST', path: '/api/login', passcode: 'wrong' }).status, 401);
  assert.equal(admin({ method: 'POST', path: '/api/login' }).status, 200);
  assert.equal(gas.api({ method: 'PUT', path: '/api/content', body: body(content), passcode: 'wrong' }).status, 401);
  assert.equal(gas.api({ method: 'GET', path: '/api/participants' }).status, 401);
  assert.equal(admin({ method: 'PUT', path: '/api/content', body: '{not json' }).status, 400);
  assert.equal(admin({ method: 'PUT', path: '/api/content', body: body({ teams: [] }) }).status, 400);
  assert.equal(publish({ ...content, portal: { ...content.portal, demoMinutes: 0 } }).status, 400);
  assert.equal(publish({ ...content, portal: { ...content.portal, qaMinutes: 61 } }).status, 400);

  const { token, body: { user } } = register();
  const version = gas.api({ method: 'GET', path: '/api/stream' }).body.version;
  assert.equal(admin({ method: 'PUT', path: '/api/participants', body: body({ id: user.id, status: 'bogus' }) }).status, 400);
  assert.equal(admin({ method: 'PUT', path: '/api/participants', body: body({ id: user.id, status: 'qualified', teamId: 'nope' }) }).status, 400);
  assert.equal(admin({ method: 'PUT', path: '/api/participants', body: body({ id: 'missing', status: 'qualified' }) }).status, 404);
  const team = content.teams[0];
  const saved = admin({ method: 'PUT', path: '/api/participants', body: body({ id: user.id, status: 'qualified', teamId: team.id, note: '=HYPERLINK("x")' }) });
  assert.equal(saved.status, 200);
  assert.notEqual(gas.api({ method: 'GET', path: '/api/stream', query: { since: version } }).body.version, version, 'open portals are woken');
  const row = gas.books.get(gas.props.get('SHEET_ID')).getSheetByName('Registrations').data[1];
  assert.deepEqual(Array.from(row.slice(9)), ['qualified', team.name, "'=HYPERLINK(\"x\")"]);

  let portal = gas.api({ method: 'GET', path: '/api/portal', token }).body;
  assert.equal(portal.user.status, 'qualified');
  assert.equal(portal.result.linked, true);
  assert.equal(portal.result.published, false);
  assert.equal(portal.result.rank, undefined);
  assert.equal(portal.assignedTwist, null);
  assert.equal(portal.content.question.statement, undefined);

  team.crisisCard = content.crisis.cards[0].title;
  content.results.published = true; content.crisis.revealed = true; content.question.revealed = true;
  publish();
  portal = gas.api({ method: 'GET', path: '/api/portal', token }).body;
  assert.equal(portal.result.published, true);
  assert.ok(portal.result.rank >= 1);
  assert.equal(typeof portal.result.total, 'number');
  assert.equal(portal.assignedTwist.title, content.crisis.cards[0].title);
  assert.equal(portal.content.question.statement, 'SECRET question statement');
});

test('content publishes keep a backup of the previous version and survive cache loss', () => {
  const { gas, admin, content, publish } = deployed();
  gas.cacheStore.delete('backup-recent');
  const previous = gas.files.get(gas.props.get('CONTENT_FILE_ID')).bytes.toString('utf8');
  content.event.venue = 'Main auditorium';
  const saved = publish().body;
  assert.match(saved.updatedAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(gas.files.get(gas.props.get('BACKUP_FILE_ID')).bytes.toString('utf8'), previous);
  // Content larger than one cache value is split into pieces.
  content.aiNote = 'x'.repeat(250 * 1024);
  assert.equal(publish().status, 200);
  assert.ok(Number(gas.cacheStore.get('content:n')) > 1);
  assert.equal(admin({ method: 'GET', path: '/api/content' }).body.aiNote.length, 250 * 1024);
  gas.cacheStore.clear();
  assert.equal(gas.api({ method: 'GET', path: '/api/content' }).body.event.venue, 'Main auditorium');
  gas.run('refreshCache');
  assert.equal(gas.api({ method: 'GET', path: '/api/content' }).body.event.venue, 'Main auditorium');
});

test('media uploads are stored in Drive and shared by link', () => {
  const { gas, admin } = deployed();
  const upload = (name, bytes) => admin({ method: 'POST', path: '/api/upload', query: { name }, body: body({ data: Buffer.from(bytes).toString('base64') }) });
  assert.equal(gas.api({ method: 'POST', path: '/api/upload', query: { name: 'a.png' }, body: body({ data: 'AA==' }) }).status, 401);
  assert.equal(upload('page.html', '<p>x</p>').status, 400);
  const image = upload('Team Photo!.png', 'png-bytes');
  assert.equal(image.status, 200);
  assert.match(image.body.url, /^https:\/\/lh3\.googleusercontent\.com\/d\/[\w-]+$/);
  const file = gas.files.get(image.body.driveId);
  assert.equal(file.sharing, 'ANYONE_WITH_LINK:VIEW');
  assert.match(file.name, /-Team-Photo-\.png$/);
  assert.equal(file.parent, gas.props.get('MEDIA_FOLDER_ID'));
  assert.match(upload('clip.mp4', 'video').body.url, /^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/preview$/);
  gas.blockSharing = true;
  assert.equal(upload('private.jpg', 'jpg').body.shared, false);
  assert.equal(admin({ method: 'POST', path: '/api/upload', query: { name: 'x.png' }, body: body({ data: 'not base64!' }) }).status, 400);
});

test('passwords use standard PBKDF2-HMAC-SHA256', () => {
  const { gas } = deployed();
  const expected = crypto.pbkdf2Sync('pässword', 'salt-value', 50, 32, 'sha256').toString('hex');
  assert.equal(gas.context.passwordHash_('pässword', 'salt-value', 50), expected);
  assert.equal(gas.context.sha256Hex_('abc'), crypto.createHash('sha256').update('abc').digest('hex'));
});

test('unknown routes and server errors return JSON errors', () => {
  const { gas } = deployed();
  assert.equal(gas.api({ method: 'GET', path: '/api/nope' }).status, 405);
  assert.equal(gas.api({ method: 'DELETE', path: '/api/content' }).status, 405);
  gas.files.delete(gas.props.get('CONTENT_FILE_ID'));
  gas.cacheStore.clear();
  const failed = gas.api({ method: 'GET', path: '/api/content' });
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { error: 'Could not complete the request. Please try again.' });
  assert.equal(gas.lockHeld, false);
});
