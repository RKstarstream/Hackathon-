'use strict';
// A small in-memory stand-in for the Google Apps Script services used by apps-script/Code.gs.
// Used by the tests and by tools/preview-apps-script.js. It follows the documented behaviour that matters here:
// signed Byte[] arrays, 100 KB cache values, non-reentrant script locks, Drive files and folders, and HtmlService output.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const toBuffer = (value) => (typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(Array.from(value, (b) => b & 255)));

function createGas({ dir = path.join(__dirname, '..', 'apps-script'), url = 'https://script.google.com/macros/s/TEST/exec', logs = [] } = {}) {
  let nextId = 1;
  const newId = (prefix) => `${prefix}${String(nextId++).padStart(6, '0')}${crypto.randomBytes(12).toString('hex')}`;

  class Blob {
    constructor(bytes, type = 'application/octet-stream', name = '') { this.bytes = Buffer.from(bytes); this.type = type; this.name = name; }
    getBytes() { return toSigned(this.bytes); }
    getDataAsString() { return this.bytes.toString('utf8'); }
    getContentType() { return this.type; }
    getName() { return this.name; }
    setName(name) { this.name = name; return this; }
  }

  /* ---------- Drive ---------- */
  const files = new Map(), folders = new Map();
  class File {
    constructor(name, bytes, type, parent) { this.id = newId('f'); this.name = name; this.bytes = Buffer.from(bytes); this.type = type; this.parent = parent; this.trashed = false; this.sharing = 'PRIVATE'; files.set(this.id, this); }
    getId() { return this.id; }
    getName() { return this.name; }
    getBlob() { return new Blob(this.bytes, this.type, this.name); }
    getMimeType() { return this.type; }
    getSize() { return this.bytes.length; }
    setContent(text) { this.bytes = Buffer.from(String(text), 'utf8'); return this; }
    getUrl() { return `https://drive.google.com/file/d/${this.id}/view`; }
    setSharing(access, permission) { if (sim.blockSharing) throw new Error('Sharing is restricted by your organisation'); this.sharing = `${access}:${permission}`; return this; }
    setTrashed(value) { this.trashed = !!value; return this; }
    isTrashed() { return this.trashed; }
    moveTo(folder) { this.parent = folder.id; return this; }
  }
  class Folder {
    constructor(name, parent = null) { this.id = newId('d'); this.name = name; this.parent = parent; folders.set(this.id, this); }
    getId() { return this.id; }
    getName() { return this.name; }
    createFolder(name) { return new Folder(name, this.id); }
    createFile(blobOrName, content, type) {
      if (blobOrName instanceof Blob) return new File(blobOrName.name || 'Untitled', blobOrName.bytes, blobOrName.type, this.id);
      return new File(String(blobOrName), Buffer.from(String(content), 'utf8'), type || 'text/plain', this.id);
    }
    getFilesByName(name) {
      const list = [...files.values()].filter((f) => f.parent === this.id && f.name === name && !f.trashed);
      return { hasNext: () => list.length > 0, next: () => list.shift() };
    }
  }
  const root = new Folder('My Drive');
  const lookup = (map, id, kind) => { const item = map.get(id); if (!item) throw new Error(`No ${kind} with the given ID could be found, or you do not have permission to access it.`); return item; };
  const DriveApp = {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' }, Permission: { VIEW: 'VIEW', EDIT: 'EDIT' },
    createFolder: (name) => root.createFolder(name),
    getFolderById: (id) => lookup(folders, id, 'item'),
    getFileById: (id) => lookup(files, id, 'item'),
    getRootFolder: () => root,
  };

  /* ---------- Sheets ---------- */
  const books = new Map();
  class Range {
    constructor(sheet, row, col, rows, cols) { Object.assign(this, { sheet, row, col, rows, cols }); }
    getRow() { return this.row; }
    getValues() { return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.cols }, (_, c) => (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c] ?? '')); }
    setValues(values) { values.forEach((line, r) => line.forEach((v, c) => { const row = this.sheet.data[this.row - 1 + r] || (this.sheet.data[this.row - 1 + r] = []); row[this.col - 1 + c] = v; })); return this; }
    createTextFinder(text) {
      let entire = false;
      const finder = {
        matchEntireCell: (v) => { entire = !!v; return finder; },
        findNext: () => {
          for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
            const v = String((this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c] ?? '');
            if (entire ? v === text : v.includes(text)) return new Range(this.sheet, this.row + r, this.col + c, 1, 1);
          }
          return null;
        },
      };
      return finder;
    }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; this.frozen = 0; }
    getName() { return this.name; }
    setName(name) { this.name = name; return this; }
    appendRow(values) { this.data.push(values.slice()); return this; }
    getLastRow() { return this.data.length; }
    setFrozenRows(n) { this.frozen = n; return this; }
    getRange(row, col, rows = 1, cols = 1) { return new Range(this, row, col, rows, cols); }
  }
  class Spreadsheet {
    constructor(name) { this.file = root.createFile(name, '', 'application/vnd.google-apps.spreadsheet'); this.sheets = [new Sheet('Sheet1')]; books.set(this.file.id, this); }
    getId() { return this.file.id; }
    getSheets() { return this.sheets.slice(); }
    getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
    insertSheet(name) { const s = new Sheet(name); this.sheets.push(s); return s; }
  }
  const SpreadsheetApp = { create: (name) => new Spreadsheet(name), openById: (id) => lookup(books, id, 'spreadsheet'), flush() {} };

  /* ---------- properties, cache, locks ---------- */
  const props = new Map();
  const scriptProperties = {
    getProperty: (k) => (props.has(k) ? props.get(k) : null),
    setProperty: (k, v) => { props.set(k, String(v)); return scriptProperties; },
    deleteProperty: (k) => { props.delete(k); return scriptProperties; },
    getProperties: () => Object.fromEntries(props),
  };
  const cacheStore = new Map();
  const cacheCheck = (k, v) => {
    if (typeof v !== 'string') throw new Error('Cache values must be strings');
    if (Buffer.byteLength(v, 'utf8') > 100 * 1024) throw new Error('Argument too large: value');
    if (k.length > 250) throw new Error('Argument too large: key');
  };
  const cache = {
    get: (k) => (cacheStore.has(k) ? cacheStore.get(k) : null),
    getAll: (keys) => Object.fromEntries(keys.filter((k) => cacheStore.has(k)).map((k) => [k, cacheStore.get(k)])),
    put: (k, v) => { cacheCheck(k, v); cacheStore.set(k, v); },
    putAll: (values) => { for (const [k, v] of Object.entries(values)) cacheCheck(k, v); for (const [k, v] of Object.entries(values)) cacheStore.set(k, v); },
    remove: (k) => { cacheStore.delete(k); },
  };
  let lockHeld = false;
  const scriptLock = {
    waitLock() { if (lockHeld) throw new Error('Lock timeout: the script lock is already held by this execution (nested lock)'); lockHeld = true; },
    tryLock() { if (lockHeld) return false; lockHeld = true; return true; },
    hasLock: () => lockHeld,
    releaseLock() { lockHeld = false; },
  };

  /* ---------- Utilities ---------- */
  const Utilities = {
    Charset: { UTF_8: 'UTF_8' }, DigestAlgorithm: { SHA_256: 'SHA_256' },
    getUuid: () => crypto.randomUUID(),
    computeDigest: (alg, value) => { if (alg !== 'SHA_256') throw new Error('Unsupported digest'); return toSigned(crypto.createHash('sha256').update(toBuffer(value)).digest()); },
    computeHmacSha256Signature: (value, key) => { sim.hmacCalls++; return toSigned(crypto.createHmac('sha256', toBuffer(key)).update(toBuffer(value)).digest()); },
    base64Encode: (value) => toBuffer(value).toString('base64'),
    base64Decode: (text) => { if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('Could not decode string.'); return toSigned(Buffer.from(text, 'base64')); },
    newBlob: (data, type, name) => new Blob(typeof data === 'string' ? Buffer.from(data, 'utf8') : toBuffer(data), type, name),
    sleep() {},
  };

  /* ---------- HtmlService ---------- */
  class HtmlOutput {
    constructor(html) { this.html = String(html); this.title = ''; this.metas = {}; this.xframe = 'DEFAULT'; }
    getContent() { return this.html; }
    setContent(html) { this.html = String(html); return this; }
    setTitle(t) { this.title = String(t); return this; }
    getTitle() { return this.title; }
    addMetaTag(name, content) { this.metas[name] = content; return this; }
    setXFrameOptionsMode(mode) { this.xframe = mode; return this; }
  }
  const HtmlService = {
    XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' },
    createHtmlOutput: (html = '') => new HtmlOutput(html),
    createHtmlOutputFromFile: (name) => {
      const file = path.join(dir, name + '.html');
      if (!fs.existsSync(file)) throw new Error(`No HTML file named ${name} was found.`);
      return new HtmlOutput(fs.readFileSync(file, 'utf8'));
    },
  };

  const sim = { hmacCalls: 0, blockSharing: false, files, folders, books, props, cacheStore, logs, get lockHeld() { return lockHeld; } };
  const log = (level) => (...args) => logs.push({ level, text: args.map(String).join(' ') });
  const context = vm.createContext({
    DriveApp, SpreadsheetApp, Utilities, HtmlService,
    PropertiesService: { getScriptProperties: () => scriptProperties },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => scriptLock },
    ScriptApp: { getService: () => ({ getUrl: () => url }) },
    console: { log: log('log'), info: log('info'), warn: log('warn'), error: log('error') },
    Logger: { log: log('log') },
  });
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), context, { filename: file });
  }
  // google.script.run passes arguments and results through JSON-like serialisation.
  const roundTrip = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  sim.context = context;
  sim.run = (name, ...args) => {
    if (typeof context[name] !== 'function' || name.endsWith('_')) throw new Error(`Script function not found: ${name}`);
    const result = context[name](...args.map(roundTrip));
    if (lockHeld) throw new Error(`${name} returned while still holding the script lock`);
    return roundTrip(result);
  };
  sim.api = (req) => {
    const out = sim.run('api', req);
    return { ...out, body: out.json != null ? JSON.parse(out.json) : undefined };
  };
  sim.doGet = (parameter = {}) => context.doGet({ parameter });
  return sim;
}

module.exports = { createGas };
