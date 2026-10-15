import { store, isAdmin } from '../fb.js';
import { esc, icon, dateKey, startOfMonth, toast, friendlyError, monthKey, parseKey } from '../util.js';
import {
  monthlySummaryReport, dailyMatrixReport, attendanceLogReport, pettyReport, updatesReport, projectReport, alertsReport,
  projectsOverviewReport, downloadReport,
} from '../report-lib.js';

const REPORTS = [
  { id: 'summary', name: 'Monthly attendance summary', desc: 'One row per employee: days worked, off days, absences, total hours, average start time, flagged check-ins.', inputs: ['month'] },
  { id: 'matrix', name: 'Daily attendance register', desc: 'Payroll-style grid — employees × days of the month with hours, OFF and A (absent).', inputs: ['month'] },
  { id: 'log', name: 'Attendance log (detailed)', desc: 'Every check-in / check-out with times, duration, GPS distance and location coordinates.', inputs: ['range', 'employee', 'site'] },
  { id: 'alerts', name: 'Geofence alerts', desc: 'Times staff left their site while still checked in (checked hourly), with GPS position.', inputs: ['range', 'employee'] },
  { id: 'updates', name: 'Site updates', desc: 'Progress notes, issues and material requests submitted from sites.', inputs: ['range', 'site'] },
  { id: 'project', name: 'Project report', desc: 'Summary, sites, team effort, attendance and updates for one project' + ' (plus expenses for admins).', inputs: ['project'] },
  { id: 'projects', name: 'Projects overview', desc: 'All projects with status, progress, dates and man-hours.', inputs: [] },
  { id: 'petty', name: 'Petty cash statement', desc: 'Balances per employee and every transaction in the period.', inputs: ['range', 'employee'], admin: true },
];

export function mount(el, _p, { setHeader }) {
  setHeader('Reports', 'Download Excel, PDF or CSV reports');
  const t = new Date();
  const state = {
    month: monthKey(t), from: dateKey(startOfMonth(t)), to: dateKey(t), employee: '', site: '', project: store.projects[0]?.id || '',
  };

  el.innerHTML = `<div class="grid cols-2">${REPORTS.filter((r) => !r.admin || isAdmin()).map((r) => `
    <div class="card card-pad" data-r="${r.id}">
      <div class="row"><span class="kpi"><span class="ico" style="background:#D98A1A1f;color:#D98A1A;width:34px;height:34px;border-radius:10px;display:grid;place-items:center">${icon('report', 18)}</span></span>
        <div style="flex:1"><h2>${esc(r.name)}</h2><div class="muted small">${esc(r.desc)}</div></div></div>
      <div class="filters" style="margin-top:14px">
        ${r.inputs.includes('month') ? `<label class="f"><span>Month</span><input type="month" data-k="month" value="${state.month}"></label>` : ''}
        ${r.inputs.includes('range') ? `<label class="f"><span>From</span><input type="date" data-k="from" value="${state.from}"></label>
          <label class="f"><span>To</span><input type="date" data-k="to" value="${state.to}"></label>` : ''}
        ${r.inputs.includes('employee') ? `<label class="f"><span>Employee</span><select data-k="employee"><option value="">All</option>${store.employees.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>` : ''}
        ${r.inputs.includes('site') ? `<label class="f"><span>Site</span><select data-k="site"><option value="">All</option>${store.sites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>` : ''}
        ${r.inputs.includes('project') ? `<label class="f"><span>Project</span><select data-k="project">${store.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('') || '<option value="">No projects yet</option>'}</select></label>` : ''}
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn" data-fmt="xlsx">${icon('download', 16)} Excel</button>
        <button class="btn ghost" data-fmt="pdf">PDF</button>
        <button class="btn ghost" data-fmt="csv">CSV</button>
      </div>
    </div>`).join('')}</div>`;

  el.querySelectorAll('[data-r]').forEach((card) => {
    const id = card.dataset.r;
    const val = (k) => card.querySelector(`[data-k="${k}"]`)?.value || '';
    card.querySelectorAll('[data-fmt]').forEach((b) => {
      b.onclick = async () => {
        const label = b.innerHTML;
        b.disabled = true; b.textContent = 'Preparing…';
        try {
          let rep;
          if (id === 'summary') rep = await monthlySummaryReport(parseKey(`${val('month')}-01`));
          if (id === 'matrix') rep = await dailyMatrixReport(parseKey(`${val('month')}-01`));
          if (id === 'log') rep = await attendanceLogReport(val('from'), val('to'), val('employee') || null, val('site') || null);
          if (id === 'alerts') rep = await alertsReport(val('from'), val('to'), val('employee') || null);
          if (id === 'updates') rep = await updatesReport(val('from'), val('to'), val('site') || null);
          if (id === 'petty') rep = await pettyReport(val('from'), val('to'), val('employee') || null);
          if (id === 'projects') rep = await projectsOverviewReport();
          if (id === 'project') {
            const p = store.project(val('project'));
            if (!p) throw new Error('Create a project first.');
            rep = await projectReport(p);
          }
          await downloadReport(rep, b.dataset.fmt);
        } catch (e) {
          console.error(e);
          toast(friendlyError(e), true);
        } finally { b.disabled = false; b.innerHTML = label; }
      };
    });
  });
  return () => {};
}
