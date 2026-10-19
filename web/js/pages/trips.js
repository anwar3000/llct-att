// Driver trips — live trips in progress, daily list with km and cost, route map, admin corrections.
import { store, isAdmin, tripsInRange, tripKm, tripCost, tripMinutes, tripPoints, editTrip, endTripNow, deleteTrip, saveSettings, tripRateFor } from '../fb.js';
import { tripsReport, downloadReport } from '../report-lib.js';
import { esc, icon, pill, avatar, fmtMins, fmtTime, fmtMoney, dateKey, addDays, atTz, tzLabel, timeAgo, modal, toast, confirmBox, friendlyError } from '../util.js';
import { makeMap, siteLayer, fitTo } from '../mapkit.js';

const TRIP_COLOR = '#7B4FC9';

export function mount(el, _p, { setHeader }) {
  const admin = isAdmin();
  setHeader('Driver trips', 'Car trips by drivers — GPS distance, time and cost, charged to the pick-up / drop-off site',
    `<button class="btn ghost" id="tr-xlsx">${icon('download', 16)} Excel</button><button class="btn ghost" id="tr-pdf">${icon('download', 16)} PDF</button>`);
  const today = dateKey(new Date());
  let from = today, to = today, driver = '', site = '';
  let fetched = [];
  let loading = false;

  async function load() {
    loading = true; draw();
    try { fetched = await tripsInRange(from, to); } catch (e) { toast(friendlyError(e), true); fetched = []; }
    loading = false; draw();
  }

  // The fetched range, kept live with today's / running trips from the store.
  function trips() {
    const m = new Map(fetched.map((t) => [t.id, t]));
    for (const t of store.tripsToday) if (t.date >= from && t.date <= to) m.set(t.id, t);
    return [...m.values()]
      .filter((t) => (!driver || t.employeeId === driver) && (!site || t.siteId === site || t.startSiteId === site || t.endSiteId === site))
      .sort((a, b) => (b.startAt || 0) - (a.startAt || 0));
  }

  function draw() {
    const list = trips();
    const active = store.tripsActive;
    const km = list.reduce((a, t) => a + tripKm(t), 0);
    const cost = list.reduce((a, t) => a + tripCost(t), 0);
    const drivers = store.users.filter((u) => u.isDriver);
    const bySite = new Map();
    for (const t of list) {
      // A trip still running is shown against its pick-up site until it ends.
      const sid = t.siteId || (t.status === 'active' ? t.startSiteId : '');
      const c = bySite.get(sid) || { id: sid, name: t.siteName || (t.status === 'active' ? t.startSiteName : '') || 'Not at a site', n: 0, km: 0, cost: 0 };
      c.n++; c.km += tripKm(t); c.cost += tripCost(t);
      bySite.set(sid, c);
    }
    const byDriver = new Map();
    for (const t of list) {
      const c = byDriver.get(t.employeeId) || { id: t.employeeId, name: t.employeeName, n: 0, km: 0, cost: 0, mins: 0 };
      c.n++; c.km += tripKm(t); c.cost += tripCost(t); c.mins += tripMinutes(t);
      byDriver.set(t.employeeId, c);
    }

    el.innerHTML = `
    <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <div class="seg">${[['today', 'Today'], ['yday', 'Yesterday'], ['7', 'Last 7 days'], ['month', 'This month']].map(([k, l]) => `<button class="btn sm ghost" data-quick="${k}">${l}</button>`).join('')}</div>
      <label class="row small" style="gap:6px;flex-wrap:nowrap">From <input type="date" id="tr-from" value="${from}" style="width:150px"></label>
      <label class="row small" style="gap:6px;flex-wrap:nowrap">To <input type="date" id="tr-to" value="${to}" style="width:150px"></label>
      <select id="tr-driver" style="width:auto;min-width:150px"><option value="">All drivers</option>${drivers.map((u) => `<option value="${u.id}" ${u.id === driver ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
      <select id="tr-site" style="width:auto;min-width:150px"><option value="">All sites</option>${store.sites.map((s) => `<option value="${s.id}" ${s.id === site ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <span class="spacer"></span>
      ${admin ? `<span class="small muted">Company rate</span><input id="tr-rate" type="number" min="0" step="0.01" value="${store.settings.tripRatePerKm || 0}" style="width:90px"> <span class="small muted">AED / km</span> <button class="btn sm" id="tr-rate-save">Save</button>` : ''}
    </div>
    ${!drivers.length ? `<div class="card pad" style="background:#fff4e2;margin-bottom:12px">${icon('warn', 16)} No drivers yet. Open <a href="#/employees">Employees</a>, edit a person and tick <b>Driver</b> — they get Start / Stop trip in the app.</div>` : ''}
    <div class="grid kpis">
      ${kpi('Trips', list.length, `${byDriver.size} driver${byDriver.size === 1 ? '' : 's'}`, TRIP_COLOR)}
      ${kpi('Distance', `${km.toFixed(1)} km`, list.length ? `avg ${(km / list.length).toFixed(1)} km / trip` : '—', '#2E9E6A')}
      ${admin ? kpi('Cost', fmtMoney(Math.round(cost * 100) / 100), `${bySite.size} site${bySite.size === 1 ? '' : 's'} charged`, '#D98A1A') : kpi('Driving time', fmtMins(list.reduce((a, t) => a + tripMinutes(t), 0)), 'total', '#D98A1A')}
      ${kpi('In progress', active.length, active.length ? 'driving now' : 'no trip running', active.length ? '#2E9E6A' : '#404041')}
    </div>
    ${active.length ? `<div class="card mt" style="border:2px solid #2E9E6A"><div class="card-head"><h2>Driving now</h2><span class="spacer"></span>${pill('Live', 'green', true)}</div>
      ${active.map((t) => `<div class="list-item">
        ${avatar(t.employeeName, 32, '#2E9E6A')}
        <div class="grow"><b>${esc(t.employeeName)}</b>${t.vehicle ? ` <span class="small muted">· ${esc(t.vehicle)}</span>` : ''}
          <div class="small muted">From ${esc(t.startSiteName || 'GPS location')} · started ${fmtTime(atTz(t.startAt, t.tz))} · ${fmtMins(tripMinutes(t))}${t.purpose ? ` · ${esc(t.purpose)}` : ''} · last GPS ${timeAgo(t.lastAt)}</div></div>
        <b>${tripKm(t).toFixed(1)} km</b>
        <button class="btn sm ghost" data-route="${t.id}">${icon('map', 14)} Route</button>
        <button class="btn sm ghost" data-end="${t.id}" title="End a trip the driver forgot to stop">End</button>
      </div>`).join('')}</div>` : ''}
    <div class="grid cols-2-1 mt">
      <div class="card"><div class="card-head"><h2>Trips</h2><span class="spacer"></span><span class="small muted">${loading ? 'Loading…' : `${list.length} trip${list.length === 1 ? '' : 's'}`}</span></div>
        ${list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th>Driver</th><th>Route</th><th>Charged to</th><th>Time</th><th class="num">Km</th>${admin ? '<th class="num">Cost</th>' : ''}<th></th></tr></thead><tbody>
        ${list.map((t) => `<tr>
          <td>${esc(t.date.slice(5))}</td>
          <td><b>${esc(t.employeeName)}</b>${t.vehicle ? `<div class="small muted">${esc(t.vehicle)}</div>` : ''}</td>
          <td>${esc(t.startSiteName || 'GPS')} → ${t.status === 'active' ? '<i class="muted">driving…</i>' : esc(t.endSiteName || 'GPS')}${t.purpose ? `<div class="small muted">${esc(t.purpose)}</div>` : ''}</td>
          <td>${t.siteId ? `<a href="#/sites/${t.siteId}">${esc(t.siteName)}</a>` : t.status === 'active' ? '<span class="muted">—</span>' : '<span class="muted">No site</span>'}</td>
          <td class="small">${fmtTime(atTz(t.startAt, t.tz))} – ${t.endAt ? fmtTime(atTz(t.endAt, t.tz)) : 'now'}<div class="muted">${fmtMins(tripMinutes(t))} · ${tzLabel(t.tz)}</div></td>
          <td class="num"><b>${tripKm(t).toFixed(1)}</b>${t.editedBy ? `<div class="small muted" title="Edited by ${esc(t.editedBy)}">edited</div>` : ''}</td>
          ${admin ? `<td class="num">${fmtMoney(tripCost(t))}${t.status === 'active' ? '<div class="small muted">est.</div>' : ''}</td>` : ''}
          <td style="white-space:nowrap"><button class="btn sm ghost icon" data-route="${t.id}" title="Route map">${icon('map', 15)}</button>${admin ? `<button class="btn sm ghost icon" data-edit="${t.id}" title="Edit">${icon('edit', 15)}</button><button class="btn sm ghost icon" data-del="${t.id}" title="Delete">${icon('trash', 15)}</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>` : `<div class="empty"><b>No trips in this period</b>Drivers start and stop trips from the app.</div>`}
      </div>
      <div>
        <div class="card"><div class="card-head"><h2>Expense by site</h2></div>
          ${[...bySite.values()].sort((a, b) => b.cost - a.cost || b.km - a.km).map((c) => `<div class="list-item">
            <div class="grow">${c.id ? `<a href="#/sites/${c.id}"><b>${esc(c.name)}</b></a>` : `<b class="muted">${esc(c.name)}</b>`}<div class="small muted">${c.n} trip${c.n === 1 ? '' : 's'} · ${c.km.toFixed(1)} km</div></div>
            ${admin ? `<b>${fmtMoney(Math.round(c.cost * 100) / 100)}</b>` : ''}</div>`).join('') || '<div class="empty">—</div>'}
          <div class="small muted" style="padding:8px 14px">A trip is charged to the site where it ends; if it doesn’t end at a site, to the site where it started.</div>
        </div>
        <div class="card mt"><div class="card-head"><h2>By driver</h2></div>
          ${[...byDriver.values()].sort((a, b) => b.km - a.km).map((c) => `<div class="list-item">${avatar(c.name, 28, TRIP_COLOR)}
            <div class="grow"><b>${esc(c.name)}</b><div class="small muted">${c.n} trip${c.n === 1 ? '' : 's'} · ${fmtMins(c.mins)}${admin ? ` · ${tripRateFor(c.id)} AED/km` : ''}</div></div>
            <div style="text-align:right"><b>${c.km.toFixed(1)} km</b>${admin ? `<div class="small">${fmtMoney(Math.round(c.cost * 100) / 100)}</div>` : ''}</div></div>`).join('') || '<div class="empty">—</div>'}
        </div>
      </div>
    </div>`;
    wire(list);
  }

  function wire(list) {
    const find = (id) => list.find((t) => t.id === id) || store.tripsActive.find((t) => t.id === id);
    el.querySelectorAll('[data-quick]').forEach((b) => {
      b.onclick = () => {
        const n = new Date();
        if (b.dataset.quick === 'today') { from = to = dateKey(n); }
        if (b.dataset.quick === 'yday') { from = to = dateKey(addDays(n, -1)); }
        if (b.dataset.quick === '7') { from = dateKey(addDays(n, -6)); to = dateKey(n); }
        if (b.dataset.quick === 'month') { from = dateKey(new Date(n.getFullYear(), n.getMonth(), 1)); to = dateKey(n); }
        load();
      };
    });
    el.querySelector('#tr-from').onchange = (e) => { from = e.target.value || today; if (to < from) to = from; load(); };
    el.querySelector('#tr-to').onchange = (e) => { to = e.target.value || today; if (to < from) from = to; load(); };
    el.querySelector('#tr-driver').onchange = (e) => { driver = e.target.value; draw(); };
    el.querySelector('#tr-site').onchange = (e) => { site = e.target.value; draw(); };
    const rs = el.querySelector('#tr-rate-save');
    if (rs) rs.onclick = async () => {
      const v = Number(el.querySelector('#tr-rate').value);
      if (!(v >= 0)) { toast('Enter a rate (AED per km)', true); return; }
      try { await saveSettings({ tripRatePerKm: v }); toast(`Company rate set to ${v} AED / km (for new trips)`); } catch (e) { toast(friendlyError(e), true); }
    };
    el.querySelectorAll('[data-route]').forEach((b) => { b.onclick = () => { const t = find(b.dataset.route); if (t) routeDialog(t); }; });
    el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { const t = find(b.dataset.edit); if (t) editDialog(t, load); }; });
    el.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const t = find(b.dataset.del);
        if (!t || !await confirmBox('Delete trip', `Delete ${t.employeeName}'s trip on ${t.date} (${tripKm(t).toFixed(1)} km)? This cannot be undone.`, { ok: 'Delete', danger: true })) return;
        try { await deleteTrip(t.id); toast('Trip deleted'); load(); } catch (e) { toast(friendlyError(e), true); }
      };
    });
    el.querySelectorAll('[data-end]').forEach((b) => {
      b.onclick = async () => {
        const t = find(b.dataset.end);
        if (!t || !await confirmBox('End trip', `End ${t.employeeName}'s trip now at the last GPS point (${tripKm(t).toFixed(1)} km)?`, { ok: 'End trip' })) return;
        try { await endTripNow(t); toast('Trip ended'); load(); } catch (e) { toast(friendlyError(e), true); }
      };
    });
  }

  const exp = (fmt) => async () => {
    try { toast('Preparing report…'); await downloadReport(await tripsReport(from, to, driver || null, site || null), fmt); } catch (e) { toast(friendlyError(e), true); }
  };
  document.getElementById('tr-xlsx').onclick = exp('xlsx');
  document.getElementById('tr-pdf').onclick = exp('pdf');

  load();
  let last = '';
  return store.on(() => {
    const sig = JSON.stringify([store.tripsToday.map((t) => [t.id, t.distanceM, t.status, t.siteId, +t.lastAt]), store.tripsActive.map((t) => t.id), store.users.length, store.settings]);
    if (sig !== last) { last = sig; draw(); }
  });
}

function kpi(label, value, sub, color) {
  return `<div class="card kpi"><div class="lbl"><span class="ico" style="background:${color}1f;color:${color}">●</span>${esc(label)}</div>
    <div class="val" style="color:${color === '#404041' ? 'inherit' : color}">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
}

export async function routeDialog(t) {
  const { el } = modal({
    title: `${t.employeeName} — ${t.date}`, wide: true,
    body: `<div class="small muted" style="margin-bottom:8px">${esc(t.startSiteName || 'GPS location')} → ${esc(t.status === 'active' ? 'driving…' : (t.endSiteName || 'GPS location'))}
      · ${tripKm(t).toFixed(2)} km · ${fmtMins(tripMinutes(t))}${t.vehicle ? ` · ${esc(t.vehicle)}` : ''}${t.siteName ? ` · charged to <b>${esc(t.siteName)}</b>` : ''}</div>
      <div id="rt-map" class="map" style="height:420px"></div><div id="rt-info" class="small muted" style="margin-top:6px">Loading route…</div>`,
  });
  const map = makeMap(el.querySelector('#rt-map'));
  const L = window.L;
  store.sites.filter((s) => s.active && [t.startSiteId, t.endSiteId, t.siteId].includes(s.id)).forEach((s) => siteLayer(s).addTo(map));
  let pts = [];
  try { pts = await tripPoints(t.id); } catch (e) { el.querySelector('#rt-info').textContent = friendlyError(e); }
  const line = pts.map((p) => [p.lat, p.lng]);
  if (!line.length && t.startLat != null) line.push([t.startLat, t.startLng]);
  if (t.endLat != null) line.push([t.endLat, t.endLng]);
  if (line.length > 1) L.polyline(line, { color: TRIP_COLOR, weight: 5, opacity: 0.85 }).addTo(map);
  if (line.length) {
    L.circleMarker(line[0], { radius: 8, color: '#fff', weight: 3, fillColor: '#2E9E6A', fillOpacity: 1 }).bindTooltip('Start').addTo(map);
    if (line.length > 1) L.circleMarker(line[line.length - 1], { radius: 8, color: '#fff', weight: 3, fillColor: t.status === 'active' ? TRIP_COLOR : '#D64545', fillOpacity: 1 }).bindTooltip(t.status === 'active' ? 'Now' : 'End').addTo(map);
    fitTo(map, line);
  }
  el.querySelector('#rt-info').textContent = `${pts.length} GPS points recorded${pts.length && pts[0].at ? ` · ${fmtTime(pts[0].at)} – ${fmtTime(pts[pts.length - 1].at)} (your time)` : ''}`;
}

function editDialog(t, onDone) {
  modal({
    title: 'Edit trip',
    body: `<div class="small muted" style="margin-bottom:10px">${esc(t.employeeName)} · ${esc(t.date)} · GPS measured ${(t.originalDistanceM ?? t.distanceM) / 1000 > 0 ? ((t.originalDistanceM ?? t.distanceM) / 1000).toFixed(2) : '0'} km</div>
      <div class="grid cols-2" style="gap:10px">
        <label class="f"><span>Distance (km)</span><input id="et-km" type="number" min="0" step="0.01" value="${tripKm(t).toFixed(2)}"></label>
        <label class="f"><span>Rate (AED / km)</span><input id="et-rate" type="number" min="0" step="0.01" value="${t.ratePerKm ?? tripRateFor(t.employeeId)}"></label>
        <label class="f"><span>Vehicle</span><input id="et-veh" value="${esc(t.vehicle)}"></label>
        <label class="f"><span>Purpose</span><input id="et-pur" value="${esc(t.purpose)}"></label>
      </div>
      <label class="f"><span>Charge to site</span><select id="et-site"><option value="">— No site —</option>${store.sites.map((s) => `<option value="${s.id}" ${s.id === t.siteId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Note</span><input id="et-note" value="${esc(t.note)}"></label>
      <div class="small muted" id="et-cost"></div>`,
    foot: '<button class="btn ghost" data-no>Cancel</button><button class="btn" data-yes>Save</button>',
    onMount: (el, close) => {
      const v = (id) => el.querySelector(id).value;
      const upd = () => { el.querySelector('#et-cost').textContent = `Cost: ${fmtMoney(Math.round(Number(v('#et-km')) * Number(v('#et-rate')) * 100) / 100)}`; };
      el.querySelector('#et-km').oninput = upd; el.querySelector('#et-rate').oninput = upd; upd();
      el.querySelector('[data-no]').onclick = close;
      el.querySelector('[data-yes]').onclick = async () => {
        const km = Number(v('#et-km')), rate = Number(v('#et-rate'));
        if (!(km >= 0) || !(rate >= 0)) { toast('Enter valid numbers', true); return; }
        try {
          await editTrip(t, { km, ratePerKm: rate, siteId: v('#et-site'), vehicle: v('#et-veh').trim(), purpose: v('#et-pur').trim(), note: v('#et-note').trim() });
          toast('Trip updated'); close(); onDone && onDone();
        } catch (e) { toast(friendlyError(e), true); }
      };
    },
  });
}
