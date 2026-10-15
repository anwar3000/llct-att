import { store, schedulesForDate, sessionsInRange, addSchedule, deleteSchedule, isoWeekday, sessionMinutes } from '../fb.js';
import { esc, icon, avatar, pill, fmtMins, dateKey, parseKey, addDays, fmtDay, toast, modal, confirmBox, friendlyError } from '../util.js';

export function mount(el, _p, { setHeader }) {
  let day = new Date();
  let schedules = null, sessions = [];
  setHeader('Schedule', 'Assign one or more sites to staff for each day',
    `<button class="btn" id="sc-new">${icon('plus', 16)} Assign sites</button>`);
  document.getElementById('sc-new').onclick = () => assign(day, load);

  async function load() {
    schedules = null; draw();
    const k = dateKey(day);
    [schedules, sessions] = await Promise.all([schedulesForDate(k), sessionsInRange(k, k)]);
    draw();
  }

  function draw() {
    const k = dateKey(day);
    const isToday = k === dateKey(new Date());
    const byEmp = new Map();
    for (const s of schedules || []) {
      if (!byEmp.has(s.employeeId)) byEmp.set(s.employeeId, { name: s.employeeName, items: [] });
      byEmp.get(s.employeeId).items.push(s);
    }
    const unscheduled = store.activeEmployees.filter((u) => !byEmp.has(u.id));
    el.innerHTML = `
    <div class="row" style="margin-bottom:14px">
      <button class="btn ghost sm" id="d-prev">‹</button>
      <input type="date" id="d-pick" value="${k}" class="inline-input">
      <button class="btn ghost sm" id="d-next">›</button>
      <button class="btn ghost sm" id="d-today" ${isToday ? 'disabled' : ''}>Today</button>
      <b style="margin-left:6px">${fmtDay(day)}</b>
    </div>
    <div class="grid cols-2-1">
      <div class="card"><div class="card-head"><h2>Assignments</h2><span class="muted small">${schedules ? `${schedules.length} site visits` : 'Loading…'}</span></div>
        ${schedules && byEmp.size ? [...byEmp.entries()].map(([eid, v]) => `
          <div style="border-bottom:1px solid var(--line);padding:12px 18px">
            <div class="row">${avatar(v.name, 30)}<b>${esc(v.name)}</b><span class="muted small">${v.items.length} site${v.items.length === 1 ? '' : 's'}</span></div>
            ${v.items.map((s) => {
              const visits = sessions.filter((x) => x.employeeId === eid && x.siteId === s.siteId);
              const now = visits.some((x) => !x.checkOut);
              const mins = visits.reduce((a, x) => a + sessionMinutes(x), 0);
              return `<div class="row" style="margin:8px 0 0 42px">
                <div class="grow" style="flex:1"><b>${esc(s.siteName)}</b> <span class="muted small">${esc(s.startTime || s.endTime ? `${s.startTime}–${s.endTime}` : 'any time')}${s.note ? ` · ${esc(s.note)}` : ''}</span></div>
                ${now ? pill('On site', 'green', true) : visits.length ? pill(`Visited · ${fmtMins(mins)}`, 'teal') : pill('Pending', 'gray')}
                <button class="btn sm ghost icon" data-del="${s.id}" title="Remove">${icon('trash', 14)}</button></div>`;
            }).join('')}
          </div>`).join('') : `<div class="empty">${schedules ? '<b>Nothing scheduled</b>Click “Assign sites”.' : 'Loading…'}</div>`}
      </div>
      <div class="card"><div class="card-head"><h2>Not scheduled</h2><span class="muted small">${unscheduled.length}</span></div>
        ${unscheduled.map((u) => `<div class="list-item">${avatar(u.name, 28)}<div class="grow">${esc(u.name)}</div>
          ${u.weeklyOffDays.includes(isoWeekday(day)) ? pill('Weekly off', 'amber') : ''}</div>`).join('') || '<div class="empty">Everyone has an assignment</div>'}
      </div>
    </div>`;
    const go = (d) => { day = d; load(); };
    el.querySelector('#d-prev').onclick = () => go(addDays(day, -1));
    el.querySelector('#d-next').onclick = () => go(addDays(day, 1));
    el.querySelector('#d-today').onclick = () => go(new Date());
    el.querySelector('#d-pick').onchange = (e) => { if (e.target.value) go(parseKey(e.target.value)); };
    el.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!await confirmBox('Remove assignment?', 'Remove this site from the schedule?', { ok: 'Remove' })) return;
        await deleteSchedule(b.dataset.del); toast('Removed'); load();
      };
    });
  }

  load();
  return () => {};
}

export function assign(initialDay, onDone) {
  const emps = store.activeEmployees;
  const sites = store.sites.filter((s) => s.active);
  if (!emps.length || !sites.length) { toast('Add at least one employee and one active site first.', true); return; }
  const selE = new Set(), selS = new Set();
  modal({
    title: 'Assign sites',
    wide: true,
    body: `<p class="muted" style="margin-top:0">Pick one or more employees and one or more sites. Each employee gets every selected site.</p>
      <label class="f"><span>Employees</span></label><div class="chips" id="as-e">${emps.map((u) => `<span class="chip" data-e="${u.id}">${esc(u.name)}</span>`).join('')}</div>
      <label class="f mt"><span>Sites</span></label><div class="chips" id="as-s">${sites.map((s) => `<span class="chip" data-s="${s.id}">${esc(s.name)}</span>`).join('')}</div>
      <div class="fields mt">
        <label class="f"><span>Start date</span><input type="date" id="as-d" value="${dateKey(initialDay)}"></label>
        <label class="f"><span>Repeat for</span><select id="as-r">${[1, 2, 3, 5, 6, 7, 14, 30].map((n) => `<option value="${n}">${n} day${n === 1 ? '' : 's'}</option>`).join('')}</select></label>
        <label class="f"><span>Start time (optional)</span><input type="time" id="as-st"></label>
        <label class="f"><span>End time (optional)</span><input type="time" id="as-et"></label>
        <label class="f full"><span>Instructions (optional)</span><input id="as-n"></label>
        <label class="f full row" style="gap:8px"><input type="checkbox" id="as-skip" checked> Skip each employee's weekly off day when repeating</label>
      </div><div class="error" id="as-err"></div>`,
    foot: '<button class="btn ghost" data-cancel>Cancel</button><button class="btn" data-save>Assign</button>',
    onMount: (m, close) => {
      m.querySelectorAll('[data-e]').forEach((c) => { c.onclick = () => { c.classList.toggle('on'); selE.has(c.dataset.e) ? selE.delete(c.dataset.e) : selE.add(c.dataset.e); }; });
      m.querySelectorAll('[data-s]').forEach((c) => { c.onclick = () => { c.classList.toggle('on'); selS.has(c.dataset.s) ? selS.delete(c.dataset.s) : selS.add(c.dataset.s); }; });
      m.querySelector('[data-cancel]').onclick = close;
      m.querySelector('[data-save]').onclick = async () => {
        const err = m.querySelector('#as-err');
        if (!selE.size || !selS.size) { err.textContent = 'Choose at least one employee and one site.'; return; }
        const start = parseKey(m.querySelector('#as-d').value || dateKey(new Date()));
        const rep = Number(m.querySelector('#as-r').value);
        const skip = m.querySelector('#as-skip').checked;
        const st = m.querySelector('#as-st').value, et = m.querySelector('#as-et').value, note = m.querySelector('#as-n').value.trim();
        const btn = m.querySelector('[data-save]'); btn.disabled = true; btn.textContent = 'Saving…';
        let n = 0;
        try {
          for (let i = 0; i < rep; i++) {
            const d = addDays(start, i);
            for (const e of emps.filter((x) => selE.has(x.id))) {
              if (skip && rep > 1 && e.weeklyOffDays.includes(isoWeekday(d))) continue;
              for (const s of sites.filter((x) => selS.has(x.id))) { await addSchedule(e, s, d, st, et, note); n++; }
            }
          }
          close(); toast(`Added ${n} assignment${n === 1 ? '' : 's'}`); if (onDone) onDone();
        } catch (e) { err.textContent = friendlyError(e); btn.disabled = false; btn.textContent = 'Assign'; }
      };
    },
  });
}
