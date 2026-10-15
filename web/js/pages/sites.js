import { store, saveSite, deleteSite, saveProject, approveSite } from '../fb.js';
import { esc, icon, pill, cap, progressBar, toast, modal, confirmBox, friendlyError, fmtMins } from '../util.js';
import { makeMap, siteLayer, fitTo } from '../mapkit.js';
import { createPlacePicker } from '../placepicker.js';

const STATUSES = ['planned', 'active', 'on hold', 'completed'];

export function mount(el, _p, { setHeader }) {
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
      <tr><th>Site</th><th>Project</th><th>Status</th><th>Progress</th><th class="num">Today</th><th class="num">Radius</th></tr>
      ${list.map((s) => {
        const proj = s.projectId ? store.project(s.projectId) : null;
        const onSite = store.open.filter((x) => x.siteId === s.id).length;
        const mins = store.today.filter((x) => x.siteId === s.id).reduce((a, x) => a + ((x.checkOut || new Date()) - x.checkIn) / 60000, 0);
        return `<tr class="click" data-id="${s.id}">
          <td><b style="color:${s.active ? 'inherit' : '#8a96a0'}">${esc(s.name)}</b>${s.addedBy ? ` ${pill(`Added by ${s.addedBy}`, 'amber')}` : ''}${!s.approved && s.status !== 'rejected' ? ` ${pill('Awaiting approval', 'red')} <button class="btn sm success" data-approve="${s.id}">Approve</button> <button class="btn sm ghost" data-reject="${s.id}">Reject</button>` : ''}<div class="small muted">${esc(s.address)}</div></td>
          <td>${proj ? `<a href="#/projects/${proj.id}" data-stop>${esc(proj.name)}</a>` : '<span class="muted">—</span>'}</td>
          <td>${s.active ? pill(cap(s.status), { active: 'green', planned: 'blue', 'on hold': 'amber', completed: 'teal' }[s.status] || 'gray') : pill('Inactive', 'gray')}</td>
          <td style="min-width:120px"><div class="row" style="gap:8px;flex-wrap:nowrap"><div style="flex:1">${progressBar(s.progress)}</div><b class="small">${s.progress}%</b></div></td>
          <td class="num">${onSite ? `<span style="color:#2E9E6A;font-weight:700">● ${onSite}</span> · ` : ''}${fmtMins(mins)}</td>
          <td class="num">${Math.round(s.radius)} m</td></tr>`;
      }).join('')}</table>` : `<div class="empty"><b>No sites</b>Add a site to start scheduling and check-ins.</div>`;
    el.querySelectorAll('tr[data-id]').forEach((r) => {
      r.onclick = (e) => { if (e.target.closest('[data-stop],[data-approve],[data-reject]')) return; editSite(store.site(r.dataset.id)); };
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
