// Driver trips — live trips in progress, daily list with km and cost, route map, admin corrections.
import { store, isAdmin, addDriverPayment, deleteDriverPayment, finishedTripsFor, tripsInRange, tripKm, tripCost, tripMinutes, tripPoints, editTrip, endTripNow, deleteTrip, saveSettings, tripRateFor, tripKindLabel } from '../fb.js';
import { tripsReport, downloadReport } from '../report-lib.js';
import { esc, icon, pill, avatar, fmtMins, fmtTime, fmtMoney, dateKey, addDays, atTz, tzLabel, timeAgo, modal, toast, confirmBox, friendlyError } from '../util.js';
import { makeMap, siteLayer, fitTo } from '../mapkit.js';

const TRIP_COLOR = '#7B4FC9';

export function mount(el, _p, { setHeader }) {
  const admin = isAdmin();
  setHeader('Trips & rides', 'Driver trips (paid per km) and staff taxi / company-driver rides — GPS distance, time and cost, charged to the pick-up / drop-off site',
    `<button class="btn ghost" id="tr-xlsx">${icon('download', 16)} Excel</button><button class="btn ghost" id="tr-pdf">${icon('download', 16)} PDF</button>`);
  const today = dateKey(new Date());
  // Default: this month, so the full list of trips & rides is visible.
  let from = dateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to = today, driver = '', site = '', kind = '';
  let fetched = [];
  let loading = false;
  let view = 'trips', acctTrips = null, acctLoading = false;

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
      .filter((t) => (!kind || (t.kind || 'driver') === kind) && (!driver || t.employeeId === driver || t.driverId === driver) && (!site || t.siteId === site || t.startSiteId === site || t.endSiteId === site))
      .sort((a, b) => (b.startAt || 0) - (a.startAt || 0));
  }

  async function loadAccounts() {
    acctLoading = true; draw();
    try { acctTrips = await finishedTripsFor(store.users.filter((u) => u.isDriver).map((u) => u.id)); } catch (e) { toast(friendlyError(e), true); acctTrips = []; }
    acctLoading = false; draw();
  }

  function tabs() {
    return admin ? `<div class="chips" style="margin-bottom:12px">${[['trips', 'Trips & rides'], ['accounts', 'Driver accounts & payments']]
      .map(([k, l]) => `<span class="chip ${view === k ? 'on' : ''}" data-view="${k}">${l}</span>`).join('')}</div>` : '';
  }
  function wireTabs() {
    el.querySelectorAll('[data-view]').forEach((c) => {
      c.onclick = () => { view = c.dataset.view; if (view === 'accounts') loadAccounts(); else draw(); };
    });
  }

  // ------------------------------------------------ driver accounts: earned (trip costs) − paid = balance
  function drawAccounts() {
    const drivers = store.users.filter((u) => u.isDriver);
    const all = acctTrips || [];
    const rows = drivers.map((u) => {
      const tr = all.filter((t) => t.employeeId === u.id);
      const pays = store.payments.filter((p) => p.employeeId === u.id);
      const earned = tr.reduce((a, t) => a + (t.cost || 0), 0);
      const paid = pays.reduce((a, p) => a + p.amount, 0);
      return { u, tr, pays, earned, paid, balance: Math.round((earned - paid) * 100) / 100, km: tr.reduce((a, t) => a + tripKm(t), 0),
        edited: tr.filter((t) => t.costEntered).length };
    }).sort((a, b) => b.balance - a.balance);
    const T = (k) => rows.reduce((a, r) => a + r[k], 0);
    el.innerHTML = `${tabs()}
    <div class="grid kpis">
      ${kpi('Earned by drivers', fmtMoney(Math.round(T('earned') * 100) / 100), `${all.length} finished trips · all time`, '#404041')}
      ${kpi('Paid', fmtMoney(Math.round(T('paid') * 100) / 100), `${store.payments.length} payments`, '#2E9E6A')}
      ${kpi('Balance due', fmtMoney(Math.round(T('balance') * 100) / 100), 'earned − paid', '#D98A1A')}
    </div>
    <div class="card mt"><div class="card-head"><h2>Driver accounts</h2><span class="spacer"></span><span class="small muted">${acctLoading ? 'Loading…' : 'All time'}</span></div>
      ${drivers.length ? `<div class="table-wrap"><table class="t tr-t"><thead><tr><th>Driver</th><th class="num">Trips</th><th class="num">Km</th><th class="num">Earned</th><th class="num">Paid</th><th class="num">Balance</th><th>Last payment</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr>
        <td><div class="person">${avatar(r.u.name, 30, TRIP_COLOR)}<div><b>${esc(r.u.name)}</b><div class="small muted">${esc(r.u.vehicle || '')} · ${tripRateFor(r.u.id)} AED/km</div></div></div></td>
        <td class="num">${r.tr.length}${r.edited ? `<div class="small muted" title="Trips where the driver entered the cost">${r.edited} entered</div>` : ''}</td>
        <td class="num">${r.km.toFixed(1)}</td>
        <td class="num">${fmtMoney(Math.round(r.earned * 100) / 100)}</td>
        <td class="num" style="color:#1f7a50">${fmtMoney(Math.round(r.paid * 100) / 100)}</td>
        <td class="num"><b style="color:${r.balance > 0 ? '#a8640f' : '#1f7a50'}">${r.balance < 0 ? 'Overpaid ' : ''}${fmtMoney(Math.abs(r.balance))}</b></td>
        <td class="small">${r.pays[0] ? `${esc(r.pays[0].date)} · ${fmtMoney(r.pays[0].amount)}` : '—'}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-pay="${r.u.id}">+ Payment</button> <button class="btn sm ghost" data-stmt="${r.u.id}">Statement</button></td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty"><b>No drivers yet</b>Set Work profile: Driver (taxi) on an employee.</div>'}
    </div>
    <div class="card mt"><div class="card-head"><h2>Payments</h2></div>
      ${store.payments.length ? store.payments.slice(0, 50).map((p) => `<div class="list-item">
        ${avatar(p.employeeName, 28, '#2E9E6A')}<div class="grow"><b>${esc(p.employeeName)}</b> <span class="small muted">· ${esc(p.date)}${p.method ? ` · ${esc(p.method)}` : ''}${p.note ? ` · ${esc(p.note)}` : ''} · by ${esc(p.createdBy)}</span></div>
        <b>${fmtMoney(p.amount)}</b><button class="btn sm ghost icon" data-delpay="${p.id}" title="Delete payment">${icon('trash', 15)}</button></div>`).join('')
        : '<div class="empty">No payments recorded yet</div>'}
    </div>`;
    wireTabs();
    el.querySelectorAll('[data-pay]').forEach((b) => { b.onclick = () => payDialog(store.user(b.dataset.pay), rows.find((r) => r.u.id === b.dataset.pay)?.balance || 0); });
    el.querySelectorAll('[data-stmt]').forEach((b) => { b.onclick = () => { const r = rows.find((x) => x.u.id === b.dataset.stmt); if (r) statementDialog(r.u, r.tr, r.pays); }; });
    el.querySelectorAll('[data-delpay]').forEach((b) => {
      b.onclick = async () => {
        const p = store.payments.find((x) => x.id === b.dataset.delpay);
        if (!p || !await confirmBox('Delete payment', `Delete the payment of ${fmtMoney(p.amount)} to ${p.employeeName} on ${p.date}?`, { ok: 'Delete', danger: true })) return;
        try { await deleteDriverPayment(p.id); toast('Payment deleted'); } catch (e) { toast(friendlyError(e), true); }
      };
    });
  }

  function draw() {
    if (view === 'accounts') { drawAccounts(); return; }
    const list = trips();
    const active = store.tripsActive;
    const km = list.reduce((a, t) => a + tripKm(t), 0);
    const cost = list.reduce((a, t) => a + tripCost(t), 0);
    const drivers = store.users.filter((u) => u.isDriver);
    const people = store.users.filter((u) => u.role === 'employee');
    const costOf = (k) => list.filter((t) => (t.kind || 'driver') === k).reduce((a, t) => a + tripCost(t), 0);
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

    el.innerHTML = `${tabs()}
    <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <div class="seg">${[['today', 'Today'], ['yday', 'Yesterday'], ['7', 'Last 7 days'], ['month', 'This month']].map(([k, l]) => `<button class="btn sm ghost" data-quick="${k}">${l}</button>`).join('')}</div>
      <label class="row small" style="gap:6px;flex-wrap:nowrap">From <input type="date" id="tr-from" value="${from}" style="width:150px"></label>
      <label class="row small" style="gap:6px;flex-wrap:nowrap">To <input type="date" id="tr-to" value="${to}" style="width:150px"></label>
      <select id="tr-kind" style="width:auto;min-width:140px">${[['', 'All types'], ['driver', 'Driver trips'], ['taxi', 'Taxi rides'], ['withDriver', 'Rides with driver']].map(([v, l]) => `<option value="${v}" ${v === kind ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="tr-driver" style="width:auto;min-width:150px"><option value="">All people</option>${people.map((u) => `<option value="${u.id}" ${u.id === driver ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
      <select id="tr-site" style="width:auto;min-width:150px"><option value="">All sites</option>${store.sites.map((s) => `<option value="${s.id}" ${s.id === site ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <span class="spacer"></span>
      ${admin ? `<span class="small muted">Company rate</span><input id="tr-rate" type="number" min="0" step="0.01" value="${store.settings.tripRatePerKm || 0}" style="width:90px"> <span class="small muted">AED / km</span> <button class="btn sm" id="tr-rate-save">Save</button>` : ''}
    </div>
    ${!drivers.length ? `<div class="card pad" style="background:#fff4e2;margin-bottom:12px">${icon('warn', 16)} No drivers yet. Open <a href="#/employees">Employees</a> → edit a person → <b>Work profile: Driver (taxi)</b>. Their login opens the driver app with Start / Stop trip. Staff can already start taxi rides below their check-in button.</div>` : ''}
    <div class="grid kpis">
      ${kpi('Trips & rides', list.length, `${list.filter((t) => (t.kind || 'driver') === 'driver').length} driver · ${list.filter((t) => t.kind === 'taxi').length} taxi · ${list.filter((t) => t.kind === 'withDriver').length} with driver`, TRIP_COLOR)}
      ${kpi('Distance', `${km.toFixed(1)} km`, list.length ? `avg ${(km / list.length).toFixed(1)} km / trip` : '—', '#2E9E6A')}
      ${admin ? kpi('Cost', fmtMoney(Math.round(cost * 100) / 100), `drivers ${fmtMoney(Math.round(costOf('driver') * 100) / 100)} · taxi ${fmtMoney(Math.round(costOf('taxi') * 100) / 100)}`, '#D98A1A') : kpi('Driving time', fmtMins(list.reduce((a, t) => a + tripMinutes(t), 0)), 'total', '#D98A1A')}
      ${kpi('In progress', active.length, active.length ? 'driving now' : 'no trip running', active.length ? '#2E9E6A' : '#404041')}
    </div>
    ${active.length ? `<div class="card mt" style="border:2px solid #2E9E6A"><div class="card-head"><h2>Driving now</h2><span class="spacer"></span>${pill('Live', 'green', true)}</div>
      ${active.map((t) => `<div class="list-item">
        ${avatar(t.employeeName, 32, '#2E9E6A')}
        <div class="grow"><b>${esc(t.employeeName)}</b> ${kindPill(t)}${t.vehicle && t.kind !== 'taxi' ? ` <span class="small muted">· ${esc(t.vehicle)}</span>` : ''}
          <div class="small muted">From ${esc(t.startSiteName || 'GPS location')} · started ${fmtTime(atTz(t.startAt, t.tz))} · ${fmtMins(tripMinutes(t))}${t.purpose ? ` · ${esc(t.purpose)}` : ''} · last GPS ${timeAgo(t.lastAt)}</div></div>
        <b>${tripKm(t).toFixed(1)} km</b>
        <button class="btn sm ghost" data-route="${t.id}">${icon('map', 14)} Route</button>
        <button class="btn sm ghost" data-end="${t.id}" title="End a trip the driver forgot to stop">End</button>
      </div>`).join('')}</div>` : ''}
    <div class="grid cols-2-1 mt">
      <div class="card"><div class="card-head"><h2>Trips</h2><span class="spacer"></span><span class="small muted">${loading ? 'Loading…' : `${list.length} trip${list.length === 1 ? '' : 's'}`}</span></div>
        ${list.length ? `<div class="table-wrap"><table class="t tr-t"><thead><tr><th>Date</th><th>Person</th><th>Type</th><th>Route</th><th>Charged to</th><th>Time</th><th class="num">Km</th>${admin ? '<th class="num">Cost</th>' : ''}<th></th></tr></thead><tbody>
        ${list.map((t) => `<tr class="click" data-row="${t.id}">
          <td>${esc(t.date.slice(5))}</td>
          <td><b>${esc(t.employeeName)}</b>${t.vehicle && t.kind !== 'taxi' ? `<div class="small muted">${esc(t.vehicle)}</div>` : ''}</td>
          <td>${kindPill(t)}</td>
          <td>${esc(t.startSiteName || 'GPS')} → ${t.status === 'active' ? '<i class="muted">driving…</i>' : esc(t.endSiteName || 'GPS')}${t.purpose ? `<div class="small muted">${esc(t.purpose)}</div>` : ''}</td>
          <td>${t.siteId ? `<a href="#/sites/${t.siteId}">${esc(t.siteName)}</a>` : t.status === 'active' ? '<span class="muted">—</span>' : '<span class="muted">No site</span>'}</td>
          <td class="small">${fmtTime(atTz(t.startAt, t.tz))} – ${t.endAt ? fmtTime(atTz(t.endAt, t.tz)) : 'now'}<div class="muted">${fmtMins(tripMinutes(t))} · ${tzLabel(t.tz)}</div></td>
          <td class="num"><b>${tripKm(t).toFixed(1)}</b>${t.editedBy ? `<div class="small muted" title="Edited by ${esc(t.editedBy)}">edited</div>` : ''}</td>
          ${admin ? `<td class="num">${t.kind === 'withDriver' ? '<span class="small muted" title="Paid through the driver’s own trip">via driver</span>' : t.kind === 'taxi' && t.status === 'active' ? '<span class="small muted">fare at end</span>' : fmtMoney(tripCost(t))}${t.status === 'active' && (t.kind || 'driver') === 'driver' && !t.costEntered ? '<div class="small muted">est.</div>' : ''}${t.costEntered ? '<div class="small" style="color:#a8640f" title="Cost entered by the driver">entered</div>' : ''}</td>` : ''}
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
        <div class="card mt"><div class="card-head"><h2>By person</h2></div>
          ${[...byDriver.values()].sort((a, b) => b.km - a.km).map((c) => `<div class="list-item">${avatar(c.name, 28, TRIP_COLOR)}
            <div class="grow"><b>${esc(c.name)}</b><div class="small muted">${c.n} trip${c.n === 1 ? '' : 's'} · ${fmtMins(c.mins)}${admin && store.user(c.id)?.isDriver ? ` · ${tripRateFor(c.id)} AED/km` : ''}</div></div>
            <div style="text-align:right"><b>${c.km.toFixed(1)} km</b>${admin ? `<div class="small">${fmtMoney(Math.round(c.cost * 100) / 100)}</div>` : ''}</div></div>`).join('') || '<div class="empty">—</div>'}
        </div>
      </div>
    </div>`;
    wire(list);
  }

  function wire(list) {
    wireTabs();
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
    el.querySelector('#tr-kind').onchange = (e) => { kind = e.target.value; draw(); };
    el.querySelector('#tr-site').onchange = (e) => { site = e.target.value; draw(); };
    const rs = el.querySelector('#tr-rate-save');
    if (rs) rs.onclick = async () => {
      const v = Number(el.querySelector('#tr-rate').value);
      if (!(v >= 0)) { toast('Enter a rate (AED per km)', true); return; }
      try { await saveSettings({ tripRatePerKm: v }); toast(`Company rate set to ${v} AED / km (for new trips)`); } catch (e) { toast(friendlyError(e), true); }
    };
    el.querySelectorAll('[data-route]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); const t = find(b.dataset.route); if (t) routeDialog(t); }; });
    el.querySelectorAll('[data-row]').forEach((r) => { r.onclick = (e) => { if (e.target.closest('button, a')) return; const t = find(r.dataset.row); if (t) routeDialog(t); }; });
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
    try { toast('Preparing report…'); await downloadReport(await tripsReport(from, to, driver || null, site || null, kind), fmt); } catch (e) { toast(friendlyError(e), true); }
  };
  document.getElementById('tr-xlsx').onclick = exp('xlsx');
  document.getElementById('tr-pdf').onclick = exp('pdf');

  load();
  let last = '';
  return store.on(() => {
    const sig = JSON.stringify([store.payments.map((p) => [p.id, p.amount]), store.tripsToday.map((t) => [t.id, t.distanceM, t.status, t.siteId, +t.lastAt, t.cost]), store.tripsActive.map((t) => t.id), store.users.length, store.settings]);
    if (sig !== last) { last = sig; draw(); }
  });
}

function kindPill(t) {
  const k = t.kind || 'driver';
  return pill(tripKindLabel(t), k === 'taxi' ? 'amber' : k === 'withDriver' ? 'blue' : 'purple');
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
      <div class="grid cols-2" style="gap:6px 16px;margin-bottom:10px;font-size:13px">
        <div><span class="muted">Type</span> <b>${esc(tripKindLabel(t))}</b></div>
        <div><span class="muted">Time</span> <b>${fmtTime(atTz(t.startAt, t.tz))} – ${t.endAt ? fmtTime(atTz(t.endAt, t.tz)) : 'now'}</b> ${esc(tzLabel(t.tz))}</div>
        <div><span class="muted">Pick-up</span> <b>${esc(t.startSiteName || 'GPS location')}</b></div>
        <div><span class="muted">Drop-off</span> <b>${esc(t.status === 'active' ? '—' : (t.endSiteName || 'GPS location'))}</b></div>
        <div><span class="muted">Charged to</span> <b>${esc(t.siteName || '—')}</b></div>
        ${isAdmin() ? `<div><span class="muted">Cost</span> <b>${t.kind === 'withDriver' ? 'paid via the driver’s trip' : fmtMoney(tripCost(t))}</b>${t.costEntered ? ' <span class="small" style="color:#a8640f">entered by driver</span>' : ''}${t.ratePerKm != null ? ` <span class="small muted">· ${t.ratePerKm} AED/km</span>` : ''}</div>` : ''}
        ${t.purpose ? `<div><span class="muted">Purpose</span> <b>${esc(t.purpose)}</b></div>` : ''}
        ${t.note ? `<div><span class="muted">Note</span> ${esc(t.note)}</div>` : ''}
      </div>
      <div id="rt-map" class="map" style="height:380px"></div><div id="rt-info" class="small muted" style="margin-top:6px">Loading route…</div>`,
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
    title: `Edit ${tripKindLabel(t).toLowerCase()}`,
    body: `<div class="small muted" style="margin-bottom:10px">${esc(t.employeeName)} · ${esc(t.date)} · GPS measured ${(t.originalDistanceM ?? t.distanceM) / 1000 > 0 ? ((t.originalDistanceM ?? t.distanceM) / 1000).toFixed(2) : '0'} km</div>
      <div class="grid cols-2" style="gap:10px">
        <label class="f"><span>Distance (km)</span><input id="et-km" type="number" min="0" step="0.01" value="${tripKm(t).toFixed(2)}"></label>
        ${t.kind === 'taxi' ? `<label class="f"><span>Taxi fare (AED)</span><input id="et-fare" type="number" min="0" step="0.01" value="${t.cost ?? 0}"></label>`
          : t.kind === 'withDriver' ? '<div class="small muted" style="padding-top:22px">Ride with a company driver — paid through the driver’s trip.</div>'
          : `<label class="f"><span>Rate (AED / km)</span><input id="et-rate" type="number" min="0" step="0.01" value="${t.ratePerKm ?? tripRateFor(t.employeeId)}"></label>
             <label class="f"><span>Cost (AED) — km × rate, or type an amount</span><input id="et-costv" type="number" min="0" step="0.01" value="${tripCost(t)}"></label>`}
        <label class="f"><span>Vehicle</span><input id="et-veh" value="${esc(t.vehicle)}"></label>
        <label class="f"><span>Purpose</span><input id="et-pur" value="${esc(t.purpose)}"></label>
      </div>
      <label class="f"><span>Charge to site</span><select id="et-site"><option value="">— No site —</option>${store.sites.map((s) => `<option value="${s.id}" ${s.id === t.siteId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Note</span><input id="et-note" value="${esc(t.note)}"></label>
      <div class="small muted" id="et-cost"></div>`,
    foot: '<button class="btn ghost" data-no>Cancel</button><button class="btn" data-yes>Save</button>',
    onMount: (el, close) => {
      const v = (id) => el.querySelector(id).value;
      const has = (id) => !!el.querySelector(id);
      const upd = () => {
        el.querySelector('#et-cost').textContent = has('#et-costv') ? '' : has('#et-rate') ? `Cost: ${fmtMoney(Math.round(Number(v('#et-km')) * Number(v('#et-rate')) * 100) / 100)}`
          : has('#et-fare') ? `Cost: ${fmtMoney(Number(v('#et-fare')) || 0)}` : 'Cost: none (paid via the driver)';
      };
      const recalc = () => { if (has('#et-costv')) el.querySelector('#et-costv').value = Math.round(Number(v('#et-km')) * Number(v('#et-rate')) * 100) / 100; upd(); };
      el.querySelector('#et-km').oninput = has('#et-rate') ? recalc : upd; if (has('#et-rate')) el.querySelector('#et-rate').oninput = recalc; if (has('#et-fare')) el.querySelector('#et-fare').oninput = upd; upd();
      el.querySelector('[data-no]').onclick = close;
      el.querySelector('[data-yes]').onclick = async () => {
        const km = Number(v('#et-km')), rate = has('#et-rate') ? Number(v('#et-rate')) : null, fare = has('#et-fare') ? Number(v('#et-fare')) : has('#et-costv') ? Number(v('#et-costv')) : null;
        if (!(km >= 0) || (rate != null && !(rate >= 0)) || (fare != null && !(fare >= 0))) { toast('Enter valid numbers', true); return; }
        try {
          await editTrip(t, { km, ratePerKm: rate, fare, siteId: v('#et-site'), vehicle: v('#et-veh').trim(), purpose: v('#et-pur').trim(), note: v('#et-note').trim() });
          toast('Trip updated'); close(); onDone && onDone();
        } catch (e) { toast(friendlyError(e), true); }
      };
    },
  });
}

function payDialog(u, balance) {
  if (!u) return;
  modal({
    title: `Payment to ${u.name}`,
    body: `<div class="small muted" style="margin-bottom:10px">Balance due now: <b>${fmtMoney(balance)}</b></div>
      <div class="grid cols-2" style="gap:10px">
        <label class="f"><span>Amount (AED)</span><input id="pd-amt" type="number" min="0" step="0.01" value="${balance > 0 ? balance : ''}"></label>
        <label class="f"><span>Date</span><input id="pd-date" type="date" value="${dateKey(new Date())}"></label>
        <label class="f"><span>Method</span><select id="pd-m"><option>Cash</option><option>Bank transfer</option><option>Cheque</option><option>Other</option></select></label>
        <label class="f"><span>Note / reference</span><input id="pd-note"></label>
      </div><div class="error" id="pd-err"></div>`,
    foot: '<button class="btn ghost" data-no>Cancel</button><button class="btn" data-yes>Save payment</button>',
    onMount: (el, close) => {
      el.querySelector('[data-no]').onclick = close;
      el.querySelector('[data-yes]').onclick = async () => {
        const amount = Number(el.querySelector('#pd-amt').value), date = el.querySelector('#pd-date').value;
        if (!(amount > 0) || !date) { el.querySelector('#pd-err').textContent = 'Enter the amount and date.'; return; }
        try {
          await addDriverPayment({ driver: u, amount, date, method: el.querySelector('#pd-m').value, note: el.querySelector('#pd-note').value.trim() });
          toast(`Payment of ${fmtMoney(amount)} saved — it shows in ${u.name}'s app`); close();
        } catch (e) { el.querySelector('#pd-err').textContent = friendlyError(e); }
      };
    },
  });
}

/** Ledger: trips (+) and payments (−) in date order with a running balance. */
function statementRows(trips, pays) {
  const items = [
    ...trips.map((t) => ({ date: t.date, at: t.startAt || new Date(0), type: 'Trip', desc: `${t.startSiteName || 'GPS'} → ${t.endSiteName || 'GPS'}${t.purpose ? ` · ${t.purpose}` : ''}`,
      km: Math.round(tripKm(t) * 10) / 10, plus: t.cost || 0, minus: 0, flag: t.costEntered ? 'cost entered by driver' : '' })),
    ...pays.map((p) => ({ date: p.date, at: new Date(`${p.date}T23:59:00`), type: 'Payment', desc: [p.method, p.note].filter(Boolean).join(' · '), km: '', plus: 0, minus: p.amount, flag: p.createdBy ? `by ${p.createdBy}` : '' })),
  ].sort((a, b) => a.at - b.at);
  let bal = 0;
  return items.map((i) => { bal = Math.round((bal + i.plus - i.minus) * 100) / 100; return { ...i, bal }; });
}
function statementDialog(u, trips, pays) {
  const rows = statementRows(trips, pays);
  const rep = {
    title: `Driver statement — ${u.name}`,
    subtitle: `${u.vehicle ? `${u.vehicle} · ` : ''}generated ${dateKey(new Date())} · balance ${rows.length ? rows[rows.length - 1].bal : 0} AED`,
    filename: `driver-statement-${u.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    orientation: 'portrait',
    sheets: [{ name: 'Statement', columns: ['Date', 'Type', 'Details', 'Km', 'Earned (AED)', 'Paid (AED)', 'Balance (AED)', 'Note'], widths: [11, 9, 36, 7, 12, 12, 13, 22],
      rows: rows.map((r) => [r.date, r.type, r.desc, r.km, r.plus || '', r.minus || '', r.bal, r.flag]),
      totals: ['TOTAL', '', '', '', Math.round(rows.reduce((a, r) => a + r.plus, 0) * 100) / 100, Math.round(rows.reduce((a, r) => a + r.minus, 0) * 100) / 100, rows.length ? rows[rows.length - 1].bal : 0, ''] }],
  };
  modal({
    title: rep.title, wide: true,
    body: `<div class="table-wrap" style="max-height:60vh;overflow:auto"><table class="t tr-t"><thead><tr><th>Date</th><th>Type</th><th>Details</th><th class="num">Earned</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${r.type === 'Payment' ? pill('Payment', 'green') : pill('Trip', 'purple')}</td>
        <td class="small">${esc(r.desc)}${r.km !== '' ? ` · ${r.km} km` : ''}${r.flag ? `<div class="muted">${esc(r.flag)}</div>` : ''}</td>
        <td class="num">${r.plus ? fmtMoney(r.plus) : ''}</td><td class="num" style="color:#1f7a50">${r.minus ? fmtMoney(r.minus) : ''}</td><td class="num"><b>${fmtMoney(r.bal)}</b></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">Nothing yet</div></td></tr>'}
      </tbody></table></div>`,
    foot: '<button class="btn ghost" data-x2>Close</button><button class="btn ghost" data-f="pdf">PDF</button><button class="btn" data-f="xlsx">Excel</button>',
    onMount: (el, close) => {
      el.querySelector('[data-x2]').onclick = close;
      el.querySelectorAll('[data-f]').forEach((b) => { b.onclick = async () => { try { await downloadReport(rep, b.dataset.f); } catch (e) { toast(friendlyError(e), true); } }; });
    },
  });
}
