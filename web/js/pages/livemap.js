import { store, staffStatuses } from '../fb.js';
import { esc, avatar, fmtMins, fmtTime, timeAgo, pill, EXT_COLOR, STAFF_COLOR, atTz } from '../util.js';
import { makeMap, siteLayer, employeeMarker, fitTo, workerMarker } from '../mapkit.js';

export function mount(el, _p, { setHeader }) {
  setHeader('Live map', 'Checked-in staff (live GPS) and their external workers (shown at the employee’s location) · updates automatically',
    `<label class="row small" style="gap:6px"><input type="checkbox" id="lm-all"> Show checked-out staff</label>
     <button class="btn ghost" id="lm-fit">Fit all</button>`);

  el.innerHTML = `<div class="grid cols-2-1" style="grid-template-columns:minmax(0,3fr) minmax(260px,1fr)">
    <div id="lm-map" class="map tall"></div>
    <div class="card" style="max-height:calc(100vh - 170px);overflow:auto"><div class="card-head"><h2>On duty</h2><span id="lm-count" class="muted small"></span></div><div id="lm-list"></div></div>
  </div>`;

  const map = makeMap(el.querySelector('#lm-map'));
  const L = window.L;
  const siteGroup = L.layerGroup().addTo(map);
  const empGroup = L.layerGroup().addTo(map);
  let fitted = false;
  let showAll = false;
  const markers = new Map();

  document.getElementById('lm-all').onchange = (e) => { showAll = e.target.checked; draw(); };
  document.getElementById('lm-fit').onclick = () => fitTo(map, points());

  // Position of a person on the map: their phone's last GPS, or — if on duty but the phone
  // hasn't sent GPS yet — the site they checked in at (shown as "no GPS").
  function locOf(s) {
    if (s.user.lastLocation) return s.user.lastLocation;
    const site = s.open && store.site(s.open.siteId);
    return site ? { lat: site.lat, lng: site.lng, accuracy: 0, at: null, checkedIn: true, siteName: site.name, noGps: true } : null;
  }
  function visible() {
    return staffStatuses().filter((s) => locOf(s) && (showAll || s.state === 'onDuty'));
  }
  function points() {
    return [
      ...visible().map((s) => [locOf(s).lat, locOf(s).lng]),
      ...store.sites.filter((s) => s.active).map((s) => [s.lat, s.lng]),
    ];
  }

  let lastSig = '';
  function draw() {
    const sig = JSON.stringify([showAll, store.sites.map((s) => [s.id, s.lat, s.lng, s.radius, s.active]),
      staffStatuses().map((s) => [s.user.id, s.state, s.user.lastLocation && [s.user.lastLocation.lat, s.user.lastLocation.lng, +s.user.lastLocation.at]]),
      store.extOnSite.map((l) => [l.workerId, l.sessionId]), store.open.map((o) => o.id)]);
    if (sig === lastSig) return;
    lastSig = sig;
    siteGroup.clearLayers();
    store.sites.filter((s) => s.active).forEach((s) => siteGroup.addLayer(siteLayer(s)));
    empGroup.clearLayers();
    markers.clear();
    const vis = visible();
    vis.forEach((s) => {
      const loc = locOf(s);
      const m = employeeMarker(s.user, loc).bindPopup(`
        <b>${esc(s.user.name)}</b><br>
        ${s.open ? `${esc(s.open.siteName)} · since ${fmtTime(s.open.inLocal)}<br>` : 'Checked out<br>'}
        Today: <b>${fmtMins(s.minutes)}</b><br>
        ${(() => { const ws = s.open ? store.extOnSite.filter((l) => l.sessionId === s.open.id) : []; return ws.length ? `<span style="color:${EXT_COLOR};font-weight:700">+ ${ws.length} external worker${ws.length === 1 ? '' : 's'}:</span> ${ws.map((l) => esc(store.worker(l.workerId)?.name || l.name || 'Worker')).join(', ')}<br>` : ''; })()}
        <span style="color:#6b7885">${loc.noGps ? '⚠ No GPS from phone yet — shown at the site. Check location permission / battery settings.' : `GPS ${timeAgo(loc.at)} · ±${Math.round(loc.accuracy || 0)} m`}</span><br>
        <a href="#/employees/${s.user.id}">Open profile & route →</a>`);
      empGroup.addLayer(m);
      markers.set(s.user.id, m);
    });
    // External workers have no phone of their own: place them around the employee who checked them in
    // (or at the site if that employee has no GPS yet).
    const byEmp = new Map(vis.filter((s) => s.state === 'onDuty' && s.open).map((s) => [s.open.id, s]));
    const posOf = (s) => locOf(s);
    const groups = new Map();
    store.extOnSite.forEach((l) => { if (!groups.has(l.sessionId)) groups.set(l.sessionId, []); groups.get(l.sessionId).push(l); });
    groups.forEach((ls, sid) => {
      const emp = byEmp.get(sid);
      const site = store.site(ls[0].siteId);
      const base = emp ? posOf(emp) : site ? { lat: site.lat, lng: site.lng } : null;
      if (!base) return;
      ls.forEach((l, i) => {
        // small ring (~18 m) so each worker stays clickable
        const a = (2 * Math.PI * i) / ls.length - Math.PI / 2;
        const r = 0.00017 * (1 + Math.floor(i / 8) * 0.6);
        const lat = base.lat + r * Math.sin(a), lng = base.lng + (r * Math.cos(a)) / Math.cos((base.lat * Math.PI) / 180);
        const name = store.worker(l.workerId)?.name || l.name || 'Worker';
        const m = workerMarker(name, lat, lng).bindPopup(`<b>${esc(name)}</b> <span style="color:${EXT_COLOR};font-weight:700">· External</span><br>
          ${esc(l.siteName)} · with ${esc(l.employeeName)}<br>since ${fmtTime(atTz(l.since, emp?.open?.tz))}<br>
          <span style="color:#6b7885">Location = ${emp && !posOf(emp).noGps ? `${esc(l.employeeName)}'s phone` : 'site (no GPS from employee yet)'}</span><br>
          <a href="#/workers/${l.workerId}">Open worker →</a>`);
        empGroup.addLayer(m);
        markers.set(`w:${l.workerId}`, m);
      });
    });
    const onDuty = vis.filter((s) => s.state === 'onDuty');
    const locks = store.extOnSite;
    el.querySelector('#lm-count').innerHTML = `<span class="wf-chip staff">${onDuty.length} staff</span> <span class="wf-chip ext">${locks.length} external</span>`;
    el.querySelector('#lm-list').innerHTML = onDuty.length || locks.length ? onDuty.map((s) => {
      const loc = locOf(s);
      const fresh = loc.at && Date.now() - loc.at.getTime() < 15 * 60000;
      const ws = locks.filter((l) => l.sessionId === s.open?.id);
      return `<div class="list-item" data-focus="${s.user.id}" style="cursor:pointer;border-left:3px solid ${STAFF_COLOR}">
        ${avatar(s.user.name, 34, fresh ? '#2E9E6A' : '#E08E2B')}
        <div class="grow"><b>${esc(s.user.name)}</b><div class="small muted">${esc(s.open?.siteName || '')} · ${fmtMins(s.minutes)}</div></div>
        ${loc.noGps ? pill('No GPS', 'red') : pill(timeAgo(loc.at), fresh ? 'green' : 'amber')}</div>
        ${ws.map((l) => `<a class="list-item" data-focus="w:${l.workerId}" href="javascript:void 0" style="color:inherit;padding-left:34px;background:#fffaf2;border-left:3px solid ${EXT_COLOR}">
          ${avatar(store.worker(l.workerId)?.name || l.name || '?', 26, EXT_COLOR)}<div class="grow"><b class="small">${esc(store.worker(l.workerId)?.name || l.name || 'Worker')}</b>
          <div class="small muted">External · since ${fmtTime(atTz(l.since, s.open?.tz))}</div></div></a>`).join('')}`;
    }).join('') + locks.filter((l) => !onDuty.some((s) => s.open?.id === l.sessionId)).map((l) => `<a class="list-item" data-focus="w:${l.workerId}" href="javascript:void 0" style="color:inherit;background:#fffaf2;border-left:3px solid ${EXT_COLOR}">
      ${avatar(store.worker(l.workerId)?.name || l.name || '?', 30, EXT_COLOR)}<div class="grow"><b>${esc(store.worker(l.workerId)?.name || l.name || 'Worker')}</b>
      <div class="small muted">External · ${esc(l.siteName)} · with ${esc(l.employeeName)}</div></div></a>`).join('')
      : '<div class="empty"><b>Nobody on duty</b>Staff appear here when they check in.</div>';
    el.querySelectorAll('[data-focus]').forEach((row) => {
      row.onclick = () => {
        const m = markers.get(row.dataset.focus);
        if (m) { map.setView(m.getLatLng(), 16); m.openPopup(); }
      };
    });
    if (!fitted && store.loaded) {
      const pts = points();
      if (pts.length) { fitTo(map, pts); fitted = true; }
    }
  }

  draw();
  const off = store.on(draw);
  return () => { off(); map.remove(); };
}
