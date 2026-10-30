import { acctPositionNow, canSeeAccounts, watchCompanyDocs, companyDueState, daysUntil, store, isAdmin, alertLabel, resolveAlert, clearViolations, violationsToday, approveSite, staffStatuses, sessionFlagged, sessionsInRange, reviewPetty, reviewOff, closeSession, recentUpdates, workerEntriesInRange, entryMinutes } from '../fb.js';
import {
  esc, fromTz, STAFF_COLOR, EXT_COLOR, icon, avatar, pill, fmtMins, fmtTime, fmtDateTime, fmtMoney, fmtDate, timeAgo, progressBar,
  dateKey, addDays, toast, promptBox, friendlyError, parseKey, b64img, photoViewer,
} from '../util.js';
import { pettySummary } from '../calc.js';

const STATE = {
  onDuty: ['On duty', 'green'], done: ['Checked out', 'teal'], off: ['Off day', 'amber'], notIn: ['Not checked in', 'gray'],
};
const RING = { onDuty: '#2E9E6A', done: '#D98A1A', off: '#E08E2B', notIn: '#c5ced4' };

export function mount(el, _params, { setHeader }) {
  const now = new Date();
  setHeader('Dashboard', now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    `<a class="btn ghost" href="#/reports">${icon('download', 16)} Reports</a>`);

  let chart = null;
  let trend = null; // last 14 days minutes
  let updates = [];
  let companyDocs = [];
  // Current cash position (admin / people allowed to see Accounts).
  let cashPos = null;
  if (canSeeAccounts()) acctPositionNow().then((p) => { cashPos = p; draw(); }).catch((e) => console.warn('cash position', e));
  const m2 = (v) => `${v < 0 ? '−' : ''}${fmtMoney(Math.abs(v))}`;
  const cashCard = () => {
    if (!cashPos) return '';
    const P = cashPos;
    return `<a class="card mt dash-cash" href="#/accounts">
      <div class="dc-main"><div class="dc-cap">Current balance</div><div class="dc-big ${P.bal < 0 ? 'neg' : ''}">${m2(P.bal)}</div>
        <div class="dc-split"><span><i style="background:#D98A1A"></i>Cash ${m2(P.cash)}</span><span><i style="background:#6FA8FF"></i>Bank ${m2(P.bank)}</span></div>
        ${P.hasOpening ? '' : '<div class="dc-hint">Set the opening balance on the Accounts page for a true figure.</div>'}</div>
      <div class="dc-cell"><div class="dc-cap">To pay</div><b style="color:#C2557A">${fmtMoney(P.toPay)}</b>${P.overdue ? `<span class="small" style="color:#D64545">${P.overdue} overdue</span>` : '<span class="small muted">pending</span>'}</div>
      <div class="dc-cell"><div class="dc-cap">To receive</div><b style="color:#3A7BD5">${fmtMoney(P.toGet)}</b><span class="small muted">pending</span></div>
      <div class="dc-cell"><div class="dc-cap">Projected</div><b style="color:${P.projected < 0 ? '#D64545' : '#2B2B2C'}">${m2(P.projected)}</b><span class="small muted">after pending</span></div>
    </a>`;
  };
  // Company documents expired or expiring within 15 days.
  const companyDue = () => companyDocs.filter((d) => ['expired', 'soon'].includes(companyDueState(d.expiry)))
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
  const companyCard = () => {
    const due = companyDue();
    if (!due.length) return '';
    return `<div class="card mt" style="background:#fff4e2;border-color:#f3d7a6">
      <div class="card-head">${icon('warn', 18, '#D98A1A')}<h2>Company documents to renew (${due.length})</h2><a class="small" href="#/company">Open →</a></div>
      ${due.map((d) => { const n = daysUntil(d.expiry); return `<a class="list-item" style="color:inherit" href="#/company">
        <div class="grow"><b>${esc(d.title)}</b>${d.number ? ` <span class="small muted mono">${esc(d.number)}</span>` : ''}</div>
        ${n < 0 ? pill(`Expired ${-n} d ago`, 'red') : pill(n === 0 ? 'Expires today' : `Expires in ${n} d`, 'amber')}</a>`; }).join('')}
    </div>`;
  };

  el.innerHTML = `<div id="d-body"></div>`;
  const body = el.querySelector('#d-body');

  const from = dateKey(addDays(now, -13));
  sessionsInRange(from, dateKey(now)).then((list) => { trend = list; draw(); }).catch((e) => console.error(e));
  let extTrend = null;
  workerEntriesInRange(from, dateKey(now)).then((list) => { extTrend = list; draw(); }).catch((e) => console.error(e));
  recentUpdates(6).then((l) => { updates = l; draw(); }).catch(() => {});

  // Team today: working now grouped by site (staff with their external workers), then finished, then not working.
  function teamBySite(st) {
    const vio = violationsToday();
    const row = (s) => `<a class="list-item" href="#/employees/${s.user.id}" style="color:inherit">
        ${avatar(s.user.name, 34, RING[s.state])}
        <div class="grow"><div class="nm"><b>${esc(s.user.name)}</b>${vio[s.user.id] ? ` <span class="pill ${vio[s.user.id] > 5 ? 'red' : 'amber'}" title="GPS violations today (no location ≥ 1 h)">⚑ ${vio[s.user.id]}</span>` : ''}${s.open?.violationMark ? ' <span class="pill red" title="Checked in with a violation mark">⚑ Marked</span>' : ''}</div><div class="small muted">${esc(statusLine(s))}</div></div>
        <div class="right">${pill(s.forgot ? 'Open since earlier' : STATE[s.state][0], s.forgot ? 'red' : STATE[s.state][1], s.state === 'onDuty')}
          ${s.minutes ? `<div class="small" style="font-weight:700;margin-top:3px">${fmtMins(s.minutes)}</div>` : ''}</div></a>`;
    const extRow = (wid, nested) => {
      const es = store.workersToday.filter((e) => e.workerId === wid);
      if (!es.length) return '';
      const w = store.worker(wid), last = es[es.length - 1], open = es.find((e) => e.open);
      const m = es.reduce((a, e) => a + entryMinutes(e), 0);
      return `<a class="list-item" href="#/workers/${wid}" style="color:inherit;background:#fffaf2;${nested ? 'padding-left:44px;' : ''}">${avatar(w?.name || last.workerName, nested ? 26 : 30, EXT_COLOR)}
        <div class="grow"><b class="${nested ? 'small' : ''}">${esc(w?.name || last.workerName)}</b><div class="small muted">External${nested ? '' : ` · ${esc(last.siteName)} · with ${esc(last.employeeName)}`}</div></div>
        <div class="right"><span class="wf-chip ext">${open ? 'On site' : 'Done'}</span><div class="small" style="font-weight:700;margin-top:3px">${fmtMins(m)}</div></div></a>`;
    };
    const head = (t, bg, color, extra = '') => `<div class="list-item small" style="background:${bg};color:${color};font-weight:800">${t}<span class="spacer"></span>${extra}</div>`;
    const on = st.filter((s) => s.state === 'onDuty' && s.open);
    const groups = new Map();
    const grp = (id, name) => { if (!groups.has(id)) groups.set(id, { name: store.site(id)?.name || name || 'Site', staff: [], ext: [] }); return groups.get(id); };
    on.forEach((s) => grp(s.open.siteId, s.open.siteName).staff.push(s));
    store.extOnSite.forEach((l) => grp(l.siteId, l.siteName).ext.push(l));
    const sites = [...groups.values()].sort((a, b) => (b.staff.length + b.ext.length) - (a.staff.length + a.ext.length));
    const onExt = new Set(store.extOnSite.map((l) => l.workerId));
    const done = st.filter((s) => s.state === 'done');
    const extDone = [...new Set(store.workersToday.map((e) => e.workerId))].filter((id) => !onExt.has(id));
    const notWorking = st.filter((s) => s.state === 'notIn' || s.state === 'off');
    if (!st.length && !onExt.size && !extDone.length) return '<div class="empty"><b>No employees yet</b>Add staff under Employees.</div>';
    return (sites.length ? sites.map((g) => head(`📍 ${esc(g.name)}`, '#e2f4ea', '#1f7a50', `<span class="wf-chip staff">${g.staff.length} staff</span> <span class="wf-chip ext">${g.ext.length} external</span>`)
        + g.staff.map((s) => row(s) + g.ext.filter((l) => l.sessionId === s.open.id).map((l) => extRow(l.workerId, true)).join('')).join('')
        + g.ext.filter((l) => !g.staff.some((s) => s.open.id === l.sessionId)).map((l) => extRow(l.workerId, false)).join('')).join('')
      : head('Nobody working right now', '#f3f2ef', '#75757a'))
      + (done.length || extDone.length ? head(`Finished today · ${done.length + extDone.length}`, '#eef0f3', '#404041') + done.map(row).join('') + extDone.map((id) => extRow(id, false)).join('') : '')
      + (notWorking.length ? head(`Not working today · ${notWorking.length}`, '#f3f2ef', '#75757a') + notWorking.map(row).join('') : '');
  }

  function draw() {
    if (!store.loaded) { body.innerHTML = '<div class="boot" style="height:200px"><div class="spinner"></div></div>'; return; }
    const st = staffStatuses();
    const count = (k) => st.filter((s) => s.state === k).length;
    const present = count('onDuty') + count('done');
    const minutes = st.reduce((a, s) => a + s.minutes, 0);
    const flagged = store.today.filter(sessionFlagged);
    const forgot = store.open.filter((s) => s.date !== dateKey(new Date()));
    const activeSites = new Set([...store.today.map((s) => s.siteId), ...store.open.map((s) => s.siteId)]);
    const pendingAmt = store.pendingPetty.filter((t) => t.type !== 'credit').reduce((a, t) => a + t.amount, 0);
    const activeProjects = store.projects.filter((p) => p.status === 'active');
    // External workers (labour) are part of the workforce too.
    const extIds = new Set(store.workersToday.map((e) => e.workerId));
    const extMins = store.workersToday.reduce((a, e) => a + entryMinutes(e), 0);
    const extNow = store.extOnSite.length;

    body.innerHTML = `
    <div class="quick">
      <a href="#/working">${icon('people', 16)} Working now</a>
      <a href="#/workers" data-qa="checkin">${icon('check', 16)} Check in workers</a>
      <a href="#/workers" data-qa="register">${icon('worker', 16)} Register worker</a>
      <a href="#/sites" data-qa="site">${icon('site', 16)} Add site</a>
      <a href="#/schedule">${icon('calendar', 16)} Schedule</a>
      <a href="#/documents">${icon('idcard', 16)} ID documents</a>
      <a href="#/reports">${icon('report', 16)} Reports</a>
    </div>
    <div class="grid kpis">
      ${kpi('On site now', store.open.length + extNow, `${store.open.length} staff · ${extNow} external`, 'pin', '#2E9E6A', 'working')}
      ${kpi('Workforce today', present + extIds.size, `${present} staff · ${extIds.size} external`, 'people', '#D98A1A', 'attendance')}
      ${kpi('Man-hours today', fmtMins(minutes + extMins), `staff ${fmtMins(minutes)} · external ${fmtMins(extMins)}`, 'clock', '#3A7BD5')}
      ${kpi('External workers', `${extNow} on site`, `${new Set(store.extOnSite.map((l) => l.siteId)).size} sites · ${store.workers.filter((w) => w.active).length} registered`, 'worker', EXT_COLOR, 'workers')}
      ${kpi('Active sites', activeSites.size, `${store.schedulesToday.length} visits scheduled`, 'site', '#8E5CC4', 'sites')}
      ${kpi('Active projects', activeProjects.length, `${store.projects.length} total`, 'project', '#C2557A', 'projects')}
      ${isAdmin()
        ? kpi('Pending approvals', store.pendingPetty.length + store.pendingOff.length + store.pendingSites.length + store.requests.length, `${store.requests.length} document changes · ${fmtMoney(pendingAmt)} petty`, 'pending', '#E08E2B', store.requests.length ? 'requests' : 'petty')
        : kpi('Pending approvals', store.pendingOff.length + store.pendingSites.length + store.requests.length, `off days, new sites & ${store.requests.length} document changes`, 'pending', '#E08E2B', store.requests.length ? 'requests' : '')}
    </div>

    ${cashCard()}
    ${companyCard()}
    ${forgot.length || flagged.length || store.alerts.length ? `
    <div class="card mt">
      <div class="card-head">${icon('warn', 18, '#D64545')}<h2>Needs attention</h2></div>
      ${store.alerts.map((a) => `<div class="list-item" style="${a.type === 'left_site' ? '' : 'background:#fff5f5'}">${avatar(a.employeeName, 32, a.type === 'left_site' ? '#E08E2B' : '#D64545')}
        <div class="grow"><b>${esc(a.employeeName)}</b> — ${esc(alertLabel(a))}
        <div class="small muted">${fmtDateTime(a.atLocal)}${a.lat != null ? ` · <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${a.lat}&mlon=${a.lng}#map=17/${a.lat}/${a.lng}">GPS ${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}</a>` : ''}</div></div>
        ${pill({ gps_off: 'GPS off', no_activity: '⚑ No activity', checkin_blocked: '⚑ Check-in blocked' }[a.type] || 'Left site', a.type === 'left_site' ? 'amber' : 'red')}
        ${a.type === 'checkin_blocked' && isAdmin() ? `<button class="btn sm" data-allow="${a.employeeId}" data-aid="${a.id}">Allow check-in</button>` : `<button class="btn sm ghost" data-resolve="${a.id}">Resolve</button>`}</div>`).join('')}
      ${forgot.map((s) => `<div class="list-item">${avatar(s.employeeName, 32, '#D64545')}
        <div class="grow"><b>${esc(s.employeeName)}</b> never checked out
        <div class="small muted">${esc(s.siteName)} · in ${fmtDateTime(s.inLocal)}</div></div>
        <button class="btn sm ghost" data-close="${s.id}">Close session</button></div>`).join('')}
      ${flagged.map((s) => `<div class="list-item">${avatar(s.employeeName, 32, '#E08E2B')}
        <div class="grow"><b>${esc(s.employeeName)}</b> · ${esc(s.siteName)}
        <div class="small muted">${fmtTime(s.inLocal)} – ${s.checkOut ? fmtTime(s.outLocal) : 'now'}</div></div>
        ${s.inOutside ? pill(`In ${Math.round(s.inDistance || 0)} m away`, 'amber') : ''}
        ${s.outOutside ? pill(`Out ${Math.round(s.outDistance || 0)} m away`, 'amber') : ''}
        ${s.mocked ? pill('Fake GPS', 'red') : ''}</div>`).join('')}
    </div>` : ''}

    <div class="grid cols-2-1 mt">
      <div class="card">
        <div class="card-head"><h2>Man-hours — last 14 days</h2><span class="small"><span class="wf-dot staff"></span> Staff &nbsp;<span class="wf-dot ext"></span> External</span></div>
        <div class="card-pad"><div class="chart-box"><canvas id="trend"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Approvals</h2>${isAdmin() ? '<a class="small" href="#/petty">All petty →</a>' : ''}</div>
        ${approvalsHtml()}
      </div>
    </div>

    ${isAdmin() && store.petty.length ? pettyStatusHtml() : ''}

    <div class="grid cols-2 mt">
      <div class="card">
        <div class="card-head"><h2>Team today <span class="wf-chip staff">${st.length} staff</span> <span class="wf-chip ext">${extIds.size} external</span></h2><a class="small" href="#/employees">Manage →</a></div>
        ${teamBySite(st)}
      </div>
      <div>
        <div class="card">
          <div class="card-head"><h2>Projects</h2><a class="small" href="#/projects">All →</a></div>
          ${activeProjects.length ? activeProjects.slice(0, 6).map((p) => {
            const sites = p.siteIds.map((id) => store.site(id)).filter(Boolean);
            const prog = sites.length ? Math.round(sites.reduce((a, s) => a + s.progress, 0) / sites.length) : 0;
            const onSite = store.open.filter((s) => p.siteIds.includes(s.siteId)).length;
            return `<a class="list-item" href="#/projects/${p.id}" style="color:inherit;display:block">
              <div class="row between"><b>${esc(p.name)}</b><span class="small"><b>${prog}%</b></span></div>
              <div class="small muted" style="margin:2px 0 6px">${esc(p.client || '—')} · ${sites.length} site${sites.length === 1 ? '' : 's'}${onSite ? ` · ${onSite} on site now` : ''}</div>
              ${progressBar(prog)}</a>`;
          }).join('') : '<div class="empty"><b>No active projects</b><a href="#/projects">Create a project</a></div>'}
        </div>
        <div class="card mt">
          <div class="card-head"><h2>Latest site updates</h2><a class="small" href="#/updates">All →</a></div>
          ${updates.length ? updates.map((u) => `<div class="update">
            <div class="row"><b>${esc(u.employeeName)}</b><span class="muted small">· ${esc(u.siteName)} · ${timeAgo(u.createdAt)}</span>
              <span class="spacer"></span>${pill(u.category, { Issue: 'red', Material: 'blue', Safety: 'amber' }[u.category] || 'green')}</div>
            ${u.note ? `<div style="margin-top:4px">${esc(u.note)}</div>` : ''}
            ${u.photos.length ? `<div class="photos" style="margin-top:8px">${u.photos.slice(0, 3).map((p) => `<img src="${b64img(p)}" data-photo>`).join('')}</div>` : ''}
          </div>`).join('') : '<div class="empty">No updates yet</div>'}
        </div>
      </div>
    </div>`;

    wire();
    drawChart();
  }

  function statusLine(s) {
    if (s.state === 'onDuty') return `${s.open.siteName} · since ${fmtTime(s.open.inLocal)}${s.user.lastLocation ? ` · GPS ${timeAgo(s.user.lastLocation.at)}` : ''}`;
    if (s.state === 'done') return `${s.sessions.length} site${s.sessions.length === 1 ? '' : 's'} · out ${fmtTime(s.sessions[s.sessions.length - 1].outLocal)}`;
    if (s.state === 'off') return 'Scheduled off';
    return s.user.designation || 'No check-in yet';
  }

  function approvalsHtml() {
    const offs = store.pendingOff;
    const petty = store.pendingPetty.slice(0, 6);
    const sites = store.pendingSites;
    if (!offs.length && !petty.length && !sites.length) return '<div class="empty"><b>All clear</b>Nothing waiting for approval.</div>';
    return sites.map((st) => `<div class="list-item">${avatar(st.addedBy || 'Site', 30)}
        <div class="grow"><b>New site: ${esc(st.name)}</b><div class="small muted">Added by ${esc(st.addedBy)}${st.address ? ` · ${esc(st.address)}` : ''}</div></div>
        <button class="btn sm ghost" data-site-no="${st.id}">✕</button><button class="btn sm success" data-site-yes="${st.id}">✓</button></div>`).join('') +
      offs.map((o) => `<div class="list-item">${avatar(o.employeeName, 30)}
        <div class="grow"><b>${esc(o.employeeName)}</b><div class="small muted">Off day · ${fmtDate(parseKey(o.date))}${o.reason ? ` · ${esc(o.reason)}` : ''}</div></div>
        <button class="btn sm ghost" data-off-no="${o.id}">✕</button><button class="btn sm success" data-off-yes="${o.id}">✓</button></div>`).join('') +
      petty.map((t) => `<div class="list-item">${avatar(t.employeeName, 30)}
        <div class="grow"><b>${esc(t.employeeName)}</b> <b style="color:${t.type === 'credit' ? '#2E9E6A' : '#D64545'}">${t.type === 'credit' ? '+' : '−'}${fmtMoney(t.amount)}</b>
        <div class="small muted">${esc(t.type === 'credit' ? 'Cash received' : t.category)}${t.note ? ` · ${esc(t.note)}` : ''}</div></div>
        <button class="btn sm ghost" data-p-no="${t.id}">✕</button><button class="btn sm success" data-p-yes="${t.id}">✓</button></div>`).join('');
  }

  function wire() {
    body.querySelectorAll('[data-qa]').forEach((a) => {
      a.onclick = async (e) => {
        e.preventDefault();
        if (a.dataset.qa === 'checkin') (await import('./workers.js')).checkInWorkers();
        if (a.dataset.qa === 'register') (await import('./workers.js')).registerWorker();
        if (a.dataset.qa === 'site') (await import('./sites.js')).editSite(null);
      };
    });
    body.querySelectorAll('[data-nav]').forEach((k) => { k.onclick = () => { location.hash = `#/${k.dataset.nav}`; }; });
    body.querySelectorAll('[data-off-yes]').forEach((b) => { b.onclick = () => reviewOff(b.dataset.offYes, true).then(() => toast('Off day approved')); });
    body.querySelectorAll('[data-off-no]').forEach((b) => { b.onclick = () => reviewOff(b.dataset.offNo, false).then(() => toast('Off day rejected')); });
    body.querySelectorAll('[data-p-yes]').forEach((b) => { b.onclick = () => reviewPetty(b.dataset.pYes, true, store.me.name).then(() => toast('Approved')); });
    body.querySelectorAll('[data-p-no]').forEach((b) => {
      b.onclick = async () => {
        const reason = await promptBox('Reject entry', 'Reason (shown to employee)', { ok: 'Reject' });
        if (reason === null) return;
        await reviewPetty(b.dataset.pNo, false, store.me.name, reason);
        toast('Rejected');
      };
    });
    body.querySelectorAll('[data-close]').forEach((b) => {
      b.onclick = async () => {
        const s = store.open.find((x) => x.id === b.dataset.close);
        if (!s) return;
        const t = await promptBox('Close session', `Check-out time on ${fmtDate(s.inLocal)} (HH:MM, 24h)`, { ok: 'Close', value: '18:00', type: 'time' });
        if (!t) return;
        const [h, m] = t.split(':').map(Number);
        const at = fromTz(new Date(s.inLocal.getFullYear(), s.inLocal.getMonth(), s.inLocal.getDate(), h, m), s.tz);
        if (at <= s.checkIn) { toast('Check-out must be after check-in', true); return; }
        try { await closeSession(s, at); toast('Session closed'); } catch (e) { toast(friendlyError(e), true); }
      };
    });
    body.querySelectorAll('[data-photo]').forEach((img) => { img.onclick = () => photoViewer(img.src); });
    body.querySelectorAll('[data-allow]').forEach((b) => {
      b.onclick = async () => {
        try { await clearViolations(b.dataset.allow); await resolveAlert(b.dataset.aid, store.me.name); toast('Check-in allowed — earlier GPS violations cleared'); } catch (e) { toast(friendlyError(e), true); }
      };
    });
    body.querySelectorAll('[data-resolve]').forEach((b) => { b.onclick = () => resolveAlert(b.dataset.resolve, store.me.name).then(() => toast('Resolved')); });
    body.querySelectorAll('[data-site-yes]').forEach((b) => { b.onclick = () => approveSite(b.dataset.siteYes, true).then(() => toast('Site approved')); });
    body.querySelectorAll('[data-site-no]').forEach((b) => { b.onclick = () => approveSite(b.dataset.siteNo, false).then(() => toast('Site rejected')); });
  }

  function drawChart() {
    const canvas = body.querySelector('#trend');
    if (!canvas || !window.Chart) return;
    const labels = [], data = [], ext = [];
    for (let i = 13; i >= 0; i--) {
      const d = addDays(new Date(), -i);
      const k = dateKey(d);
      labels.push(d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
      const src = k === dateKey(new Date()) ? store.today : (trend || []).filter((s) => s.date === k);
      data.push(Math.round(src.reduce((a, s) => a + (((s.checkOut || new Date()) - s.checkIn) / 3600000), 0) * 10) / 10);
      const esrc = k === dateKey(new Date()) ? store.workersToday : (extTrend || []).filter((e) => e.date === k);
      ext.push(Math.round((esrc.reduce((a, e) => a + entryMinutes(e), 0) / 60) * 10) / 10);
    }
    if (chart) chart.destroy();
    chart = new window.Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Staff', data, backgroundColor: STAFF_COLOR, borderRadius: 4, maxBarThickness: 28 },
        { label: 'External', data: ext, backgroundColor: EXT_COLOR, borderRadius: 4, maxBarThickness: 28 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw} h` } } },
        scales: { y: { stacked: true, beginAtZero: true, grid: { color: '#eef1f3' }, ticks: { callback: (v) => `${v}h` } }, x: { stacked: true, grid: { display: false } } },
      },
    });
  }

  draw();
  const off = store.on(draw);
  const offCo = watchCompanyDocs((l) => { companyDocs = l || []; draw(); });
  return () => { off(); offCo(); if (chart) chart.destroy(); };
}

function kpi(label, value, sub, ico, color, nav) {
  return `<div class="card kpi" ${nav ? `data-nav="${nav}"` : ''}>
    <div class="lbl"><span class="ico" style="background:${color}1f;color:${color}">${icon(ico, 16)}</span>${esc(label)}</div>
    <div class="val">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
}

// Overall petty cash status for admins: totals, then each person's balance (who holds the most cash first).
function pettyStatusHtml() {
  const all = store.petty;
  const t = pettySummary(all);
  const by = new Map();
  for (const x of all) { if (!by.has(x.employeeId)) by.set(x.employeeId, []); by.get(x.employeeId).push(x); }
  const rows = [...by.entries()].map(([id, l]) => ({ id, name: store.user(id)?.name || l[0].employeeName, s: pettySummary(l) }))
    .filter((r) => Math.abs(r.s.balance) >= 0.01 || r.s.pendingCount)
    .sort((a, b) => b.s.balance - a.s.balance);
  const fig = (label, v, color, sub = '') => `<div style="flex:1;min-width:120px"><div class="small muted" style="font-weight:600">${label}</div>
    <div style="font-size:20px;font-weight:800;color:${color}">${fmtMoney(v)}</div>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
  return `<div class="card mt">
    <div class="card-head">${icon('wallet', 18, '#D98A1A')}<h2>Petty cash</h2><span class="spacer"></span><a class="small" href="#/petty">All petty →</a></div>
    <div class="card-pad" style="display:flex;gap:16px;flex-wrap:wrap;border-bottom:1px solid var(--line, #eee)">
      ${fig('Given (approved)', t.credited, '#2E9E6A')}
      ${fig('Spent (approved)', t.spent, '#D64545')}
      ${fig('Cash with staff', t.balance, '#D98A1A', 'given − spent')}
      ${fig('Waiting for approval', t.pending, '#E08E2B', `${t.pendingCount} entries`)}
    </div>
    ${rows.length ? `<div class="table-wrap"><table class="t"><tr><th>Employee</th><th class="num">Given</th><th class="num">Spent</th><th class="num">Pending</th><th class="num">Balance</th></tr>
      ${rows.slice(0, 12).map((r) => `<tr style="cursor:pointer" onclick="location.hash='#/petty'"><td><div class="person">${avatar(r.name, 26)}<span class="nm">${esc(r.name)}</span></div></td>
        <td class="num">${fmtMoney(r.s.credited)}</td><td class="num">${fmtMoney(r.s.spent)}</td>
        <td class="num">${r.s.pendingCount ? `${fmtMoney(r.s.pending)} <span class="small muted">(${r.s.pendingCount})</span>` : '—'}</td>
        <td class="num"><b style="color:${r.s.balance < 0 ? '#D64545' : 'inherit'}">${fmtMoney(r.s.balance)}</b></td></tr>`).join('')}
      </table></div>${rows.length > 12 ? `<div class="card-pad small muted">+ ${rows.length - 12} more on the Petty cash page</div>` : ''}` : ''}
  </div>`;
}
