import { store, staffStatuses } from '../fb.js';
import { esc, avatar, fmtMins, fmtTime, timeAgo, pill } from '../util.js';
import { makeMap, siteLayer, employeeMarker, fitTo } from '../mapkit.js';

export function mount(el, _p, { setHeader }) {
  setHeader('Live map', 'Live locations of checked-in staff · updates automatically',
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

  function visible() {
    return staffStatuses().filter((s) => s.user.lastLocation && (showAll || s.state === 'onDuty'));
  }
  function points() {
    return [
      ...visible().map((s) => [s.user.lastLocation.lat, s.user.lastLocation.lng]),
      ...store.sites.filter((s) => s.active).map((s) => [s.lat, s.lng]),
    ];
  }

  let lastSig = '';
  function draw() {
    const sig = JSON.stringify([showAll, store.sites.map((s) => [s.id, s.lat, s.lng, s.radius, s.active]),
      staffStatuses().map((s) => [s.user.id, s.state, s.user.lastLocation && [s.user.lastLocation.lat, s.user.lastLocation.lng, +s.user.lastLocation.at]])]);
    if (sig === lastSig) return;
    lastSig = sig;
    siteGroup.clearLayers();
    store.sites.filter((s) => s.active).forEach((s) => siteGroup.addLayer(siteLayer(s)));
    empGroup.clearLayers();
    markers.clear();
    const vis = visible();
    vis.forEach((s) => {
      const loc = s.user.lastLocation;
      const m = employeeMarker(s.user, loc).bindPopup(`
        <b>${esc(s.user.name)}</b><br>
        ${s.open ? `${esc(s.open.siteName)} · since ${fmtTime(s.open.inLocal)}<br>` : 'Checked out<br>'}
        Today: <b>${fmtMins(s.minutes)}</b><br>
        <span style="color:#6b7885">GPS ${timeAgo(loc.at)} · ±${Math.round(loc.accuracy || 0)} m</span><br>
        <a href="#/employees/${s.user.id}">Open profile & route →</a>`);
      empGroup.addLayer(m);
      markers.set(s.user.id, m);
    });
    const onDuty = vis.filter((s) => s.state === 'onDuty');
    el.querySelector('#lm-count').textContent = `${onDuty.length} staff`;
    el.querySelector('#lm-list').innerHTML = onDuty.length ? onDuty.map((s) => {
      const loc = s.user.lastLocation;
      const fresh = loc.at && Date.now() - loc.at.getTime() < 15 * 60000;
      return `<div class="list-item" data-focus="${s.user.id}" style="cursor:pointer">
        ${avatar(s.user.name, 34, fresh ? '#2E9E6A' : '#E08E2B')}
        <div class="grow"><b>${esc(s.user.name)}</b><div class="small muted">${esc(s.open?.siteName || '')} · ${fmtMins(s.minutes)}</div></div>
        ${pill(timeAgo(loc.at), fresh ? 'green' : 'amber')}</div>`;
    }).join('') : '<div class="empty"><b>Nobody on duty</b>Staff appear here when they check in.</div>';
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
