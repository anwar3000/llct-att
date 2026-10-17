import {
  store, saveSite, deleteSite, saveProject, approveSite, sessionsForSites, workerEntriesForSites, sessionMinutes, entryMinutes,
} from '../fb.js';
import {
  esc, icon, pill, cap, progressBar, toast, modal, confirmBox, friendlyError, fmtMins, avatar, fmtTime, fmtDay, dateKey, addDays,
  startOfMonth, hoursDec, STAFF_COLOR, EXT_COLOR, atTz, parseKey,
} from '../util.js';
import { workforce, siteWorkforceReport, downloadReport } from '../report-lib.js';
import { makeMap, siteLayer, fitTo } from '../mapkit.js';
import { createPlacePicker } from '../placepicker.js';

const STATUSES = ['planned', 'active', 'on hold', 'completed'];

// ------------------------------------------------------------------ site detail: consolidated workforce
function detail(el, id, { setHeader }) {
  const today = new Date();
  let range = 'today', from = dateKey(today), to = dateKey(today);
  let sessions = null, entries = null, chart = null, token = 0;

  async function load() {
    const t = ++token;
    const [s, e] = await Promise.all([sessionsForSites([id]), workerEntriesForSites([id])]);
    if (t !== token) return;
    sessions = s; entries = e; draw();
  }
  const setRange = (r) => {
    range = r;
    const now = new Date();
    if (r === 'today') { from = to = dateKey(now); }
    if (r === '7') { from = dateKey(addDays(now, -6)); to = dateKey(now); }
    if (r === 'month') { from = dateKey(startOfMonth(now)); to = dateKey(now); }
    if (r === 'all') { from = '2000-01-01'; to = dateKey(now); }
    draw();
  };

  function header(site) {
    setHeader(site.name, `${esc(site.address || '')}${site.address ? ' · ' : ''}${cap(site.status)} · ${site.progress}% complete · radius ${Math.round(site.radius)} m`,
      `<a class="btn ghost" href="#/sites">← All sites</a>
       <button class="btn ghost" id="sd-xlsx">${icon('download', 16)} Excel</button>
       <button class="btn ghost" id="sd-pdf">PDF</button>
       <button class="btn" id="sd-edit">${icon('edit', 16)} Edit site</button>`);
    document.getElementById('sd-edit').onclick = () => editSite(store.site(id));
    ['xlsx', 'pdf'].forEach((f) => {
      document.getElementById(`sd-${f}`).onclick = async () => {
        try { await downloadReport(await siteWorkforceReport(store.site(id), from, to), f); } catch (e) { toast(friendlyError(e), true); }
      };
    });
  }

  function draw() {
    const site = store.site(id);
    if (!site) { el.innerHTML = store.loaded ? '<div class="card empty"><b>Site not found</b></div>' : ''; return; }
    header(site);
    const inR = (d) => d >= from && d <= to;
    const ss = (sessions || []).filter((x) => inR(x.date));
    const es = (entries || []).filter((x) => inR(x.date));
    const wf = workforce(ss, es);
    // Total to date — everything ever worked at this site (people on site now count up to this minute).
    const all = sessions ? workforce(sessions, entries || []) : null;
    const allDays = sessions ? new Set([...sessions.map((x) => x.date), ...(entries || []).map((x) => x.date)]) : new Set();
    const firstDay = [...allDays].sort()[0];
    const allTotal = all ? all.staffMins + all.extMins : 0;
    const staffNow = store.open.filter((x) => x.siteId === id);
    const extNow = store.extOnSite.filter((l) => l.siteId === id);
    const total = wf.staffMins + wf.extMins;
    const pct = total ? Math.round((wf.staffMins / total) * 100) : 0;
    el.innerHTML = `
    <div class="site-total">
      <div><div class="lbl">Total working hours to date</div>
        <div class="big">${all ? fmtMins(allTotal) : '…'}</div>
        <div class="sub">${all ? `${hoursDec(allTotal)} man-hours${firstDay ? ` · since ${fmtDay(parseKey(firstDay))}` : ''} · ${allDays.size} working day${allDays.size === 1 ? '' : 's'}` : 'Loading…'}</div></div>
      ${all ? `<div class="split">
        <div><span class="wf-dot staff"></span> Staff <b>${fmtMins(all.staffMins)}</b><div class="sub">${all.staffCount} people</div></div>
        <div><span class="wf-dot ext"></span> External <b>${fmtMins(all.extMins)}</b><div class="sub">${all.extCount} workers</div></div>
        <div>Total people <b>${all.people.length}</b><div class="sub">${staffNow.length + extNow.length} on site now</div></div>
      </div>` : ''}
    </div>
    <div class="row" style="margin-bottom:12px">
      <div class="chips">${[['today', 'Today'], ['7', 'Last 7 days'], ['month', 'This month'], ['all', 'All time']]
        .map(([k, l]) => `<span class="chip ${range === k ? 'on' : ''}" data-r="${k}">${l}</span>`).join('')}</div>
      <span class="row" style="gap:6px;flex-wrap:nowrap"><input type="date" id="sd-from" style="width:150px" value="${range === 'all' ? '' : from}"> – <input type="date" id="sd-to" style="width:150px" value="${to}"></span>
      <span class="spacer"></span><span class="small"><span class="wf-dot staff"></span> Staff &nbsp; <span class="wf-dot ext"></span> External workers</span>
    </div>
    <div class="grid kpis">
      ${k('Total workforce', wf.people.length, `${wf.staffCount} staff · ${wf.extCount} external`, '#404041')}
      ${k('Total man-hours', fmtMins(total), `${hoursDec(total)} h`, '#404041')}
      ${k('Staff', `${wf.staffCount} · ${fmtMins(wf.staffMins)}`, `${pct}% of hours`, STAFF_COLOR)}
      ${k('External workers', `${wf.extCount} · ${fmtMins(wf.extMins)}`, `${total ? 100 - pct : 0}% of hours`, EXT_COLOR)}
      ${k('On site now', staffNow.length + extNow.length, `${staffNow.length} staff · ${extNow.length} external`, '#2E9E6A')}
    </div>
    ${total ? `<div class="wf-bar mt" title="Share of man-hours"><i class="staff" style="width:${pct}%"></i><i class="ext" style="width:${100 - pct}%"></i></div>` : ''}
    <div class="grid cols-2-1 mt">
      <div class="card"><div class="card-head"><h2>Who worked here</h2><span class="muted small">${sessions ? `${wf.people.length} people` : 'Loading…'}</span></div>
        <div class="table-wrap"><table class="t">
          <tr><th>Name</th><th>Type</th><th>Designation / company</th><th class="num">Days</th><th class="num">Hours</th><th>Last day</th></tr>
          ${wf.people.length ? wf.people.map((p) => `<tr class="wf-row ${p.type === 'staff' ? 'staff' : 'ext'} click" data-go="${p.type === 'staff' ? `#/employees/${p.id}` : `#/workers/${p.id}`}">
            <td><div class="person">${avatar(p.name, 28, p.type === 'staff' ? STAFF_COLOR : EXT_COLOR)}<span class="nm">${esc(p.name)}</span></div></td>
            <td><span class="wf-chip ${p.type === 'staff' ? 'staff' : 'ext'}">${p.type === 'staff' ? 'Staff' : 'External'}</span></td>
            <td class="small">${esc(p.org)}</td><td class="num">${p.days.size}</td><td class="num"><b>${fmtMins(p.mins)}</b></td>
            <td class="small nowrap">${p.last ? fmtDay(p.last) : '—'}</td></tr>`).join('')
            : `<tr><td colspan="6"><div class="empty">${sessions ? 'Nobody worked here in this period' : 'Loading…'}</div></td></tr>`}
          ${wf.people.length ? `
          <tr class="wf-sub staff"><td colspan="3">Staff subtotal · ${wf.staffCount}</td><td></td><td class="num">${fmtMins(wf.staffMins)}</td><td></td></tr>
          <tr class="wf-sub ext"><td colspan="3">External subtotal · ${wf.extCount}</td><td></td><td class="num">${fmtMins(wf.extMins)}</td><td></td></tr>
          <tr class="wf-sub total"><td colspan="3">TOTAL · ${wf.people.length} people</td><td></td><td class="num">${fmtMins(total)}</td><td></td></tr>` : ''}
        </table></div></div>
      <div>
        <div class="card"><div class="card-head"><h2>On site now</h2></div>
          ${staffNow.map((x) => `<a class="list-item" href="#/employees/${x.employeeId}" style="color:inherit">${avatar(x.employeeName, 28, STAFF_COLOR)}<div class="grow"><b>${esc(x.employeeName)}</b><div class="small muted">Staff · since ${fmtTime(x.inLocal)}</div></div><span class="wf-chip staff">Staff</span></a>`).join('')}
          ${extNow.map((l) => `<a class="list-item" href="#/workers/${l.workerId}" style="color:inherit">${avatar(store.worker(l.workerId)?.name || l.name || '?', 28, EXT_COLOR)}<div class="grow"><b>${esc(store.worker(l.workerId)?.name || l.name || 'Worker')}</b><div class="small muted">with ${esc(l.employeeName)} · since ${fmtTime(atTz(l.since, store.open.find((x) => x.id === l.sessionId)?.tz))}</div></div><span class="wf-chip ext">External</span></a>`).join('')}
          ${staffNow.length + extNow.length ? '' : '<div class="empty">Nobody on site right now</div>'}
        </div>
        <div class="card mt"><div class="card-head"><h2>Man-hours per day</h2></div><div class="card-pad"><div class="chart-box" style="height:220px"><canvas id="sd-chart"></canvas></div></div></div>
      </div>
    </div>`;
    el.querySelectorAll('[data-r]').forEach((c) => { c.onclick = () => setRange(c.dataset.r); });
    el.querySelector('#sd-from').onchange = (e) => { if (e.target.value) { from = e.target.value; range = 'custom'; draw(); } };
    el.querySelector('#sd-to').onchange = (e) => { if (e.target.value) { to = e.target.value; range = 'custom'; draw(); } };
    el.querySelectorAll('[data-go]').forEach((r) => { r.onclick = () => { location.hash = r.dataset.go; }; });
    drawChart(ss, es);
  }

  function drawChart(ss, es) {
    const canvas = el.querySelector('#sd-chart');
    if (!canvas || !window.Chart) return;
    const days = [...new Set([...ss.map((x) => x.date), ...es.map((x) => x.date)])].sort().slice(-31);
    const staff = days.map((d) => hoursDec(ss.filter((x) => x.date === d).reduce((a, x) => a + sessionMinutes(x), 0)));
    const ext = days.map((d) => hoursDec(workforce([], es.filter((x) => x.date === d)).extMins));
    if (chart) chart.destroy();
    chart = new window.Chart(canvas, {
      type: 'bar',
      data: { labels: days.map((d) => d.slice(5)), datasets: [
        { label: 'Staff', data: staff, backgroundColor: STAFF_COLOR, borderRadius: 4, maxBarThickness: 26 },
        { label: 'External', data: ext, backgroundColor: EXT_COLOR, borderRadius: 4, maxBarThickness: 26 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw} h` } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => `${v}h` } } } },
    });
  }

  draw();
  load();
  const off = store.on(() => { if (!el.querySelector('input:focus')) draw(); });
  return () => { off(); token++; if (chart) chart.destroy(); };
}
const k = (label, value, sub, color) => `<div class="card kpi"><div class="lbl"><span class="ico" style="background:${color}1f;color:${color}">●</span>${esc(label)}</div>
  <div class="val" style="font-size:22px;color:${color === '#404041' ? 'inherit' : color}">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;

export function mount(el, params, ctx) {
  if (params[0]) return detail(el, params[0], ctx);
  return list(el, ctx);
}

function list(el, { setHeader }) {
  setHeader('Sites', 'Work locations with geofence radius used for check-in',
    `<button class="btn" id="s-new">${icon('plus', 16)} Add site</button>`);
  document.getElementById('s-new').onclick = () => editSite(null);
  let q = '';
  let map = null;
  let layer = null;

  el.innerHTML = `<div class="grid cols-2-1">
      <div class="card"><div class="card-head"><input id="s-q" placeholder="Search sites…" style="max-width:280px"><span class="spacer"></span><span id="s-count" class="muted small"></span></div>
        <div class="table-wrap" id="s-table"></div></div>
      <div><div id="s-map" class="map" style="height:480px"></div></div>
    </div>`;
  el.querySelector('#s-q').oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
  map = makeMap(el.querySelector('#s-map'));
  layer = window.L.layerGroup().addTo(map);
  let fitted = false;

  function draw() {
    const all = store.sites;
    const list = all.filter((s) => !q || s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q));
    el.querySelector('#s-count').textContent = `${list.length} of ${all.length}`;
    el.querySelector('#s-table').innerHTML = list.length ? `<table class="t">
      <tr><th>Site</th><th>Project</th><th>Status</th><th>Progress</th><th class="num">On site now</th><th class="num">Workforce today</th><th class="num">Man-hours today</th><th class="num">Radius</th></tr>
      ${list.map((s) => {
        const proj = s.projectId ? store.project(s.projectId) : null;
        const onSite = store.open.filter((x) => x.siteId === s.id).length;
        const extOn = store.extOnSite.filter((l) => l.siteId === s.id).length;
        const staffToday = new Set([...store.today, ...store.open].filter((x) => x.siteId === s.id).map((x) => x.employeeId)).size;
        const extToday = new Set(store.workersToday.filter((x) => x.siteId === s.id).map((x) => x.workerId)).size;
        const mins = store.today.filter((x) => x.siteId === s.id).reduce((a, x) => a + ((x.checkOut || new Date()) - x.checkIn) / 60000, 0)
          + store.workersToday.filter((x) => x.siteId === s.id).reduce((a, x) => a + entryMinutes(x), 0);
        return `<tr class="click" data-id="${s.id}">
          <td><b style="color:${s.active ? 'inherit' : '#8a96a0'}">${esc(s.name)}</b>${s.addedBy ? ` ${pill(`Added by ${s.addedBy}`, 'amber')}` : ''}${!s.approved && s.status !== 'rejected' ? ` ${pill('Awaiting approval', 'red')} <button class="btn sm success" data-approve="${s.id}">Approve</button> <button class="btn sm ghost" data-reject="${s.id}">Reject</button>` : ''}<div class="small muted">${esc(s.address)}</div></td>
          <td>${proj ? `<a href="#/projects/${proj.id}" data-stop>${esc(proj.name)}</a>` : '<span class="muted">—</span>'}</td>
          <td>${s.active ? pill(cap(s.status), { active: 'green', planned: 'blue', 'on hold': 'amber', completed: 'teal' }[s.status] || 'gray') : pill('Inactive', 'gray')}</td>
          <td style="min-width:120px"><div class="row" style="gap:8px;flex-wrap:nowrap"><div style="flex:1">${progressBar(s.progress)}</div><b class="small">${s.progress}%</b></div></td>
          <td class="num nowrap">${onSite || extOn ? `<span class="wf-chip staff" title="Staff">${onSite}</span> <span class="wf-chip ext" title="External workers">${extOn}</span>` : '<span class="muted">—</span>'}</td>
          <td class="num nowrap">${staffToday + extToday ? `<b>${staffToday + extToday}</b> <span class="small muted">(${staffToday} staff · ${extToday} ext)</span>` : '<span class="muted">—</span>'}</td>
          <td class="num">${mins ? fmtMins(mins) : '—'}</td>
          <td class="num">${Math.round(s.radius)} m</td></tr>`;
      }).join('')}</table>` : `<div class="empty"><b>No sites</b>Add a site to start scheduling and check-ins.</div>`;
    el.querySelectorAll('tr[data-id]').forEach((r) => {
      r.onclick = (e) => { if (e.target.closest('[data-stop],[data-approve],[data-reject]')) return; location.hash = `#/sites/${r.dataset.id}`; };
    });
    el.querySelectorAll('[data-approve]').forEach((b) => { b.onclick = () => approveSite(b.dataset.approve, true).then(() => toast('Site approved')); });
    el.querySelectorAll('[data-reject]').forEach((b) => { b.onclick = () => approveSite(b.dataset.reject, false).then(() => toast('Site rejected')); });
    layer.clearLayers();
    list.forEach((s) => layer.addLayer(siteLayer(s)));
    if (!fitted && list.length) { fitTo(map, list.map((s) => [s.lat, s.lng])); fitted = true; }
  }

  draw();
  const off = store.on(draw);
  return () => { off(); map.remove(); };
}

export function editSite(s) {
  let lat = s?.lat ?? null, lng = s?.lng ?? null;
  let radius = s?.radius ?? 200;
  modal({
    title: s ? `Edit ${s.name}` : 'Add site',
    wide: true,
    body: `<form id="sf"><div class="fields">
      <label class="f"><span>Site name *</span><input name="name" required value="${esc(s?.name)}"></label>
      <label class="f"><span>Project</span><select name="project"><option value="">— None —</option>
        ${store.projects.map((p) => `<option value="${p.id}" ${s?.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="f full"><span>Address / landmark</span><input name="address" value="${esc(s?.address)}"></label>
    </div>
    <div class="row" style="margin-bottom:8px"><b>Location</b><span class="muted small">Search the address, paste a Google Maps link, or click the map.</span></div>
    <div id="sf-picker"></div>
    <div class="fields" style="margin-top:10px">
      <label class="f"><span>Latitude</span><input name="lat" value="${lat ?? ''}"></label>
      <label class="f"><span>Longitude</span><input name="lng" value="${lng ?? ''}"></label>
      <label class="f"><span>Check-in geofence radius: <b id="sf-rv">${Math.round(radius)}</b> m <span class="muted">(staff can only check in inside this circle)</span></span><input name="radius" type="range" min="50" max="1000" step="25" value="${radius}"></label>
      <label class="f"><span>Status</span><select name="status">${STATUSES.map((x) => `<option value="${x}" ${(s?.status || 'active') === x ? 'selected' : ''}>${cap(x)}</option>`).join('')}</select></label>
      <label class="f"><span>Progress: <b id="sf-pv">${s?.progress ?? 0}</b>%</span><input name="progress" type="range" min="0" max="100" step="5" value="${s?.progress ?? 0}"></label>
      <label class="f row" style="gap:8px;align-items:center;margin-top:22px"><input type="checkbox" name="active" ${s?.active === false ? '' : 'checked'}> Active (visible to staff)</label>
      <label class="f full"><span>Notes for staff</span><textarea name="notes" rows="2">${esc(s?.notes)}</textarea></label>
    </div><div class="error" id="sf-err"></div></form>`,
    foot: `${s ? `<button class="btn ghost" data-del style="margin-right:auto;color:#D64545">${icon('trash', 16)} Delete</button>` : ''}
      <button class="btn ghost" data-cancel>Cancel</button><button class="btn" data-save>Save site</button>`,
    onMount: (m, close) => {
      const f = m.querySelector('#sf');
      const picker = createPlacePicker(m.querySelector('#sf-picker'), {
        lat, lng, radius,
        onPick: (la, ln, label) => {
          lat = la; lng = ln;
          f.lat.value = la.toFixed(6); f.lng.value = ln.toFixed(6);
          if (label && !f.address.value.trim()) f.address.value = label;
        },
      });
      const map = { remove: () => picker.destroy() };
      f.radius.oninput = () => { radius = Number(f.radius.value); m.querySelector('#sf-rv').textContent = radius; picker.setRadius(radius); };
      f.progress.oninput = () => { m.querySelector('#sf-pv').textContent = f.progress.value; };
      const manual = () => {
        const la = parseFloat(f.lat.value), ln = parseFloat(f.lng.value);
        if (!Number.isNaN(la) && !Number.isNaN(ln)) { lat = la; lng = ln; picker.setPoint(la, ln); }
      };
      f.lat.onchange = manual; f.lng.onchange = manual;
      m.querySelector('[data-cancel]').onclick = () => { map.remove(); close(); };
      m.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!await confirmBox('Delete site?', `Delete ${s.name}? Past attendance is kept. Tip: untick "Active" instead to hide it.`, { ok: 'Delete', danger: true })) return;
        await deleteSite(s.id); map.remove(); close(); toast('Site deleted');
      });
      m.querySelector('[data-save]').onclick = async () => {
        const err = m.querySelector('#sf-err');
        if (!f.name.value.trim()) { err.textContent = 'Site name is required.'; return; }
        if (lat == null || lng == null) { err.textContent = 'Set the location on the map.'; return; }
        const projectId = f.project.value;
        const proj = projectId ? store.project(projectId) : null;
        const data = {
          name: f.name.value.trim(), address: f.address.value.trim(), lat, lng, radius,
          status: f.status.value, progress: Number(f.progress.value), active: f.active.checked, notes: f.notes.value.trim(),
          projectId, projectName: proj?.name || '', approved: true,
        };
        try {
          await saveSite(s?.id || '', data);
          // keep project.siteIds in sync
          const sid = s?.id || store.sites.find((x) => x.name === data.name && x.lat === lat)?.id;
          if (sid) {
            for (const p of store.projects) {
              const has = p.siteIds.includes(sid);
              if (p.id === projectId && !has) await saveProject(p.id, { name: p.name, siteIds: [...p.siteIds, sid] });
              if (p.id !== projectId && has) await saveProject(p.id, { name: p.name, siteIds: p.siteIds.filter((x) => x !== sid) });
            }
          }
          map.remove(); close(); toast('Site saved');
        } catch (e) { err.textContent = friendlyError(e); }
      };
    },
  });
}
