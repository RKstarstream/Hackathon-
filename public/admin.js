/* Tech Tank Control Room — edits data/content.json through the API. No code edits needed to run the event. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
let PASS = '';
let D = null;          // draft content
let savedStr = '';     // last published JSON
let tab = 'live';

/* ---------- tiny DOM helper ---------- */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const pad = (n) => String(n).padStart(2, '0');
const ICONS = {
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
  portal: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18m4-12 3 3-3 3"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  trophy: '<path d="M8 3h8v5a4 4 0 0 1-8 0V3Zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 1v6m-4 3h8m-6-3h4v3h-4z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 4h.01"/>',
  check: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
  rules: '<path d="M6 3h12a2 2 0 0 1 2 2v16H8a4 4 0 0 1-4-4V5a2 2 0 0 1 2-2Zm2 0v18m4-13h4m-4 4h4m-4 4h4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-13 4h2m4 0h2"/>',
  settings: '<path d="m9 3-.5 3-2 1L4 6l-2 4 2.5 2v2L2 16l2 4 2.5-1 2 1L9 23h6l.5-3 2-1 2.5 1 2-4-2.5-2v-2L22 10l-2-4-2.5 1-2-1L15 3z" transform="translate(1 0) scale(.92)"/><circle cx="12" cy="12" r="3"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5z"/>',
  shuffle: '<path d="M3 7h3c4 0 8 10 12 10h3m-4-4 4 4-4 4M3 17h3c1 0 2-1 3-2m6-6 3-2h3m-4-4 4 4-4 4"/>',
  chat: '<path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 0 1-1-5 9 9 0 0 1 18 0Z"/><path d="M8 10h8m-8 4h5"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16"/>',
  up: '<path d="m6 12 6-6 6 6m-6-6v15"/>',
  down: '<path d="m6 12 6 6 6-6m-6 6V3"/>',
  left: '<path d="m12 6-6 6 6 6m-6-6h15"/>',
  right: '<path d="m12 6 6 6-6 6m6-6H3"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
const icon = (name) => h('span', { class: 'svg-icon', 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false">${ICONS[name]}</svg>` });

function toast(msg, kind = 'ok') {
  const t = $('#toast'); t.textContent = msg; t.className = `toast show ${kind}`;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', 2600);
}

/* ---------- dirty state + publishing ---------- */
const isDirty = () => JSON.stringify(D) !== savedStr;
let autoTimer;
function changed() {
  const st = $('#state'); const d = isDirty();
  st.textContent = d ? 'Unpublished changes' : 'All changes live'; st.className = 'state' + (d ? ' dirty' : '');
  if (d && $('#autopub').checked) { clearTimeout(autoTimer); autoTimer = setTimeout(publish, 1000); }
}
async function api(method, url, body, raw) {
  const res = await fetch(url, { method, headers: { 'x-admin-passcode': PASS, ...(raw ? {} : { 'Content-Type': 'application/json' }) }, body: raw ? body : body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error('Session expired, sign in again'); }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
let pendingPublish = null;
function publish(msg) {
  // Serialize saves so a slower, older request cannot overwrite a newer one.
  if (pendingPublish) return pendingPublish.then((ok) => ok && isDirty() ? publish(msg) : ok);
  pendingPublish = saveDraft(msg).finally(() => { pendingPublish = null; });
  return pendingPublish;
}
async function saveDraft(msg) {
  clearTimeout(autoTimer);
  const st = $('#state'); st.textContent = 'Publishing...';
  try {
    const out = await api('PUT', '/api/content', D);
    savedStr = JSON.stringify(out);
    // Keep the draft and field bindings intact, including edits typed during the save.
    D.updatedAt = out.updatedAt;
    changed(); toast(isDirty() ? 'Published. Newer edits still need publishing.' : typeof msg === 'string' ? msg : 'Published. The live site is updated.');
    return true;
  } catch (e) { st.textContent = 'Publish failed'; st.className = 'state err'; toast(e.message, 'bad'); return false; }
}

/* ---------- field builders (bind straight into the draft) ---------- */
function text(obj, key, label, o = {}) {
  const input = o.multiline ? h('textarea', { rows: o.rows || 3 }) : h('input', { type: o.type || 'text' });
  input.value = obj[key] ?? ''; if (o.placeholder) input.placeholder = o.placeholder;
  input.addEventListener('input', () => { obj[key] = o.type === 'number' ? (input.value === '' ? '' : Number(input.value)) : input.value; changed(); o.onchange && o.onchange(); });
  return label ? h('label', { class: 'f' }, label, input) : input;
}
const num = (obj, key, label, o = {}) => text(obj, key, label, { ...o, type: 'number' });
function check(obj, key, label, onchange) {
  const c = h('input', { type: 'checkbox', checked: !!obj[key] });
  c.addEventListener('change', () => { obj[key] = c.checked; changed(); onchange && onchange(); });
  return h('label', { class: 'f inline' }, c, label);
}
function select(obj, key, label, options, onchange) {
  const s = h('select', {}, options.map(([v, l]) => h('option', { value: v }, l)));
  s.value = obj[key] ?? ''; s.addEventListener('change', () => { obj[key] = s.value; changed(); onchange && onchange(); });
  return label ? h('label', { class: 'f' }, label, s) : s;
}
function color(obj, key, label) {
  const c = h('input', { type: 'color', value: obj[key] || '#2ec5ff' });
  c.addEventListener('input', () => { obj[key] = c.value; changed(); });
  return h('label', { class: 'f' }, label, c);
}
function lines(obj, key, label, hint = 'One per line') {
  const t = h('textarea', { rows: Math.max(3, (obj[key] || []).length + 1), placeholder: hint });
  t.value = (obj[key] || []).join('\n');
  t.addEventListener('input', () => { obj[key] = t.value.split('\n').map((s) => s.trim()).filter(Boolean); changed(); });
  return h('label', { class: 'f' }, h('span', {}, label, h('span', { class: 'dim' }, `  (${hint.toLowerCase()})`)), t);
}
function dt(obj, key, label) {
  const i = h('input', { type: 'datetime-local' });
  const d = new Date(obj[key]);
  if (!isNaN(d)) i.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  i.addEventListener('change', () => {
    if (!i.value) { obj[key] = ''; changed(); return; }
    const off = -new Date(i.value).getTimezoneOffset();
    obj[key] = `${i.value}:00${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`; changed();
  });
  return h('label', { class: 'f' }, label, i);
}
/* reorderable list of anything */
function list(arr, renderItem, makeNew, o = {}) {
  const wrap = h('div', { class: 'list' });
  arr.forEach((item, i) => {
    const ctrl = h('div', { class: 'ctrl' },
      h('button', { class: 'btn icon sm', title: 'Move up', disabled: i === 0, onclick: () => { arr.splice(i - 1, 0, arr.splice(i, 1)[0]); changed(); render(); } }, icon('up')),
      h('button', { class: 'btn icon sm', title: 'Move down', disabled: i === arr.length - 1, onclick: () => { arr.splice(i + 1, 0, arr.splice(i, 1)[0]); changed(); render(); } }, icon('down')),
      h('button', { class: 'btn icon sm', title: 'Delete', style: 'color:var(--red)', onclick: () => { if (o.confirm === false || confirm('Delete this item?')) { arr.splice(i, 1); changed(); render(); } } }, icon('close')));
    wrap.append(h('div', { class: 'item' + (o.compact ? ' compact' : '') }, h('div', { class: 'body' }, renderItem(item, i)), ctrl));
  });
  const add = h('button', { class: 'btn', onclick: () => { o.top ? arr.unshift(makeNew()) : arr.push(makeNew()); changed(); render(); } }, '+ ' + (o.addLabel || 'Add'));
  return h('div', {}, wrap, h('div', { style: 'margin-top:12px' }, add));
}
const strList = (arr, add, ph) => list(arr, (_, i) => { const inp = h('input', { type: 'text', value: arr[i], placeholder: ph || '' }); inp.addEventListener('input', () => { arr[i] = inp.value; changed(); }); return inp; }, () => '', { compact: true, addLabel: add, confirm: false });
const card = (title, hint, ...kids) => h('div', { class: 'card' }, h('h3', {}, title), hint ? h('p', { class: 'hint' }, hint) : null, ...kids);

/* ---------- tabs ---------- */
const TABS = [
  ['live', 'bolt', 'Live control'],
  ['portal', 'portal', 'Participant portal'],
  ['participants', 'person', 'Participant accounts'],
  ['results', 'trophy', 'Results'],
  ['media', 'image', 'Media'],
  ['question', 'question', 'Question card'],
  ['qualifiers', 'check', 'Qualifiers'],
  ['teams', 'people', 'Teams'],
  ['rules', 'rules', 'Rules & judging'],
  ['schedule', 'calendar', 'Schedule'],
  ['event', 'settings', 'Event details'],
  ['tracks', 'compass', 'Tracks'],
  ['crisis', 'shuffle', 'The twist'],
  ['faq', 'chat', 'FAQ & organisers'],
  ['raw', 'code', 'Raw data'],
];

const V = {};

V.live = () => {
  const phases = [['upcoming', 'Upcoming', 'before start', '#8a90a6'], ['live', 'Hacking', 'build phase', '#18e0a0'], ['crisis', 'Twist', 'reality check', '#ff3b5c'], ['judging', 'Judging', 'demos', '#ffb020'], ['ended', 'Ended', 'results out', '#7c5cff']];
  const ph = h('div', { class: 'phases' }, phases.map(([v, l, s, c]) => h('button', { class: 'phase' + (D.event.phase === v ? ' on' : ''), style: `--c:${c}`, onclick: async () => { D.event.phase = v; render(); await publish(`Phase set to ${l}`); } }, l, h('small', {}, s))));

  const a = D.alert = D.alert || {};
  const presets = h('div', { class: 'presets' },
    h('button', { class: 'btn sm', onclick: () => { Object.assign(a, { level: 'RED', title: 'Reality check', message: 'The twist is live. Check your table for your scenario. The adaptation window starts now.' }); render(); } }, 'Twist is live'),
    h('button', { class: 'btn sm', onclick: () => { Object.assign(a, { level: 'AMBER', title: '15 minutes left', message: 'The adaptation window closes in 15 minutes. Lock in your crisis response.' }); render(); } }, '15 min warning'),
    h('button', { class: 'btn sm', onclick: () => { Object.assign(a, { level: 'AMBER', title: 'Code freeze', message: 'Stop coding. Push your final commit and submit your README now.' }); render(); } }, 'Code freeze'),
    h('button', { class: 'btn sm', onclick: () => { Object.assign(a, { level: 'INFO', title: 'Registrations close soon', message: 'Last call. Register your team before the deadline.' }); render(); } }, 'Last call to register'),
    h('button', { class: 'btn sm', onclick: () => { Object.assign(a, { level: 'INFO', title: 'Qualifiers announced', message: 'The qualified teams list is live. Scroll to the end to find your team.' }); render(); } }, 'Qualifiers out'),
    h('button', { class: 'btn sm', onclick: () => { Object.assign(a, { level: 'INFO', title: 'Results are live', message: 'The winners have been announced. Scroll to Live Results.' }); render(); } }, 'Results live'));

  const ann = D.announcements = D.announcements || [];
  const quick = h('input', { type: 'text', placeholder: 'Type an announcement and press Enter to post it live' });
  const post = async () => {
    if (!quick.value.trim()) return;
    const n = new Date(); ann.unshift({ id: uid('a'), time: `${pad(n.getHours())}:${pad(n.getMinutes())}`, text: quick.value.trim() });
    quick.value = ''; render(); await publish('Announcement posted');
  };
  quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') post(); });

  return [
    card('Event phase', 'Shown as a badge on the site. Click to switch, it goes live immediately.', ph),
    card('Broadcast alert', 'Flashes a full-screen alert with a sound on every open screen, then stays as a banner until you clear it.',
      a.active ? h('div', { class: 'alert-live' }, h('span', { class: 'pulse' }), h('div', { style: 'flex:1' }, h('b', {}, 'LIVE NOW: '), a.title), h('button', { class: 'btn sm', onclick: async () => { a.active = false; render(); await publish('Alert cleared'); } }, 'Clear alert')) : null,
      presets,
      h('div', { class: 'grid3' }, select(a, 'level', 'Level', [['RED', 'Red (crisis)'], ['AMBER', 'Amber (warning)'], ['INFO', 'Info (announcement)']]), h('div', { style: 'grid-column:span 2' }, text(a, 'title', 'Headline'))),
      text(a, 'message', 'Message', { multiline: true, rows: 2 }),
      h('button', { class: 'btn danger', onclick: async () => { a.active = true; a.id = uid('al'); render(); await publish('Alert broadcast to all screens'); } }, a.active ? 'Re-broadcast' : 'Broadcast now')),
    card('Announcements ticker', 'Scrolls across the top of the site. Newest first.',
      h('div', { style: 'display:flex;gap:8px;margin-bottom:14px' }, quick, h('button', { class: 'btn primary', onclick: post }, 'Post')),
      list(ann, (x) => h('div', { class: 'grid3', style: 'grid-template-columns:90px 1fr' }, text(x, 'time', null, { placeholder: 'time' }), text(x, 'text')), () => ({ id: uid('a'), time: '', text: '' }), { compact: true, addLabel: 'Add announcement', top: true })),
    card('Results visibility', null, check(D.results, 'published', 'Show the live leaderboard on the site', () => publish(D.results.published ? 'Leaderboard is visible' : 'Leaderboard hidden'))),
  ];
};

V.results = () => {
  const crit = D.judging || [];
  const total = (t) => crit.reduce((a, j) => a + (Number((t.scores || {})[j.name]) || 0) / 10 * Number(j.weight || 0), 0);
  const cells = {};
  const refresh = () => {
    const ranked = [...D.teams].sort((a, b) => total(b) - total(a));
    D.teams.forEach((t) => { if (cells[t.id]) { cells[t.id].tot.textContent = total(t).toFixed(1); cells[t.id].rk.textContent = '#' + (ranked.indexOf(t) + 1); } });
  };
  const rows = D.teams.map((t) => {
    t.scores = t.scores || {};
    const tot = h('td', { class: 'tot' }); const rk = h('td', { class: 'rank' }); cells[t.id] = { tot, rk };
    return h('tr', {}, h('td', {}, h('b', {}, t.name)),
      crit.map((j) => {
        const inp = h('input', { type: 'number', min: 0, max: 10, step: .5, value: t.scores[j.name] ?? '' });
        const set = (v) => { if (v === '' || v == null || isNaN(v)) delete t.scores[j.name]; else t.scores[j.name] = Math.max(0, Math.min(10, Math.round(v * 2) / 2)); inp.value = t.scores[j.name] ?? ''; refresh(); changed(); };
        inp.addEventListener('input', () => set(inp.value === '' ? '' : Number(inp.value)));
        return h('td', {}, h('span', { class: 'stepper' },
          h('button', { onclick: () => set((Number(t.scores[j.name]) || 0) - .5) }, '−'), inp,
          h('button', { onclick: () => set((Number(t.scores[j.name]) || 0) + .5) }, '+')));
      }), tot, rk);
  });
  setTimeout(refresh);
  const teamOpts = [['', 'Pick a team'], ...D.teams.map((t) => [t.name, t.name])];
  D.results.winners = D.results.winners || [];
  return [
    card('Scores', `Each criterion is out of 10 and weighted by its judging weight, so the total is out of 100. Tip: turn on Auto-publish while judging so the leaderboard moves live.`,
      D.teams.length ? h('div', { class: 'scores' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Team'), crit.map((j) => h('th', {}, `${j.name} (${j.weight}%)`)), h('th', {}, 'Total'), h('th', {}, 'Rank'))), h('tbody', {}, rows)))
        : h('p', { class: 'dim' }, 'Add teams first in the Teams tab.'),
      h('div', { style: 'display:flex;gap:8px;margin-top:14px;flex-wrap:wrap' },
        h('button', { class: 'btn ghost sm', onclick: () => { if (confirm('Clear every score for every team?')) { D.teams.forEach((t) => t.scores = {}); changed(); render(); } } }, 'Reset all scores'))),
    card('Winners', 'Shown in gold above the leaderboard. Leave empty until you announce.',
      list(D.results.winners, (w) => h('div', { class: 'grid2' }, text(w, 'award', 'Award', { placeholder: 'e.g. Overall Winner' }), select(w, 'team', 'Team', teamOpts.some(([v]) => v === w.team) ? teamOpts : [...teamOpts, [w.team, w.team]])), () => ({ award: '', team: '' }), { addLabel: 'Add award' })),
    card('Leaderboard', null, text(D.results, 'note', 'Note under the heading'), check(D.results, 'published', 'Show the leaderboard on the site')),
  ];
};

V.media = () => {
  D.media = D.media || [];
  const fileIn = h('input', { type: 'file', multiple: true, accept: 'image/*,video/*', hidden: true });
  const bar = h('i'); const prog = h('div', { class: 'progress', hidden: true }, bar);
  const status = h('div', { class: 'dim', style: 'margin-top:8px;font-size:.85rem' });
  const upload = async (files) => {
    files = [...files]; if (!files.length) return;
    prog.hidden = false; let done = 0;
    for (const f of files) {
      status.textContent = `Uploading ${f.name} (${done + 1}/${files.length})`;
      try {
        const out = await new Promise((res, rej) => {
          const x = new XMLHttpRequest(); x.open('POST', '/api/upload?name=' + encodeURIComponent(f.name));
          x.setRequestHeader('x-admin-passcode', PASS);
          x.upload.onprogress = (e) => { bar.style.width = ((done + e.loaded / e.total) / files.length * 100) + '%'; };
          x.onload = () => { const d = JSON.parse(x.responseText || '{}'); x.status < 300 ? res(d) : rej(new Error(d.error || 'Upload failed')); };
          x.onerror = () => rej(new Error('Network error')); x.send(f);
        });
        D.media.unshift({ id: uid('m'), type: f.type.startsWith('video') ? 'video' : 'image', url: out.url, caption: '' });
      } catch (e) { toast(`${f.name}: ${e.message}`, 'bad'); }
      done++;
    }
    render(); await publish(`${done} file${done > 1 ? 's' : ''} uploaded and live`);
  };
  fileIn.addEventListener('change', () => upload(fileIn.files));
  const drop = h('div', { class: 'drop', onclick: () => fileIn.click() }, h('b', {}, 'Drop photos or videos here'), 'or click to choose. They go live straight away.', fileIn);
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => upload(e.dataTransfer.files));

  const link = { url: '', caption: '' };
  const addLink = async () => {
    if (!link.url) return toast('Paste a link first', 'bad');
    const yt = /youtu\.?be/.test(link.url); const vid = /\.(mp4|webm|mov)(\?|$)/i.test(link.url);
    D.media.unshift({ id: uid('m'), type: yt ? 'youtube' : vid ? 'video' : 'image', url: link.url, caption: link.caption });
    render(); await publish('Media added');
  };

  const grid = h('div', { class: 'media-grid' }, D.media.map((m, i) => {
    const thumb = h('div', { class: 'thumb' });
    if (m.topic === 'twist' || /sample-crisis-card/i.test(m.url || '')) thumb.append(icon('shuffle'), 'Twist widget');
    else if (m.type === 'video') thumb.append(h('video', { src: m.url, muted: true, preload: 'metadata' }));
    else if (m.type === 'youtube') { const id = (/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/.exec(m.url) || [])[1]; thumb.style.backgroundImage = `url(https://img.youtube.com/vi/${id}/hqdefault.jpg)`; }
    else thumb.style.backgroundImage = `url("${m.url.replace(/"/g, '%22')}")`;
    if (!m.topic) m.topic = /sample-crisis-card/i.test(m.url || '') ? 'twist' : /sample-theme/i.test(m.url || '') ? 'theme' : /sample-campaign/i.test(m.url || '') ? 'campaign' : 'media';
    return h('div', { class: 'mcard' }, thumb, h('div', { class: 'mb' }, text(m, 'caption', null, { placeholder: 'Caption' }),
      select(m, 'topic', 'Widget content', [['media', 'Media details'], ['theme', 'Event theme'], ['campaign', 'Event information'], ['twist', 'The twist (follows reveal controls)'], ['question', 'Question card'], ['rules', 'Rules & judging'], ['presentation', 'Presentation format'], ['schedule', 'Schedule'], ['results', 'Results']]),
      text(m, 'details', 'Widget description (for media cards)', { multiline: true, rows: 2 }),
      h('div', { class: 'row' },
        h('button', { class: 'btn icon sm', title: 'Move earlier', disabled: i === 0, onclick: () => { D.media.splice(i - 1, 0, D.media.splice(i, 1)[0]); changed(); render(); } }, icon('left')),
        h('button', { class: 'btn icon sm', title: 'Move later', disabled: i === D.media.length - 1, onclick: () => { D.media.splice(i + 1, 0, D.media.splice(i, 1)[0]); changed(); render(); } }, icon('right')),
        h('span', { class: 'dim mono', style: 'flex:1;font-size:.7rem;align-self:center;text-align:center' }, m.type),
        h('button', { class: 'btn icon sm', title: 'Remove', style: 'color:var(--red)', onclick: () => { if (confirm('Remove from the site?')) { D.media.splice(i, 1); changed(); render(); } } }, icon('close')))));
  }));
  return [
    card('Upload', 'Images and videos up to 60 MB each.', drop, prog, status),
    card('Add by link', 'YouTube links, or any image or video URL.', h('div', { class: 'grid2' }, text(link, 'url', 'Link', { placeholder: 'https://youtu.be/...' }), text(link, 'caption', 'Caption')), h('button', { class: 'btn', onclick: addLink }, 'Add link')),
    card(`Gallery (${D.media.length})`, 'Captions change live after you publish. First item shows first.', D.media.length ? grid : h('p', { class: 'dim' }, 'Nothing yet.')),
  ];
};

V.teams = () => {
  const trackOpts = [['', 'No track'], ...(D.tracks || []).map((t) => [t.id, t.name])];
  const cardOpts = [['', 'Not dealt yet'], ...((D.crisis && D.crisis.cards) || []).map((c) => [c.title, `${c.title} (${c.level})`])];
  const members = (t) => { const ta = h('textarea', { rows: 2, placeholder: 'One name per line' }); ta.value = (t.members || []).join('\n'); ta.addEventListener('input', () => { t.members = ta.value.split(/\n|,/).map((s) => s.trim()).filter(Boolean); changed(); }); return h('label', { class: 'f' }, 'Members (one per line)', ta); };
  const deal = () => { const cards = D.crisis.cards || []; if (!cards.length) return; const pool = [...cards].sort(() => Math.random() - .5); D.teams.forEach((t, i) => t.crisisCard = pool[i % pool.length].title); changed(); render(); toast('Random crisis cards dealt. Publish to show them.'); };
  return [
    card(`Teams (${D.teams.length})`, 'Teams here are used for scoring and the results board. Scores are edited in the Results tab.',
      h('div', { style: 'display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap' }, h('button', { class: 'btn sm ghost', onclick: () => { if (confirm('Delete ALL teams (including sample teams)?')) { D.teams = []; changed(); render(); } } }, 'Remove all teams')),
      list(D.teams, (t) => h('div', {},
        h('div', { class: 'grid2' }, text(t, 'name', 'Team name'), select(t, 'track', 'Track', trackOpts)),
        h('div', { class: 'grid2' }, members(t), text(t, 'project', 'Project (one line)', { multiline: true, rows: 2 })),
        select(t, 'crisisCard', 'Assigned twist (visible in linked participant portals after reveal)', cardOpts)),
      () => ({ id: uid('t'), name: 'New team', track: (D.tracks[0] || {}).id || '', members: [], project: '', crisisCard: '', scores: {} }), { addLabel: 'Add team' })),
  ];
};

V.qualifiers = () => {
  const qf = D.qualifiers = D.qualifiers || { published: false, note: '', list: [] }; qf.list = qf.list || [];
  const bulk = h('textarea', { rows: 4, placeholder: 'Paste team names, one per line. Add details after a dash, e.g.\nNull Pointers - PES University' });
  return [
    card('Qualified teams', 'Appears in its own section after the 3D journey, with a search box so teams can find themselves.',
      check(qf, 'published', 'Show the qualifiers list on the site', () => publish(qf.published ? 'Qualifiers list is live' : 'Qualifiers list hidden')),
      text(qf, 'note', 'Note above the list')),
    card('Paste a list', 'Fastest way to add many teams at once.', bulk,
      h('button', { class: 'btn', style: 'margin-top:10px', onclick: () => { const rows = bulk.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [n, ...d] = l.split(/\s+-\s+/); return { name: n, detail: d.join(' - ') }; }); qf.list.push(...rows); changed(); render(); toast(`${rows.length} added. Publish to show them.`); } }, 'Add to list')),
    card(`List (${qf.list.length})`, null,
      list(qf.list, (x) => h('div', { class: 'grid2' }, text(x, 'name', 'Team'), text(x, 'detail', 'Detail (college, members)')), () => ({ name: '', detail: '' }), { compact: true, addLabel: 'Add team' }),
      qf.list.length ? h('button', { class: 'btn sm ghost', style: 'margin-top:10px', onclick: () => { if (confirm('Clear the whole list?')) { qf.list = []; changed(); render(); } } }, 'Clear list') : null),
  ];
};

V.question = () => {
  const q = D.question = D.question || {};
  return [
    card('Reveal', 'The question stays sealed on the public site until the reveal time. Nobody can read it before then, even by looking at the page code. At the reveal moment every open screen flips the card by itself.',
      h('div', { class: 'grid2' }, dt(q, 'revealAt', 'Reveal time')),
      check(q, 'revealed', 'Reveal now (ignore the reveal time)'),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn danger', onclick: async () => { if (!confirm('Reveal the question to everyone right now?')) return; q.revealed = true; render(); await publish('Question revealed on every screen'); } }, 'Reveal to everyone now'),
        q.revealed ? h('button', { class: 'btn ghost', onclick: async () => { q.revealed = false; render(); await publish('Question sealed again'); } }, 'Seal it again') : null)),
    card('Problem statement', 'While "sample" is ticked the site shows a SAMPLE badge once revealed. Untick it once the final question is decided.',
      check(q, 'sample', 'This is a sample question (final not announced yet)'),
      text(q, 'title', 'Title'), text(q, 'statement', 'Statement', { multiline: true, rows: 3 }), text(q, 'context', 'Context / background', { multiline: true, rows: 3 }),
      lines(q, 'requirements', 'What teams must do'), lines(q, 'deliverables', 'What to submit')),
  ];
};

V.rules = () => {
  const sum = h('span', { class: 'sum' });
  const upd = () => { const s = D.judging.reduce((a, j) => a + (Number(j.weight) || 0), 0); sum.textContent = `Weights add up to ${s}%`; sum.className = 'sum' + (s === 100 ? '' : ' bad'); };
  setTimeout(upd);
  return [
    card('Rules', 'Numbered automatically on the site.', strList(D.rules, 'Add rule', 'Rule')),
    card('Judging criteria', null, sum,
      h('div', { style: 'height:12px' }),
      list(D.judging, (j) => h('div', { class: 'grid3', style: 'grid-template-columns:1fr 100px 2fr' }, text(j, 'name', 'Criterion'), num(j, 'weight', 'Weight %', { onchange: upd }), text(j, 'desc', 'Description')), () => ({ name: 'New criterion', weight: 0, desc: '' }), { addLabel: 'Add criterion' }),
      h('p', { class: 'dim', style: 'margin-top:12px;font-size:.85rem' }, 'Renaming a criterion detaches existing scores for it. Re-enter them in Results.')),
  ];
};

V.schedule = () => [
  card('Schedule', '"Day 1" is the start date in Event details, "Day 2" the day after, and so on. The site highlights the session happening now.',
    list(D.schedule, (s) => h('div', {},
      h('div', { class: 'grid3', style: 'grid-template-columns:110px 110px 1fr' }, text(s, 'day', 'Day'), text(s, 'time', 'Time (24h)', { placeholder: '14:30' }), text(s, 'title', 'Title')),
      h('div', { class: 'grid2', style: 'grid-template-columns:1fr 180px' }, text(s, 'desc', 'Details'), select(s, 'type', 'Style', [['', 'Normal'], ['key', 'Key moment'], ['crisis', 'Crisis']]))),
    () => ({ day: 'Day 1', time: '', title: '', desc: '', type: '' }), { addLabel: 'Add session' })),
];

V.event = () => {
  const e = D.event;
  return [
    card('Basics', null,
      h('div', { class: 'grid2' }, text(e, 'name', 'Event name'), text(e, 'theme', 'Theme (hero headline)')),
      h('div', { class: 'grid2' }, text(e, 'campaign', 'Campaign line'), text(e, 'tagline', 'Tagline')),
      text(e, 'about', 'About', { multiline: true, rows: 4 })),
    card('When & where', 'Drives the countdown and the live schedule. Times use this computer\'s time zone.',
      h('div', { class: 'grid2' }, dt(e, 'startsAt', 'Starts'), dt(e, 'endsAt', 'Ends')),
      check(e, 'datesTentative', 'Show "dates tentative"'), text(e, 'venue', 'Venue')),
    card('Registration', 'Drives the Register buttons and the countdown at the end of the journey.',
      check(e, 'registrationOpen', 'Registrations are open'),
      h('div', { class: 'grid2' }, dt(e, 'registrationDeadline', 'Registrations close'), text(e, 'registerUrl', 'Optional additional form (inside participant portal)', { type: 'url', placeholder: 'https://forms.gle/...' }))),
    card('Links', null,
      h('div', { class: 'grid2' }, text(e, 'contactEmail', 'Contact email', { type: 'email' }), text(e, 'instagram', 'Instagram', { placeholder: '@techtank' }))),
    card('Headline numbers', 'The four numbers in the Mission panel.',
      list(e.stats = e.stats || [], (s) => h('div', { class: 'grid2', style: 'grid-template-columns:120px 1fr' }, text(s, 'value', 'Number'), text(s, 'label', 'Label')), () => ({ value: '0', label: 'Label' }), { compact: true, addLabel: 'Add number' })),
  ];
};

V.tracks = () => [
  card('Tracks', 'Each track becomes a floating hologram and a row in the Tracks panel. Tapping either opens the full brief.',
    list(D.tracks, (t) => h('div', {},
      h('div', { class: 'grid3', style: 'grid-template-columns:1fr 120px 150px 60px' }, text(t, 'name', 'Name'), text(t, 'id', 'Short id'), select(t, 'icon', 'Icon', [['brain', 'Brain'], ['shield', 'Shield'], ['leaf', 'Leaf'], ['people', 'People'], ['spark', 'Spark'], ['bolt', 'Bolt'], ['code', 'Code']]), color(t, 'color', 'Colour')),
      text(t, 'description', 'One-line description'),
      text(t, 'about', 'Full brief (shown when someone taps the track)', { multiline: true, rows: 3 }),
      lines(t, 'areas', 'Focus areas'), lines(t, 'examples', 'Example ideas'), text(t, 'lookFor', 'What judges look for')),
    () => ({ id: uid('tr'), name: 'New track', icon: 'spark', color: '#2ec5ff', description: '', about: '', areas: [], examples: [], lookFor: '' }), { addLabel: 'Add track' })),
  card('AI note', null, text(D, 'aiNote', null, { multiline: true, rows: 2 })),
];

V.crisis = () => {
  const c = D.crisis;
  if (c.published == null) c.published = true;
  return [
    card('Twist content', 'The title, introduction, instructions, scenarios and linked media stay hidden until publication.', text(c, 'title', 'Twist title'), text(c, 'intro', 'Introduction', { multiline: true, rows: 3 }), lines(c, 'tests', 'What it tests')),
    card('Release to participants', 'The detailed instructions and assigned team scenarios stay sealed on the server until this time or a manual reveal. Publish to apply changes.',
      dt(c, 'revealAt', 'Twist reveal time (optional)'),
      h('p', { class: 'hint' }, c.published === false ? 'Unpublished. It stays hidden even if the saved reveal time has passed.' : c.revealed ? 'Published immediately.' : c.revealAt ? 'Scheduled for ' + new Date(c.revealAt).toLocaleString() : 'Sealed. Choose a time or publish now.'),
      text(c, 'statement', 'Released twist instructions', { multiline: true, rows: 5 }),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
        h('button', { class: 'btn', onclick: async () => { if (!c.revealAt || !Number.isFinite(Date.parse(c.revealAt))) return toast('Choose a valid reveal time first', 'bad'); c.published = true; c.revealed = false; render(); await publish('Twist publication scheduled'); } }, 'Schedule publication'),
        h('button', { class: 'btn danger', onclick: async () => { c.published = true; c.revealed = true; render(); await publish('Twist revealed in participant portals'); } }, 'Reveal twist now'),
        h('button', { class: 'btn ghost', onclick: async () => { c.published = false; c.revealed = false; render(); await publish('Twist unpublished. Saved schedule is disabled until you schedule again.'); } }, 'Unpublish twist'))),
    card('Team scenarios', 'Assign a scenario in Teams. Only linked participants receive their assigned scenario after the twist is revealed.',
      list(c.cards, (x) => h('div', {},
        h('div', { class: 'grid2' }, text(x, 'title', 'Scenario title'), select(x, 'level', 'Level', [['RED', 'Red'], ['AMBER', 'Amber'], ['INFO', 'Info']])),
        text(x, 'text', 'Scenario instructions', { multiline: true, rows: 3 }), num(x, 'minutes', 'Adaptation time (minutes)')),
      () => ({ title: 'New scenario', level: 'AMBER', text: '', minutes: 90 }), { addLabel: 'Add scenario' })),
  ];
};

V.portal = () => {
  const p = D.portal;
  return [
    card('Participant portal', 'Participants create an account at /register and sign in at /login. Their portal opens directly on the question. Publish these settings to update all portals.',
      text(p, 'welcome', 'Welcome message'),
      h('a', { href: '/portal', target: '_blank', rel: 'noopener', class: 'btn' }, 'Open participant portal ↗')),
    card('Presentation format', 'Shown in the presentation tab and the portal summary. Times are in minutes.',
      h('div', { class: 'grid2' }, num(p, 'demoMinutes', 'Demo / presentation duration'), num(p, 'qaMinutes', 'Q&A duration')),
      text(p, 'presentationIntro', 'Presentation description', { multiline: true, rows: 2 }),
      text(p, 'presentationNotes', 'Preparation instructions', { multiline: true, rows: 4 }),
      text(p, 'submissionUrl', 'Project submission link', { type: 'url', placeholder: 'https://...' })),
    card('Build & submission parameters', 'Extra requirements shown alongside the shared rules and judging criteria.', lines(p, 'parameters', 'Parameters')),
    card('Result status', 'Individual registration status and notes are managed in Participant accounts. Scores and awards are managed in Results.',
      text(p, 'resultNotice', 'Message for everyone about results', { multiline: true, rows: 3 })),
    card('Other portal content', 'Question card controls the sealed question and reveal time. The twist controls twist instructions and scenarios. Rules & judging, Schedule and Live control update the same content in participant portals.'),
  ];
};

V.participants = () => {
  const container = h('div', {}, h('p', { class: 'dim' }, 'Loading registered participants…'));
  const refresh = async () => {
    try {
      const { users } = await api('GET', '/api/participants');
      if (!container.isConnected) return;
      const statuses = [['registered', 'Registered'], ['under-review', 'Under review'], ['qualified', 'Qualified'], ['not-qualified', 'Not qualified'], ['presenting', 'Presenting'], ['completed', 'Completed'], ['disqualified', 'Disqualified']];
      container.replaceChildren(...(users.length ? users.map((user) => {
        const team = h('select', {}, h('option', { value: '' }, 'Not linked yet'), D.teams.map((t) => h('option', { value: t.id }, t.name)));
        team.value = user.teamId || '';
        const status = h('select', {}, statuses.map(([value, label]) => h('option', { value }, label)));
        status.value = user.status;
        const note = h('textarea', { rows: 3, maxLength: 2000, value: user.note || '', placeholder: 'Visible only to this participant in their portal' });
        const save = h('button', { class: 'btn primary sm', onclick: async () => {
          save.disabled = true;
          try {
            await api('PUT', '/api/participants', { id: user.id, teamId: team.value, status: status.value, note: note.value });
            toast(`Portal updated for ${user.name}`); save.textContent = 'Saved';
          } catch (error) { toast(error.message, 'bad'); }
          finally { save.disabled = false; }
        } }, 'Save participant update');
        [team, status, note].forEach((input) => input.addEventListener('input', () => { save.textContent = 'Save participant update'; }));
        return card(user.name, `${user.email} · Registered team: ${user.teamName} · ${fmtParticipantDate(user.createdAt)}`,
          user.payment ? h('div', {}, h('p', {}, `Payment: ₹${user.payment.amount} · Transaction ID: ${user.payment.transactionId} · Pending organiser review`),
            h('button', { class: 'btn sm', onclick: async () => {
              try {
                const response = await fetch(user.payment.proofUrl, { headers: { 'x-admin-passcode': PASS } });
                if (!response.ok) throw new Error('Could not load payment proof');
                const objectUrl = URL.createObjectURL(await response.blob());
                const link = h('a', { href: objectUrl, download: `payment-proof-${user.id}` });
                link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
              } catch (error) { toast(error.message, 'bad'); }
            } }, 'Download payment proof')) : h('p', { class: 'dim' }, 'No payment proof on file (existing account).'),
          h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Link official team (controls scores and assigned twist)', team), h('label', { class: 'f' }, 'Participant status', status)),
          h('label', { class: 'f' }, 'Private participant message', note), save);
      }) : [h('p', { class: 'dim' }, 'No accounts yet. Participants appear here after creating an account at /register.')]));
    } catch (error) { container.replaceChildren(h('p', { class: 'err' }, error.message), h('button', { class: 'btn', onclick: refresh }, 'Retry')); }
  };
  setTimeout(refresh, 0);
  return [card('Registered accounts', 'Link each account to its official team from the Teams tab. Accounts cannot claim an existing team themselves. Use Save participant update on each card to apply its status, team link and private message immediately. The top Publish button applies shared event content.', h('button', { class: 'btn sm', onclick: refresh }, 'Refresh accounts')), container];
};
const fmtParticipantDate = (value) => new Date(value).toLocaleString();

V.faq = () => [
  card('FAQ', null, list(D.faq = D.faq || [], (f) => h('div', {}, text(f, 'q', 'Question'), text(f, 'a', 'Answer', { multiline: true, rows: 2 })), () => ({ q: '', a: '' }), { addLabel: 'Add question' })),
  card('Organising team', 'Shown in the footer.', strList(D.committee = D.committee || [], 'Add person', 'Name')),
];

V.raw = () => {
  const ta = h('textarea', { rows: 28, class: 'mono', style: 'font-family:var(--mono);font-size:.8rem' }); ta.value = JSON.stringify(D, null, 2);
  return [card('Raw content', 'Everything on the site in one place. For bulk edits or backups. Apply, then Publish.', ta,
    h('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' },
      h('button', { class: 'btn', onclick: () => { try { const v = JSON.parse(ta.value); if (!v.event) throw new Error('Missing "event"'); D = v; changed(); toast('Applied. Publish to go live.'); } catch (e) { toast('Invalid JSON: ' + e.message, 'bad'); } } }, 'Apply'),
      h('button', { class: 'btn ghost', onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(D, null, 2)], { type: 'application/json' })), download: 'tech-tank-content.json' }); a.click(); } }, 'Download backup')))];
};

function render() {
  $('#tabs').replaceChildren(...TABS.map(([id, ic, l]) => h('button', { class: 'tab' + (tab === id ? ' on' : ''), onclick: () => { tab = id; try { localStorage.setItem('tt-tab', id); } catch {} $('#side').classList.remove('open'); render(); scrollTo(0, 0); } }, icon(ic), l)));
  $('#tabTitle').textContent = TABS.find((t) => t[0] === tab)[2];
  ['teams', 'tracks', 'schedule', 'rules', 'judging', 'media', 'faq', 'committee', 'announcements'].forEach((k) => { if (!Array.isArray(D[k])) D[k] = []; });
  D.results = D.results || { published: true }; D.crisis = D.crisis || { cards: [] }; D.crisis.cards = D.crisis.cards || [];
  D.portal = { welcome: '', demoMinutes: 3, qaMinutes: 2, presentationIntro: '', presentationNotes: '', submissionUrl: '', parameters: [], resultNotice: '', ...D.portal };
  $('#content').replaceChildren(...V[tab]());
}

/* ---------- auth + boot ---------- */
async function load() {
  D = await (await fetch('/api/content', { cache: 'no-store', headers: { 'x-admin-passcode': PASS } })).json();
  savedStr = JSON.stringify(D);
  $('#login').hidden = true; $('#app').hidden = false;
  render(); changed();
  const es = new EventSource('/api/stream');
  es.addEventListener('content', async () => {
    if (pendingPublish) return;
    // the stream carries the public (sealed) view, so fetch the full version with the passcode
    const full = await (await fetch('/api/content', { cache: 'no-store', headers: { 'x-admin-passcode': PASS } })).json();
    const incoming = JSON.stringify(full);
    if (incoming === savedStr) return;
    if (!isDirty()) { D = JSON.parse(incoming); savedStr = incoming; render(); }
    else toast('Someone else published changes. Yours will overwrite theirs when you publish.', 'bad');
  });
}
function logout() { try { localStorage.removeItem('tt-pass'); sessionStorage.removeItem('tt-pass'); } catch {} location.reload(); }

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); PASS = $('#pass').value;
  const r = await fetch('/api/login', { method: 'POST', headers: { 'x-admin-passcode': PASS } });
  if (!r.ok) { $('#loginErr').textContent = 'Wrong passcode'; return; }
  try { ($('#remember').checked ? localStorage : sessionStorage).setItem('tt-pass', PASS); } catch {}
  load();
});
$('#publish').onclick = () => publish();
$('#revert').onclick = () => { if (isDirty() && confirm('Discard unpublished changes?')) { D = JSON.parse(savedStr); render(); changed(); } };
$('#logout').onclick = logout;
$('#menu').onclick = () => $('#side').classList.toggle('open');
try { $('#autopub').checked = localStorage.getItem('tt-auto') === '1'; tab = localStorage.getItem('tt-tab') || 'live'; } catch {}
if (!TABS.some((t) => t[0] === tab)) tab = 'live';
$('#autopub').addEventListener('change', () => { try { localStorage.setItem('tt-auto', $('#autopub').checked ? '1' : '0'); } catch {} if ($('#autopub').checked) changed(); });
addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (D) publish(); } });
addEventListener('beforeunload', (e) => { if (D && isDirty()) { e.preventDefault(); e.returnValue = ''; } });

(async () => {
  let saved = null; try { saved = sessionStorage.getItem('tt-pass') || localStorage.getItem('tt-pass'); } catch {}
  if (saved) {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'x-admin-passcode': saved } });
    if (r.ok) { PASS = saved; return load(); }
  }
})();
})();
