// Everyone working right now — staff and external workers together, grouped by site.
import { store, staffStatuses, sessionMinutes, entryMinutes } from '../fb.js';
import { esc, avatar, pill, fmtMins, fmtTime, timeAgo, atTz, STAFF_COLOR, EXT_COLOR } from '../util.js';

export function mount(el, _p, { setHeader }) {
  setHeader('Working now', 'Everyone on site right now — staff (blue) and external workers (orange), by site');
  let q = '';

  function draw() {
    const st = staffStatuses();
    // Every open check-in (any role, any date — catches forgotten check-outs too).
    const onDuty = [...store.open].sort((a, b) => a.checkIn - b.checkIn).map((o) => ({
      open: o, user: store.user(o.employeeId) || { id: o.employeeId, name: o.employeeName, lastLocation: null },
    }));
    const locks = store.extOnSite;
    const ql = q.toLowerCase();
    const match = (...v) => !ql || v.join(' ').toLowerCase().includes(ql);

    // group by site
    const sites = new Map();
    const site = (id, name) => {
      if (!sites.has(id)) sites.set(id, { id, name: store.site(id)?.name || name || 'Site', staff: [], ext: [] });
      return sites.get(id);
    };
    for (const s of onDuty) site(s.open.siteId, s.open.siteName).staff.push(s);
    for (const l of locks) site(l.siteId, l.siteName).ext.push(l);
    const groups = [...sites.values()]
      .map((g) => ({ ...g, staff: g.staff.filter((s) => match(s.user.name, g.name)), ext: g.ext.filter((l) => match(store.worker(l.workerId)?.name, l.employeeName, g.name)) }))
      .filter((g) => g.staff.length || g.ext.length)
      .sort((a, b) => (b.staff.length + b.ext.length) - (a.staff.length + a.ext.length));

    const doneStaff = st.filter((s) => s.state === 'done');
    const doneExt = [...new Set(store.workersToday.filter((e) => !e.open).map((e) => e.workerId))].filter((id) => !locks.some((l) => l.workerId === id));
    const workerMins = (id) => store.workersToday.filter((e) => e.workerId === id).reduce((a, e) => a + entryMinutes(e), 0);

    el.innerHTML = `
    <div class="grid kpis">
      ${k('On site now', onDuty.length + locks.length, `${onDuty.length} staff · ${locks.length} external`, '#2E9E6A')}
      ${k('Staff on duty', onDuty.length, `${doneStaff.length} already checked out`, STAFF_COLOR)}
      ${k('External on site', locks.length, `${doneExt.length} finished today`, EXT_COLOR)}
      ${k('Active sites', groups.length, 'with people on site now', '#404041')}
    </div>
    <div class="row mt" style="margin-bottom:10px"><input id="wn-q" placeholder="Search name or site…" value="${esc(q)}" style="max-width:300px">
      <span class="spacer"></span><span class="small"><span class="wf-dot staff"></span> Staff &nbsp; <span class="wf-dot ext"></span> External workers</span></div>
    ${groups.length ? `<div class="grid cols-2">${groups.map((g) => `
      <div class="card">
        <div class="card-head"><a href="#/sites/${g.id}" style="color:inherit"><h2>${esc(g.name)}</h2></a>
          <span class="spacer"></span><span class="wf-chip staff">${g.staff.length} staff</span> <span class="wf-chip ext">${g.ext.length} external</span></div>
        ${g.staff.map((s) => {
          const mine = g.ext.filter((l) => l.sessionId === s.open.id);
          const loc = s.user.lastLocation;
          return `<a class="list-item" href="#/employees/${s.user.id}" style="color:inherit;border-left:3px solid ${STAFF_COLOR}">
            ${avatar(s.user.name, 32, STAFF_COLOR)}<div class="grow"><b>${esc(s.user.name)}</b>
            <div class="small muted">Staff · since ${fmtTime(s.open.inLocal)} · ${fmtMins(sessionMinutes(s.open))}${loc ? ` · GPS ${timeAgo(loc.at)}` : ''}</div></div>
            ${mine.length ? `<span class="wf-chip ext">+${mine.length}</span>` : ''}</a>
            ${mine.map((l) => ext(l, s.open.tz, true)).join('')}`;
        }).join('')}
        ${g.ext.filter((l) => !g.staff.some((s) => s.open.id === l.sessionId)).map((l) => ext(l, null, false)).join('')}
      </div>`).join('')}</div>` : '<div class="card empty"><b>Nobody on site right now</b>Staff and their external workers appear here when they check in.</div>'}
    ${doneStaff.length || doneExt.length ? `<h2 class="mt2" style="margin-bottom:8px">Finished today</h2><div class="card">
      ${doneStaff.map((s) => `<a class="list-item" href="#/employees/${s.user.id}" style="color:inherit;border-left:3px solid ${STAFF_COLOR}">${avatar(s.user.name, 28, STAFF_COLOR)}
        <div class="grow"><b>${esc(s.user.name)}</b> <span class="small muted">Staff · ${s.sessions.map((x) => esc(x.siteName)).join(', ')}</span></div><b>${fmtMins(s.minutes)}</b></a>`).join('')}
      ${doneExt.map((id) => { const e = store.workersToday.find((x) => x.workerId === id); const n = store.worker(id)?.name || e.workerName; return `<a class="list-item" href="#/workers/${id}" style="color:inherit;border-left:3px solid ${EXT_COLOR};background:#fffaf2">${avatar(n, 28, EXT_COLOR)}
        <div class="grow"><b>${esc(n)}</b> <span class="small muted">External · ${esc(e.siteName)} · with ${esc(e.employeeName)}</span></div><b>${fmtMins(workerMins(id))}</b></a>`; }).join('')}
    </div>` : ''}`;

    const qi = el.querySelector('#wn-q');
    qi.oninput = (e) => { q = e.target.value; draw(); const n = el.querySelector('#wn-q'); n.focus(); n.setSelectionRange(q.length, q.length); };
  }

  function ext(l, tz, nested) {
    const w = store.worker(l.workerId);
    return `<a class="list-item" href="#/workers/${l.workerId}" style="color:inherit;${nested ? 'padding-left:40px;' : ''}background:#fffaf2;border-left:3px solid ${EXT_COLOR}">
      ${avatar(w?.name || l.name || '?', nested ? 26 : 32, EXT_COLOR)}<div class="grow"><b class="${nested ? 'small' : ''}">${esc(w?.name || l.name || 'Worker')}</b>
      <div class="small muted">External${w?.trade ? ` · ${esc(w.trade)}` : ''} · since ${fmtTime(atTz(l.since, tz))}${nested ? '' : ` · with ${esc(l.employeeName)}`}</div></div>
      ${pill('On site', 'green', true)}</a>`;
  }

  draw();
  return store.on(() => { if (!el.querySelector('#wn-q:focus')) draw(); });
}

const k = (label, value, sub, color) => `<div class="card kpi"><div class="lbl"><span class="ico" style="background:${color}1f;color:${color}">●</span>${esc(label)}</div>
  <div class="val" style="color:${color === '#404041' ? 'inherit' : color}">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
