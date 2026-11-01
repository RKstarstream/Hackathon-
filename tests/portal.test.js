const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startServer } = require('./support/server.cjs');
const paymentProof = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1sAAAAASUVORK5CYII=';
const account = { name: 'Test Participant', email: 'participant@example.com', teamName: 'Null Pointers', password: 'a-long-test-password', transactionId: 'UTR123456789', paymentProof };
const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];

test('payment proof is required, persisted privately and accessible only to organisers', async (t) => {
  const app = await startServer(t);
  assert.equal((await app.json('/api/account/register', { ...account, transactionId: '' })).status, 400);
  assert.equal((await app.json('/api/account/register', { ...account, paymentProof: '' })).status, 400);
  assert.equal((await app.json('/api/account/register', { ...account, paymentProof: 'data:image/png;base64,aGVsbG8=' })).status, 400);
  assert.equal((await app.json('/api/account/register', { ...account, paymentProof: 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64') })).status, 400);
  const registered = await app.json('/api/account/register', { ...account, amount: 1, payment: { status: 'paid' } });
  assert.equal(registered.status, 201);
  const { user } = await registered.json();
  assert.equal(user.payment.amount, 150);
  assert.equal(user.payment.status, 'pending-review');
  assert.equal(user.payment.transactionId, account.transactionId);
  assert.equal(user.payment.proofFile, undefined);
  assert.equal((await app.request(user.payment.proofUrl)).status, 401);
  assert.equal((await app.request(user.payment.proofUrl, { headers: { Cookie: cookieOf(registered) } })).status, 401);
  await app.restart();
  const proof = await app.request(user.payment.proofUrl, { headers: { 'x-admin-passcode': 'test-only' } });
  assert.equal(proof.status, 200);
  assert.equal(proof.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await proof.arrayBuffer()), Buffer.from(paymentProof.split(',')[1], 'base64'));
  const publicContent = await (await app.request('/api/content')).text();
  assert.ok(!publicContent.includes(account.transactionId));
  const admin = await (await app.request('/api/participants', { headers: { 'x-admin-passcode': 'test-only' } })).json();
  assert.equal(admin.users[0].payment.transactionId, account.transactionId);
});

test('register, protected portal, persistent session, sign in and sign out', { timeout: 20000 }, async (t) => {
  const app = await startServer(t);
  const redirect = await app.request('/portal', { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/login');
  assert.equal((await app.request('/api/portal')).status, 401);
  assert.equal((await app.request('/register')).status, 200);
  const response = await app.json('/api/account/register', { ...account, teamId: 't1', status: 'qualified' });
  assert.equal(response.status, 201);
  const cookie = cookieOf(response);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const { user } = await response.json();
  assert.equal(user.teamId, '', 'registration cannot claim an existing team');
  assert.equal(user.status, 'registered', 'registration cannot set its own qualification');
  assert.equal(user.passwordHash, undefined);
  const stored = fs.readFileSync(path.join(app.dir, 'data/participants.private.json'), 'utf8');
  assert.ok(!stored.includes(account.password));
  assert.ok(!stored.includes(cookie.split('=')[1]));
  assert.match(stored, /passwordHash/);
  assert.equal((await app.request('/portal', { headers: { Cookie: cookie } })).status, 200);
  const signedInRedirect = await app.request('/register', { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(signedInRedirect.headers.get('location'), '/portal');
  assert.equal((await app.json('/api/account/register', { ...account, email: account.email.toUpperCase() })).status, 409);
  assert.equal((await app.json('/api/account/login', { email: account.email, password: 'wrong-password' })).status, 401);
  await app.restart();
  assert.equal((await app.request('/api/account', { headers: { Cookie: cookie } })).status, 200, 'session survives restart');
  const logout = await app.json('/api/account/logout', {}, { cookie });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await app.request('/api/portal', { headers: { Cookie: cookie } })).status, 401);
  const login = await app.json('/api/account/login', { email: account.email, password: account.password });
  assert.equal(login.status, 200);
  assert.notEqual(cookieOf(login), cookie);
  assert.equal((await app.request('/data/participants.private.json')).status, 404);
});

test('admin controls participant status, timed question/twist release, presentation and published scores', { timeout: 20000 }, async (t) => {
  const app = await startServer(t);
  const registration = await app.json('/api/account/register', account);
  const { user } = await registration.json();
  const cookie = cookieOf(registration);
  const portal = async (session = cookie) => (await app.request('/api/portal', { headers: { Cookie: session } })).json();
  const publicContent = async () => (await app.request('/api/content')).json();
  let view = await portal();
  assert.equal(view.content.question.statement, undefined);
  assert.equal(view.content.crisis.statement, undefined);
  assert.equal(view.content.crisis.cards, undefined);
  assert.equal(view.assignedTwist, null);
  assert.equal(view.content.teams[0].scores, undefined);
  assert.equal(view.result.total, undefined);
  assert.equal((await app.request('/api/participants', { headers: { Cookie: cookie } })).status, 401);
  const update = { id: user.id, teamId: 't1', status: 'qualified', note: 'Your presentation is at 10:30. Check in early.' };
  assert.equal((await app.json('/api/participants', update, { cookie, method: 'PUT' })).status, 401);
  assert.equal((await app.json('/api/participants', update, { admin: true, method: 'PUT' })).status, 200);
  view = await portal();
  assert.equal(view.user.status, 'qualified');
  assert.equal(view.user.note, update.note);
  assert.equal(view.result.linked, true);
  const second = await app.json('/api/account/register', { ...account, email: 'other@example.com' });
  const otherView = await portal(cookieOf(second));
  assert.equal(otherView.user.note, '');
  assert.equal(otherView.result.linked, false);
  app.content.portal.demoMinutes = 7;
  app.content.portal.qaMinutes = 3;
  app.content.portal.parameters = ['Use only the provided dataset.'];
  app.content.question.revealed = true;
  app.content.crisis.revealed = true;
  app.content.results.published = true;
  assert.equal((await app.publish()).status, 200);
  view = await portal();
  assert.equal(view.content.question.statement, app.content.question.statement);
  assert.equal(view.content.crisis.statement, app.content.crisis.statement);
  assert.equal(view.assignedTwist.title, app.content.teams[0].crisisCard);
  assert.equal((await portal(cookieOf(second))).assignedTwist, null);
  assert.equal(view.content.portal.demoMinutes, 7);
  assert.equal(view.content.portal.qaMinutes, 3);
  assert.deepEqual(view.content.portal.parameters, app.content.portal.parameters);
  assert.equal(view.result.total, 80);
  assert.equal(view.result.rank, 2);
  const publicView = await publicContent();
  assert.equal(publicView.crisis.cards, undefined);
  assert.equal(publicView.teams[0].crisisCard, undefined);
  assert.equal(publicView.teams[0].members, undefined);
  assert.ok(!JSON.stringify(publicView).includes(account.email));
  assert.ok(!JSON.stringify(publicView).includes(update.note));
  // A scheduled reveal uses the server clock even without a manual reveal.
  app.content.question.revealed = false;
  app.content.question.revealAt = '2000-01-01T00:00:00Z';
  app.content.crisis.revealed = false;
  app.content.crisis.revealAt = '2000-01-01T00:00:00Z';
  await app.publish();
  view = await portal();
  assert.equal(view.content.question.sealed, false);
  assert.equal(view.content.crisis.sealed, false);
  // Resealing and unpublishing remove confidential details from every public response.
  app.content.question.revealAt = '2099-01-01T00:00:00Z';
  app.content.crisis.revealAt = '';
  app.content.results.published = false;
  await app.publish();
  view = await portal();
  assert.equal(view.content.question.statement, undefined);
  assert.equal(view.content.crisis.statement, undefined);
  assert.equal(view.assignedTwist, null);
  assert.equal(view.result.total, undefined);
});

test('registration validation, closed registration, origin protection and login rate limiting', { timeout: 20000 }, async (t) => {
  const app = await startServer(t);
  assert.equal((await app.json('/api/account/register', { ...account, password: 'short' })).status, 400);
  assert.equal((await app.json('/api/account/register', account, { headers: { Origin: 'https://other.example' } })).status, 403);
  const registered = await app.json('/api/account/register', account);
  assert.equal(registered.status, 201);
  app.content.event.registrationOpen = false;
  await app.publish();
  assert.equal((await app.json('/api/account/register', { ...account, email: 'new@example.com' })).status, 403);
  assert.equal((await app.json('/api/account/login', account)).status, 200, 'existing users can sign in after registration closes');
  app.content.portal.demoMinutes = -5;
  assert.equal((await app.publish()).status, 400);
  let limited = false;
  for (let i = 0; i < 32; i++) {
    const response = await app.json('/api/account/login', { email: account.email, password: 'wrong' });
    if (response.status === 429) { limited = true; assert.equal(response.headers.get('retry-after'), '900'); break; }
  }
  assert.ok(limited, 'repeated authentication attempts are throttled');
});

test('portal renderer shows sealed and revealed content with escaped participant text', async () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'public/portal.js'), 'utf8');
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, innerHTML: '', textContent: '', classList: { toggle() {} }, setAttribute() {}, addEventListener() {} });
    return nodes.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: node, querySelectorAll: () => [], addEventListener() {} },
    location: { hash: '', origin: 'http://localhost', replace() {} }, window: {},
    addEventListener() {}, setInterval() {}, URL, AbortSignal, fetch: () => new Promise(() => {}),
  });
  const instrumented = file.replace(/\}\)\(\);\s*$/, 'globalThis.testPortal = { render, selectSection }; })();');
  vm.runInContext(instrumented, context);
  const content = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/content.json'), 'utf8'));
  content.question = { sealed: true, revealAt: '2099-01-01T00:00:00Z' };
  content.crisis = { sealed: true };
  const snapshot = { user: { name: 'Test <script>', teamName: 'A & B', status: 'registered' }, content, result: { team: 'A & B', linked: false, published: false }, assignedTwist: null };
  context.testPortal.render(snapshot);
  assert.equal(node('section-question').hidden, false);
  assert.equal(node('section-results').hidden, true);
  assert.match(node('questionContent').innerHTML, /challenge is almost yours/);
  assert.match(node('portalResults').innerHTML, /A &amp; B/);
  assert.match(node('presentationContent').innerHTML, /3 min/);
  content.question = { sealed: false, title: 'Build <safe>', statement: '<script>alert(1)</script>' };
  content.crisis = { sealed: false, title: 'Adapt', statement: 'No network.' };
  context.testPortal.render(snapshot);
  assert.match(node('questionContent').innerHTML, /&lt;script&gt;/);
  assert.ok(!node('questionContent').innerHTML.includes('<script>'));
  assert.match(node('twistContent').innerHTML, /No network/);
  context.location.hash = '#results';
  context.testPortal.selectSection();
  assert.equal(node('section-question').hidden, true);
  assert.equal(node('section-results').hidden, false);
});

test('admin portal controls render and account updates use the private admin API', async () => {
  class Element {
    constructor(tag) {
      this.tag = tag; this.nodeType = 1; this.children = []; this.events = {};
      this.style = {}; this.value = ''; this.checked = false; this.disabled = false; this.isConnected = true;
      this.classList = { toggle() {}, remove() {} };
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this[key] = value; }
    addEventListener(name, callback) { this.events[name] = callback; }
  }
  const nodes = new Map(), timers = [], requests = [];
  const registered = { id: 'account-1', name: 'Test Person', email: 'test@example.com', teamName: 'Team A', status: 'registered', note: '', teamId: '', createdAt: '2026-10-22T00:00:00Z' };
  const context = vm.createContext({
    document: {
      createElement: (tag) => new Element(tag), createTextNode: (value) => ({ nodeType: 3, textContent: String(value) }),
      querySelector: (key) => { if (!nodes.has(key)) nodes.set(key, new Element('div')); return nodes.get(key); },
    },
    localStorage: { getItem() { return null; } }, sessionStorage: { getItem() { return null; } },
    addEventListener() {}, setTimeout: (callback) => { timers.push(callback); return timers.length; }, clearTimeout() {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => options.method === 'GET' ? { users: [registered] } : registered };
    },
  });
  const code = fs.readFileSync(path.join(__dirname, '..', 'public/admin.js'), 'utf8').replace(/\}\)\(\);\s*$/, 'globalThis.adminViews = { init(content) { D = content; PASS = "test-only"; }, views: V }; })();');
  vm.runInContext(code, context);
  const content = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/content.json'), 'utf8'));
  context.adminViews.init(content);
  const all = (elements) => elements.flatMap((element) => [element, ...all(element.children || [])]);
  const text = (elements) => all(elements).map((element) => element.textContent || '').join(' ');
  assert.match(text(context.adminViews.views.portal()), /Demo \/ presentation duration/);
  assert.match(text(context.adminViews.views.crisis()), /Reveal twist now/);
  assert.match(text(context.adminViews.views.teams()), /Assigned twist/);
  const accountView = context.adminViews.views.participants();
  await timers.pop()();
  assert.match(text(accountView), /Test Person/);
  const elements = all(accountView);
  const selects = elements.filter((element) => element.tag === 'select');
  selects[0].value = 't1';
  selects[1].value = 'qualified';
  elements.find((element) => element.tag === 'textarea').value = 'Your team has qualified.';
  const save = elements.find((element) => element.tag === 'button' && text([element]).includes('Save participant update'));
  await save.events.click();
  const update = requests.find((request) => request.options.method === 'PUT');
  assert.equal(update.url, '/api/participants');
  assert.equal(update.options.headers['x-admin-passcode'], 'test-only');
  assert.deepEqual(JSON.parse(update.options.body), { id: 'account-1', teamId: 't1', status: 'qualified', note: 'Your team has qualified.' });
});

test('portal rechecks a publication received during an in-flight refresh', async () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'public/portal.js'), 'utf8');
  const replies = [], events = new Map(), nodes = new Map();
  const element = () => ({ classList: { toggle() {} }, setAttribute() {}, addEventListener() {}, hidden: false });
  const context = vm.createContext({
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, querySelectorAll: () => [], addEventListener() {} },
    location: { hash: '', origin: 'http://localhost', replace() {} }, window: { EventSource: true },
    EventSource: class { addEventListener(name, callback) { events.set(name, callback); } },
    URL, AbortSignal, addEventListener() {}, setInterval() {},
    fetch: () => new Promise((resolve) => { replies.push(resolve); }),
  });
  // Keep the refresh implementation intact and stub rendering for this request-order test.
  const code = file.replace('function render(data) {', 'function unusedRender(data) {')
    .replace('  function refresh() {', '  function render() {}\n  function refresh() {');
  vm.runInContext(code, context);
  assert.equal(replies.length, 1);
  events.get('content')(); // A publish arrives while the first portal fetch is pending.
  replies[0]({ ok: true, json: async () => ({ content: { event: {} } }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(replies.length, 2, 'a second fetch recovers the newer publish immediately');
  replies[1]({ ok: true, json: async () => ({ content: { event: {} } }) });
  await new Promise((resolve) => setImmediate(resolve));
});

test('twist publication seals all content and assets, and unpublishing overrides an elapsed schedule', { timeout: 20000 }, async (t) => {
  const app = await startServer(t);
  const asset = '/uploads/sample-crisis-card.svg';
  fs.copyFileSync(path.join(__dirname, '..', 'public', asset), path.join(app.dir, 'public', asset));
  app.content.crisis.title = 'SECRET twist title';
  app.content.crisis.intro = 'SECRET twist introduction';
  app.content.crisis.tests = ['SECRET test'];
  app.content.crisis.published = true;
  app.content.crisis.revealed = false;
  app.content.crisis.revealAt = '2099-01-01T00:00:00Z';
  await app.publish();
  const read = async () => (await app.request('/api/content')).json();
  let publicView = await read();
  assert.equal(publicView.crisis.sealed, true);
  assert.equal(publicView.crisis.title, 'The twist');
  assert.equal(publicView.crisis.intro, '');
  assert.deepEqual(publicView.crisis.tests, []);
  const card = publicView.media.find((m) => m.topic === 'twist');
  assert.equal(card.locked, true);
  assert.equal(card.url, '');
  assert.equal(card.caption, 'The twist · Locked');
  assert.equal((await app.request(asset)).status, 403);
  assert.equal((await app.request(asset, { headers: { 'x-admin-passcode': 'test-only' } })).status, 200);
  app.content.crisis.revealAt = '2000-01-01T00:00:00Z';
  await app.publish();
  publicView = await read();
  assert.equal(publicView.crisis.sealed, false);
  assert.equal(publicView.crisis.title, 'SECRET twist title');
  assert.equal(publicView.media.find((m) => m.topic === 'twist').url, asset);
  assert.equal((await app.request(asset)).status, 200);
  app.content.crisis.published = false;
  app.content.crisis.revealed = true; // Explicit unpublish takes precedence over either release mechanism.
  await app.publish();
  publicView = await read();
  assert.equal(publicView.crisis.sealed, true);
  assert.equal(publicView.crisis.revealAt, '');
  assert.equal(publicView.media.find((m) => m.topic === 'twist').locked, true);
  assert.equal((await app.request(asset)).status, 403);
  const admin = await (await app.request('/api/content', { headers: { 'x-admin-passcode': 'test-only' } })).json();
  assert.equal(admin.crisis.revealAt, '2000-01-01T00:00:00Z', 'unpublish preserves the disabled schedule');
  assert.equal(admin.crisis.statement, app.content.crisis.statement);
});

test('all information card widgets display live details instead of an enlarged card image', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'public/world.js'), 'utf8');
  const widget = file.slice(file.indexOf('function cardWidget('), file.indexOf('function openLb('));
  const content = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/content.json'), 'utf8'));
  content.crisis = { sealed: true, revealAt: '2099-01-01T00:00:00Z' };
  content.question = { sealed: true };
  const context = vm.createContext({ C: content, esc: (value) => String(value ?? '').replaceAll('<', '&lt;'), fmtDate: String, ytId: () => null });
  vm.runInContext(widget + '\nglobalThis.renderWidget = cardWidget;', context);
  for (const topic of ['theme', 'campaign', 'twist', 'question', 'rules', 'presentation', 'schedule', 'results', 'media']) {
    const html = context.renderWidget({ topic, caption: 'Card title', url: '/uploads/sample-theme.svg', details: 'Extra card details' });
    assert.match(html, /id="cardWidgetTitle"/);
    assert.ok(!html.includes('<img'), `${topic} opens content, not an enlarged image`);
  }
  assert.match(context.renderWidget({ topic: 'twist' }), /The twist is sealed/);
  content.crisis = { sealed: false, title: 'New twist', statement: 'Adapt to no network.', tests: ['Offline resilience'] };
  assert.match(context.renderWidget({ topic: 'twist' }), /Adapt to no network/);
  assert.match(context.renderWidget({ topic: 'twist' }), /Offline resilience/);
  content.crisis = { sealed: true };
  assert.ok(!context.renderWidget({ topic: 'twist' }).includes('Adapt to no network'));
});
