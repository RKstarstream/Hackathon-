const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const createSync = require('../apps-script-sync');

test('Google sync sends only allowed data, retries failures and preserves concurrent updates', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tech-tank-google-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'data/payment-proofs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/payment-proofs/test.png'), 'proof');
  let stored = { users: [{ id: 'test', name: 'Person', email: 'test@example.com', teamName: 'Team', createdAt: 'today', passwordHash: 'never-send', salt: 'private', note: 'private note', googleSync: { status: 'pending' }, payment: { amount: 150, transactionId: '12345', status: 'pending-review', proofFile: 'test.png', proofType: 'image/png' } }], sessions: [{ tokenHash: 'private-token' }] };
  const read = () => structuredClone(stored);
  const save = data => { stored = data; };
  let fail = true, payload, calls = 0;
  const sync = createSync({ root, read, save, url: 'https://script.google.com/macros/s/example/exec', secret: 'x'.repeat(32), fetchImpl: async (url, options) => {
    calls++; payload = JSON.parse(options.body);
    if (fail) throw Error('Offline');
    stored.users[0].note = 'Changed during sync';
    return { ok: true, json: async () => ({ ok: true }) };
  } });
  await sync.flush();
  assert.equal(stored.users[0].googleSync.status, 'pending');
  fail = false;
  await sync.flush();
  assert.equal(stored.users[0].googleSync.status, 'synced');
  assert.equal(stored.users[0].note, 'Changed during sync');
  assert.equal(payload.registration.proofBase64, Buffer.from('proof').toString('base64'));
  assert.equal(payload.registration.amount, 150);
  for (const privateValue of ['never-send', 'private note', 'private-token', 'passwordHash', 'salt']) assert.ok(!JSON.stringify(payload).includes(privateValue));
  await sync.flush();
  assert.equal(calls, 2);
  await createSync({ root, read, save, url: '', secret: '', fetchImpl: () => { throw Error('Must stay disabled'); } }).flush();
});

test('Apps Script rejects bad secrets, stores private proof and deduplicates registrations', () => {
  const rows = [], files = new Map();
  const sheet = { getLastRow: () => rows.length, appendRow: row => rows.push(row), getRange: () => ({ createTextFinder: id => ({ matchEntireCell: () => ({ findNext: () => rows.find(row => row[0] === id) }) }) }) };
  const properties = { SHARED_SECRET: 'x'.repeat(32), SPREADSHEET_ID: 'sheet', PROOF_FOLDER_ID: 'folder' };
  let held = false;
  const context = vm.createContext({
    LockService: { getScriptLock: () => ({ waitLock: () => { held = true; }, hasLock: () => held, releaseLock: () => { held = false; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => properties[name] }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }), flush() {} },
    DriveApp: { getFolderById: () => ({ getFilesByName: name => ({ hasNext: () => files.has(name), next: () => files.get(name) }), createFile: blob => { const file = { getUrl: () => 'https://drive.google.com/file/proof' }; files.set(blob.name, file); return file; } }) },
    Utilities: { base64Decode: value => [...Buffer.from(value, 'base64')], newBlob: (bytes, type, name) => ({ bytes, type, name }) },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../integrations/google-apps-script/Code.gs'), 'utf8'), context);
  const input = { secret: properties.SHARED_SECRET, action: 'registration', registration: { id: '12345678-1234-1234-1234-123456789012', name: '=IMPORTXML("bad")', email: 'test@example.com', teamName: 'Test', amount: 150, transactionId: '00123', proofType: 'image/png', proofBase64: 'aGVsbG8=' } };
  const post = body => context.doPost({ postData: { contents: JSON.stringify(body) } });
  assert.equal(post({ ...input, secret: 'wrong' }).ok, false);
  assert.equal(rows.length, 0);
  assert.equal(post(input).ok, true);
  assert.equal(post(input).ok, true);
  assert.equal(rows.length, 2, 'one header plus one registration');
  assert.equal(files.size, 1);
  assert.equal(rows[1][6], "'00123", 'transaction IDs keep leading zeros and avoid numeric rounding');
  assert.ok(rows[1][2].startsWith("'="), 'formula-like participant names are escaped');
  assert.equal(held, false);
});
