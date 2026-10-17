import { store, isAdmin, saveSettings } from '../fb.js';
import { esc, icon, dateKey, startOfMonth, toast, friendlyError, monthKey, parseKey, modal } from '../util.js';
import {
  monthlySummaryReport, dailyMatrixReport, attendanceLogReport, pettyReport, updatesReport, projectReport, alertsReport,
  projectsOverviewReport, downloadReport, filterReport, keywordTerms, workerAttendanceReport, workerRegisterReport, workforceBySiteReport, siteWorkforceReport, workerPayReport,
} from '../report-lib.js';

const REPORTS = [
  { id: 'summary', name: 'Monthly attendance summary', desc: 'One row per employee: days worked, off days, absences, total hours, average start time, flagged check-ins.', inputs: ['month'], tags: 'attendance hours payroll monthly employee' },
  { id: 'matrix', name: 'Daily attendance register', desc: 'Payroll-style grid — employees × days of the month with hours, OFF and A (absent).', inputs: ['month'], tags: 'attendance register payroll muster daily absent off' },
  { id: 'log', name: 'Attendance log (detailed)', desc: 'Every check-in / check-out with times, duration, GPS distance and location coordinates.', inputs: ['range', 'employee', 'site'], tags: 'attendance check in out gps location log detailed' },
  { id: 'workerpay', name: 'External workers — days & pay', desc: 'Per worker for any period: days worked, full and short days (below the minimum hours), total hours — plus daily rate and amount for admins. Includes an attendance sheet with short days marked.', inputs: ['range', 'company'], tags: 'external workers labour days pay salary rate invoice timesheet short minimum hours' },
  { id: 'workforce', name: 'Workforce by site (staff + external)', desc: 'Per site: staff and external worker headcount and man-hours, consolidated, plus everyone’s days and hours.', inputs: ['range'], tags: 'workforce manpower man-hours site staff external labour consolidated' },
  { id: 'siteworkforce', name: 'Site workforce', desc: 'Everyone who worked at one site — staff and external workers — with days, hours and a daily log.', inputs: ['range', 'site1'], tags: 'site workforce manpower staff external labour' },
  { id: 'workers', name: 'External workers attendance', desc: 'Per worker: days and hours on site, plus every entry with date, site, time in/out and the employee who added them.', inputs: ['range', 'worker', 'site'], tags: 'external workers labour manpower hours timesheet' },
  { id: 'wregister', name: 'External workers register', desc: 'Workers × days of the month with hours on site — for labour supplier invoices.', inputs: ['month'], tags: 'external workers labour register timesheet monthly invoice' },
  { id: 'alerts', name: 'Geofence alerts', desc: 'Times staff left their site while still checked in (checked hourly), with GPS position.', inputs: ['range', 'employee'], tags: 'alerts geofence left site gps flag' },
  { id: 'updates', name: 'Site updates', desc: 'Progress notes, issues and material requests submitted from sites.', inputs: ['range', 'site'], tags: 'site updates progress issue material safety notes photos' },
  { id: 'project', name: 'Project report', desc: 'Summary, sites, team effort, attendance and updates for one project (plus expenses for admins).', inputs: ['project'], tags: 'project sites team man-hours progress' },
  { id: 'projects', name: 'Projects overview', desc: 'All projects with status, progress, dates and man-hours.', inputs: [], tags: 'projects overview status progress' },
  { id: 'petty', name: 'Petty cash statement', desc: 'Balances per employee and every transaction in the period.', inputs: ['range', 'employee'], admin: true, tags: 'petty cash accounts expenses fuel food travel balance' },
];

export function mount(el, _p, { setHeader }) {
  setHeader('Reports', 'Search by keywords, preview, then download Excel, PDF or CSV');
  const t = new Date();
  const defaults = { month: monthKey(t), from: dateKey(startOfMonth(t)), to: dateKey(t) };
  let query = '';

  const visible = () => REPORTS.filter((r) => !r.admin || isAdmin());

  el.innerHTML = `
    ${isAdmin() ? `<div class="card card-pad row" style="margin-bottom:14px;gap:12px">
      <b>Minimum working hours per day</b>
      <input id="min-h" type="number" min="1" max="24" step="0.5" value="${store.settings.minDailyHours}" style="width:90px">
      <button class="btn sm" id="min-save">Save</button>
      <span class="small muted">Days below this are marked as <b style="color:#b23535">short</b> on attendance sheets and reports (staff and external workers).</span>
    </div>` : ''}
    <div class="card card-pad">
      <div class="searchbar">${icon('search', 18)}<input id="rq" placeholder="Search reports by keywords — employee, site, project, category, note…  (e.g. “Rahul fuel”, “Marina”, “absent”)"></div>
      <div class="small muted" style="margin-top:8px">All words must match (any column). The keywords filter the rows of whichever report you preview or download. Leave empty for the full report.</div>
    </div>
    <div class="grid cols-2 mt" id="rcards"></div>`;

  const cards = el.querySelector('#rcards');
  cards.innerHTML = visible().map((r) => `
    <div class="card card-pad" data-r="${r.id}">
      <div class="row" style="flex-wrap:nowrap;align-items:flex-start">
        <span style="background:#D98A1A1f;color:#D98A1A;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;flex:none">${icon('report', 18)}</span>
        <div style="flex:1"><h2>${esc(r.name)}</h2><div class="muted small">${esc(r.desc)}</div></div></div>
      <div class="filters" style="margin-top:14px">
        ${r.inputs.includes('month') ? `<label class="f"><span>Month</span><input type="month" data-k="month" value="${defaults.month}"></label>` : ''}
        ${r.inputs.includes('range') ? `<label class="f"><span>From</span><input type="date" data-k="from" value="${defaults.from}"></label>
          <label class="f"><span>To</span><input type="date" data-k="to" value="${defaults.to}"></label>` : ''}
        ${r.inputs.includes('employee') ? `<label class="f"><span>Employee</span><select data-k="employee"><option value="">All</option>${store.employees.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>` : ''}
        ${r.inputs.includes('company') ? `<label class="f"><span>Company / agency</span><select data-k="company"><option value="">All</option>${[...new Set(store.workers.map((w) => w.company).filter(Boolean))].sort().map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>` : ''}
        ${r.inputs.includes('site1') ? `<label class="f"><span>Site</span><select data-k="site1">${store.sites.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('') || '<option value="">No sites</option>'}</select></label>` : ''}
        ${r.inputs.includes('worker') ? `<label class="f"><span>Worker</span><select data-k="worker"><option value="">All</option>${store.workers.map((w) => `<option value="${w.id}">${esc(w.name)}${w.company ? ` (${esc(w.company)})` : ''}</option>`).join('')}</select></label>` : ''}
        ${r.inputs.includes('site') ? `<label class="f"><span>Site</span><select data-k="site"><option value="">All</option>${store.sites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>` : ''}
        ${r.inputs.includes('project') ? `<label class="f"><span>Project</span><select data-k="project">${store.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('') || '<option value="">No projects yet</option>'}</select></label>` : ''}
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn ghost" data-act="preview">${icon('report', 16)} Preview</button>
        <span class="spacer"></span>
        <button class="btn" data-act="xlsx">${icon('download', 16)} Excel</button>
        <button class="btn ghost" data-act="pdf">PDF</button>
        <button class="btn ghost" data-act="csv">CSV</button>
      </div>
    </div>`).join('');

  el.querySelector('#min-save')?.addEventListener('click', async () => {
    const v = Number(el.querySelector('#min-h').value);
    if (!(v > 0 && v <= 24)) { toast('Enter hours between 1 and 24', true); return; }
    try { await saveSettings({ minDailyHours: v }); toast(`Minimum set to ${v} h per day`); } catch (e) { toast(friendlyError(e), true); }
  });
  const rq = el.querySelector('#rq');
  rq.oninput = () => { query = rq.value; };

  cards.querySelectorAll('[data-r]').forEach((card) => {
    const id = card.dataset.r;
    const val = (k) => card.querySelector(`[data-k="${k}"]`)?.value || '';
    const build = async () => {
      if (id === 'summary') return monthlySummaryReport(parseKey(`${val('month')}-01`));
      if (id === 'matrix') return dailyMatrixReport(parseKey(`${val('month')}-01`));
      if (id === 'log') return attendanceLogReport(val('from'), val('to'), val('employee') || null, val('site') || null);
      if (id === 'workerpay') return workerPayReport(val('from'), val('to'), val('company'));
      if (id === 'workforce') return workforceBySiteReport(val('from'), val('to'));
      if (id === 'siteworkforce') { const st = store.site(val('site1')); if (!st) throw new Error('Choose a site.'); return siteWorkforceReport(st, val('from'), val('to')); }
      if (id === 'workers') return workerAttendanceReport(val('from'), val('to'), val('worker') || null, val('site') || null);
      if (id === 'wregister') return workerRegisterReport(parseKey(`${val('month')}-01`));
      if (id === 'alerts') return alertsReport(val('from'), val('to'), val('employee') || null);
      if (id === 'updates') return updatesReport(val('from'), val('to'), val('site') || null);
      if (id === 'petty') return pettyReport(val('from'), val('to'), val('employee') || null);
      if (id === 'projects') return projectsOverviewReport();
      const p = store.project(val('project'));
      if (!p) throw new Error('Create a project first.');
      return projectReport(p);
    };
    card.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = async () => {
        const label = b.innerHTML;
        b.disabled = true; b.textContent = 'Preparing…';
        try {
          const rep = await build();
          if (b.dataset.act === 'preview') preview(rep, query);
          else {
            const filtered = filterReport(rep, query);
            if (query.trim() && !filtered.sheets.some((s) => s.rows.length)) toast(`No rows match “${query.trim()}” — downloading empty report`, true);
            await downloadReport(filtered, b.dataset.act);
          }
        } catch (e) {
          console.error(e);
          toast(friendlyError(e), true);
        } finally { b.disabled = false; b.innerHTML = label; }
      };
    });
  });
  return () => {};
}

/** Interactive preview with live keyword search + highlighted matches. */
function preview(rep, initialQuery) {
  let q = initialQuery || '';
  let tab = 0;
  modal({
    title: rep.title,
    wide: true,
    body: `<div class="searchbar" style="margin-bottom:10px">${icon('search', 18)}<input id="pv-q" value="${esc(q)}" placeholder="Type keywords to filter rows…"></div>
      <div class="small muted" id="pv-info" style="margin-bottom:8px"></div>
      <div class="tabs" id="pv-tabs" style="margin-bottom:10px"></div>
      <div class="table-wrap" id="pv-table" style="max-height:52vh;overflow:auto;border:1px solid var(--line);border-radius:10px"></div>`,
    foot: `<span class="muted small" style="margin-right:auto">${esc(rep.subtitle || '')}</span>
      <button class="btn ghost" data-f="csv">CSV</button><button class="btn ghost" data-f="pdf">PDF</button><button class="btn" data-f="xlsx">${icon('download', 16)} Excel</button>`,
    onMount: (m) => {
      const input = m.querySelector('#pv-q');
      const draw = () => {
        const f = filterReport(rep, q);
        const terms = keywordTerms(q);
        if (tab >= f.sheets.length) tab = 0;
        m.querySelector('#pv-tabs').innerHTML = f.sheets.length > 1 ? f.sheets.map((s, i) =>
          `<a href="javascript:void 0" data-t="${i}" class="${i === tab ? 'on' : ''}">${esc(s.name)} (${s.rows.length})</a>`).join('') : '';
        m.querySelectorAll('[data-t]').forEach((a) => { a.onclick = () => { tab = Number(a.dataset.t); draw(); }; });
        const sh = f.sheets[tab];
        const total = rep.sheets[tab].rows.length;
        m.querySelector('#pv-info').innerHTML = terms.length
          ? `<b>${sh.rows.length}</b> of ${total} rows match <b>“${esc(q.trim())}”</b>`
          : `${total} rows`;
        const hl = (v) => {
          let s = esc(v == null ? '' : v);
          for (const t of terms) s = s.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
          return s;
        };
        const shown = sh.rows.slice(0, 500);
        m.querySelector('#pv-table').innerHTML = `<table class="t"><thead><tr>${sh.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${shown.map((r) => `<tr>${r.map((c) => `<td class="${typeof c === 'number' ? 'num' : ''}">${hl(c)}</td>`).join('')}</tr>`).join('')
          || `<tr><td colspan="${sh.columns.length}"><div class="empty">No matching rows</div></td></tr>`}
          ${sh.totals && sh.rows.length ? `<tr>${sh.totals.map((c) => `<td class="${typeof c === 'number' ? 'num' : ''}"><b>${esc(c ?? '')}</b></td>`).join('')}</tr>` : ''}</tbody></table>
          ${sh.rows.length > 500 ? `<div class="small muted" style="padding:8px 12px">Showing first 500 of ${sh.rows.length} rows — downloads include all.</div>` : ''}`;
      };
      let timer;
      input.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { q = input.value; draw(); }, 150); };
      input.focus();
      m.querySelectorAll('[data-f]').forEach((b) => {
        b.onclick = async () => {
          try { await downloadReport(filterReport(rep, q), b.dataset.f); } catch (e) { toast(friendlyError(e), true); }
        };
      });
      draw();
    },
  });
}
