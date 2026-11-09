// TV screen: a full-screen, hands-free live view for a wall TV — who is working where, what is happening,
// and (optionally) the money position. Updates itself; long lists scroll slowly on their own.
import { store, staffStatuses, isAdmin, canSeeAccounts, acctPositionNow, recentUpdates, sessionMinutes, entryMinutes, alertLabel, db } from '../fb.js';
import { esc, fmtMins, fmtTime, fmtMoney, initials, colorFor, timeAgo, dateKey, EXT_COLOR } from '../util.js';
import { makeMap, fitTo } from '../mapkit.js';
import { collection, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const PREF = 'tvPrefs';
const prefs = (() => { try { return { money: true, map: true, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return { money: true, map: true }; } })();
const savePrefs = () => { try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch { /* */ } };

export function mount(el) {
  document.body.classList.add('tv-mode');
  const subs = [];
  const timers = [];
  let tickets = [];
  let updates = [];
  let cash = null;
  let wake = null;

  el.innerHTML = `<div class="tv">
    <header class="tv-top">
      <div class="tv-brand"><img src="img/icon-192.png" alt="" onerror="this.style.display='none'"><div><b>LLCT Live</b><span>Leaders Line Trading LLC</span></div></div>
      <div class="tv-kpis" id="tv-kpis"></div>
      <div class="tv-clock"><b id="tv-time"></b><span id="tv-date"></span></div>
      <div class="tv-ctl">
        <button id="tv-money" title="Show / hide accounts">AED</button>
        <button id="tv-mapbtn" title="Show / hide map">Map</button>
        <button id="tv-fs" title="Full screen">⛶</button>
        <a href="#/" title="Back to dashboard">✕</a>
      </div>
    </header>
    <main class="tv-grid ${prefs.map ? '' : 'nomap'}" id="tv-grid">
      <section class="tv-card tv-mapcard"><h2>Live map <span id="tv-mapn"></span></h2><div id="tv-map"></div></section>
      <section class="tv-card"><h2>On duty by site <span id="tv-dutyn"></span></h2><div class="tv-scroll" id="tv-duty"></div></section>
      <section class="tv-card tv-right">
        <div class="tv-events"><h2>Events today</h2><div class="tv-scroll" id="tv-events"></div></div>
        <div class="tv-money" id="tv-moneybox"></div>
      </section>
    </main>
    <footer class="tv-foot" id="tv-foot"></footer>
  </div>`;

  // ---- clock
  const clock = () => {
    const d = new Date();
    el.querySelector('#tv-time').textContent = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    el.querySelector('#tv-date').textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  };
  clock();
  timers.push(setInterval(clock, 1000));

  // ---- keep the TV awake, controls
  const lock = async () => { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wake = await navigator.wakeLock.request('screen'); } catch { /* */ } };
  lock();
  const onVis = () => { if (document.visibilityState === 'visible') lock(); };
  document.addEventListener('visibilitychange', onVis);
  el.querySelector('#tv-fs').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()).catch?.(() => {});
  const moneyAllowed = canSeeAccounts();
  const mb = el.querySelector('#tv-money');
  if (!moneyAllowed) mb.style.display = 'none';
  const markBtns = () => { mb.classList.toggle('off', !prefs.money); el.querySelector('#tv-mapbtn').classList.toggle('off', !prefs.map); };
  markBtns();
  mb.onclick = () => { prefs.money = !prefs.money; savePrefs(); markBtns(); if (prefs.money) loadCash(); draw(); };
  el.querySelector('#tv-mapbtn').onclick = () => {
    prefs.map = !prefs.map; savePrefs(); markBtns();
    el.querySelector('#tv-grid').classList.toggle('nomap', !prefs.map);
    setTimeout(() => map?.invalidateSize(), 100);
  };
  const onKey = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) location.hash = '#/'; };
  document.addEventListener('keydown', onKey);
  // hide the cursor and controls when nobody touches the mouse
  let idle;
  const wakeUi = () => { el.querySelector('.tv').classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => el.querySelector('.tv')?.classList.add('idle'), 4000); };
  document.addEventListener('mousemove', wakeUi);
  wakeUi();

  // ---- data that is not in the shared store
  try {
    subs.push(onSnapshot(query(collection(db, 'svcTickets'), where('open', '==', true)), (q) => {
      tickets = q.docs.map((d) => ({ id: d.id, ...d.data() }));
      draw();
    }, () => {}));
  } catch { /* service desk not set up */ }
  const loadUpdates = () => recentUpdates(12).then((l) => { updates = l; draw(); }).catch(() => {});
  loadUpdates();
  timers.push(setInterval(loadUpdates, 120000));
  const loadCash = () => { if (moneyAllowed && prefs.money) acctPositionNow().then((p) => { cash = p; draw(); }).catch(() => {}); };
  loadCash();
  timers.push(setInterval(loadCash, 300000));
  subs.push(store.on(() => draw()));
  timers.push(setInterval(() => draw(), 30000)); // hours and "x min ago" move on

  // ---- map
  let map = null;
  let layer = null;
  let fittedAt = 0;
  const L = window.L;
  if (L) {
    map = makeMap(el.querySelector('#tv-map'), { zoom: 11 });
    map.zoomControl?.remove();
    layer = L.layerGroup().addTo(map);
  }
  const pin = (lat, lng, label, color, small = false) => L.marker([lat, lng], {
    icon: L.divIcon({ className: '', iconSize: null, iconAnchor: [small ? 12 : 17, small ? 12 : 17],
      html: `<div class="tv-pin${small ? ' sm' : ''}" style="background:${color}">${esc(initials(label))}</div><div class="tv-pinl">${esc(label.split(' ')[0])}</div>` }),
  });

  function drawMap(st) {
    if (!map || !prefs.map) return;
    layer.clearLayers();
    const pts = [];
    store.sites.filter((s) => s.active && store.open.some((o) => o.siteId === s.id)).forEach((s) => {
      L.circle([s.lat, s.lng], { radius: Math.max(s.radius || 100, 80), color: '#FCB040', weight: 1.5, fillColor: '#FCB040', fillOpacity: 0.12 }).addTo(layer);
      L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', iconSize: null, iconAnchor: [0, -14], html: `<div class="tv-site">${esc(s.name)}</div>` }) }).addTo(layer);
      pts.push([s.lat, s.lng]);
    });
    st.filter((s) => s.state === 'onDuty').forEach((s) => {
      const site = store.site(s.open.siteId);
      const loc = s.user.lastLocation || (site ? { lat: site.lat, lng: site.lng } : null);
      if (!loc) return;
      const fresh = s.user.lastLocation?.at && Date.now() - s.user.lastLocation.at.getTime() < 15 * 60000;
      pin(loc.lat, loc.lng, s.user.name, fresh ? '#2E9E6A' : '#E08E2B').addTo(layer);
      pts.push([loc.lat, loc.lng]);
    });
    store.tripsActive.forEach((t) => {
      const lat = t.lastLat ?? t.startLat, lng = t.lastLng ?? t.startLng;
      if (lat == null) return;
      pin(lat, lng, t.employeeName, '#7B4FC9', true).addTo(layer);
      pts.push([lat, lng]);
    });
    el.querySelector('#tv-mapn').textContent = pts.length ? '' : '— nobody on duty';
    if (pts.length && Date.now() - fittedAt > 600000) { fitTo(map, pts, 14); fittedAt = Date.now(); }
  }

  // ---- render
  let pending = false;
  function draw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  }
  function render() {
    if (!store.loaded) return;
    const st = staffStatuses();
    const count = (k) => st.filter((s) => s.state === k).length;
    const extNow = store.extOnSite.length;
    const mins = st.reduce((a, s) => a + s.minutes, 0) + store.workersToday.reduce((a, e) => a + entryMinutes(e), 0);
    const newTickets = tickets.filter((t) => t.status === 'new').length;
    const missed = store.open.filter((o) => o.date < dateKey(new Date())).length;

    const k = (n, label, color, sub = '') => `<div class="tv-k" style="--c:${color}"><b>${n}</b><span>${label}${sub ? `<i>${sub}</i>` : ''}</span></div>`;
    el.querySelector('#tv-kpis').innerHTML = [
      k(count('onDuty') + extNow, 'On site now', '#2E9E6A', `${count('onDuty')} staff · ${extNow} ext`),
      k(count('done'), 'Checked out', '#E8A23A'),
      k(count('notIn'), 'Not in yet', count('notIn') ? '#D64545' : '#6b6b6e'),
      k(count('off'), 'Off today', '#8a8a8e'),
      k(fmtMins(mins), 'Man-hours', '#5B9BEA'),
      k(tickets.length, 'Open service', newTickets ? '#D64545' : '#8E5CC4', newTickets ? `${newTickets} new` : ''),
    ].join('');

    // ---- on duty grouped by site
    const bySite = new Map();
    st.filter((s) => s.state === 'onDuty').forEach((s) => {
      const key = s.open.siteId || s.open.siteName;
      if (!bySite.has(key)) bySite.set(key, { name: s.open.siteName, staff: [], ext: [] });
      bySite.get(key).staff.push(s);
    });
    store.extOnSite.forEach((l) => {
      const key = l.siteId || l.siteName;
      if (!bySite.has(key)) bySite.set(key, { name: l.siteName, staff: [], ext: [] });
      bySite.get(key).ext.push(l);
    });
    const groups = [...bySite.values()].sort((a, b) => (b.staff.length + b.ext.length) - (a.staff.length + a.ext.length));
    el.querySelector('#tv-dutyn').textContent = `${groups.length} site${groups.length === 1 ? '' : 's'}`;
    const notIn = st.filter((s) => s.state === 'notIn');
    el.querySelector('#tv-duty').innerHTML = (groups.length ? groups.map((g) => `<div class="tv-site-g">
        <div class="tv-sg-h"><b>${esc(g.name)}</b><span>${g.staff.length} staff${g.ext.length ? ` · <em>${g.ext.length} ext</em>` : ''}</span></div>
        ${g.staff.map((s) => `<div class="tv-p"><span class="tv-av" style="background:${colorFor(s.user.name)}">${esc(initials(s.user.name))}</span>
          <span class="tv-pn">${esc(s.user.name)}${s.forgot ? ' <em class="red">not signed out</em>' : ''}</span><span class="tv-pt">since ${fmtTime(s.open.inLocal)} · <b>${fmtMins(sessionMinutes(s.open, new Date()))}</b></span></div>`).join('')}
        ${g.ext.length ? `<div class="tv-ext">${g.ext.map((l) => esc(store.worker(l.workerId)?.name || l.name || 'Worker')).join(' · ')}</div>` : ''}
      </div>`).join('') : '<div class="tv-empty">Nobody on duty right now</div>')
      + (notIn.length ? `<div class="tv-notin"><b>Not checked in (${notIn.length})</b><div>${notIn.map((s) => esc(s.user.name)).join(' · ')}</div></div>` : '');

    // ---- events today (newest first)
    const today = dateKey(new Date());
    const ev = [];
    store.today.forEach((s) => {
      ev.push({ t: s.checkIn, c: '#2E9E6A', i: '▶', h: `<b>${esc(s.employeeName)}</b> checked in · ${esc(s.siteName)}`, at: s.inLocal });
      if (s.checkOut) ev.push({ t: s.checkOut, c: '#E8A23A', i: '■', h: `<b>${esc(s.employeeName)}</b> checked out · ${esc(s.siteName)} (${fmtMins(sessionMinutes(s))})`, at: s.outLocal });
    });
    store.alerts.forEach((a) => ev.push({ t: a.at || a.atLocal, c: '#D64545', i: '!', h: `<b>${esc(a.employeeName)}</b> — ${esc(alertLabel(a))}`, at: a.atLocal, hot: true }));
    tickets.forEach((t) => {
      const at = t.createdAt?.toDate ? t.createdAt.toDate() : (t.createdAt ? new Date(t.createdAt) : null);
      if (!at) return;
      ev.push({ t: at, c: t.status === 'new' ? '#D64545' : '#8E5CC4', i: '🛠', h: `${t.status === 'new' ? '<b class="red">New service request</b>' : 'Service request'} · <b>${esc(t.clientName || '')}</b>${t.siteName ? ` · ${esc(t.siteName)}` : ''}`, at, hot: t.status === 'new' });
    });
    updates.filter((u) => u.date === today || (u.createdAt && dateKey(u.createdAt) === today))
      .forEach((u) => ev.push({ t: u.createdAt, c: '#5B9BEA', i: '📷', h: `<b>${esc(u.employeeName)}</b> posted ${esc(u.category.toLowerCase())} · ${esc(u.siteName)}${u.progress != null ? ` · ${u.progress}%` : ''}`, at: u.createdLocal }));
    store.tripsActive.forEach((t) => ev.push({ t: t.startAt, c: '#7B4FC9', i: '🚗', h: `<b>${esc(t.employeeName)}</b> driving${t.startSiteName ? ` from ${esc(t.startSiteName)}` : ''} · ${((t.distanceM || 0) / 1000).toFixed(1)} km`, at: t.startAt }));
    if (missed) ev.push({ t: new Date(), c: '#D64545', i: '⚑', h: `<b class="red">${missed} missed sign-out${missed === 1 ? '' : 's'}</b> waiting for review`, at: null, hot: true });
    ev.sort((a, b) => (b.t || 0) - (a.t || 0));
    el.querySelector('#tv-events').innerHTML = ev.length ? ev.slice(0, 40).map((e) => `<div class="tv-ev${e.hot ? ' hot' : ''}">
        <span class="tv-evi" style="background:${e.c}">${e.i}</span><span class="tv-evt">${e.h}</span><span class="tv-evtime">${e.at ? fmtTime(e.at) : 'now'}</span></div>`).join('')
      : '<div class="tv-empty">No events yet today</div>';

    // ---- money
    const box = el.querySelector('#tv-moneybox');
    const pendAmt = store.pendingPetty.filter((t) => t.type !== 'credit').reduce((a, t) => a + t.amount, 0);
    if (moneyAllowed && prefs.money && cash) {
      const m2 = (v) => `${v < 0 ? '−' : ''}${fmtMoney(Math.abs(v))}`;
      box.style.display = '';
      box.innerHTML = `<h2>Accounts</h2>
        <div class="tv-bal"><span>Balance</span><b class="${cash.bal < 0 ? 'neg' : ''}">${m2(cash.bal)}</b><i>Cash ${m2(cash.cash)} · Bank ${m2(cash.bank)}</i></div>
        <div class="tv-mrow">
          <div><span>To pay</span><b style="color:#F08DB0">${fmtMoney(cash.toPay)}</b>${cash.overdue ? `<i class="red">${cash.overdue} overdue</i>` : ''}</div>
          <div><span>To receive</span><b style="color:#7FB2FF">${fmtMoney(cash.toGet)}</b></div>
          <div><span>Projected</span><b class="${cash.projected < 0 ? 'neg' : ''}">${m2(cash.projected)}</b></div>
          ${isAdmin() ? `<div><span>Petty pending</span><b style="color:#FCB040">${store.pendingPetty.length}</b><i>${fmtMoney(pendAmt)}</i></div>` : ''}
        </div>`;
    } else box.style.display = 'none';

    el.querySelector('#tv-foot').innerHTML = `<span>Updated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
      <span>${store.schedulesToday.length ? `Scheduled today: ${store.schedulesToday.slice(0, 8).map((s) => `${esc(s.employeeName.split(' ')[0])} → ${esc(s.siteName)}${s.startTime ? ` ${esc(s.startTime)}` : ''}`).join(' · ')}` : ''}</span>
      <span>Live · LLCT</span>`;

    drawMap(st);
  }

  // ---- slow auto-scroll for long lists (pauses at the top and bottom)
  const scrollers = new Map();
  const tick = () => {
    el.querySelectorAll('.tv-scroll').forEach((box) => {
      const s = scrollers.get(box) || { dir: 1, wait: 120 };
      scrollers.set(box, s);
      if (box.scrollHeight <= box.clientHeight + 4) { box.scrollTop = 0; return; }
      if (s.wait > 0) { s.wait--; return; }
      box.scrollTop += s.dir * 0.6;
      if (s.dir > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 1) { s.wait = 160; s.dir = 0; s.back = true; }
      if (s.dir === 0 && s.back && s.wait <= 0) { box.scrollTo({ top: 0, behavior: 'smooth' }); s.back = false; s.wait = 160; s.dir = 1; }
    });
  };
  timers.push(setInterval(tick, 40));

  render();

  return () => {
    document.body.classList.remove('tv-mode');
    timers.forEach(clearInterval);
    subs.forEach((u) => { try { u(); } catch { /* */ } });
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousemove', wakeUi);
    clearTimeout(idle);
    try { wake?.release(); } catch { /* */ }
    try { map?.remove(); } catch { /* */ }
  };
}
