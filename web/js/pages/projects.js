import { store, isAdmin, saveProject, deleteProject, sessionsForSites, updatesForSites, sessionMinutes } from '../fb.js';
import {
  esc, icon, pill, cap, fmtMoney, fmtMins, fmtDate, fmtDateTime, progressBar, toast, modal, confirmBox,
  friendlyError, parseKey, b64img, photoViewer, avatar,
} from '../util.js';
import { projectReport, downloadReport } from '../report-lib.js';

export const PROJECT_STATUSES = ['planned', 'active', 'on hold', 'completed'];
const STATUS_COLOR = { planned: 'blue', active: 'green', 'on hold': 'amber', completed: 'teal' };

export function mount(el, params, ctx) {
  if (params[0]) return detail(el, params[0], ctx);
  return list(el, ctx);
}

function projectProgress(p) {
  const sites = p.siteIds.map((id) => store.site(id)).filter(Boolean);
  return sites.length ? Math.round(sites.reduce((a, s) => a + s.progress, 0) / sites.length) : 0;
}

// ------------------------------------------------------------------ list
function list(el, { setHeader }) {
  setHeader('Projects', 'Define projects, link their sites and track progress, hours and spend',
    `<button class="btn" id="p-new">${icon('plus', 16)} New project</button>`);
  document.getElementById('p-new').onclick = () => editProject(null);
  let filter = 'all';

  function draw() {
    const all = store.projects;
    const ps = filter === 'all' ? all : all.filter((p) => p.status === filter);
    el.innerHTML = `
      <div class="chips" style="margin-bottom:14px">
        ${['all', ...PROJECT_STATUSES].map((s) => `<span class="chip ${filter === s ? 'on' : ''}" data-f="${s}">${cap(s)} (${s === 'all' ? all.length : all.filter((p) => p.status === s).length})</span>`).join('')}
      </div>
      ${ps.length ? `<div class="grid cols-3">${ps.map(card).join('')}</div>` : `
      <div class="card empty"><b>No projects yet</b>Create a project, then link the sites that belong to it.<br><br>
        <button class="btn" data-new>${icon('plus', 16)} New project</button></div>`}`;
    el.querySelectorAll('[data-f]').forEach((c) => { c.onclick = () => { filter = c.dataset.f; draw(); }; });
    el.querySelector('[data-new]')?.addEventListener('click', () => editProject(null));
  }

  function card(p) {
    const prog = projectProgress(p);
    const onSite = store.open.filter((s) => p.siteIds.includes(s.siteId)).length;
    const spent = store.petty.filter((t) => t.type !== 'credit' && t.status === 'approved' && p.siteIds.includes(t.siteId))
      .reduce((a, t) => a + t.amount, 0);
    const end = p.endDate ? parseKey(p.endDate) : null;
    const daysLeft = end ? Math.ceil((end - new Date()) / 86400000) : null;
    return `<a class="card card-pad" href="#/projects/${p.id}" style="color:inherit;display:block">
      <div class="row between"><div>${p.code ? `<span class="mono muted">${esc(p.code)}</span> ` : ''}<h2 style="display:inline">${esc(p.name)}</h2></div>
        ${pill(cap(p.status), STATUS_COLOR[p.status] || 'gray')}</div>
      <div class="muted small" style="margin:4px 0 12px">${esc(p.client || 'No client')} ${p.manager ? `· PM ${esc(p.manager)}` : ''}</div>
      <div class="row between small"><span>Progress</span><b>${prog}%</b></div>
      ${progressBar(prog)}
      <div class="row small muted" style="margin-top:12px;gap:14px">
        <span>${icon('site', 14)} ${p.siteIds.length} sites</span>
        ${onSite ? `<span style="color:#2E9E6A">● ${onSite} on site</span>` : ''}
        ${!isAdmin() ? '' : p.budget ? `<span>${fmtMoney(spent)} / ${fmtMoney(p.budget)}</span>` : spent ? `<span>${fmtMoney(spent)} spent</span>` : ''}
        ${daysLeft != null && p.status !== 'completed' ? `<span style="color:${daysLeft < 0 ? '#D64545' : 'inherit'}">${daysLeft < 0 ? `${-daysLeft}d overdue` : `${daysLeft}d left`}</span>` : ''}
      </div></a>`;
  }

  draw();
  return store.on(draw);
}

// ------------------------------------------------------------------ editor
export function editProject(p) {
  const selected = new Set(p ? p.siteIds : []);
  const sites = store.sites;
  modal({
    title: p ? `Edit ${p.name}` : 'New project',
    wide: true,
    body: `<form id="pf"><div class="fields">
      <label class="f"><span>Project name *</span><input name="name" required value="${esc(p?.name)}"></label>
      <label class="f"><span>Project code</span><input name="code" value="${esc(p?.code)}" placeholder="e.g. PRJ-2026-01"></label>
      <label class="f"><span>Client</span><input name="client" value="${esc(p?.client)}"></label>
      <label class="f"><span>Project manager</span><input name="manager" value="${esc(p?.manager)}"></label>
      <label class="f"><span>Start date</span><input name="startDate" type="date" value="${esc(p?.startDate)}"></label>
      <label class="f"><span>Target end date</span><input name="endDate" type="date" value="${esc(p?.endDate)}"></label>
      ${isAdmin() ? `<label class="f"><span>Budget (₹)</span><input name="budget" type="number" min="0" step="1" value="${p?.budget || ''}"></label>` : ''}
      <label class="f"><span>Status</span><select name="status">${PROJECT_STATUSES.map((s) => `<option value="${s}" ${(p?.status || 'active') === s ? 'selected' : ''}>${cap(s)}</option>`).join('')}</select></label>
      <label class="f full"><span>Description / scope of work</span><textarea name="description" rows="3">${esc(p?.description)}</textarea></label>
      <div class="full"><label class="f" style="margin-bottom:6px"><span>Sites in this project</span></label>
        ${sites.length ? `<div class="chips" id="pf-sites">${sites.map((s) => {
          const other = s.projectId && s.projectId !== p?.id ? store.project(s.projectId) : null;
          return `<span class="chip ${selected.has(s.id) ? 'on' : ''}" data-s="${s.id}" title="${other ? `Currently in ${esc(other.name)}` : ''}">${esc(s.name)}${other ? ' *' : ''}</span>`;
        }).join('')}</div><div class="small muted" style="margin-top:6px">* already linked to another project — selecting moves it here.</div>`
        : '<div class="muted small">No sites yet — add sites first under Sites.</div>'}
      </div>
    </div><div class="error" id="pf-err"></div></form>`,
    foot: `${p ? `<button class="btn ghost" data-del style="margin-right:auto;color:#D64545">${icon('trash', 16)} Delete</button>` : ''}
      <button class="btn ghost" data-cancel>Cancel</button><button class="btn" data-save>Save project</button>`,
    onMount: (m, close) => {
      m.querySelectorAll('[data-s]').forEach((c) => {
        c.onclick = () => { c.classList.toggle('on'); if (selected.has(c.dataset.s)) selected.delete(c.dataset.s); else selected.add(c.dataset.s); };
      });
      m.querySelector('[data-cancel]').onclick = close;
      m.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!await confirmBox('Delete project?', `Delete ${p.name}? Sites and attendance records are kept.`, { ok: 'Delete', danger: true })) return;
        await saveProject(p.id, { name: p.name, siteIds: [] }).catch(() => {});
        await deleteProject(p.id);
        close(); toast('Project deleted'); location.hash = '#/projects';
      });
      m.querySelector('[data-save]').onclick = async () => {
        const f = m.querySelector('#pf');
        if (!f.name.value.trim()) { m.querySelector('#pf-err').textContent = 'Project name is required.'; return; }
        const data = {
          name: f.name.value.trim(), code: f.code.value.trim(), client: f.client.value.trim(), manager: f.manager.value.trim(),
          startDate: f.startDate.value, endDate: f.endDate.value, status: f.status.value,
          ...(f.budget ? { budget: Number(f.budget.value) || 0 } : {}),
          description: f.description.value.trim(), siteIds: [...selected],
        };
        try {
          const id = await saveProject(p?.id || '', data);
          close(); toast('Project saved');
          if (!p) location.hash = `#/projects/${id}`;
        } catch (e) { m.querySelector('#pf-err').textContent = friendlyError(e); }
      };
    },
  });
}

// ------------------------------------------------------------------ detail
function detail(el, id, { setHeader }) {
  let sessions = null, updates = null;
  let loadedFor = '';

  async function load(p) {
    const key = p.siteIds.join(',');
    if (key === loadedFor) return;
    loadedFor = key;
    [sessions, updates] = await Promise.all([sessionsForSites(p.siteIds), updatesForSites(p.siteIds)]);
    draw();
  }

  function draw() {
    const p = store.project(id);
    if (!p) {
      el.innerHTML = store.loaded ? '<div class="card empty"><b>Project not found</b><a href="#/projects">Back to projects</a></div>' : '';
      return;
    }
    setHeader(p.name, `${p.code ? `${esc(p.code)} · ` : ''}${esc(p.client || 'No client')}${p.manager ? ` · PM ${esc(p.manager)}` : ''}`,
      `<a class="btn ghost" href="#/projects">← All projects</a>
       <button class="btn ghost" id="pd-xlsx">${icon('download', 16)} Excel</button>
       <button class="btn ghost" id="pd-pdf">${icon('download', 16)} PDF</button>
       <button class="btn" id="pd-edit">${icon('edit', 16)} Edit</button>`);
    document.getElementById('pd-edit').onclick = () => editProject(p);
    const dl = (fmt) => async () => {
      try { await downloadReport(await projectReport(p), fmt); } catch (e) { toast(friendlyError(e), true); }
    };
    document.getElementById('pd-xlsx').onclick = dl('xlsx');
    document.getElementById('pd-pdf').onclick = dl('pdf');
    load(p);

    const sites = p.siteIds.map((sid) => store.site(sid)).filter(Boolean);
    const prog = projectProgress(p);
    const petty = store.petty.filter((t) => p.siteIds.includes(t.siteId));
    const spent = petty.filter((t) => t.type !== 'credit' && t.status === 'approved').reduce((a, t) => a + t.amount, 0);
    const pendingSpend = petty.filter((t) => t.type !== 'credit' && t.status === 'pending').reduce((a, t) => a + t.amount, 0);
    const minutes = (sessions || []).reduce((a, s) => a + sessionMinutes(s), 0);
    const staff = new Map();
    for (const s of sessions || []) {
      const cur = staff.get(s.employeeId) || { name: s.employeeName, minutes: 0, days: new Set(), last: null };
      cur.minutes += sessionMinutes(s); cur.days.add(s.date); cur.last = s.checkIn;
      staff.set(s.employeeId, cur);
    }
    const onSite = store.open.filter((s) => p.siteIds.includes(s.siteId));
    const start = p.startDate ? parseKey(p.startDate) : null;
    const end = p.endDate ? parseKey(p.endDate) : null;
    const timePct = start && end && end > start ? Math.max(0, Math.min(100, Math.round(((new Date() - start) / (end - start)) * 100))) : null;

    el.innerHTML = `
    <div class="grid kpis">
      ${k('Status', cap(p.status), p.startDate || p.endDate ? `${p.startDate ? fmtDate(start) : '?'} → ${p.endDate ? fmtDate(end) : '?'}` : 'No dates set')}
      ${k('Work progress', `${prog}%`, timePct != null ? `${timePct}% of time elapsed` : `${sites.length} sites`)}
      ${k('Man-hours', sessions ? fmtMins(minutes) : '…', sessions ? `${staff.size} staff · ${sessions.length} visits` : 'loading')}
      ${isAdmin() ? k('Spent (petty)', fmtMoney(spent), p.budget ? `of ${fmtMoney(p.budget)} budget (${Math.round((spent / p.budget) * 100)}%)` : pendingSpend ? `${fmtMoney(pendingSpend)} pending` : 'No budget set') : ''}
      ${k('On site now', onSite.length, onSite.map((s) => s.employeeName).join(', ') || '—')}
    </div>
    ${p.description ? `<div class="card card-pad mt"><h3 style="margin-bottom:6px">Scope</h3><div style="white-space:pre-wrap">${esc(p.description)}</div></div>` : ''}
    ${p.budget && isAdmin() ? `<div class="card card-pad mt"><div class="row between small"><b>Budget used</b><span>${fmtMoney(spent)} / ${fmtMoney(p.budget)}</span></div>
      <div class="progress" style="margin-top:6px"><i style="width:${Math.min(100, (spent / p.budget) * 100)}%;background:${spent > p.budget ? '#D64545' : '#D98A1A'}"></i></div></div>` : ''}
    <div class="grid cols-2 mt">
      <div class="card"><div class="card-head"><h2>Sites</h2><a class="small" href="#/sites">Manage sites →</a></div>
        ${sites.length ? `<div class="table-wrap"><table class="t"><tr><th>Site</th><th>Status</th><th>Progress</th><th class="num">Hours</th></tr>
        ${sites.map((s) => {
          const m = (sessions || []).filter((x) => x.siteId === s.id).reduce((a, x) => a + sessionMinutes(x), 0);
          return `<tr><td><b>${esc(s.name)}</b><div class="small muted">${esc(s.address)}</div></td><td>${pill(cap(s.status), 'gray')}</td>
            <td style="min-width:120px"><div class="row" style="gap:8px;flex-wrap:nowrap"><div style="flex:1">${progressBar(s.progress)}</div><b class="small">${s.progress}%</b></div></td>
            <td class="num">${sessions ? fmtMins(m) : '…'}</td></tr>`;
        }).join('')}</table></div>` : '<div class="empty"><b>No sites linked</b>Edit the project to add sites.</div>'}
      </div>
      <div class="card"><div class="card-head"><h2>Team effort</h2></div>
        ${staff.size ? `<div class="table-wrap"><table class="t"><tr><th>Employee</th><th class="num">Days</th><th class="num">Hours</th><th>Last visit</th></tr>
        ${[...staff.entries()].sort((a, b) => b[1].minutes - a[1].minutes).map(([eid, v]) => `<tr class="click" data-emp="${eid}">
          <td><div class="person">${avatar(v.name, 28)}<span class="nm">${esc(v.name)}</span></div></td>
          <td class="num">${v.days.size}</td><td class="num"><b>${fmtMins(v.minutes)}</b></td><td class="small">${fmtDateTime(v.last)}</td></tr>`).join('')}
        </table></div>` : `<div class="empty">${sessions ? 'No attendance on these sites yet' : 'Loading…'}</div>`}
      </div>
    </div>
    <div class="grid cols-2 mt">
      <div class="card"><div class="card-head"><h2>Site updates</h2><span class="muted small">${updates ? updates.length : '…'}</span></div>
        ${updates && updates.length ? updates.slice(0, 12).map((u) => `<div class="update">
          <div class="row"><b>${esc(u.employeeName)}</b><span class="muted small">· ${esc(u.siteName)} · ${fmtDateTime(u.createdAt)}</span><span class="spacer"></span>
            ${pill(u.category, { Issue: 'red', Material: 'blue', Safety: 'amber' }[u.category] || 'green')}</div>
          ${u.note ? `<div style="margin-top:4px">${esc(u.note)}</div>` : ''}
          ${u.progress != null ? `<div class="small muted" style="margin-top:4px">Progress → <b>${u.progress}%</b></div>` : ''}
          ${u.photos.length ? `<div class="photos" style="margin-top:8px">${u.photos.map((ph) => `<img src="${b64img(ph)}" data-photo>`).join('')}</div>` : ''}
        </div>`).join('') : `<div class="empty">${updates ? 'No updates yet' : 'Loading…'}</div>`}
      </div>
      ${!isAdmin() ? '' : `<div class="card"><div class="card-head"><h2>Petty cash on this project</h2><span class="muted small">${fmtMoney(spent)} approved</span></div>
        ${petty.length ? `<div class="table-wrap"><table class="t"><tr><th>Date</th><th>Employee</th><th>Item</th><th class="num">Amount</th><th>Status</th></tr>
        ${petty.slice(0, 25).map((t) => `<tr><td class="small nowrap">${fmtDate(t.createdAt)}</td><td>${esc(t.employeeName)}</td>
          <td>${esc(t.type === 'credit' ? 'Cash given' : t.category)}<div class="small muted">${esc(t.note)}</div></td>
          <td class="num" style="color:${t.type === 'credit' ? '#2E9E6A' : '#D64545'}">${t.type === 'credit' ? '+' : '−'}${fmtMoney(t.amount)}</td>
          <td>${pill(cap(t.status), { approved: 'green', rejected: 'red', pending: 'amber' }[t.status])}</td></tr>`).join('')}
        </table></div>` : '<div class="empty">No expenses tagged to these sites</div>'}
      </div>`}
    </div>`;
    el.querySelectorAll('[data-photo]').forEach((img) => { img.onclick = () => photoViewer(img.src); });
    el.querySelectorAll('[data-emp]').forEach((r) => { r.onclick = () => { location.hash = `#/employees/${r.dataset.emp}`; }; });
  }

  draw();
  return store.on(draw);
}

const k = (label, value, sub) => `<div class="card kpi"><div class="lbl">${esc(label)}</div><div class="val" style="font-size:22px">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
