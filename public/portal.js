(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (value) => { const date = new Date(value); return isNaN(date) ? 'To be announced' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
  const statusNames = { registered: 'Registered', 'under-review': 'Under review', qualified: 'Qualified', 'not-qualified': 'Not qualified', presenting: 'Presenting', completed: 'Completed', disqualified: 'Disqualified' };
  const phaseNames = { upcoming: 'Upcoming', live: 'Hacking live', crisis: 'Twist active', judging: 'Judging', ended: 'Event ended' };
  const sections = ['question', 'twist', 'presentation', 'rules', 'schedule', 'results'];
  const list = (items, ordered = false) => `<${ordered ? 'ol' : 'ul'} class="${ordered ? 'numbered-list' : 'bullet-list'}">${(items || []).map((item) => `<li>${esc(item)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
  const safeLink = (url) => { try { const parsed = new URL(url, location.origin); return /^https?:$/.test(parsed.protocol) ? esc(parsed.href) : ''; } catch { return ''; } };
  let snapshot = null, lastJSON = '', inFlight = null, stream = null, lastRevealCheck = 0, refreshAgain = false;

  function selectSection() {
    const selected = sections.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'question';
    sections.forEach((id) => { $('section-' + id).hidden = id !== selected; });
    document.querySelectorAll('#portalNav a').forEach((link) => {
      if (link.hash === '#' + selected) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }
  addEventListener('hashchange', selectSection);
  selectSection();

  const lockIcon = '<div class="locked-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></svg></div>';
  function sealedCard(id, title, when, text) {
    return `${lockIcon}<h2 id="heading-${id}">${esc(title)}</h2><p class="muted">${esc(text)}</p>${when ? `<p>Official reveal: <strong>${esc(fmt(when))}</strong></p><div class="reveal-countdown" id="${id}Countdown" aria-label="Time until reveal"></div>` : '<p class="muted">The organisers will announce the reveal time here.</p>'}<p class="muted">This page updates automatically when the organisers release it.</p>`;
  }
  function render(data) {
    const { user, content: c, result, assignedTwist } = data;
    const e = c.event, settings = c.portal || {}, q = c.question || {}, twist = c.crisis || {};
    const demo = Number(settings.demoMinutes ?? 3), qa = Number(settings.qaMinutes ?? 2);
    document.title = `${e.name} · Your portal`;
    $('welcomeTitle').textContent = `Welcome, ${user.name.split(' ')[0]}.`;
    $('welcomeText').textContent = settings.welcome || 'Your question, updates and team progress. All in one place.';
    $('participantName').textContent = user.name;
    $('participantTeam').textContent = result.team || user.teamName;
    $('summaryStatus').textContent = statusNames[user.status] || 'Registered';
    $('summaryTeam').textContent = result.team || user.teamName;
    $('summaryDuration').textContent = `${demo + qa} minutes`;
    $('summaryDurationNote').textContent = `${demo} min demo + ${qa} min Q&A`;
    $('summaryPhase').textContent = phaseNames[e.phase] || e.phase || 'Upcoming';
    $('summaryVenue').textContent = e.venue || 'Venue to be announced';
    $('questionState').textContent = q.sealed === false ? 'REVEALED' : 'SEALED';
    $('questionState').classList.toggle('sealed', q.sealed !== false);
    $('questionContent').innerHTML = q.sealed !== false
      ? sealedCard('question', 'The challenge is almost yours.', q.revealAt, 'Your question will unlock right here at the official reveal. You can check the rules and presentation format while you wait.')
      : `${q.sample ? '<p class="eyebrow">SAMPLE QUESTION · FINAL TO BE ANNOUNCED</p>' : ''}<h2 id="heading-question">${esc(q.title || 'Your challenge')}</h2><p class="lead">${esc(q.statement)}</p>${q.context ? `<p>${esc(q.context)}</p>` : ''}${q.requirements?.length ? '<h3>What you must do</h3>' + list(q.requirements, true) : ''}${q.deliverables?.length ? '<h3>What to submit</h3>' + list(q.deliverables) : ''}`;
    $('twistState').textContent = twist.sealed ? 'SEALED' : 'REVEALED';
    $('twistState').classList.toggle('sealed', !!twist.sealed);
    $('twistContent').innerHTML = twist.sealed
      ? sealedCard('twist', 'Expect the unexpected.', twist.revealAt, twist.intro || 'A new constraint will put your solution to the test. The details stay sealed until the organisers release them.')
      : `<h2 id="heading-twist">${esc(twist.title || 'The twist')}</h2><p class="lead">${esc(twist.statement || twist.intro || 'The twist is live. Follow the organisers’ instructions.')}</p>${assignedTwist ? `<h3>Your team’s scenario: ${esc(assignedTwist.title)}</h3><p class="result-note">${esc(assignedTwist.text)}</p>${assignedTwist.minutes ? `<p>Adaptation window: <strong>${esc(assignedTwist.minutes)} minutes</strong></p>` : ''}` : ''}${twist.tests?.length ? '<h3>What it tests</h3>' + list(twist.tests) : ''}`;
    const submission = settings.submissionUrl && safeLink(settings.submissionUrl);
    $('presentationContent').innerHTML = `<p class="lead">${esc(settings.presentationIntro || 'Show the problem, demo your working solution, and explain how you adapted.')}</p><div class="timing-grid"><div class="timing-card"><strong>${esc(demo)} min</strong><span>Live presentation / demo</span></div><div class="timing-card"><strong>${esc(qa)} min</strong><span>Questions from the judges</span></div></div>${settings.presentationNotes ? `<h3>Before you present</h3><p class="result-note">${esc(settings.presentationNotes)}</p>` : ''}${submission ? `<a class="inline-link" href="${submission}" target="_blank" rel="noopener">Submit your project ↗</a>` : ''}`;
    $('portalRules').innerHTML = (c.rules || []).map((rule) => `<li>${esc(rule)}</li>`).join('') || '<li>The organisers will publish the rules here.</li>';
    $('portalJudging').innerHTML = (c.judging || []).map((j) => `<div class="criterion"><div class="criterion-head"><span>${esc(j.name)}</span><strong>${esc(j.weight)}%</strong></div><p>${esc(j.desc)}</p></div>`).join('') || '<p class="muted">Judging criteria will be announced.</p>';
    $('portalParameters').innerHTML = `${settings.parameters?.length ? '<h3>Build & submission parameters</h3>' + list(settings.parameters) : ''}${c.aiNote ? `<p class="result-note">${esc(c.aiNote)}</p>` : ''}`;
    const days = [...new Set((c.schedule || []).map((item) => item.day || 'Day 1'))];
    $('portalSchedule').innerHTML = `${e.datesTentative ? '<p class="muted">Tentative schedule. Timings may change.</p>' : ''}${days.map((day) => `<h3>${esc(day)}</h3>${c.schedule.filter((item) => (item.day || 'Day 1') === day).map((item) => `<div class="session-row"><time>${esc(item.time)}</time><div><b>${esc(item.title)}</b>${item.desc ? `<p>${esc(item.desc)}</p>` : ''}</div></div>`).join('')}`).join('') || '<p class="muted">The schedule will be published here.</p>'}`;
    $('portalResults').innerHTML = `<p class="lead">${esc(result.team || user.teamName)}</p><p><span class="badge">${esc(statusNames[user.status] || 'Registered')}</span></p>${user.note ? `<p class="result-note">${esc(user.note)}</p>` : ''}${e.registerUrl && safeLink(e.registerUrl) ? `<a class="inline-link" href="${safeLink(e.registerUrl)}" target="_blank" rel="noopener">Additional registration form ↗</a>` : ''}${!result.linked ? '<p class="muted">Your account is registered. Organisers will link it to your official team for scoring and team-specific updates.</p>' : ''}${settings.resultNotice ? `<p>${esc(settings.resultNotice)}</p>` : ''}${result.published && result.linked ? `<div class="timing-grid"><div class="timing-card"><strong>#${esc(result.rank)}</strong><span>Current rank</span></div><div class="timing-card"><strong>${esc(result.total)}</strong><span>Weighted score / 100</span></div></div>${(result.awards || []).map((award) => `<div class="award">${esc(award)}</div>`).join('')}${(c.judging || []).map((j) => `<div class="score-row"><span>${esc(j.name)}</span><b>${esc(result.scores[j.name] ?? '—')} / 10</b></div>`).join('')}<p class="muted">${esc(c.results?.note || 'Standings update as judging progresses.')}</p>` : '<h3>Results are not available yet.</h3><p class="muted">Your team’s scores and rank appear here when the organisers publish results and confirm your team link.</p>'}`;
    const alert = c.alert || {};
    $('portalAlert').hidden = !alert.active;
    $('portalAlert').innerHTML = alert.active ? `<strong>${esc(alert.title || 'Event update')}</strong><p>${esc(alert.message)}</p>` : '';
    $('portalAnnouncements').innerHTML = (c.announcements || []).filter((a) => a.text).map((a) => `<div class="announcement"><time>${esc(a.time || 'NOW')}</time><p>${esc(a.text)}</p></div>`).join('') || '<p class="muted">No announcements yet. Check here for updates from the organisers.</p>';
    $('portalUpdated').textContent = c.updatedAt ? 'Event content updated ' + fmt(c.updatedAt) : 'Tech Tank participant portal';
    $('portalMain').setAttribute('aria-busy', 'false');
    tick();
  }
  function refresh() {
    if (inFlight) { refreshAgain = true; return inFlight; }
    inFlight = (async () => {
      try {
        const response = await fetch('/api/portal', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (response.status === 401) { stream?.close(); location.replace('/login'); return; }
        if (!response.ok) throw new Error('Could not fetch the latest event updates. Retrying automatically.');
        const data = await response.json();
        const serialized = JSON.stringify(data);
        snapshot = data;
        if (serialized !== lastJSON) { render(data); lastJSON = serialized; }
        $('portalError').hidden = true;
        $('syncState').innerHTML = '<span class="status-dot"></span> Up to date';
      } catch (error) {
        $('portalError').textContent = snapshot ? 'Connection interrupted. Showing your last update; reconnecting automatically.' : 'Could not load your portal. Check your connection; retrying automatically.';
        $('portalError').hidden = false;
        $('syncState').textContent = 'Reconnecting…';
      }
    })().finally(() => {
      inFlight = null;
      // A publish received while fetching must trigger another read, not get lost.
      if (refreshAgain) { refreshAgain = false; refresh(); }
    });
    return inFlight;
  }
  function tick() {
    if (!snapshot) return;
    const { question, crisis } = snapshot.content;
    let due = false;
    [['question', question], ['twist', crisis]].forEach(([id, item]) => {
      if (!item?.sealed || !item.revealAt) return;
      const remaining = Date.parse(item.revealAt) - Date.now();
      if (remaining <= 0) due = true;
      const seconds = Math.max(0, Math.floor(remaining / 1000));
      const values = [Math.floor(seconds / 86400), Math.floor(seconds % 86400 / 3600), Math.floor(seconds % 3600 / 60), seconds % 60];
      const box = $(id + 'Countdown');
      if (box && Number.isFinite(seconds)) box.innerHTML = values.map((n, i) => `<div><b>${String(n).padStart(2, '0')}</b><small>${['DAYS', 'HRS', 'MIN', 'SEC'][i]}</small></div>`).join('');
    });
    if (due && Date.now() - lastRevealCheck > 3000) { lastRevealCheck = Date.now(); refresh(); }
  }
  $('signOut').addEventListener('click', async () => {
    $('signOut').disabled = true;
    try {
      const response = await fetch('/api/account/logout', { method: 'POST', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Could not sign out');
      stream?.close(); location.replace('/login');
    } catch {
      $('signOut').disabled = false;
      $('portalError').textContent = 'Could not sign out. Check your connection and try again.';
      $('portalError').hidden = false;
    }
  });
  refresh();
  if ('EventSource' in window) {
    stream = new EventSource('/api/stream');
    stream.addEventListener('content', refresh);
  }
  setInterval(tick, 1000);
  setInterval(() => { if (!document.hidden) refresh(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  addEventListener('online', refresh);
})();
