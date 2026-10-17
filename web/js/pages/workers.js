// External workers / labour: registration (with passport + Emirates ID copies), who is on site now,
// per-worker attendance, and ID downloads for customers.
import {
  store, saveWorker, deleteWorker, saveIdInfo, uploadIdFile, releaseWorkerLock, workerEntriesInRange,
  closeWorkerEntry, deleteWorkerEntry, isAdmin, addWorkersToSession, saveWorkerRate, isShortDay, minDayMins, entryMinutes,
} from '../fb.js';
import {
  esc, fromTz, icon, avatar, pill, fmtMins, fmtTime, fmtDay, fmtMonth, dateKey, monthKey, startOfMonth, endOfMonth,
  toast, modal, confirmBox, promptBox, friendlyError,
} from '../util.js';
import { docsPanel, ownerFromWorker, docsSummaryHtml, exportMenu, ownerExpiry, prepareFile, DOC_KINDS } from '../iddocs.js';
import { workerAttendanceReport, downloadReport } from '../report-lib.js';
import { editTimesDialog } from '../admin-edit.js';

export function mount(el, params, ctx) {
  if (params[0]) return detail(el, params[0], ctx);
  return list(el, ctx);
}

const norm = (s) => String(s || '').replace(/[\s-]/g, '').toLowerCase();

// ------------------------------------------------------------------ list
function list(el, { setHeader }) {
  setHeader('External workers', 'Labour registered by management — staff add them to their check-in',
    `<button class="btn ghost" id="w-ids">${icon('download', 16)} Download IDs</button>
     <button class="btn ghost" id="w-checkin">${icon('check', 16)} Check in workers</button>
     <button class="btn" id="w-new">${icon('plus', 16)} Register worker</button>`);
  document.getElementById('w-new').onclick = () => registerWorker();
  document.getElementById('w-checkin').onclick = () => checkInWorkers();
  let q = '', filter = 'active';
  const sel = new Set();
  document.getElementById('w-ids').onclick = () => {
    const chosen = (sel.size ? store.workers.filter((w) => sel.has(w.id)) : shown());
    exportMenu(chosen.map(ownerFromWorker), 'External workers IDs');
  };

  function shown() {
    const ql = q.toLowerCase();
    return store.workers.filter((w) => {
      if (filter === 'active' && !w.active) return false;
      if (filter === 'inactive' && w.active) return false;
      if (filter === 'onsite' && !store.workerLock(w.id)) return false;
      if (filter === 'byStaff' && !w.addedBy) return false;
      if (filter === 'expiry' && !['expired', 'soon'].includes(ownerExpiry(w.id).state)) return false;
      if (filter === 'missing' && ['passport', 'eid'].every((k) => store.files(w.id).some((f) => f.kind === k))) return false;
      if (!ql) return true;
      const i = store.info(w.id) || {};
      return [w.name, w.phone, w.company, w.trade, w.code, i.passportNo, i.eidNo, i.nationality].join(' ').toLowerCase().includes(ql);
    });
  }

  function draw() {
    const rows = shown();
    const locks = store.workerLocks;
    const cnt = (f) => store.workers.filter(f).length;
    el.innerHTML = `
    ${locks.length ? `<div class="card"><div class="card-head"><h2>On site now (${locks.length})</h2><span class="small muted">added by staff at check-in</span></div>
      ${locks.map((l) => `<div class="list-item">${avatar(store.worker(l.workerId)?.name || '?', 30)}
        <div class="grow"><b>${esc(store.worker(l.workerId)?.name || 'Removed worker')}</b>
        <div class="small muted">${esc(l.siteName)} · with ${esc(l.employeeName)} · since ${fmtTime(l.since)}${l.since && dateKey(l.since) !== dateKey(new Date()) ? ` (${fmtDay(l.since)})` : ''}</div></div>
        <button class="btn sm ghost" data-release="${l.workerId}" title="Use if the employee forgot to remove them">Release</button></div>`).join('')}</div>` : ''}
    <div class="row ${locks.length ? 'mt' : ''}" style="margin-bottom:12px">
      <input id="w-q" placeholder="Search name, phone, company, passport / EID no…" value="${esc(q)}" style="max-width:340px">
      <div class="chips">${[['active', `Active (${cnt((w) => w.active)})`], ['onsite', `On site (${locks.length})`],
        ['expiry', `Expiring / expired (${cnt((w) => ['expired', 'soon'].includes(ownerExpiry(w.id).state))})`],
        ['missing', 'Missing PP/EID'], ['byStaff', `Added by staff (${cnt((w) => w.addedBy)})`], ['inactive', `Inactive (${cnt((w) => !w.active)})`], ['all', 'All']]
        .map(([k, l]) => `<span class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l}</span>`).join('')}</div>
      <span class="spacer"></span>${sel.size ? `<span class="small"><b>${sel.size}</b> selected · <a href="javascript:void 0" id="w-clear">clear</a></span>` : ''}
    </div>
    <div class="card"><div class="table-wrap"><table class="t">
      <tr><th style="width:34px"><input type="checkbox" id="w-all" ${rows.length && rows.every((w) => sel.has(w.id)) ? 'checked' : ''}></th>
        <th>Worker</th><th>Company</th><th>Trade</th><th>Phone</th><th>Passport / Emirates ID</th><th>Copies</th>${isAdmin() ? '<th class="num">Daily rate</th>' : ''}<th>Today</th></tr>
      ${rows.length ? rows.map((w) => {
        const lk = store.workerLock(w.id);
        return `<tr class="click" data-id="${w.id}">
        <td><input type="checkbox" data-sel="${w.id}" ${sel.has(w.id) ? 'checked' : ''}></td>
        <td><div class="person">${avatar(w.name, 30)}<div><div class="nm">${esc(w.name)}</div><div class="small muted">${esc(w.code || '')}${w.active ? '' : ' · inactive'}</div>${w.addedBy ? `<span class="pill amber" title="Added from the app — please complete their documents">Added by ${esc(w.addedBy)}</span>` : ''}</div></div></td>
        <td>${esc(w.company)}</td><td>${esc(w.trade)}</td><td class="nowrap">${esc(w.phone)}</td>
        <td class="small mono">${(() => { const i = store.info(w.id) || {}; return `${esc(i.passportNo || '—')}<br>${esc(i.eidNo || '—')}`; })()}</td>
        <td>${docsSummaryHtml(w.id)}</td>
        ${isAdmin() ? `<td class="num nowrap">${store.rates[w.id] ? `AED ${store.rates[w.id]}` : '<span class="muted">—</span>'}</td>` : ''}
        <td>${lk ? `${pill('On site', 'green', true)}<div class="small muted">${esc(lk.siteName)}</div>` : '<span class="muted">—</span>'}</td></tr>`;
      }).join('') : `<tr><td colspan="9"><div class="empty">${store.workers.length ? 'No matching workers' : 'No external workers yet — click “Register worker”.'}</div></td></tr>`}
    </table></div></div>`;

    const qi = el.querySelector('#w-q');
    qi.oninput = (e) => { q = e.target.value; draw(); const n = el.querySelector('#w-q'); n.focus(); n.setSelectionRange(q.length, q.length); };
    el.querySelectorAll('[data-f]').forEach((c) => { c.onclick = () => { filter = c.dataset.f; draw(); }; });
    el.querySelectorAll('tr[data-id]').forEach((r) => {
      r.onclick = (e) => { if (e.target.closest('input')) return; location.hash = `#/workers/${r.dataset.id}`; };
    });
    el.querySelectorAll('[data-sel]').forEach((c) => { c.onchange = () => { if (c.checked) sel.add(c.dataset.sel); else sel.delete(c.dataset.sel); draw(); }; });
    el.querySelector('#w-all').onchange = (e) => { rows.forEach((w) => (e.target.checked ? sel.add(w.id) : sel.delete(w.id))); draw(); };
    el.querySelector('#w-clear')?.addEventListener('click', () => { sel.clear(); draw(); });
    el.querySelectorAll('[data-release]').forEach((b) => {
      b.onclick = async () => {
        const l = store.workerLock(b.dataset.release);
        const w = store.worker(l.workerId);
        if (!await confirmBox('Release worker?', `End ${w?.name || 'this worker'}'s time at ${l.siteName} now? Use this if ${l.employeeName} forgot to remove them.`, { ok: 'Release' })) return;
        try { await releaseWorkerLock(l); toast('Released'); } catch (e) { toast(friendlyError(e), true); }
      };
    });
  }
  draw();
  return store.on(() => { if (!el.querySelector('#w-q:focus')) draw(); });
}

// ------------------------------------------------------------------ check in workers with an employee
export function checkInWorkers(presetSessionId = '') {
  const sessions = [...store.open].sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  if (!sessions.length) { toast('Nobody is checked in right now. An employee must check in first.', true); return; }
  if (!store.workers.some((w) => w.active)) { toast('Register external workers first.', true); return; }
  const picked = new Set();
  let q = '';
  modal({
    title: 'Check in external workers',
    wide: true,
    body: `<label class="f"><span>With employee (checked in now)</span><select id="ci-s">${sessions.map((s) =>
      `<option value="${s.id}" ${s.id === presetSessionId ? 'selected' : ''}>${esc(s.employeeName)} — ${esc(s.siteName)} (since ${fmtTime(s.inLocal)})</option>`).join('')}</select></label>
      <input id="ci-q" placeholder="Search workers…" style="margin:4px 0 10px">
      <div id="ci-list" style="max-height:48vh;overflow:auto;border:1px solid var(--line);border-radius:10px"></div>
      <div class="small muted" style="margin-top:8px">Workers' hours follow this employee's check-in until removed or until the employee checks out. A worker can be on only one site at a time.</div>`,
    foot: `<span class="small" id="ci-n" style="margin-right:auto"></span><button class="btn ghost" data-cancel>Cancel</button><button class="btn" data-ok>Check in</button>`,
    onMount: (m, close) => {
      const sel = m.querySelector('#ci-s');
      const draw = () => {
        const sid = sel.value;
        const ql = q.toLowerCase();
        const ws = store.workers.filter((w) => w.active && (!ql || `${w.name} ${w.company} ${w.trade} ${w.phone}`.toLowerCase().includes(ql)));
        m.querySelector('#ci-list').innerHTML = ws.map((w) => {
          const lk = store.workerLock(w.id);
          const here = lk && lk.sessionId === sid;
          const busy = lk && !here;
          return `<label class="list-item" style="cursor:${busy || here ? 'default' : 'pointer'};margin:0">
            <input type="checkbox" data-w="${w.id}" ${here || picked.has(w.id) ? 'checked' : ''} ${busy || here ? 'disabled' : ''}>
            ${avatar(w.name, 28)}<div class="grow"><b>${esc(w.name)}</b> <span class="small muted">${esc([w.company, w.trade].filter(Boolean).join(' · '))}</span>
            ${busy ? `<div class="small" style="color:#D64545">With ${esc(lk.employeeName)} at ${esc(lk.siteName)}</div>` : here ? '<div class="small" style="color:#2E9E6A">Already on this check-in</div>' : ''}</div></label>`;
        }).join('') || '<div class="empty">No workers match</div>';
        m.querySelectorAll('[data-w]').forEach((c) => { c.onchange = () => { if (c.checked) picked.add(c.dataset.w); else picked.delete(c.dataset.w); count(); }; });
        count();
      };
      const count = () => { m.querySelector('#ci-n').innerHTML = `<b>${picked.size}</b> selected`; };
      sel.onchange = () => { picked.clear(); draw(); };
      m.querySelector('#ci-q').oninput = (e) => { q = e.target.value; draw(); };
      m.querySelector('[data-cancel]').onclick = close;
      m.querySelector('[data-ok]').onclick = async (ev) => {
        if (!picked.size) { toast('Tick at least one worker', true); return; }
        const s = store.open.find((x) => x.id === sel.value);
        if (!s) { toast('That employee has checked out', true); return; }
        ev.currentTarget.disabled = true;
        try {
          const busy = await addWorkersToSession(s, store.workers.filter((w) => picked.has(w.id)));
          const n = picked.size - busy.length;
          if (busy.length) toast(`Not added — ${busy.join('; ')}`, true);
          if (n) toast(`${n} worker${n === 1 ? '' : 's'} checked in with ${s.employeeName}`);
          close();
        } catch (e) { toast(friendlyError(e), true); ev.currentTarget.disabled = false; }
      };
      draw();
    },
  });
}

// ------------------------------------------------------------------ register / edit
function duplicateOf(data, info, exceptId) {
  for (const w of store.workers) {
    if (w.id === exceptId) continue;
    const i = store.info(w.id) || {};
    if (data.phone && norm(w.phone) === norm(data.phone)) return `${w.name} already has phone ${w.phone}`;
    if (info.passportNo && norm(i.passportNo) === norm(info.passportNo)) return `${w.name} already has passport ${i.passportNo}`;
    if (info.eidNo && norm(i.eidNo) === norm(info.eidNo)) return `${w.name} already has Emirates ID ${i.eidNo}`;
    if (data.code && norm(w.code) === norm(data.code)) return `${w.name} already uses code ${w.code}`;
  }
  return '';
}

export function registerWorker(w = null) {
  const editing = !!w;
  const i = (w && store.info(w.id)) || {};
  modal({
    title: editing ? `Edit ${w.name}` : 'Register external worker',
    wide: true,
    body: `<form id="wf"><div class="fields">
      <label class="f"><span>Full name (as on passport) *</span><input name="name" required value="${esc(w?.name)}"></label>
      <label class="f"><span>Phone *</span><input name="phone" required value="${esc(w?.phone)}" placeholder="+971 5x xxx xxxx"></label>
      <label class="f"><span>Company / agency</span><input name="company" value="${esc(w?.company)}" list="w-companies"></label>
      <label class="f"><span>Trade</span><input name="trade" value="${esc(w?.trade)}" list="w-trades" placeholder="Helper, Mason, Electrician…"></label>
      <label class="f"><span>Worker code (optional)</span><input name="code" value="${esc(w?.code)}"></label>
      <label class="f"><span>Nationality</span><input name="nationality" value="${esc(i.nationality || w?.nationality || '')}"></label>
      ${isAdmin() ? `<label class="f"><span>Daily rate (AED) — admin only</span><input name="rate" type="number" min="0" step="0.01" value="${w ? (store.rates[w.id] ?? '') : ''}" placeholder="e.g. 120"></label>` : ''}
      ${editing ? `<label class="f row full" style="gap:8px"><input type="checkbox" name="active" ${w.active ? 'checked' : ''}> Active — can be selected at check-in</label>` : ''}
      <div class="full reg-docs-head"><h3>ID documents <span class="muted small" style="font-weight:500">— optional, can be added later</span></h3></div>
      ${DOC_KINDS.filter((k) => k.num).map((k) => `<div class="full reg-doc">
        <div class="reg-doc-title">${esc(k.label)}</div>
        <label class="f"><span>Number</span><input name="${k.num}" value="${esc(i[k.num] || '')}"></label>
        <label class="f"><span>Expiry</span><input name="${k.exp}" type="date" value="${esc(i[k.exp] || '')}"></label>
        ${editing ? '' : `<label class="f"><span>Copy (photo / PDF, max 2 MB)</span><input name="file_${k.k}" type="file" accept="image/*,application/pdf" multiple></label>`}
      </div>`).join('')}
      ${editing ? '<div class="full small muted">Upload or replace copies on the worker’s page.</div>' : ''}
    </div>
    <datalist id="w-companies">${[...new Set(store.workers.map((x) => x.company).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="w-trades">${[...new Set(['Helper', 'Mason', 'Carpenter', 'Electrician', 'Plumber', 'Painter', 'Steel fixer', 'Welder', 'Driver', 'Foreman',
      ...store.workers.map((x) => x.trade)].filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="error" id="wf-err"></div></form>`,
    foot: `${editing && isAdmin() ? `<button class="btn danger" data-del style="margin-right:auto">${icon('trash', 16)} Delete</button>` : ''}
      <button class="btn ghost" data-cancel>Cancel</button><button class="btn" data-save>${editing ? 'Save' : 'Register'}</button>`,
    onMount: (m, close) => {
      const f = m.querySelector('#wf');
      const err = m.querySelector('#wf-err');
      m.querySelector('[data-cancel]').onclick = close;
      m.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!await confirmBox('Delete worker?', `Delete ${w.name}? Past attendance stays in reports. Tip: untick “Active” instead to hide them.`, { ok: 'Delete', danger: true })) return;
        await deleteWorker(w.id); close(); location.hash = '#/workers'; toast('Deleted');
      });
      m.querySelector('[data-save]').onclick = async () => {
        const btn = m.querySelector('[data-save]');
        const data = {
          name: f.name.value.trim(), phone: f.phone.value.trim(), company: f.company.value.trim(), trade: f.trade.value.trim(),
          code: f.code.value.trim(), nationality: f.nationality.value.trim(),
        };
        const info = { nationality: data.nationality };
        DOC_KINDS.filter((k) => k.num).forEach((k) => { info[k.num] = f[k.num].value.trim(); info[k.exp] = f[k.exp].value; });
        if (!data.name) { err.textContent = 'Name is required.'; return; }
        if (!data.phone) { err.textContent = 'Phone number is required.'; return; }
        const dup = duplicateOf(data, info, w?.id);
        if (dup) { err.textContent = `Already registered: ${dup}.`; return; }
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          if (editing) data.active = f.active.checked;
          const id = await saveWorker(w?.id, data);
          if (isAdmin() && f.rate && f.rate.value !== '' && Number(f.rate.value) !== (store.rates[id] ?? null)) await saveWorkerRate(id, Number(f.rate.value));
          await saveIdInfo(id, 'worker', { ...info, name: data.name });
          if (!editing) {
            for (const k of DOC_KINDS.filter((x) => x.num)) {
              for (const file of f[`file_${k.k}`].files) {
                btn.textContent = `Uploading ${file.name}…`;
                const p = await prepareFile(file);
                await uploadIdFile({ ownerId: id, ownerType: 'worker', ownerName: data.name, kind: k.k, ...p });
              }
            }
          }
          toast(editing ? 'Saved' : `${data.name} registered`);
          close();
          if (!editing) location.hash = `#/workers/${id}`;
        } catch (e) { err.textContent = friendlyError(e); btn.disabled = false; btn.textContent = editing ? 'Save' : 'Register'; }
      };
    },
  });
}

// ------------------------------------------------------------------ detail
function detail(el, id, { setHeader }) {
  let month = startOfMonth(new Date());
  let entries = null;
  let token = 0;
  let docsCleanup = null;
  let built = false;

  async function load() {
    const t = ++token;
    entries = null; drawEntries();
    const all = await workerEntriesInRange(dateKey(month), dateKey(endOfMonth(month)));
    if (t !== token) return;
    entries = all.filter((e) => e.workerId === id);
    drawEntries();
  }

  function build() {
    const w = store.worker(id);
    if (!w) { el.innerHTML = store.loaded ? '<div class="card empty"><b>Worker not found</b></div>' : ''; return; }
    built = true;
    header(w);
    el.innerHTML = `
      <div class="card"><div class="card-head"><h2>ID documents</h2><span class="small muted">Passport · Emirates ID · SIRA · visa · labour card</span></div>
        <div class="card-pad" id="wd-docs"></div></div>
      <div class="card mt"><div class="card-head"><h2>Attendance</h2>
        <div class="row"><button class="btn ghost sm" id="m-prev">‹</button><b id="m-lbl" style="min-width:120px;text-align:center"></b>
        <button class="btn ghost sm" id="m-next">›</button><button class="btn ghost sm" id="wd-xlsx">${icon('download', 14)} Excel</button></div></div>
        <div id="wd-att"></div></div>`;
    docsCleanup = docsPanel(el.querySelector('#wd-docs'), ownerFromWorker(w));
    el.querySelector('#m-prev').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); load(); };
    el.querySelector('#m-next').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); load(); };
    el.querySelector('#wd-xlsx').onclick = async () => {
      try { await downloadReport(await workerAttendanceReport(dateKey(month), dateKey(endOfMonth(month)), id), 'xlsx'); } catch (e) { toast(friendlyError(e), true); }
    };
    load();
  }

  function header(w) {
    const lk = store.workerLock(id);
    setHeader(w.name, [w.company, w.trade, w.phone, w.code].filter(Boolean).map(esc).join(' · ') +
      (lk ? ` · <span class="pill green"><i class="dot"></i>On site: ${esc(lk.siteName)} with ${esc(lk.employeeName)}</span>` : '') +
      (w.active ? '' : ' · <b style="color:#D64545">inactive</b>'),
      `<a class="btn ghost" href="#/workers">← All workers</a>
       <button class="btn ghost" id="wd-ids">${icon('download', 16)} Download IDs</button>
       <button class="btn" id="wd-edit">${icon('edit', 16)} Edit</button>`);
    document.getElementById('wd-edit').onclick = () => registerWorker(store.worker(id));
    document.getElementById('wd-ids').onclick = () => exportMenu([ownerFromWorker(store.worker(id))], `${w.name} IDs`);
  }

  function drawEntries() {
    const box = el.querySelector('#wd-att');
    if (!box) return;
    el.querySelector('#m-lbl').textContent = fmtMonth(month);
    el.querySelector('#m-next').disabled = monthKey(month) >= monthKey(new Date());
    const list = entries || [];
    const mins = list.reduce((a, e) => a + Math.max(0, Math.round(((e.checkOut || new Date()) - e.checkIn) / 60000)), 0);
    const days = new Set(list.map((e) => e.date)).size;
    const dayTot = new Map();
    list.forEach((e) => dayTot.set(e.date, (dayTot.get(e.date) || 0) + entryMinutes(e)));
    const shortDays = [...dayTot].filter(([d, m]) => isShortDay(d, m, list.some((e) => e.date === d && e.open))).map(([d]) => d);
    const rate = store.rates[id];
    box.innerHTML = `<div class="row card-pad" style="gap:18px;padding-top:0"><span><b>${days}</b> days</span>
      <span style="color:${shortDays.length ? '#b23535' : 'inherit'}"><b>${shortDays.length}</b> short (&lt; ${minDayMins() / 60} h)</span><span><b>${fmtMins(mins)}</b> total</span>
      ${isAdmin() && rate ? `<span>Rate <b>AED ${rate}</b>/day · <b>AED ${Math.round(rate * days * 100) / 100}</b> this month</span>` : ''}
      <span><b>${new Set(list.map((e) => e.siteId)).size}</b> sites</span></div>
      <div class="table-wrap"><table class="t"><tr><th>Date</th><th>Site</th><th>Added by</th><th>In</th><th>Out</th><th class="num">Hours</th><th></th></tr>
      ${list.length ? [...list].reverse().map((e) => `<tr class="${shortDays.includes(e.date) ? 'short-day' : ''}"><td class="nowrap">${fmtDay(e.inLocal)}${shortDays.includes(e.date) ? ` <span class="pill red" title="Day total ${fmtMins(dayTot.get(e.date))} — below ${minDayMins() / 60} h">Short day</span>` : ''}</td><td><b>${esc(e.siteName)}</b></td>
        <td>${esc(e.employeeName)}</td><td>${fmtTime(e.inLocal)}</td><td>${e.checkOut ? fmtTime(e.outLocal) : pill('On site', 'green', true)}</td>
        <td class="num"><b>${fmtMins(Math.round(((e.checkOut || new Date()) - e.checkIn) / 60000))}</b></td>
        <td class="right nowrap">${e.open ? `<button class="btn sm ghost" data-close="${e.id}">End</button>` : ''}
          ${isAdmin() ? `<button class="btn sm ghost icon" data-edit-e="${e.id}" title="Edit times">${icon('edit', 14)}</button>` : ''}
          <button class="btn sm ghost icon" data-del="${e.id}" title="Delete">${icon('trash', 14)}</button></td></tr>`).join('')
        : `<tr><td colspan="7"><div class="empty">${entries ? 'No attendance this month' : 'Loading…'}</div></td></tr>`}
      </table></div>`;
    box.querySelectorAll('[data-close]').forEach((b) => {
      b.onclick = async () => {
        const e = entries.find((x) => x.id === b.dataset.close);
        const t = await promptBox('End time', `Time ${store.worker(id)?.name || 'worker'} left on ${fmtDay(e.inLocal)}`, { ok: 'Save', value: '18:00', type: 'time' });
        if (!t) return;
        const [h, mi] = t.split(':').map(Number);
        const at = fromTz(new Date(e.inLocal.getFullYear(), e.inLocal.getMonth(), e.inLocal.getDate(), h, mi), e.tz);
        if (at <= e.checkIn) return toast('End must be after start', true);
        try { await closeWorkerEntry(e, at, 'ended by management'); toast('Saved'); load(); } catch (er) { toast(friendlyError(er), true); }
      };
    });
    box.querySelectorAll('[data-edit-e]').forEach((b) => { b.onclick = () => editTimesDialog(entries.find((x) => x.id === b.dataset.editE), load, { worker: true }); });
    box.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!await confirmBox('Delete entry?', 'Delete this attendance entry?', { ok: 'Delete', danger: true })) return;
        try {
          const e = entries.find((x) => x.id === b.dataset.del);
          if (e.open) await closeWorkerEntry(e, new Date());
          await deleteWorkerEntry(e.id); toast('Deleted'); load();
        } catch (er) { toast(friendlyError(er), true); }
      };
    });
  }

  build();
  const off = store.on(() => {
    if (!built) build();
    else if (store.worker(id)) header(store.worker(id));
  });
  return () => { off(); if (docsCleanup) docsCleanup(); token++; };
}

