import {
  store, isAdmin, staffStatuses, createStaff, updateUser, sessionsInRange, offDaysInRange, trackForDay,
  sessionMinutes, sessionFlagged, closeSession, deleteSession, ROLE_LABEL,
} from '../fb.js';
import {
  esc, icon, avatar, pill, cap, fmtMins, fmtTime, fmtDate, fmtDay, fmtDateTime, fmtMoney, fmtDist, fmtMonth, timeAgo,
  dateKey, monthKey, parseKey, startOfMonth, endOfMonth, addDays, WEEKDAYS, WEEKDAYS_LONG, toast, modal, confirmBox,
  promptBox, friendlyError, statusPill,
} from '../util.js';
import { employeeSummary, pettySummary, flagText } from '../calc.js';
import { makeMap, siteLayer, fitTo } from '../mapkit.js';
import { monthlySummaryReport, attendanceLogReport, downloadReport } from '../report-lib.js';

const STATE = { onDuty: ['On duty', 'green'], done: ['Checked out', 'teal'], off: ['Off day', 'amber'], notIn: ['Not checked in', 'gray'] };

export function mount(el, params, ctx) {
  if (params[0]) return detail(el, params[0], ctx);
  return list(el, ctx);
}

// ------------------------------------------------------------------ list
function list(el, { setHeader }) {
  setHeader('Employees', 'Staff, managers and their status today',
    isAdmin() ? `<button class="btn" id="e-new">${icon('plus', 16)} Add person</button>` : '');
  document.getElementById('e-new')?.addEventListener('click', () => editPerson(null));
  let q = '', filter = 'all';

  function draw() {
    const st = staffStatuses();
    const ql = q.toLowerCase();
    const rows = st.filter((s) => (filter === 'all' || s.state === filter) &&
      (!ql || [s.user.name, s.user.loginId, s.user.phone, s.user.designation].join(' ').toLowerCase().includes(ql)));
    const staffMgr = store.users.filter((u) => u.role !== 'employee');
    const inactive = store.users.filter((u) => u.role === 'employee' && !u.active);
    const cnt = (k) => st.filter((s) => s.state === k).length;
    el.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <input id="e-q" placeholder="Search name, ID, phone…" value="${esc(q)}" style="max-width:300px">
      <div class="chips">${[['all', `All (${st.length})`], ['onDuty', `On duty (${cnt('onDuty')})`], ['done', `Checked out (${cnt('done')})`],
        ['notIn', `Not in (${cnt('notIn')})`], ['off', `Off (${cnt('off')})`]].map(([k, l]) => `<span class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l}</span>`).join('')}</div>
    </div>
    <div class="card"><div class="table-wrap"><table class="t">
      <tr><th>Employee</th><th>Login ID</th><th>Phone</th><th>Weekly off</th><th>Status today</th><th class="num">Today</th><th>Last GPS</th></tr>
      ${rows.length ? rows.map((s) => `<tr class="click" data-id="${s.user.id}">
        <td><div class="person">${avatar(s.user.name, 32)}<div><div class="nm">${esc(s.user.name)}</div><div class="small muted">${esc(s.user.designation)}</div></div></div></td>
        <td class="mono">${esc(s.user.loginId)}</td><td>${esc(s.user.phone)}</td>
        <td>${s.user.weeklyOffDays.length ? s.user.weeklyOffDays.map((w) => WEEKDAYS[w]).join(', ') : '<span class="muted">Flexible</span>'}</td>
        <td>${pill(STATE[s.state][0], STATE[s.state][1], s.state === 'onDuty')}${s.open ? `<div class="small muted">${esc(s.open.siteName)}</div>` : ''}</td>
        <td class="num"><b>${s.minutes ? fmtMins(s.minutes) : '—'}</b></td>
        <td class="small muted">${s.user.lastLocation ? timeAgo(s.user.lastLocation.at) : '—'}</td></tr>`).join('')
        : '<tr><td colspan="7"><div class="empty">No matching employees</div></td></tr>'}
    </table></div></div>
    ${staffMgr.length ? `<h2 class="mt2" style="margin-bottom:10px">Admins & managers</h2>
    <div class="card"><div class="table-wrap"><table class="t"><tr><th>Name</th><th>Role</th><th>Login ID</th><th>Access</th><th></th></tr>
      ${staffMgr.map((u) => `<tr><td><div class="person">${avatar(u.name, 30)}<span class="nm">${esc(u.name)}</span></div></td>
        <td>${pill(ROLE_LABEL[u.role] || u.role, u.role === 'admin' ? 'purple' : 'blue')}</td><td class="mono">${esc(u.loginId)}</td>
        <td class="small muted">${u.role === 'admin' ? 'Everything incl. accounts & logins' : 'Everything except accounts'}${u.active ? '' : ' · <b style="color:#D64545">disabled</b>'}</td>
        <td class="right">${isAdmin() && u.id !== store.me.id ? `<button class="btn sm ghost" data-edit="${u.id}">${icon('edit', 14)} Edit</button>` : ''}</td></tr>`).join('')}
    </table></div></div>` : ''}
    ${inactive.length ? `<h2 class="mt2" style="margin-bottom:10px">Deactivated</h2>
    <div class="card">${inactive.map((u) => `<a class="list-item" href="#/employees/${u.id}" style="color:inherit">${avatar(u.name, 30)}<div class="grow muted">${esc(u.name)} · ${esc(u.loginId)}</div></a>`).join('')}</div>` : ''}`;
    const qi = el.querySelector('#e-q');
    qi.oninput = (e) => { q = e.target.value; draw(); el.querySelector('#e-q').focus(); el.querySelector('#e-q').setSelectionRange(q.length, q.length); };
    el.querySelectorAll('[data-f]').forEach((c) => { c.onclick = () => { filter = c.dataset.f; draw(); }; });
    el.querySelectorAll('tr[data-id]').forEach((r) => { r.onclick = () => { location.hash = `#/employees/${r.dataset.id}`; }; });
    el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => editPerson(store.user(b.dataset.edit)); });
  }
  draw();
  return store.on(() => { if (!el.querySelector('#e-q:focus')) draw(); });
}

// ------------------------------------------------------------------ add / edit
export function editPerson(u) {
  const editing = !!u;
  const off = new Set(u ? u.weeklyOffDays : [7]);
  modal({
    title: editing ? `Edit ${u.name}` : 'Add person',
    body: `<form id="ef"><div class="fields">
      <label class="f full"><span>Full name *</span><input name="name" required value="${esc(u?.name)}"></label>
      <label class="f"><span>Login ID *</span><input name="loginId" ${editing ? 'disabled' : ''} value="${esc(u?.loginId)}" placeholder="EMP001"></label>
      ${editing ? '<label class="f"><span>&nbsp;</span><div class="small muted" style="padding-top:8px">Login ID can’t be changed.</div></label>'
        : '<label class="f"><span>Password * (min 6)</span><input name="password" type="text" minlength="6"></label>'}
      <label class="f"><span>Phone</span><input name="phone" value="${esc(u?.phone)}"></label>
      <label class="f"><span>Designation</span><input name="designation" value="${esc(u?.designation)}"></label>
      <label class="f full"><span>Role</span><select name="role">
        <option value="employee" ${(!u || u.role === 'employee') ? 'selected' : ''}>Employee — uses the mobile app to check in</option>
        <option value="manager" ${u?.role === 'manager' ? 'selected' : ''}>Manager — sees everything except accounts</option>
        <option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Admin — full access incl. petty cash & logins</option></select></label>
      <div class="full" id="ef-off"><label class="f" style="margin-bottom:6px"><span>Weekly off day(s) — none selected = flexible</span></label>
        <div class="chips">${[1, 2, 3, 4, 5, 6, 7].map((w) => `<span class="chip ${off.has(w) ? 'on' : ''}" data-w="${w}">${WEEKDAYS_LONG[w]}</span>`).join('')}</div></div>
      <label class="f" style="margin-top:12px"><span>Off days per month</span><input name="quota" type="number" min="0" max="15" value="${u?.monthlyOffQuota ?? 4}"></label>
      ${editing ? `<label class="f row" style="gap:8px;margin-top:34px"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Account active</label>` : ''}
    </div><div class="error" id="ef-err"></div></form>`,
    foot: `<button class="btn ghost" data-cancel>Cancel</button><button class="btn" data-save>${editing ? 'Save changes' : 'Create login'}</button>`,
    onMount: (m, close) => {
      const f = m.querySelector('#ef');
      m.querySelectorAll('[data-w]').forEach((c) => {
        c.onclick = () => { const w = Number(c.dataset.w); c.classList.toggle('on'); if (off.has(w)) off.delete(w); else off.add(w); };
      });
      m.querySelector('[data-cancel]').onclick = close;
      m.querySelector('[data-save]').onclick = async () => {
        const err = m.querySelector('#ef-err');
        const btn = m.querySelector('[data-save]');
        if (!f.name.value.trim()) { err.textContent = 'Name is required.'; return; }
        const data = {
          name: f.name.value.trim(), phone: f.phone.value.trim(), designation: f.designation.value.trim(), role: f.role.value,
          weeklyOffDays: [...off].sort(), monthlyOffQuota: Number(f.quota.value) || 0,
        };
        btn.disabled = true;
        try {
          if (editing) {
            await updateUser(u.id, { ...data, active: f.active.checked });
            toast('Saved');
          } else {
            const id = f.loginId.value.trim();
            if (!id || !/^[A-Za-z0-9._@-]+$/.test(id)) throw new Error('Login ID: use letters, numbers, dot, dash or underscore.');
            if ((f.password.value || '').length < 6) throw new Error('Password must be at least 6 characters.');
            await createStaff({ loginId: id, password: f.password.value, ...data });
            toast(`Login created: ${id}`);
          }
          close();
        } catch (e) { err.textContent = friendlyError(e); btn.disabled = false; }
      };
    },
  });
}

// ------------------------------------------------------------------ detail
function detail(el, id, { setHeader }) {
  let month = startOfMonth(new Date());
  let sessions = null, offDays = [];
  let day = dateKey(new Date());
  let map = null, mapLayer = null;
  let loadToken = 0;

  async function load() {
    const t = ++loadToken;
    sessions = null; draw();
    const from = dateKey(month), to = dateKey(endOfMonth(month));
    const [s, o] = await Promise.all([sessionsInRange(from, to), offDaysInRange(from, to)]);
    if (t !== loadToken) return;
    sessions = s.filter((x) => x.employeeId === id);
    offDays = o.filter((x) => x.employeeId === id);
    draw();
  }

  function draw() {
    const u = store.user(id);
    if (!u) { el.innerHTML = store.loaded ? '<div class="card empty"><b>Employee not found</b></div>' : ''; return; }
    setHeader(u.name, `${esc(ROLE_LABEL[u.role])} · ID <span class="mono">${esc(u.loginId)}</span>${u.phone ? ` · ${esc(u.phone)}` : ''}${u.designation ? ` · ${esc(u.designation)}` : ''}`,
      `<a class="btn ghost" href="#/employees">← All employees</a>
       <button class="btn ghost" id="ed-xlsx">${icon('download', 16)} Month report</button>
       ${isAdmin() ? `<button class="btn" id="ed-edit">${icon('edit', 16)} Edit</button>` : ''}`);
    document.getElementById('ed-edit')?.addEventListener('click', () => editPerson(u));
    document.getElementById('ed-xlsx').onclick = async () => {
      try {
        const from = dateKey(month), to = dateKey(endOfMonth(month));
        const r = await attendanceLogReport(from, to, id);
        const sum = await monthlySummaryReport(month, [id]);
        r.sheets.unshift(sum.sheets[0]);
        r.title = `${u.name} — attendance ${fmtMonth(month)}`;
        await downloadReport(r, 'xlsx');
      } catch (e) { toast(friendlyError(e), true); }
    };

    const from = dateKey(month), to = dateKey(endOfMonth(month));
    const sum = sessions ? employeeSummary(u, sessions, offDays, from, to) : null;
    const st = staffStatuses().find((s) => s.user.id === id);
    const petty = store.petty.filter((t) => t.employeeId === id);
    const ps = pettySummary(petty);

    el.innerHTML = `
    <div class="row" style="margin-bottom:14px">
      <button class="btn ghost sm" id="m-prev">‹</button><b style="min-width:130px;text-align:center">${fmtMonth(month)}</b>
      <button class="btn ghost sm" id="m-next" ${monthKey(month) >= monthKey(new Date()) ? 'disabled' : ''}>›</button>
      <span class="spacer"></span>
      ${st ? pill(STATE[st.state][0], STATE[st.state][1], st.state === 'onDuty') : u.active ? '' : pill('Deactivated', 'red')}
      ${st && st.minutes ? `<b>Today ${fmtMins(st.minutes)}</b>` : ''}
    </div>
    <div class="grid kpis">
      ${k('Total work time', sum ? fmtMins(sum.minutes) : '…', sum ? `Avg ${fmtMins(sum.avgMinutes)} / day` : '')}
      ${k('Days worked', sum ? sum.workedDays : '…', sum ? `${sum.visits} site visits` : '')}
      ${k('Off days', sum ? `${sum.offDays} / ${u.monthlyOffQuota}` : '…', u.weeklyOffDays.length ? `Weekly: ${u.weeklyOffDays.map((w) => WEEKDAYS[w]).join(', ')}` : 'Flexible')}
      ${k('Absent', sum ? sum.absentDays : '…', sum && sum.flagged ? `${sum.flagged} flagged check-ins` : 'No flags')}
      ${isAdmin() ? k('Petty balance', fmtMoney(ps.balance), `${fmtMoney(ps.pending)} pending`) : ''}
    </div>
    <div class="grid cols-2 mt">
      <div class="card"><div class="card-head"><h2>Calendar</h2><span class="muted small">click a day for its route</span></div><div class="card-pad">${sum ? calendar(sum) : 'Loading…'}</div></div>
      <div class="card"><div class="card-head"><h2>Route · ${fmtDay(parseKey(day))}</h2><span id="rt-info" class="muted small"></span></div><div id="rt-map" class="map small" style="border:0;border-radius:0 0 14px 14px"></div></div>
    </div>
    <div class="card mt"><div class="card-head"><h2>Check-ins</h2><span class="muted small">${sessions ? `${sessions.length} this month` : ''}</span></div>
      <div class="table-wrap"><table class="t"><tr><th>Date</th><th>Site</th><th>In</th><th>Out</th><th class="num">Duration</th><th>GPS check</th><th></th></tr>
      ${sessions && sessions.length ? [...sessions].reverse().map((s) => `<tr>
        <td class="nowrap">${fmtDay(s.checkIn)}</td><td><b>${esc(s.siteName)}</b></td><td>${fmtTime(s.checkIn)}</td>
        <td>${s.checkOut ? fmtTime(s.checkOut) : pill('Open', 'green', true)}</td><td class="num"><b>${fmtMins(sessionMinutes(s))}</b></td>
        <td class="small">${sessionFlagged(s) ? `<span style="color:#D64545">${esc(flagText(s))}</span>` : `<span class="muted">OK · ${fmtDist(s.inDistance)}</span>`}</td>
        <td class="right nowrap">${!s.checkOut ? `<button class="btn sm ghost" data-close="${s.id}">Close</button>` : ''}
          ${isAdmin() ? `<button class="btn sm ghost" data-del="${s.id}" title="Delete">${icon('trash', 14)}</button>` : ''}</td></tr>`).join('')
        : `<tr><td colspan="7"><div class="empty">${sessions ? 'No check-ins this month' : 'Loading…'}</div></td></tr>`}
      </table></div></div>
    ${offDays.length ? `<div class="card mt"><div class="card-head"><h2>Off-day requests</h2></div>
      ${offDays.map((o) => `<div class="list-item"><div class="grow"><b>${fmtDate(parseKey(o.date))}</b> <span class="muted">${esc(o.reason)}</span></div>${statusPill(o.status)}</div>`).join('')}</div>` : ''}
    ${isAdmin() && petty.length ? `<div class="card mt"><div class="card-head"><h2>Petty cash</h2><a class="small" href="#/petty">Open petty cash →</a></div>
      <div class="table-wrap"><table class="t"><tr><th>Date</th><th>Type</th><th>Note</th><th class="num">Amount</th><th>Status</th></tr>
      ${petty.slice(0, 15).map((t) => `<tr><td class="small">${fmtDate(t.createdAt)}</td><td>${esc(t.type === 'credit' ? 'Cash given' : t.category)}</td>
        <td class="small">${esc(t.note)}</td><td class="num" style="color:${t.type === 'credit' ? '#2E9E6A' : '#D64545'}">${t.type === 'credit' ? '+' : '−'}${fmtMoney(t.amount)}</td><td>${statusPill(t.status)}</td></tr>`).join('')}
      </table></div></div>` : ''}`;

    el.querySelector('#m-prev').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); day = dateKey(endOfMonth(month)); load(); };
    el.querySelector('#m-next').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); day = dateKey(month); load(); };
    el.querySelectorAll('[data-day]').forEach((c) => { c.onclick = () => { day = c.dataset.day; draw(); }; });
    el.querySelectorAll('[data-close]').forEach((b) => {
      b.onclick = async () => {
        const s = sessions.find((x) => x.id === b.dataset.close);
        const t = await promptBox('Close session', `Check-out time on ${fmtDate(s.checkIn)}`, { ok: 'Close', value: '18:00', type: 'time' });
        if (!t) return;
        const [h, mi] = t.split(':').map(Number);
        const at = new Date(s.checkIn.getFullYear(), s.checkIn.getMonth(), s.checkIn.getDate(), h, mi);
        if (at <= s.checkIn) return toast('Check-out must be after check-in', true);
        await closeSession(s, at); toast('Closed'); load();
      };
    });
    el.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!await confirmBox('Delete record?', 'Permanently delete this attendance record?', { ok: 'Delete', danger: true })) return;
        await deleteSession(b.dataset.del); toast('Deleted'); load();
      };
    });
    drawRoute(u);
  }

  async function drawRoute(u) {
    if (map) { map.remove(); map = null; }
    const box = el.querySelector('#rt-map');
    if (!box) return;
    map = makeMap(box);
    mapLayer = window.L.layerGroup().addTo(map);
    const daySessions = (sessions || []).filter((s) => s.date === day);
    const pts = [];
    daySessions.forEach((s) => {
      const site = store.site(s.siteId);
      if (site) mapLayer.addLayer(siteLayer(site));
      if (s.inLat != null) { window.L.circleMarker([s.inLat, s.inLng], { radius: 7, color: '#fff', weight: 2, fillColor: '#2E9E6A', fillOpacity: 1 }).bindTooltip(`In ${fmtTime(s.checkIn)} · ${s.siteName}`).addTo(mapLayer); pts.push([s.inLat, s.inLng]); }
      if (s.outLat != null) { window.L.circleMarker([s.outLat, s.outLng], { radius: 7, color: '#fff', weight: 2, fillColor: '#D64545', fillOpacity: 1 }).bindTooltip(`Out ${fmtTime(s.checkOut)}`).addTo(mapLayer); pts.push([s.outLat, s.outLng]); }
    });
    try {
      const track = await trackForDay(id, day);
      if (track.length > 1) {
        window.L.polyline(track.map((p) => [p.lat, p.lng]), { color: '#3A7BD5', weight: 4, opacity: 0.8 }).addTo(mapLayer);
        pts.push(...track.map((p) => [p.lat, p.lng]));
      }
      let km = 0;
      for (let i = 1; i < track.length; i++) km += window.L.latLng(track[i - 1].lat, track[i - 1].lng).distanceTo([track[i].lat, track[i].lng]);
      const info = el.querySelector('#rt-info');
      if (info) info.textContent = `${daySessions.length} check-ins · ${track.length} GPS points · ${fmtDist(km)} travelled`;
    } catch (e) { console.warn(e); }
    if (day === dateKey(new Date()) && u.lastLocation) pts.push([u.lastLocation.lat, u.lastLocation.lng]);
    fitTo(map, pts);
  }

  function calendar(sum) {
    const color = { worked: '#2E9E6A', off: '#E08E2B', absent: '#D64545', today: '#3A7BD5', upcoming: '#c5ced4', beforeJoin: '#c5ced4' };
    const lead = (sum.days[0].day.getDay() + 6) % 7;
    return `<div class="cal">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div class="h">${d}</div>`).join('')}
      ${'<div></div>'.repeat(lead)}
      ${sum.days.map((d) => `<div data-day="${d.date}" title="${d.kind}${d.minutes ? ` · ${fmtMins(d.minutes)}` : ''}" style="cursor:pointer;background:${color[d.kind]}${d.kind === 'upcoming' || d.kind === 'beforeJoin' ? '55' : '22'};color:${d.kind === 'upcoming' || d.kind === 'beforeJoin' ? '#8a96a0' : color[d.kind]};${d.date === day ? 'outline:2px solid #1c2a33' : ''}">
        ${d.day.getDate()}${d.minutes ? `<div style="font-size:9.5px;font-weight:500">${(d.minutes / 60).toFixed(1)}h</div>` : ''}</div>`).join('')}</div>
      <div class="row small muted" style="margin-top:10px;gap:14px">
        <span style="color:#2E9E6A">■ Present</span><span style="color:#E08E2B">■ Off</span><span style="color:#D64545">■ Absent</span><span style="color:#3A7BD5">■ Today</span></div>`;
  }

  load();
  // Only redraw from live data until the profile first appears (avoids rebuilding the map every 30 s).
  let shown = false;
  const off = store.on(() => { if (!shown && store.user(id)) { shown = true; draw(); } });
  return () => { off(); if (map) map.remove(); loadToken++; };
}

const k = (label, value, sub) => `<div class="card kpi"><div class="lbl">${esc(label)}</div><div class="val" style="font-size:22px">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
