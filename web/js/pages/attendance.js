import { store, sessionsInRange, sessionMinutes, sessionFlagged, closeSession, deleteSession, isAdmin } from '../fb.js';
import {
  esc, icon, avatar, pill, fmtMins, fmtTime, fmtDay, fmtDist, dateKey, addDays, startOfMonth, toast, confirmBox, promptBox, fmtDate,
} from '../util.js';
import { flagText } from '../calc.js';
import { attendanceLogReport, downloadReport } from '../report-lib.js';

export function mount(el, _p, { setHeader }) {
  const today = new Date();
  let from = dateKey(addDays(today, -6)), to = dateKey(today);
  let emp = '', site = '', onlyFlagged = false;
  let rows = null;

  setHeader('Attendance', 'Every check-in and check-out with GPS verification',
    `<button class="btn ghost" data-dl="csv">${icon('download', 16)} CSV</button>
     <button class="btn ghost" data-dl="xlsx">${icon('download', 16)} Excel</button>
     <button class="btn ghost" data-dl="pdf">${icon('download', 16)} PDF</button>`);
  document.querySelectorAll('[data-dl]').forEach((b) => {
    b.onclick = async () => {
      try { await downloadReport(await attendanceLogReport(from, to, emp || null, site || null), b.dataset.dl); } catch (e) { toast(e.message, true); }
    };
  });

  async function load() {
    rows = null; draw();
    rows = await sessionsInRange(from, to);
    draw();
  }

  function draw() {
    const list = (rows || []).filter((s) => (!emp || s.employeeId === emp) && (!site || s.siteId === site) && (!onlyFlagged || sessionFlagged(s)));
    const mins = list.reduce((a, s) => a + sessionMinutes(s), 0);
    const people = new Set(list.map((s) => s.employeeId)).size;
    el.innerHTML = `
    <div class="card card-pad"><div class="filters">
      <label class="f"><span>From</span><input type="date" id="a-from" value="${from}"></label>
      <label class="f"><span>To</span><input type="date" id="a-to" value="${to}"></label>
      <label class="f"><span>Employee</span><select id="a-emp"><option value="">All employees</option>${store.employees.map((u) => `<option value="${u.id}" ${emp === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Site</span><select id="a-site"><option value="">All sites</option>${store.sites.map((s) => `<option value="${s.id}" ${site === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f row" style="gap:6px;min-width:0"><input type="checkbox" id="a-flag" ${onlyFlagged ? 'checked' : ''}> Flagged only</label>
      <div class="chips">
        <span class="chip" data-r="today">Today</span><span class="chip" data-r="7">7 days</span>
        <span class="chip" data-r="month">This month</span><span class="chip" data-r="last">Last month</span></div>
    </div></div>
    <div class="row mt" style="gap:18px"><span><b>${list.length}</b> check-ins</span><span><b>${people}</b> people</span><span><b>${fmtMins(mins)}</b> total</span>
      ${rows ? '' : '<span class="muted">Loading…</span>'}</div>
    <div class="card mt"><div class="table-wrap"><table class="t">
      <tr><th>Date</th><th>Employee</th><th>Site</th><th>In</th><th>Out</th><th class="num">Hours</th><th>Distance</th><th>Check</th><th></th></tr>
      ${list.length ? [...list].reverse().map((s) => `<tr>
        <td class="nowrap">${fmtDay(s.checkIn)}</td>
        <td><a href="#/employees/${s.employeeId}" class="person" style="color:inherit">${avatar(s.employeeName, 26)}<span class="nm">${esc(s.employeeName)}</span></a></td>
        <td>${esc(s.siteName)}</td><td class="nowrap">${fmtTime(s.checkIn)}</td>
        <td class="nowrap">${s.checkOut ? fmtTime(s.checkOut) : pill('Open', 'green', true)}</td>
        <td class="num"><b>${fmtMins(sessionMinutes(s))}</b></td>
        <td class="small nowrap">${fmtDist(s.inDistance)}${s.outDistance != null ? ` / ${fmtDist(s.outDistance)}` : ''}</td>
        <td>${sessionFlagged(s) ? `<span class="pill red" title="${esc(flagText(s))}">${esc(flagText(s))}</span>` : pill('OK', 'green')}</td>
        <td class="right nowrap">${!s.checkOut ? `<button class="btn sm ghost" data-close="${s.id}">Close</button>` : ''}
          ${isAdmin() ? `<button class="btn sm ghost icon" data-del="${s.id}">${icon('trash', 14)}</button>` : ''}</td></tr>`).join('')
        : `<tr><td colspan="9"><div class="empty">${rows ? 'No check-ins for these filters' : 'Loading…'}</div></td></tr>`}
    </table></div></div>`;

    el.querySelector('#a-from').onchange = (e) => { from = e.target.value; load(); };
    el.querySelector('#a-to').onchange = (e) => { to = e.target.value; load(); };
    el.querySelector('#a-emp').onchange = (e) => { emp = e.target.value; draw(); };
    el.querySelector('#a-site').onchange = (e) => { site = e.target.value; draw(); };
    el.querySelector('#a-flag').onchange = (e) => { onlyFlagged = e.target.checked; draw(); };
    el.querySelectorAll('[data-r]').forEach((c) => {
      c.onclick = () => {
        const t = new Date();
        if (c.dataset.r === 'today') { from = to = dateKey(t); }
        if (c.dataset.r === '7') { from = dateKey(addDays(t, -6)); to = dateKey(t); }
        if (c.dataset.r === 'month') { from = dateKey(startOfMonth(t)); to = dateKey(t); }
        if (c.dataset.r === 'last') { const s = new Date(t.getFullYear(), t.getMonth() - 1, 1); from = dateKey(s); to = dateKey(new Date(t.getFullYear(), t.getMonth(), 0)); }
        load();
      };
    });
    el.querySelectorAll('[data-close]').forEach((b) => {
      b.onclick = async () => {
        const s = rows.find((x) => x.id === b.dataset.close);
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
  }

  load();
  return () => {};
}
