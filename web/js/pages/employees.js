import {
  store, isAdmin, staffStatuses, createStaff, updateUser, sessionsInRange, offDaysInRange, trackForDay,
  sessionMinutes, sessionFlagged, closeSession, deleteSession, ROLE_LABEL, deleteEmployee, isShortDay, minDayMins, entryMinutes,
} from '../fb.js';
import {
  esc, fromTz, EXT_COLOR, icon, avatar, pill, cap, fmtMins, fmtTime, fmtDate, fmtDay, fmtDateTime, fmtMoney, fmtDist, fmtMonth, timeAgo,
  dateKey, monthKey, parseKey, startOfMonth, endOfMonth, addDays, WEEKDAYS, WEEKDAYS_LONG, toast, modal, confirmBox,
  promptBox, friendlyError, statusPill,
} from '../util.js';
import { employeeSummary, pettySummary, flagText } from '../calc.js';
import { makeMap, siteLayer, fitTo } from '../mapkit.js';
import { monthlySummaryReport, attendanceLogReport, downloadReport } from '../report-lib.js';
import { docsPanel, ownerFromUser, exportMenu, docsSummaryHtml } from '../iddocs.js';
import { editTimesDialog, deleteDayDialog, logoutDialog } from '../admin-edit.js';

const STATE = { onDuty: ['On duty', 'green'], done: ['Checked out', 'teal'], off: ['Off day', 'amber'], notIn: ['Not checked in', 'gray'] };

export function mount(el, params, ctx) {
  if (params[0]) return detail(el, params[0], ctx);
  return list(el, ctx);
}

// ------------------------------------------------------------------ list
function list(el, { setHeader }) {
  setHeader('Employees', 'Staff and external workers — status today',
    isAdmin() ? `<button class="btn" id="e-new">${icon('plus', 16)} Add person</button>` : '');
  document.getElementById('e-new')?.addEventListener('click', () => editPerson(null));
  let q = '', filter = 'all';

  function draw() {
    const st = staffStatuses();
    const ql = q.toLowerCase();
    const rows = st.filter((s) => filter !== 'ext' && (filter === 'all' || s.state === filter) &&
      (!ql || [s.user.name, s.user.loginId, s.user.phone, s.user.designation].join(' ').toLowerCase().includes(ql)));
    const staffMgr = store.users.filter((u) => u.role !== 'employee');
    const inactive = store.users.filter((u) => u.role === 'employee' && !u.active);
    const cnt = (k) => st.filter((s) => s.state === k).length;
    // External workers who worked today (one row each), shown with the staff in orange.
    const extMap = new Map();
    for (const e of store.workersToday) {
      const x = extMap.get(e.workerId) || { id: e.workerId, name: store.worker(e.workerId)?.name || e.workerName, w: store.worker(e.workerId), mins: 0, open: false, last: e };
      x.mins += entryMinutes(e); if (e.open) x.open = true; if (e.checkIn >= x.last.checkIn) x.last = e;
      extMap.set(e.workerId, x);
    }
    const extAll = [...extMap.values()].sort((a, b) => (a.open === b.open ? a.name.localeCompare(b.name) : a.open ? -1 : 1));
    const extRows = extAll.filter((x) => (filter === 'all' || (filter === 'onDuty' && x.open) || (filter === 'done' && !x.open) || filter === 'ext')
      && (!ql || [x.name, x.w?.phone, x.w?.company, x.w?.trade].join(' ').toLowerCase().includes(ql)));
    const extOn = extAll.filter((x) => x.open).length;
    el.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <input id="e-q" placeholder="Search name, ID, phone…" value="${esc(q)}" style="max-width:300px">
      <div class="chips">${[['all', `All (${st.length} + ${extAll.length} ext)`], ['onDuty', `On duty (${cnt('onDuty')} + ${extOn} ext)`], ['done', `Checked out (${cnt('done')})`],
        ['notIn', `Not in (${cnt('notIn')})`], ['off', `Off (${cnt('off')})`], ['ext', `External today (${extAll.length})`]].map(([k, l]) => `<span class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l}</span>`).join('')}</div>
    </div>
    <div class="card"><div class="table-wrap"><table class="t">
      <tr><th>Employee</th><th>Login ID</th><th>Phone</th><th>Weekly off</th><th>Status today</th><th class="num">Today</th><th>IDs</th><th>Last GPS</th></tr>
      ${rows.length ? rows.map((s) => `<tr class="click" data-id="${s.user.id}">
        <td><div class="person">${avatar(s.user.name, 32)}<div><div class="nm">${esc(s.user.name)}</div><div class="small muted">${esc(s.user.designation)}</div></div></div></td>
        <td class="mono">${esc(s.user.loginId)}</td><td>${esc(s.user.phone)}</td>
        <td>${s.user.weeklyOffDays.length ? s.user.weeklyOffDays.map((w) => WEEKDAYS[w]).join(', ') : '<span class="muted">Flexible</span>'}</td>
        <td>${pill(STATE[s.state][0], STATE[s.state][1], s.state === 'onDuty')}${s.open ? `<div class="small muted">${esc(s.open.siteName)}</div>` : ''}</td>
        <td class="num"><b>${s.minutes ? fmtMins(s.minutes) : '—'}</b></td>
        <td>${docsSummaryHtml(s.user.id)}</td>
        <td class="small muted">${s.user.lastLocation ? timeAgo(s.user.lastLocation.at) : '—'}</td></tr>`).join('')
        : (extRows.length ? '' : '<tr><td colspan="8"><div class="empty">No matching employees</div></td></tr>')}
      ${extRows.length ? `<tr class="wf-sub ext"><td colspan="8">External workers today · ${extRows.length}</td></tr>` + extRows.map((x) => `<tr class="click wf-row ext" data-wid="${x.id}">
        <td><div class="person">${avatar(x.name, 32, EXT_COLOR)}<div><div class="nm">${esc(x.name)}</div><div class="small muted">${esc([x.w?.company, x.w?.trade].filter(Boolean).join(' · ') || 'External worker')}</div></div></div></td>
        <td><span class="wf-chip ext">External</span></td><td>${esc(x.w?.phone || '')}</td><td class="small muted">with ${esc(x.last.employeeName)}</td>
        <td>${x.open ? pill('On site', 'green', true) : pill('Done', 'teal')}<div class="small muted">${esc(x.last.siteName)}</div></td>
        <td class="num"><b>${fmtMins(x.mins)}</b></td><td>${docsSummaryHtml(x.id)}</td><td class="small muted">—</td></tr>`).join('') : ''}
    </table></div></div>
    ${staffMgr.length ? `<h2 class="mt2" style="margin-bottom:10px">Admins, managers & document clerks</h2>
    <div class="card"><div class="table-wrap"><table class="t"><tr><th>Name</th><th>Role</th><th>Login ID</th><th>Access</th><th></th></tr>
      ${staffMgr.map((u) => `<tr><td><a class="person" href="#/employees/${u.id}" style="color:inherit">${avatar(u.name, 30)}<span class="nm">${esc(u.name)}</span></a></td>
        <td>${pill(ROLE_LABEL[u.role] || u.role, u.role === 'admin' ? 'purple' : u.role === 'docs' ? 'amber' : 'blue')}</td><td class="mono">${esc(u.loginId)}</td>
        <td class="small muted">${u.role === 'admin' ? 'Everything incl. accounts & logins' : u.role === 'docs' ? 'Documents Portal only — changes need admin approval' : 'Everything except accounts'}${u.active ? '' : ' · <b style="color:#D64545">disabled</b>'}</td>
        <td class="right">${isAdmin() && u.id !== store.me.id ? `<button class="btn sm ghost" data-edit="${u.id}">${icon('edit', 14)} Edit</button>` : ''}</td></tr>`).join('')}
    </table></div></div>` : ''}
    ${inactive.length ? `<h2 class="mt2" style="margin-bottom:10px">Deactivated</h2>
    <div class="card">${inactive.map((u) => `<a class="list-item" href="#/employees/${u.id}" style="color:inherit">${avatar(u.name, 30)}<div class="grow muted">${esc(u.name)} · ${esc(u.loginId)}</div></a>`).join('')}</div>` : ''}`;
    const qi = el.querySelector('#e-q');
    qi.oninput = (e) => { q = e.target.value; draw(); el.querySelector('#e-q').focus(); el.querySelector('#e-q').setSelectionRange(q.length, q.length); };
    el.querySelectorAll('[data-f]').forEach((c) => { c.onclick = () => { filter = c.dataset.f; draw(); }; });
    el.querySelectorAll('tr[data-id]').forEach((r) => { r.onclick = () => { location.hash = `#/employees/${r.dataset.id}`; }; });
    el.querySelectorAll('tr[data-wid]').forEach((r) => { r.onclick = () => { location.hash = `#/workers/${r.dataset.wid}`; }; });
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
        <option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Admin — full access incl. petty cash & logins</option>
        <option value="docs" ${u?.role === 'docs' ? 'selected' : ''}>Document clerk — Documents Portal only (view / download IDs, send changes for approval)</option></select></label>
      <div class="full" id="ef-off"><label class="f" style="margin-bottom:6px"><span>Weekly off day(s) — none selected = flexible</span></label>
        <div class="chips">${[1, 2, 3, 4, 5, 6, 7].map((w) => `<span class="chip ${off.has(w) ? 'on' : ''}" data-w="${w}">${WEEKDAYS_LONG[w]}</span>`).join('')}</div></div>
      <label class="f" style="margin-top:12px"><span>Off days per month</span><input name="quota" type="number" min="0" max="15" value="${u?.monthlyOffQuota ?? 4}"></label>
      ${editing ? `<label class="f row" style="gap:8px;margin-top:34px"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Account active</label>` : ''}
    </div><div class="error" id="ef-err"></div></form>`,
    foot: `${editing && isAdmin() && u.id !== store.me.id ? `<button class="btn danger" data-delp style="margin-right:auto">${icon('trash', 16)} Delete person</button>` : ''}
      <button class="btn ghost" data-cancel>Cancel</button><button class="btn" data-save>${editing ? 'Save changes' : 'Create login'}</button>`,
    onMount: (m, close) => {
      const f = m.querySelector('#ef');
      m.querySelectorAll('[data-w]').forEach((c) => {
        c.onclick = () => { const w = Number(c.dataset.w); c.classList.toggle('on'); if (off.has(w)) off.delete(w); else off.add(w); };
      });
      m.querySelector('[data-cancel]').onclick = close;
      m.querySelector('[data-delp]')?.addEventListener('click', () => { close(); deletePersonDialog(u); });
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

function deletePersonDialog(u) {
  modal({
    title: `Delete ${u.name}?`,
    body: `<p style="margin-top:0">This removes <b>${esc(u.name)}</b> (${esc(u.loginId)}) from the team. They can no longer use the app or the dashboard.</p>
      <label class="f row" style="gap:8px;align-items:flex-start"><input type="checkbox" id="dp-r" style="margin-top:3px">
        <span style="font-weight:500">Also delete all their records: attendance, external-worker time they logged, schedules, off days, alerts and ID documents. <b>Cannot be undone.</b><br>
        <span class="muted small">Leave unticked to keep their history in reports. Petty cash entries are always kept for the accounts.</span></span></label>
      <label class="f"><span>Type DELETE to confirm</span><input id="dp-c" autocomplete="off"></label>
      <div class="small muted">Tip: to only stop access, use Edit → untick “Account active” instead. To free the login ID for reuse, also delete the user in Firebase Console → Authentication.</div>
      <div class="error" id="dp-e"></div>`,
    foot: '<button class="btn ghost" data-x2>Cancel</button><button class="btn danger" data-ok>Delete person</button>',
    onMount: (m, close) => {
      m.querySelector('[data-x2]').onclick = close;
      m.querySelector('[data-ok]').onclick = async (ev) => {
        if (m.querySelector('#dp-c').value.trim().toUpperCase() !== 'DELETE') { m.querySelector('#dp-e').textContent = 'Type DELETE to confirm.'; return; }
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Deleting…';
        try {
          const n = await deleteEmployee(u, { records: m.querySelector('#dp-r').checked });
          toast(`${u.name} deleted${n ? ` with ${n} records` : ''}`); close(); location.hash = '#/employees';
        } catch (e) { m.querySelector('#dp-e').textContent = friendlyError(e); ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Delete person'; }
      };
    },
  });
}

// ------------------------------------------------------------------ detail
function detail(root, id, { setHeader }) {
  // Top part is redrawn as data loads; the ID documents card below is built once (keeps typed values).
  root.innerHTML = `<div></div><div class="card mt" id="ed-docs-card" style="display:none">
    <div class="card-head"><h2>ID documents</h2><span class="small muted">Passport · Emirates ID · SIRA · visa · labour card — for sending to customers</span></div>
    <div class="card-pad" id="ed-docs"></div></div>`;
  const el = root.firstChild;
  let docsCleanup = null;
  const buildDocs = () => {
    const u = store.user(id);
    if (docsCleanup || !u) return;
    root.querySelector('#ed-docs-card').style.display = '';
    docsCleanup = docsPanel(root.querySelector('#ed-docs'), ownerFromUser(u));
  };
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
       <button class="btn ghost" id="ed-ids">${icon('download', 16)} IDs</button>
       ${store.open.some((x) => x.employeeId === u.id) || isAdmin() ? `<button class="btn ghost" id="ed-lo" style="color:#D64545">${icon('logout', 16)} Log out</button>` : ''}
       ${isAdmin() ? `<button class="btn" id="ed-edit">${icon('edit', 16)} Edit</button>` : ''}`);
    document.getElementById('ed-edit')?.addEventListener('click', () => editPerson(u));
    document.getElementById('ed-lo')?.addEventListener('click', () => logoutDialog(u.id, load));
    document.getElementById('ed-ids').onclick = () => exportMenu([ownerFromUser(u)], `${u.name} IDs`);
    buildDocs();
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
      <div class="card"><div class="card-head"><h2>Route · ${fmtDay(parseKey(day))}</h2><span id="rt-info" class="muted small"></span>
        ${isAdmin() && (sessions || []).some((x) => x.date === day) ? `<button class="btn sm ghost danger-t" id="rt-delday" title="Delete all check-ins on this day">${icon('trash', 14)} Delete day</button>` : ''}</div><div id="rt-map" class="map small" style="border:0;border-radius:0 0 14px 14px"></div></div>
    </div>
    <div class="card mt"><div class="card-head"><h2>Check-ins</h2><span class="muted small">${sessions ? `${sessions.length} this month` : ''}</span></div>
      <div class="table-wrap"><table class="t"><tr><th>Date</th><th>Site</th><th>In</th><th>Out</th><th class="num">Duration</th><th>GPS check</th><th></th></tr>
      ${sessions && sessions.length ? [...sessions].reverse().map((s) => `<tr>
        <td class="nowrap">${fmtDay(s.inLocal)}${s.editedAt ? ` <span class="pill gray" title="Times edited by ${esc(s.editedBy)}">edited</span>` : ''}</td><td><b>${esc(s.siteName)}</b></td><td>${fmtTime(s.inLocal)}</td>
        <td>${s.checkOut ? fmtTime(s.outLocal) : pill('Open', 'green', true)}</td><td class="num"><b>${fmtMins(sessionMinutes(s))}</b></td>
        <td class="small">${sessionFlagged(s) ? `<span style="color:#D64545">${esc(flagText(s))}</span>` : `<span class="muted">OK · ${fmtDist(s.inDistance)}</span>`}</td>
        <td class="right nowrap">${!s.checkOut ? `<button class="btn sm ghost" data-close="${s.id}">Close</button>` : ''}
          ${isAdmin() ? `<button class="btn sm ghost" data-edit-s="${s.id}" title="Edit times">${icon('edit', 14)}</button><button class="btn sm ghost" data-del="${s.id}" title="Delete">${icon('trash', 14)}</button>` : ''}</td></tr>`).join('')
        : `<tr><td colspan="7"><div class="empty">${sessions ? 'No check-ins this month' : 'Loading…'}</div></td></tr>`}
      </table></div></div>
    ${offDays.length ? `<div class="card mt"><div class="card-head"><h2>Off-day requests</h2></div>
      ${offDays.map((o) => `<div class="list-item"><div class="grow"><b>${fmtDate(parseKey(o.date))}</b> <span class="muted">${esc(o.reason)}</span></div>${statusPill(o.status)}</div>`).join('')}</div>` : ''}
    ${isAdmin() && petty.length ? `<div class="card mt"><div class="card-head"><h2>Petty cash</h2><a class="small" href="#/petty">Open petty cash →</a></div>
      <div class="table-wrap"><table class="t"><tr><th>Date</th><th>Type</th><th>Note</th><th class="num">Amount</th><th>Status</th></tr>
      ${petty.slice(0, 15).map((t) => `<tr><td class="small">${fmtDate(t.createdLocal)}</td><td>${esc(t.type === 'credit' ? 'Cash given' : t.category)}</td>
        <td class="small">${esc(t.note)}</td><td class="num" style="color:${t.type === 'credit' ? '#2E9E6A' : '#D64545'}">${t.type === 'credit' ? '+' : '−'}${fmtMoney(t.amount)}</td><td>${statusPill(t.status)}</td></tr>`).join('')}
      </table></div></div>` : ''}`;

    el.querySelector('#m-prev').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); day = dateKey(endOfMonth(month)); load(); };
    el.querySelector('#m-next').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); day = dateKey(month); load(); };
    el.querySelectorAll('[data-day]').forEach((c) => { c.onclick = () => { day = c.dataset.day; draw(); }; });
    el.querySelectorAll('[data-close]').forEach((b) => {
      b.onclick = async () => {
        const s = sessions.find((x) => x.id === b.dataset.close);
        const t = await promptBox('Close session', `Check-out time on ${fmtDate(s.inLocal)}`, { ok: 'Close', value: '18:00', type: 'time' });
        if (!t) return;
        const [h, mi] = t.split(':').map(Number);
        const at = fromTz(new Date(s.inLocal.getFullYear(), s.inLocal.getMonth(), s.inLocal.getDate(), h, mi), s.tz);
        if (at <= s.checkIn) return toast('Check-out must be after check-in', true);
        await closeSession(s, at); toast('Closed'); load();
      };
    });
    el.querySelectorAll('[data-edit-s]').forEach((b) => { b.onclick = () => editTimesDialog(sessions.find((x) => x.id === b.dataset.editS), load); });
    el.querySelector('#rt-delday')?.addEventListener('click', () => deleteDayDialog(id, u.name, day, sessions.filter((x) => x.date === day).length, load));
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
      if (s.inLat != null) { window.L.circleMarker([s.inLat, s.inLng], { radius: 7, color: '#fff', weight: 2, fillColor: '#2E9E6A', fillOpacity: 1 }).bindTooltip(`In ${fmtTime(s.inLocal)} · ${s.siteName}`).addTo(mapLayer); pts.push([s.inLat, s.inLng]); }
      if (s.outLat != null) { window.L.circleMarker([s.outLat, s.outLng], { radius: 7, color: '#fff', weight: 2, fillColor: '#D64545', fillOpacity: 1 }).bindTooltip(`Out ${fmtTime(s.outLocal)}`).addTo(mapLayer); pts.push([s.outLat, s.outLng]); }
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
      ${sum.days.map((d) => { const sh = d.sessions.length && isShortDay(d.date, d.minutes, d.sessions.some((x) => !x.checkOut)); return `<div data-day="${d.date}" title="${sh ? `SHORT DAY — ${fmtMins(d.minutes)} (min ${minDayMins() / 60} h)` : `${d.kind}${d.minutes ? ` · ${fmtMins(d.minutes)}` : ''}`}" style="cursor:pointer;background:${sh ? '#D6454522' : `${color[d.kind]}${d.kind === 'upcoming' || d.kind === 'beforeJoin' ? '55' : '22'}`};color:${sh ? '#b23535' : d.kind === 'upcoming' || d.kind === 'beforeJoin' ? '#8a96a0' : color[d.kind]};${sh ? 'box-shadow:inset 0 0 0 2px #D64545;' : ''}${d.date === day ? 'outline:2px solid #1c2a33' : ''}">
        ${d.day.getDate()}${d.minutes ? `<div style="font-size:9.5px;font-weight:500">${(d.minutes / 60).toFixed(1)}h</div>` : ''}</div>`; }).join('')}</div>
      <div class="row small muted" style="margin-top:10px;gap:14px">
        <span style="color:#2E9E6A">■ Present</span><span style="color:#E08E2B">■ Off</span><span style="color:#D64545">■ Absent</span><span style="color:#3A7BD5">■ Today</span><span style="color:#b23535">▣ Short day (&lt; ${minDayMins() / 60} h)</span></div>`;
  }

  load();
  // Only redraw from live data until the profile first appears (avoids rebuilding the map every 30 s).
  let shown = false;
  const off = store.on(() => { if (!shown && store.user(id)) { shown = true; draw(); } });
  return () => { off(); if (map) map.remove(); loadToken++; if (docsCleanup) docsCleanup(); };
}

const k = (label, value, sub) => `<div class="card kpi"><div class="lbl">${esc(label)}</div><div class="val" style="font-size:22px">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
