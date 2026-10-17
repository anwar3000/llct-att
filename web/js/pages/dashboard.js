import { store, isAdmin, alertLabel, resolveAlert, approveSite, staffStatuses, sessionFlagged, sessionsInRange, reviewPetty, reviewOff, closeSession, recentUpdates, workerEntriesInRange, entryMinutes } from '../fb.js';
import {
  esc, fromTz, STAFF_COLOR, EXT_COLOR, icon, avatar, pill, fmtMins, fmtTime, fmtDateTime, fmtMoney, fmtDate, timeAgo, progressBar,
  dateKey, addDays, toast, promptBox, friendlyError, parseKey, b64img, photoViewer,
} from '../util.js';

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

  el.innerHTML = `<div id="d-body"></div>`;
  const body = el.querySelector('#d-body');

  const from = dateKey(addDays(now, -13));
  sessionsInRange(from, dateKey(now)).then((list) => { trend = list; draw(); }).catch((e) => console.error(e));
  let extTrend = null;
  workerEntriesInRange(from, dateKey(now)).then((list) => { extTrend = list; draw(); }).catch((e) => console.error(e));
  recentUpdates(6).then((l) => { updates = l; draw(); }).catch(() => {});

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
    const extNow = store.workerLocks.length;

    body.innerHTML = `
    <div class="quick">
      <a href="#/workers" data-qa="checkin">${icon('check', 16)} Check in workers</a>
      <a href="#/workers" data-qa="register">${icon('worker', 16)} Register worker</a>
      <a href="#/sites" data-qa="site">${icon('site', 16)} Add site</a>
      <a href="#/schedule">${icon('calendar', 16)} Schedule</a>
      <a href="#/documents">${icon('idcard', 16)} ID documents</a>
      <a href="#/reports">${icon('report', 16)} Reports</a>
    </div>
    <div class="grid kpis">
      ${kpi('On site now', count('onDuty') + extNow, `${count('onDuty')} staff · ${extNow} external`, 'pin', '#2E9E6A', 'map')}
      ${kpi('Workforce today', present + extIds.size, `${present} staff · ${extIds.size} external`, 'people', '#D98A1A', 'attendance')}
      ${kpi('Man-hours today', fmtMins(minutes + extMins), `staff ${fmtMins(minutes)} · external ${fmtMins(extMins)}`, 'clock', '#3A7BD5')}
      ${kpi('External workers', `${extNow} on site`, `${new Set(store.workerLocks.map((l) => l.siteId)).size} sites · ${store.workers.filter((w) => w.active).length} registered`, 'worker', EXT_COLOR, 'workers')}
      ${kpi('Active sites', activeSites.size, `${store.schedulesToday.length} visits scheduled`, 'site', '#8E5CC4', 'sites')}
      ${kpi('Active projects', activeProjects.length, `${store.projects.length} total`, 'project', '#C2557A', 'projects')}
      ${isAdmin()
        ? kpi('Pending approvals', store.pendingPetty.length + store.pendingOff.length + store.pendingSites.length, `${fmtMoney(pendingAmt)} petty waiting`, 'pending', '#E08E2B', 'petty')
        : kpi('Pending approvals', store.pendingOff.length + store.pendingSites.length, 'off days & new sites', 'pending', '#E08E2B')}
    </div>

    ${forgot.length || flagged.length || store.alerts.length ? `
    <div class="card mt">
      <div class="card-head">${icon('warn', 18, '#D64545')}<h2>Needs attention</h2></div>
      ${store.alerts.map((a) => `<div class="list-item">${avatar(a.employeeName, 32, '#E08E2B')}
        <div class="grow"><b>${esc(a.employeeName)}</b> — ${esc(alertLabel(a))}
        <div class="small muted">${fmtDateTime(a.atLocal)}${a.lat != null ? ` · <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${a.lat}&mlon=${a.lng}#map=17/${a.lat}/${a.lng}">GPS ${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}</a>` : ''}</div></div>
        ${pill(a.type === 'gps_off' ? 'GPS off' : 'Left site', 'amber')}
        <button class="btn sm ghost" data-resolve="${a.id}">Resolve</button></div>`).join('')}
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

    <div class="grid cols-2 mt">
      <div class="card">
        <div class="card-head"><h2>Team today <span class="wf-chip staff">${st.length} staff</span> <span class="wf-chip ext">${extIds.size} external</span></h2><a class="small" href="#/employees">Manage →</a></div>
        ${st.length ? st.map((s) => `
          <a class="list-item" href="#/employees/${s.user.id}" style="color:inherit">
            ${avatar(s.user.name, 34, RING[s.state])}
            <div class="grow"><div class="nm"><b>${esc(s.user.name)}</b></div>
              <div class="small muted">${esc(statusLine(s))}</div></div>
            <div class="right">${pill(s.forgot ? 'Open since earlier' : STATE[s.state][0], s.forgot ? 'red' : STATE[s.state][1], s.state === 'onDuty')}
              ${s.minutes ? `<div class="small" style="font-weight:700;margin-top:3px">${fmtMins(s.minutes)}</div>` : ''}</div>
          </a>`).join('') : '<div class="empty"><b>No employees yet</b>Add staff under Employees.</div>'}
        ${extIds.size ? `<div class="list-item small" style="background:#fdf6ea;color:#a8640f;font-weight:700">External workers today · ${extIds.size}</div>
        ${[...extIds].map((wid) => {
          const es = store.workersToday.filter((e) => e.workerId === wid);
          const w = store.worker(wid);
          const open = es.find((e) => e.open);
          const m = es.reduce((a, e) => a + entryMinutes(e), 0);
          return `<a class="list-item" href="#/workers/${wid}" style="color:inherit">${avatar(w?.name || es[0].workerName, 30, EXT_COLOR)}
            <div class="grow"><b>${esc(w?.name || es[0].workerName)}</b><div class="small muted">${esc(es[es.length - 1].siteName)} · with ${esc(es[es.length - 1].employeeName)}</div></div>
            <div class="right"><span class="wf-chip ext">${open ? 'On site' : 'Done'}</span><div class="small" style="font-weight:700;margin-top:3px">${fmtMins(m)}</div></div></a>`;
        }).join('')}` : ''}
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
  return () => { off(); if (chart) chart.destroy(); };
}

function kpi(label, value, sub, ico, color, nav) {
  return `<div class="card kpi" ${nav ? `data-nav="${nav}"` : ''}>
    <div class="lbl"><span class="ico" style="background:${color}1f;color:${color}">${icon(ico, 16)}</span>${esc(label)}</div>
    <div class="val">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
}
