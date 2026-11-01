const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const root = path.join(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const initial = () => JSON.parse(source('data/content.json'));

test('published information reaches public GET, live viewers and reconnecting viewers', { timeout: 15000 }, async (t) => {
  // Run an isolated copy so verification never changes the real event content.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tech-tank-publish-'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'server.js'), source('server.js')
    .replace("Number(process.env.PORT) || 3000", '0')
    .replaceAll('${PORT}', '${server.address().port}'));
  fs.copyFileSync(path.join(root, 'data/content.json'), path.join(dir, 'data/content.json'));
  fs.copyFileSync(path.join(root, 'participants.js'), path.join(dir, 'participants.js'));
  fs.copyFileSync(path.join(root, 'apps-script-sync.js'), path.join(dir, 'apps-script-sync.js'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: dir, env: { ...process.env, PORT: '0', ADMIN_PASSCODE: 'test-only', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  // The isolated server uses an OS-assigned port to avoid other running previews.
  let output = '';
  const base = await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/Website: (http:\/\/localhost:\d+)/);
      if (match) resolve(match[1]);
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Test server exited before listening')));
  });
  async function stream() {
    const abort = new AbortController();
    t.after(() => abort.abort());
    const res = await fetch(base + '/api/stream', { signal: abort.signal });
    assert.equal(res.headers.get('x-accel-buffering'), 'no');
    const reader = res.body.getReader();
    let buffer = '';
    return { abort, async next() {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = event.split('\n').find((line) => line.startsWith('data: '));
          if (data) return JSON.parse(data.slice(6));
        } else {
          const part = await reader.read();
          if (part.done) throw new Error('Stream closed');
          buffer += new TextDecoder().decode(part.value);
        }
      }
    } };
  }
  const live = await stream();
  const first = await live.next();
  const draft = initial();
  draft.event.about = 'Published participant information';
  draft.rules = ['Published rule: bring your student ID.'];
  draft.judging[0].desc = 'Published judging description';
  draft.question.revealed = false;
  draft.question.revealAt = '2099-01-01T00:00:00Z';
  const put = () => fetch(base + '/api/content', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-admin-passcode': 'test-only' }, body: JSON.stringify(draft),
  });
  assert.notEqual(first.event.about, draft.event.about);
  assert.notEqual((await (await fetch(base + '/api/content')).json()).event.about, draft.event.about, 'drafts stay unpublished');
  assert.equal((await put()).status, 200);
  const updated = await live.next();
  assert.equal(updated.event.about, draft.event.about);
  assert.deepEqual(updated.rules, draft.rules);
  assert.equal(updated.judging[0].desc, draft.judging[0].desc);
  assert.equal(updated.question.sealed, true);
  assert.equal(updated.question.statement, undefined);
  assert.deepEqual(await (await fetch(base + '/api/content')).json(), updated);
  live.abort.abort();
  draft.rules.push('Published while the participant was disconnected.');
  await put();
  const reconnected = await stream();
  assert.deepEqual((await reconnected.next()).rules, draft.rules);
});

test('participant refresh recovers, skips duplicates and cannot overwrite a newer live update', async () => {
  const code = source('public/world.js');
  const section = code.slice(code.indexOf("let contentJSON = ''"), code.indexOf('/* ======================= BOOT'));
  let respond;
  let renders = 0;
  const context = vm.createContext({
    C: null, AbortSignal, $: () => null, renderAll: () => renders++,
    fetch: () => new Promise((resolve) => { respond = resolve; }),
  });
  vm.runInContext(section + '\nglobalThis.sync = { load, applyContent };', context);
  const { load, applyContent } = context.sync;
  applyContent({ event: { about: 'first' } });
  applyContent({ event: { about: 'first' } });
  assert.equal(renders, 1);
  const pending = load();
  assert.equal(load(), pending, 'overlapping refreshes share one request');
  applyContent({ event: { about: 'new live update' } });
  respond({ ok: true, json: async () => ({ event: { about: 'stale request' } }) });
  await pending;
  assert.equal(context.C.event.about, 'new live update');
  const failed = load();
  respond({ ok: false });
  await assert.rejects(failed);
  assert.equal(context.C.event.about, 'new live update');
  const recovered = load();
  respond({ ok: true, json: async () => ({ event: { about: 'recovered' } }) });
  await recovered;
  assert.equal(context.C.event.about, 'recovered');
});

test('participant renderer displays published rules, judging descriptions and event information', () => {
  const code = source('public/world.js');
  const render = code.slice(code.indexOf('function renderAll()'), code.indexOf('function setText('));
  const nodes = new Map();
  const $ = (key) => {
    if (!nodes.has(key)) nodes.set(key, { dataset: {}, textContent: '', innerHTML: '' });
    return nodes.get(key);
  };
  const content = initial();
  content.event.about = 'New participant instructions';
  content.rules = ['Bring ID & arrive <early>'];
  content.judging = [{ name: 'Working demo', weight: 100, desc: 'Explain <your> demo & fallback.' }];
  const noop = () => {};
  const context = vm.createContext({
    C: content, $, $$: () => [], document: {}, PHASES: {}, panelState: {}, isSmall: () => false,
    esc: (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    setText: (key, value) => { $(key).textContent = value; }, fmtDate: String,
    buildTiles: noop, renderQuestion: noop, renderSchedule: noop, renderRegister: noop,
    renderControl: noop, renderTicker: noop, renderAlert: noop,
  });
  vm.runInContext(render + '\nrenderAll();', context);
  assert.equal($('#aboutText').textContent, content.event.about);
  assert.match($('#rulesList').innerHTML, /Bring ID &amp; arrive &lt;early&gt;/);
  assert.match($('#judging').innerHTML, /Working demo/);
  assert.match($('#judging').innerHTML, /100%/);
  assert.match($('#judging').innerHTML, /Explain &lt;your&gt; demo &amp; fallback\./);
});

test('publishing keeps bound draft objects and edits typed during a save', async () => {
  const nodes = new Map();
  const element = () => ({
    textContent: '', className: '', checked: false, value: '',
    addEventListener() {}, classList: { toggle() {} },
  });
  let release;
  const bodies = [];
  const context = vm.createContext({
    document: { querySelector: (key) => { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key); } },
    localStorage: { getItem() { return null; } }, sessionStorage: { getItem() { return null; } },
    addEventListener() {}, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      await new Promise((resolve) => { release = resolve; });
      return { ok: true, json: async () => ({ ...body, updatedAt: '2026-10-22T12:00:00Z' }) };
    },
  });
  const code = source('public/admin.js').replace(/\}\)\(\);\s*$/, `
    globalThis.admin = { publish, isDirty, init(value) { D = value; savedStr = JSON.stringify(D); }, draft() { return D; } };
  })();`);
  vm.runInContext(code, context);
  const draft = initial();
  context.admin.init(draft);
  draft.rules[0] = 'First saved rule';
  const saving = context.admin.publish();
  draft.rules[0] = 'Typed while saving';
  release();
  await saving;
  assert.equal(context.admin.draft(), draft, 'existing input bindings remain attached');
  assert.equal(draft.rules[0], 'Typed while saving');
  assert.equal(bodies[0].rules[0], 'First saved rule');
  assert.equal(context.admin.isDirty(), true);
  const second = context.admin.publish();
  const queued = context.admin.publish();
  release();
  await Promise.all([second, queued]);
  assert.equal(bodies.length, 2, 'redundant concurrent publish is skipped');
  assert.equal(bodies[1].rules[0], 'Typed while saving');
  assert.equal(context.admin.isDirty(), false);
});
