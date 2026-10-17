// LLCT Attendance — staff web app (for iPhone and any phone browser).
// Same logins and data as the Android app: check in/out with GPS geofence, external workers,
// history & off days, site updates with photos, petty cash, and own ID documents.
import {
  auth, db, onAuthStateChanged, login, logout, getMe, store, mapSession, mapSite, mapPetty, mapUpdate, mapWorker,
  mapWorkerEntry, mapOff, mapIdInfo, mapIdFile, saveIdInfo, uploadIdFile, deleteIdFile, Timestamp, serverTimestamp,
} from './fb.js';
import {
  collection, doc, query, where, onSnapshot, addDoc, updateDoc, getDocs, deleteDoc, runTransaction, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  esc, icon, avatar, pill, toast, modal, confirmBox, friendlyError, fmtTime, fmtDate, fmtDay, fmtMins, fmtMoney, fmtMonth,
  dateKey, monthKey, parseKey, b64img, photoViewer, CURRENCY,
} from './util.js';
import { DOC_KINDS, prepareFile, viewFile, expiryPill } from './iddocs.js';

window.__appStarted = true;
const app = document.getElementById('app');
const C = (n) => collection(db, n);
const DEFAULT_RADIUS = 200;
const tolerance = (acc) => Math.min(40, Math.max(10, acc || 0));
const EXPENSE_CATS = ['Fuel', 'Food', 'Travel', 'Materials', 'Tools', 'Other'];
const UPDATE_CATS = ['Progress', 'Issue', 'Material', 'Safety'];

const S = {
  me: null, tab: 'today', sites: [], open: null, todaySessions: [], workers: [], locks: {}, sessionWorkers: [],
  month: new Date(), monthSessions: [], monthOff: [], petty: [], myUpdates: [], idInfo: {}, idFiles: [],
  busy: '', subs: [], sessSubs: [], monthSubs: [], lastAlertAt: 0, lastPush: 0,
};

// ================================================================== helpers
function distance(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
const tzNow = () => -new Date().getTimezoneOffset();
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This browser has no GPS access.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1
        ? (isIOS ? 'Location is blocked. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → “While Using the App”, and allow this site. Then try again.'
          : 'Location permission is blocked. Allow location for this site in your browser settings, then try again.')
        : e.code === 3 ? 'GPS timed out. Go outside / near a window and try again.' : 'Could not get your location. Turn on Location and try again.')),
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 10000 },
    );
  });
}
const visibleSites = () => S.sites.filter((s) => s.active && (s.approved || s.createdBy === S.me.id));
const minsOf = (s) => Math.max(0, Math.round(((s.checkOut || new Date()) - s.checkIn) / 60000));
const busy = (t) => { S.busy = t; drawBusy(); };

function drawBusy() {
  let el = document.getElementById('busy');
  if (!S.busy) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'busy'; el.className = 'st-busy'; document.body.appendChild(el); }
  el.innerHTML = `<div><span class="spin"></span>${esc(S.busy)}</div>`;
}
async function compressPhoto(file, maxSide = 960, quality = 0.5, maxBytes = 280 * 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that photo.')); i.src = url; });
    let side = maxSide, q = quality, out;
    for (let n = 0; n < 5; n++) {
      const sc = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/jpeg', q).split(',')[1];
      if (out.length * 0.75 <= maxBytes) break;
      side *= 0.8; q = Math.max(0.3, q - 0.08);
    }
    return out;
  } finally { URL.revokeObjectURL(url); }
}

// ================================================================== auth
function renderLogin(error = '') {
  app.innerHTML = `
  <div class="st-login">
    <img src="img/logo.png" alt="LLCT" class="st-logo">
    <h1>LLCT Attendance</h1>
    <p>Sign in with your staff login ID</p>
    <form id="lf">
      <input name="id" placeholder="Login ID (e.g. EMP001)" autocomplete="username" autocapitalize="characters" required>
      <input name="pw" type="password" placeholder="Password" autocomplete="current-password" required>
      <div class="error">${esc(error)}</div>
      <button class="st-btn primary" type="submit">Sign in</button>
    </form>
    ${isIOS && !standalone ? `<div class="st-hint">${icon('download', 16)} Tip: tap <b>Share</b> <span class="ios-share">⬆︎</span> then <b>Add to Home Screen</b> to install this app.</div>` : ''}
  </div>`;
  const f = document.getElementById('lf');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const b = f.querySelector('button'); b.disabled = true; b.textContent = 'Signing in…';
    try { await login(f.id.value, f.pw.value); } catch (err) { renderLogin(friendlyError(err)); }
  };
}

let loginError = '';
onAuthStateChanged(auth, async (user) => {
  stopAll();
  if (!user) { renderLogin(loginError); loginError = ''; return; }
  try {
    const me = await getMe(user.uid);
    if (!me) { loginError = 'Your login has no staff profile yet. Ask your manager.'; await logout(); return; }
    if (!me.active) { loginError = 'Your account is disabled. Contact management.'; await logout(); return; }
    if (me.role === 'docs') { location.href = 'portal.html'; return; }
    if (me.role === 'admin' || me.role === 'manager') {
      app.innerHTML = `<div class="st-login"><img src="img/logo.png" class="st-logo"><h1>Management login</h1>
        <p>This is the staff app. Open the management dashboard instead.</p>
        <a class="st-btn primary" href="index.html">Open dashboard</a><button class="st-btn" id="so">Sign out</button></div>`;
      document.getElementById('so').onclick = () => logout();
      return;
    }
    S.me = me; store.me = me;
    start();
  } catch (e) { loginError = friendlyError(e); await logout().catch(() => {}); }
});

function stopAll() {
  [...S.subs, ...S.sessSubs, ...S.monthSubs].forEach((u) => { try { u(); } catch { /* ignore */ } });
  S.subs = []; S.sessSubs = []; S.monthSubs = [];
  if (S._tick) clearInterval(S._tick);
}

// ================================================================== data
function start() {
  const uid = S.me.id;
  const on = (q, fn) => S.subs.push(onSnapshot(q, fn, (e) => { console.error(e); toast(friendlyError(e), true); }));
  on(C('sites'), (s) => { S.sites = s.docs.map(mapSite).sort((a, b) => a.name.localeCompare(b.name)); draw(); });
  on(query(C('attendance'), where('employeeId', '==', uid), where('status', '==', 'open')), (s) => {
    const l = s.docs.map(mapSession).sort((a, b) => a.checkIn - b.checkIn);
    const prev = S.open?.id;
    S.open = l.length ? l[l.length - 1] : null;
    if (prev !== S.open?.id) watchSession();
    draw();
  });
  on(query(C('attendance'), where('employeeId', '==', uid), where('date', '==', dateKey(new Date()))), (s) => {
    S.todaySessions = s.docs.map(mapSession).sort((a, b) => a.checkIn - b.checkIn); draw();
  });
  on(C('extWorkers'), (s) => { S.workers = s.docs.map(mapWorker).filter((w) => w.active).sort((a, b) => a.name.localeCompare(b.name)); });
  on(C('workerLocks'), (s) => { S.locks = Object.fromEntries(s.docs.map((d) => [d.id, d.data()])); });
  on(query(C('petty'), where('employeeId', '==', uid)), (s) => { S.petty = s.docs.map(mapPetty).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); draw(); });
  on(query(C('siteUpdates'), where('employeeId', '==', uid)), (s) => { S.myUpdates = s.docs.map(mapUpdate).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); draw(); });
  S.subs.push(onSnapshot(doc(db, 'idInfo', uid), (d) => { S.idInfo = d.exists() ? mapIdInfo(d) : {}; if (S.tab === 'me') draw(); }, () => {}));
  on(query(C('idFiles'), where('ownerId', '==', uid)), (s) => { S.idFiles = s.docs.map(mapIdFile); if (S.tab === 'me') draw(); });
  watchMonth();
  // While the app is open and you're checked in: share location every 5 min and check the geofence.
  S._tick = setInterval(() => { tick(); if (S.tab === 'today') drawTimer(); }, 30000);
  shell();
}

function watchSession() {
  S.sessSubs.forEach((u) => u()); S.sessSubs = []; S.sessionWorkers = [];
  if (!S.open) return;
  S.sessSubs.push(onSnapshot(query(C('workerAttendance'), where('sessionId', '==', S.open.id), where('employeeId', '==', S.me.id)),
    (s) => { S.sessionWorkers = s.docs.map(mapWorkerEntry).sort((a, b) => a.workerName.localeCompare(b.workerName)); draw(); }, () => {}));
}

function watchMonth() {
  S.monthSubs.forEach((u) => u()); S.monthSubs = [];
  const m = monthKey(S.month);
  S.monthSubs.push(onSnapshot(query(C('attendance'), where('employeeId', '==', S.me.id), where('month', '==', m)),
    (s) => { S.monthSessions = s.docs.map(mapSession).sort((a, b) => a.checkIn - b.checkIn); if (S.tab === 'history') draw(); }, () => {}));
  S.monthSubs.push(onSnapshot(query(C('offDays'), where('employeeId', '==', S.me.id), where('month', '==', m)),
    (s) => { S.monthOff = s.docs.map(mapOff); if (S.tab === 'history') draw(); }, () => {}));
}

async function pushLocation(p, checkedIn, siteName, track = true) {
  const b = writeBatch(db);
  b.set(doc(db, 'users', S.me.id), { lastLocation: { lat: p.lat, lng: p.lng, accuracy: p.accuracy, at: serverTimestamp(), checkedIn, siteName } }, { merge: true });
  if (track) b.set(doc(C(`users/${S.me.id}/track`)), { lat: p.lat, lng: p.lng, accuracy: p.accuracy, date: dateKey(new Date()), at: serverTimestamp() });
  await b.commit();
}

async function tick() {
  if (!S.open || document.hidden || Date.now() - S.lastPush < 5 * 60000) return;
  S.lastPush = Date.now();
  try {
    const p = await locate();
    await pushLocation(p, true, S.open.siteName);
    const site = S.sites.find((x) => x.id === S.open.siteId);
    if (site) {
      const d = distance(p.lat, p.lng, site.lat, site.lng);
      if (d > site.radius + tolerance(p.accuracy) && Date.now() - S.lastAlertAt > 3600000) {
        S.lastAlertAt = Date.now();
        await addDoc(C('alerts'), {
          employeeId: S.me.id, employeeName: S.me.name, siteId: S.open.siteId, siteName: S.open.siteName, sessionId: S.open.id,
          type: 'left_site', lat: p.lat, lng: p.lng, distance: d, date: dateKey(new Date()), at: serverTimestamp(), tz: tzNow(), resolved: false,
        });
      }
    }
  } catch { /* GPS unavailable while open — ignore */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { S.lastPush = 0; tick(); } });

// ================================================================== shell
const TABS = [['today', 'Today', 'clock'], ['history', 'History', 'calendar'], ['update', 'Updates', 'updates'], ['petty', 'Petty', 'wallet'], ['me', 'Me', 'idcard']];
function shell() {
  app.innerHTML = `
  <div class="st">
    <header class="st-top"><img src="img/icon-192.png" alt=""><div class="grow"><b id="st-title"></b><span>${esc(fmtDate(new Date()))}</span></div>
      <span id="st-duty"></span></header>
    <main class="st-main" id="st-main"></main>
    <nav class="st-nav">${TABS.map(([k, l, ic]) => `<a data-tab="${k}">${icon(ic, 22)}<span>${l}</span></a>`).join('')}</nav>
  </div>`;
  app.querySelectorAll('[data-tab]').forEach((a) => { a.onclick = () => { S.tab = a.dataset.tab; draw(); window.scrollTo(0, 0); }; });
  draw();
}

function draw() {
  const main = document.getElementById('st-main');
  if (!main) return;
  if (main.querySelector('input:focus, textarea:focus, select:focus')) return; // don't wipe what you're typing
  app.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === S.tab));
  document.getElementById('st-title').textContent = { today: 'Today', history: 'My attendance', update: 'Site updates', petty: 'Petty cash', me: 'My profile & IDs' }[S.tab];
  document.getElementById('st-duty').innerHTML = S.open ? '<span class="st-duty">● ON DUTY</span>' : '';
  ({ today: drawToday, history: drawHistory, update: drawUpdate, petty: drawPetty, me: drawMe })[S.tab](main);
}

// ================================================================== TODAY
function drawToday(main) {
  const o = S.open;
  const closed = S.todaySessions.filter((s) => s.checkOut).reduce((a, s) => a + minsOf(s), 0);
  const onSite = S.sessionWorkers.filter((e) => e.open);
  const hour = new Date().getHours();
  main.innerHTML = `
    <div class="st-status ${o ? 'on' : ''}">
      <div class="hi">${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${esc(S.me.name.split(' ')[0])}</div>
      <div class="state">${o ? `● On duty · ${esc(o.siteName)}` : 'Not checked in'}</div>
      ${o ? `<div class="since">Since ${fmtTime(o.inLocal)}</div>` : ''}
      <div class="lbl">Total work time today</div>
      <div class="timer" id="st-timer">${fmtMins(closed + (o ? minsOf(o) : 0))}</div>
    </div>
    <button class="st-big ${o ? 'out' : 'in'}" id="st-act">${o ? 'CHECK OUT' : 'CHECK IN'}</button>
    ${o ? `<div class="st-card st-workers" id="st-wk">
        <div class="ico">${icon('worker', 22)}</div>
        <div class="grow"><b>${onSite.length ? `${onSite.length} external worker${onSite.length === 1 ? '' : 's'} with you` : 'No external workers added'}</b>
          <div class="small muted">${onSite.length ? esc(onSite.map((e) => e.workerName).join(', ')) : 'Tap to add labour working with you'}</div></div>
        <span class="st-link">${onSite.length ? 'Manage' : 'Add'}</span></div>`
      : '<div class="st-note">External workers: check in first, then tick the labour working with you.</div>'}
    <div class="st-quick">
      <a data-go="update">${icon('updates', 20)}<span>Site update</span></a>
      <a data-go="history">${icon('calendar', 20)}<span>History</span></a>
      <a data-go="petty">${icon('wallet', 20)}<span>Expense</span></a>
      <a data-go="me">${icon('idcard', 20)}<span>My IDs</span></a>
    </div>
    <h3 class="st-h">Check-ins today</h3>
    <div class="st-card list">${S.todaySessions.length ? S.todaySessions.map((s) => `<div class="row-i">
        <div class="grow"><b>${esc(s.siteName)}</b><div class="small muted">${fmtTime(s.inLocal)} – ${s.checkOut ? fmtTime(s.outLocal) : 'now'}</div></div>
        <b>${fmtMins(minsOf(s))}</b></div>`).join('') : '<div class="empty small">No check-ins yet today</div>'}</div>
    ${isIOS ? '<div class="st-note small">On iPhone, location is shared only while this app is open. Open it from time to time while you are on site.</div>' : ''}`;
  main.querySelector('#st-act').onclick = () => (o ? checkOut() : checkIn());
  main.querySelector('#st-wk')?.addEventListener('click', () => workerPicker(false));
  main.querySelectorAll('[data-go]').forEach((a) => { a.onclick = () => { S.tab = a.dataset.go; draw(); }; });
}
function drawTimer() {
  const t = document.getElementById('st-timer');
  if (!t) return;
  const closed = S.todaySessions.filter((s) => s.checkOut).reduce((a, s) => a + minsOf(s), 0);
  t.textContent = fmtMins(closed + (S.open ? minsOf(S.open) : 0));
}

async function checkIn(preselected = null) {
  if (S.open) return;
  let p;
  busy('Getting your GPS location…');
  try { p = await locate(); } catch (e) { busy(''); await alertBox('Location needed', e.message); return; } finally { busy(''); }
  const tol = tolerance(p.accuracy);
  const sites = visibleSites().map((s) => ({ s, d: distance(p.lat, p.lng, s.lat, s.lng) })).sort((a, b) => a.d - b.d);
  const nearby = sites.some((x) => x.d <= x.s.radius + tol);
  let site = preselected;
  if (!site) {
    site = (!nearby && !sites.length) ? 'new' : await pickSite(sites, tol, !nearby);
    if (!site) return;
    if (site === 'new') { site = await createSiteHere(p); if (!site) return; }
  }
  const d = distance(p.lat, p.lng, site.lat, site.lng);
  if (d > site.radius + tol) {
    await alertBox('Outside the site area', `You are ${fmtDist(d)} from ${site.name}.\nCheck-in is allowed only within ${Math.round(site.radius)} m of the site.\n\nMove closer and try again. (GPS accuracy now: ±${Math.round(p.accuracy)} m)`);
    return;
  }
  busy('Checking in…');
  let ref;
  const now = new Date();
  try {
    ref = await addDoc(C('attendance'), {
      employeeId: S.me.id, employeeName: S.me.name, siteId: site.id, siteName: site.name, date: dateKey(now), month: monthKey(now),
      checkIn: Timestamp.fromDate(now), checkInServer: serverTimestamp(), tz: tzNow(), tzName: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      inLat: p.lat, inLng: p.lng, inAccuracy: p.accuracy, inDistance: d, inOutside: d > site.radius, mocked: false, status: 'open', note: '', platform: 'web',
    });
    await pushLocation(p, true, site.name).catch(() => {});
    S.lastPush = Date.now();
    toast(`Checked in at ${site.name} · ${fmtTime(now)}`);
  } catch (e) { busy(''); toast(`Check-in failed: ${friendlyError(e)}`, true); return; }
  busy('');
  // "Any external workers with you?"
  const yes = await new Promise((res) => modal({
    title: 'Any external workers with you?',
    body: `<p style="margin:0;text-align:center">Checked in at <b>${esc(site.name)}</b>.<br>Select the labour working with you today, if any.</p>`,
    foot: '<button class="st-btn" data-n style="flex:1">NO</button><button class="st-btn primary" data-y style="flex:1">YES, SELECT</button>',
    onMount: (m, close) => { m.querySelector('[data-n]').onclick = () => { close(); res(false); }; m.querySelector('[data-y]').onclick = () => { close(); res(true); }; },
  }));
  if (yes) workerPicker(true, { id: ref.id, siteId: site.id, siteName: site.name, checkIn: now, tz: tzNow() });
}

function pickSite(sites, tol, offerNew) {
  return new Promise((resolve) => {
    modal({
      title: 'Choose your site',
      body: `<div class="st-pick">
        ${offerNew ? `<a data-new class="st-pick-i new">${icon('plus', 18)}<div class="grow"><b>Add this place as a new site</b><div class="small muted">No registered site is near you</div></div></a>` : ''}
        ${sites.map((x, i) => {
          const inside = x.d <= x.s.radius + tol;
          return `<a data-i="${i}" class="st-pick-i">${icon('site', 18)}<div class="grow"><b>${esc(x.s.name)}</b>
            <div class="small muted">${fmtDist(x.d)} away · radius ${Math.round(x.s.radius)} m</div></div>
            ${inside ? pill('Inside', 'green') : pill('Too far', 'red')}${!x.s.approved ? ` ${pill('Awaiting approval', 'amber')}` : ''}</a>`;
        }).join('')}</div>`,
      onMount: (m, close) => {
        m.querySelector('[data-new]')?.addEventListener('click', () => { close(); resolve('new'); });
        m.querySelectorAll('[data-i]').forEach((a) => { a.onclick = () => { close(); resolve(sites[Number(a.dataset.i)].s); }; });
        m.querySelector('[data-x]').addEventListener('click', () => resolve(null));
      },
    });
  });
}

function createSiteHere(p) {
  return new Promise((resolve) => {
    modal({
      title: 'Add a new site here',
      body: `<p class="small muted" style="margin-top:0">Your current location (±${Math.round(p.accuracy)} m) will be saved. Management will approve the site.</p>
        <label class="f"><span>Site name *</span><input id="ns-n" placeholder="e.g. Al Barsha Villa 12"></label>
        <label class="f"><span>Address / landmark</span><input id="ns-a"></label><div class="error" id="ns-e"></div>`,
      foot: '<button class="st-btn" data-c>Cancel</button><button class="st-btn primary" data-ok>Add & check in</button>',
      onMount: (m, close) => {
        m.querySelector('[data-c]').onclick = () => { close(); resolve(null); };
        m.querySelector('[data-ok]').onclick = async (ev) => {
          const name = m.querySelector('#ns-n').value.trim();
          if (!name) { m.querySelector('#ns-e').textContent = 'Enter a site name.'; return; }
          ev.currentTarget.disabled = true;
          try {
            const data = { name, address: m.querySelector('#ns-a').value.trim(), lat: p.lat, lng: p.lng, radius: DEFAULT_RADIUS, active: true, progress: 0,
              status: 'active', notes: `Added from the field by ${S.me.name}`, approved: false, createdBy: S.me.id, createdByName: S.me.name, addedByEmployee: true, createdAt: serverTimestamp() };
            const ref = await addDoc(C('sites'), data);
            close(); resolve({ id: ref.id, ...data });
          } catch (e) { m.querySelector('#ns-e').textContent = friendlyError(e); ev.currentTarget.disabled = false; }
        };
      },
    });
  });
}

async function checkOut() {
  const o = S.open;
  if (!o) return;
  const onSite = S.sessionWorkers.filter((e) => e.open).length;
  if (!await confirmBox('Check out?', `Check out from ${o.siteName}.\nTime on this site: ${fmtMins(minsOf(o))}${onSite ? `\n\n${onSite} external worker${onSite === 1 ? '' : 's'} will be checked out with you.` : ''}`, { ok: 'Check out' })) return;
  busy('Getting your GPS location…');
  let p = null;
  try { p = await locate(); } catch (e) {
    busy('');
    if (!await confirmBox('No GPS', `${e.message}\n\nCheck out without location?`, { ok: 'Check out anyway' })) return;
  }
  busy('Checking out…');
  const now = new Date();
  try {
    const site = S.sites.find((x) => x.id === o.siteId);
    const d = p && site ? distance(p.lat, p.lng, site.lat, site.lng) : null;
    await updateDoc(doc(db, 'attendance', o.id), {
      checkOut: Timestamp.fromDate(now), checkOutServer: serverTimestamp(), outLat: p?.lat ?? null, outLng: p?.lng ?? null, outAccuracy: p?.accuracy ?? null,
      outDistance: d, outOutside: d != null && site ? d > site.radius : false, durationMin: Math.round((now - o.checkIn) / 60000), status: 'closed', outTz: tzNow(),
    });
    await closeWorkers(o.id, now).catch(() => {});
    if (p) await pushLocation(p, false, '', false).catch(() => {});
    toast(`Checked out · ${fmtMins(Math.round((now - o.checkIn) / 60000))} at ${o.siteName}`);
  } catch (e) { toast(`Check-out failed: ${friendlyError(e)}`, true); }
  busy('');
}

// ================================================================== external workers
async function addWorkers(session, workers) {
  const now = new Date();
  const start = now - session.checkIn <= 15 * 60000 ? session.checkIn : now;
  const busyList = [];
  for (const w of workers) {
    const lockRef = doc(db, 'workerLocks', w.id);
    const msg = await runTransaction(db, async (tx) => {
      const lock = await tx.get(lockRef);
      if (lock.exists()) {
        const m = lock.data();
        if (m.sessionId === session.id) return null;
        return `${w.name} is already with ${m.employeeName || 'someone'} at ${m.siteName || 'another site'}`;
      }
      const rec = doc(C('workerAttendance'));
      tx.set(rec, {
        workerId: w.id, workerName: w.name, company: w.company, trade: w.trade, sessionId: session.id, employeeId: S.me.id, employeeName: S.me.name,
        siteId: session.siteId, siteName: session.siteName, date: dateKey(start), month: monthKey(start), checkIn: Timestamp.fromDate(start),
        tz: session.tz ?? tzNow(), open: true, createdAt: serverTimestamp(),
      });
      tx.set(lockRef, { recordId: rec.id, sessionId: session.id, employeeId: S.me.id, employeeName: S.me.name, siteId: session.siteId, siteName: session.siteName, since: Timestamp.fromDate(start) });
      return null;
    });
    if (msg) busyList.push(msg);
  }
  return busyList;
}
async function endWorker(e, at) {
  const end = at < e.checkIn ? e.checkIn : at;
  const lockRef = doc(db, 'workerLocks', e.workerId);
  await runTransaction(db, async (tx) => {
    const lock = await tx.get(lockRef);
    tx.update(doc(db, 'workerAttendance', e.id), { checkOut: Timestamp.fromDate(end), durationMin: Math.round((end - e.checkIn) / 60000), open: false });
    if (lock.exists() && lock.data().recordId === e.id) tx.delete(lockRef);
  });
}
async function closeWorkers(sessionId, at) {
  const s = await getDocs(query(C('workerAttendance'), where('sessionId', '==', sessionId), where('employeeId', '==', S.me.id), where('open', '==', true)));
  for (const d of s.docs) await endWorker(mapWorkerEntry(d), at);
}

function workerPicker(afterCheckIn, session = S.open) {
  if (!session) return;
  const current = new Set(S.sessionWorkers.filter((e) => e.open && e.sessionId === session.id).map((e) => e.workerId));
  const sel = new Set(current);
  let q = '';
  modal({
    title: `External workers · ${session.siteName}`,
    wide: true,
    body: `<div class="small" style="background:#fff4e2;border-radius:10px;padding:8px 10px;margin-bottom:10px">Tick the workers who are with you. Their hours follow your check-in until you remove them or check out.</div>
      <div class="row" style="gap:8px;flex-wrap:nowrap;margin-bottom:8px"><input id="wp-q" placeholder="Search name, company, trade…"><button class="st-btn sm" id="wp-new">${icon('plus', 16)} New</button></div>
      <div id="wp-list" class="st-wlist"></div>`,
    foot: `${afterCheckIn ? '<button class="st-btn" data-skip>Skip</button>' : '<button class="st-btn" data-skip>Cancel</button>'}<button class="st-btn primary" data-save style="flex:1">Save</button>`,
    onMount: (m, close) => {
      const list = m.querySelector('#wp-list');
      const drawList = () => {
        const ql = q.toLowerCase();
        const ws = S.workers.filter((w) => !ql || `${w.name} ${w.company} ${w.trade} ${w.phone}`.toLowerCase().includes(ql))
          .sort((a, b) => (sel.has(b.id) - sel.has(a.id)) || a.name.localeCompare(b.name));
        list.innerHTML = ws.length ? ws.map((w) => {
          const lk = S.locks[w.id];
          const busyElsewhere = lk && lk.sessionId !== session.id;
          return `<label class="st-wrow ${busyElsewhere ? 'busy' : ''}">${avatar(w.name, 34, '#D98A1A')}
            <div class="grow"><b>${esc(w.name)}</b><div class="small ${busyElsewhere ? 'red-t' : 'muted'}">${busyElsewhere ? `With ${esc(lk.employeeName)} at ${esc(lk.siteName)}` : esc([w.company, w.trade].filter(Boolean).join(' · ') || w.phone)}</div></div>
            <input type="checkbox" data-w="${w.id}" ${sel.has(w.id) ? 'checked' : ''} ${busyElsewhere ? 'disabled' : ''}></label>`;
        }).join('') : '<div class="empty small">No workers found — tap “New” to add one.</div>';
        list.querySelectorAll('[data-w]').forEach((c) => { c.onchange = () => { if (c.checked) sel.add(c.dataset.w); else sel.delete(c.dataset.w); }; });
      };
      drawList();
      m.querySelector('#wp-q').oninput = (e) => { q = e.target.value; drawList(); };
      m.querySelector('#wp-new').onclick = async () => {
        const w = await newWorkerDialog(q);
        if (w) { S.workers.push(w); sel.add(w.id); q = ''; m.querySelector('#wp-q').value = ''; drawList(); }
      };
      m.querySelector('[data-skip]').onclick = close;
      m.querySelector('[data-save]').onclick = async (ev) => {
        const add = S.workers.filter((w) => sel.has(w.id) && !current.has(w.id));
        const remove = S.sessionWorkers.filter((e) => e.open && e.sessionId === session.id && !sel.has(e.workerId));
        if (!add.length && !remove.length) { close(); return; }
        if (remove.length && !await confirmBox(`Remove ${remove.length} worker${remove.length === 1 ? '' : 's'}?`, `${remove.map((e) => e.workerName).join(', ')}\n\nTheir time on site ends now.`, { ok: 'Remove' })) return;
        ev.currentTarget.disabled = true;
        try {
          const now = new Date();
          for (const e of remove) await endWorker(e, now);
          const blocked = await addWorkers(session, add);
          if (blocked.length) toast(`Not added — ${blocked.join('; ')}`, true);
          const n = add.length - blocked.length;
          toast([n ? `${n} worker${n === 1 ? '' : 's'} added` : '', remove.length ? `${remove.length} removed` : ''].filter(Boolean).join(' · ') || 'Saved');
          close();
        } catch (e) { toast(`Could not save: ${friendlyError(e)}`, true); ev.currentTarget.disabled = false; }
      };
    },
  });
}

function newWorkerDialog(prefill = '') {
  return new Promise((resolve) => {
    modal({
      title: 'Add new external worker',
      body: `<p class="small muted" style="margin-top:0">Only if the worker is not in the list. Management adds their documents later.</p>
        <label class="f"><span>Full name *</span><input id="nw-n" value="${esc(prefill)}"></label>
        <label class="f"><span>Phone *</span><input id="nw-p" type="tel"></label>
        <label class="f"><span>Company / agency</span><input id="nw-c"></label>
        <label class="f"><span>Trade (Helper, Mason…)</span><input id="nw-t"></label><div class="error" id="nw-e"></div>`,
      foot: '<button class="st-btn" data-c>Cancel</button><button class="st-btn primary" data-ok>Add</button>',
      onMount: (m, close) => {
        m.querySelector('[data-c]').onclick = () => { close(); resolve(null); };
        m.querySelector('[data-ok]').onclick = async (ev) => {
          const name = m.querySelector('#nw-n').value.trim(), phone = m.querySelector('#nw-p').value.trim();
          const err = m.querySelector('#nw-e');
          if (!name || !phone) { err.textContent = 'Name and phone are required.'; return; }
          const n = (s) => String(s || '').replace(/[\s-]/g, '');
          const dup = S.workers.find((w) => n(w.phone) === n(phone));
          if (dup) { err.textContent = `${dup.name} already has this phone — pick them from the list.`; return; }
          ev.currentTarget.disabled = true;
          try {
            const data = { name, phone, company: m.querySelector('#nw-c').value.trim(), trade: m.querySelector('#nw-t').value.trim(), active: true,
              addedByEmployee: true, createdBy: S.me.name, createdById: S.me.id, createdAt: serverTimestamp() };
            const ref = await addDoc(C('extWorkers'), data);
            close(); resolve({ id: ref.id, ...data });
          } catch (e) { err.textContent = friendlyError(e); ev.currentTarget.disabled = false; }
        };
      },
    });
  });
}

// ================================================================== HISTORY
function drawHistory(main) {
  const m = S.month;
  const byDay = new Map();
  S.monthSessions.forEach((s) => { if (!byDay.has(s.date)) byDay.set(s.date, []); byDay.get(s.date).push(s); });
  const total = S.monthSessions.reduce((a, s) => a + minsOf(s), 0);
  const days = [...byDay.keys()].sort().reverse();
  const isCur = monthKey(m) === monthKey(new Date());
  main.innerHTML = `
    <div class="st-month"><button class="st-btn sm" id="h-prev">‹</button><b>${fmtMonth(m)}</b><button class="st-btn sm" id="h-next" ${isCur ? 'disabled' : ''}>›</button></div>
    <div class="st-kpis"><div><b>${byDay.size}</b><span>days worked</span></div><div><b>${fmtMins(total)}</b><span>total time</span></div>
      <div><b>${S.monthOff.filter((o) => o.status === 'approved').length}/${S.me.monthlyOffQuota}</b><span>off days</span></div></div>
    <div class="st-card list">${days.length ? days.map((d) => {
      const ss = byDay.get(d);
      return `<div class="row-i"><div class="grow"><b>${fmtDay(parseKey(d))}</b><div class="small muted">${ss.map((s) => `${esc(s.siteName)} ${fmtTime(s.inLocal)}–${s.checkOut ? fmtTime(s.outLocal) : 'now'}`).join(' · ')}</div></div>
        <b>${fmtMins(ss.reduce((a, s) => a + minsOf(s), 0))}</b></div>`;
    }).join('') : '<div class="empty small">No check-ins this month</div>'}</div>
    <div class="row" style="margin:16px 0 8px"><h3 class="st-h" style="margin:0">Off-day requests</h3><span class="spacer"></span><button class="st-btn sm primary" id="h-off">${icon('plus', 16)} Request</button></div>
    <div class="st-card list">${S.monthOff.length ? S.monthOff.sort((a, b) => a.date.localeCompare(b.date)).map((o) => `<div class="row-i">
      <div class="grow"><b>${fmtDay(parseKey(o.date))}</b><div class="small muted">${esc(o.reason)}</div></div>
      ${pill(o.status[0].toUpperCase() + o.status.slice(1), { approved: 'green', rejected: 'red', pending: 'amber' }[o.status] || 'gray')}</div>`).join('') : '<div class="empty small">No off-day requests this month</div>'}</div>`;
  main.querySelector('#h-prev').onclick = () => { S.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); watchMonth(); draw(); };
  main.querySelector('#h-next').onclick = () => { S.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); watchMonth(); draw(); };
  main.querySelector('#h-off').onclick = () => modal({
    title: 'Request an off day',
    body: '<label class="f"><span>Date</span><input type="date" id="o-d"></label><label class="f"><span>Reason</span><input id="o-r" placeholder="e.g. family"></label><div class="error" id="o-e"></div>',
    foot: '<button class="st-btn" data-c>Cancel</button><button class="st-btn primary" data-ok>Send</button>',
    onMount: (md, close) => {
      md.querySelector('[data-c]').onclick = close;
      md.querySelector('[data-ok]').onclick = async () => {
        const v = md.querySelector('#o-d').value;
        if (!v) { md.querySelector('#o-e').textContent = 'Pick a date.'; return; }
        try {
          await addDoc(C('offDays'), { employeeId: S.me.id, employeeName: S.me.name, date: v, month: v.slice(0, 7), reason: md.querySelector('#o-r').value.trim(), status: 'pending', createdAt: serverTimestamp() });
          toast('Off-day request sent'); close();
        } catch (e) { md.querySelector('#o-e').textContent = friendlyError(e); }
      };
    },
  });
}

// ================================================================== SITE UPDATES
let upd = { siteId: '', cat: 'Progress', note: '', progress: null, photos: [] };
function drawUpdate(main) {
  const sites = visibleSites();
  if (!upd.siteId) upd.siteId = S.open?.siteId || sites[0]?.id || '';
  main.innerHTML = `
    <div class="st-card pad">
      <label class="f"><span>Site</span><select id="u-s">${sites.map((s) => `<option value="${s.id}" ${s.id === upd.siteId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <div class="chips" style="margin-bottom:10px">${UPDATE_CATS.map((c) => `<span class="chip ${upd.cat === c ? 'on' : ''}" data-c="${c}">${c}</span>`).join('')}</div>
      <label class="f"><span>Note</span><textarea id="u-n" rows="3" placeholder="What was done / what is needed?">${esc(upd.note)}</textarea></label>
      <label class="f"><span>Site progress ${upd.progress == null ? '(optional)' : `— <b>${upd.progress}%</b>`}</span><input type="range" id="u-p" min="0" max="100" step="5" value="${upd.progress ?? 0}"></label>
      <div class="photos" id="u-ph">${upd.photos.map((p, i) => `<span style="position:relative;display:inline-block"><img src="${b64img(p)}"><button class="st-x" data-rm="${i}">×</button></span>`).join('')}</div>
      <div class="row" style="gap:8px;margin-top:8px">
        <label class="st-btn sm">${icon('plus', 16)} Photo<input type="file" accept="image/*" capture="environment" id="u-cam" hidden></label>
        <label class="st-btn sm">Gallery<input type="file" accept="image/*" id="u-gal" hidden></label>
        <span class="small muted">${upd.photos.length}/3</span></div>
      <button class="st-btn primary block" id="u-send" style="margin-top:12px">Send update</button>
    </div>
    <h3 class="st-h">My recent updates</h3>
    ${S.myUpdates.slice(0, 20).map((u) => `<div class="st-card pad" style="margin-bottom:8px">
      <div class="row"><b>${esc(u.siteName)}</b>${pill(u.category, { Issue: 'red', Material: 'blue', Safety: 'amber', Progress: 'green' }[u.category] || 'gray')}<span class="spacer"></span>
        <button class="st-btn sm" data-del="${u.id}">${icon('trash', 14)}</button></div>
      <div class="small muted">${fmtDate(u.createdLocal)} ${fmtTime(u.createdLocal)}${u.progress != null ? ` · ${u.progress}%` : ''}${u.editedAt ? ' · edited' : ''}</div>
      ${u.note ? `<div style="margin-top:6px;white-space:pre-wrap">${esc(u.note)}</div>` : ''}
      ${u.photos.length ? `<div class="photos" style="margin-top:6px">${u.photos.map((p) => `<img src="${b64img(p)}" data-photo>`).join('')}</div>` : ''}</div>`).join('') || '<div class="st-card empty small">No updates yet</div>'}`;
  main.querySelector('#u-s').onchange = (e) => { upd.siteId = e.target.value; };
  main.querySelector('#u-n').oninput = (e) => { upd.note = e.target.value; };
  main.querySelector('#u-p').oninput = (e) => { upd.progress = Number(e.target.value); main.querySelector('label.f span b')?.replaceWith(Object.assign(document.createElement('b'), { textContent: `${upd.progress}%` })); };
  main.querySelector('#u-p').onchange = () => draw();
  main.querySelectorAll('[data-c]').forEach((c) => { c.onclick = () => { upd.cat = c.dataset.c; draw(); }; });
  main.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { upd.photos.splice(Number(b.dataset.rm), 1); draw(); }; });
  main.querySelectorAll('[data-photo]').forEach((i) => { i.onclick = () => photoViewer(i.src); });
  const addPhoto = async (inp) => {
    const f = inp.files[0]; inp.value = '';
    if (!f) return;
    if (upd.photos.length >= 3) { toast('Max 3 photos', true); return; }
    try { busy('Preparing photo…'); upd.photos.push(await compressPhoto(f)); } catch (e) { toast(e.message, true); } finally { busy(''); draw(); }
  };
  main.querySelector('#u-cam').onchange = (e) => addPhoto(e.target);
  main.querySelector('#u-gal').onchange = (e) => addPhoto(e.target);
  main.querySelector('#u-send').onclick = async () => {
    const site = sites.find((s) => s.id === upd.siteId);
    if (!site) { toast('Choose a site', true); return; }
    if (!upd.note.trim() && !upd.photos.length) { toast('Add a note or a photo', true); return; }
    busy('Sending…');
    let p = null;
    try { p = await locate(); } catch { /* optional */ }
    try {
      const now = new Date();
      await addDoc(C('siteUpdates'), {
        siteId: site.id, siteName: site.name, employeeId: S.me.id, employeeName: S.me.name, category: upd.cat, note: upd.note.trim(),
        progress: upd.progress, photos: upd.photos, lat: p?.lat ?? null, lng: p?.lng ?? null, date: dateKey(now), month: monthKey(now), tz: tzNow(), createdAt: serverTimestamp(),
      });
      if (upd.progress != null) await updateDoc(doc(db, 'sites', site.id), { progress: upd.progress, progressUpdatedAt: serverTimestamp() }).catch(() => {});
      upd = { siteId: site.id, cat: 'Progress', note: '', progress: null, photos: [] };
      toast('Update sent');
    } catch (e) { toast(friendlyError(e), true); }
    busy(''); draw();
  };
  main.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmBox('Delete update?', 'This update and its photos will be removed.', { ok: 'Delete', danger: true })) return;
      try { await deleteDoc(doc(db, 'siteUpdates', b.dataset.del)); toast('Deleted'); } catch (e) { toast(friendlyError(e), true); }
    };
  });
}

// ================================================================== PETTY
function drawPetty(main) {
  let credited = 0, spent = 0, pending = 0;
  S.petty.forEach((t) => {
    if (t.type === 'credit' && t.status === 'approved') credited += t.amount;
    if (t.type !== 'credit' && t.status === 'approved') spent += t.amount;
    if (t.type !== 'credit' && t.status === 'pending') pending += t.amount;
  });
  const bal = credited - spent;
  main.innerHTML = `
    <div class="st-status small-card"><div class="lbl">Cash in hand</div><div class="timer">${fmtMoney(bal)}</div>
      <div class="since">Received ${fmtMoney(credited)} · spent ${fmtMoney(spent)}${pending ? ` · ${fmtMoney(pending)} pending` : ''}</div></div>
    <button class="st-big in" id="p-add" style="font-size:17px">+ ADD EXPENSE</button>
    <h3 class="st-h">History</h3>
    <div class="st-card list">${S.petty.length ? S.petty.map((t) => `<div class="row-i">
      <div class="grow"><b>${t.type === 'credit' ? 'Cash received' : esc(t.category)}</b><div class="small muted">${fmtDate(t.createdLocal)}${t.siteName ? ` · ${esc(t.siteName)}` : ''}${t.note ? ` · ${esc(t.note)}` : ''}</div></div>
      <div class="right"><b style="color:${t.type === 'credit' ? '#2E9E6A' : '#D64545'}">${t.type === 'credit' ? '+' : '−'}${fmtMoney(t.amount)}</b>
        <div>${pill(t.status[0].toUpperCase() + t.status.slice(1), { approved: 'green', rejected: 'red', pending: 'amber' }[t.status] || 'gray')}
        ${t.status === 'pending' && t.type !== 'credit' ? `<button class="st-x inline" data-del="${t.id}">×</button>` : ''}</div></div></div>`).join('') : '<div class="empty small">No transactions yet</div>'}</div>`;
  main.querySelector('#p-add').onclick = expenseDialog;
  main.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmBox('Delete expense?', 'Delete this pending expense?', { ok: 'Delete', danger: true })) return;
      try { await deleteDoc(doc(db, 'petty', b.dataset.del)); toast('Deleted'); } catch (e) { toast(friendlyError(e), true); }
    };
  });
}
function expenseDialog() {
  let receipt = '';
  const sites = visibleSites();
  modal({
    title: 'Add expense',
    body: `<label class="f"><span>Amount (${CURRENCY}) *</span><input id="e-a" type="number" inputmode="decimal" min="0.01" step="0.01"></label>
      <div class="chips" style="margin-bottom:10px" id="e-c">${EXPENSE_CATS.map((c, i) => `<span class="chip ${i === 0 ? 'on' : ''}" data-c="${c}">${c}</span>`).join('')}</div>
      <label class="f"><span>Site</span><select id="e-s"><option value="">—</option>${sites.map((s) => `<option value="${s.id}" ${s.id === S.open?.siteId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Note</span><input id="e-n"></label>
      <label class="st-btn sm">${icon('plus', 16)} Receipt photo<input type="file" accept="image/*" capture="environment" id="e-r" hidden></label> <span id="e-rs" class="small muted"></span>
      <div class="error" id="e-e"></div>`,
    foot: '<button class="st-btn" data-x2>Cancel</button><button class="st-btn primary" data-ok>Submit</button>',
    onMount: (m, close) => {
      let cat = EXPENSE_CATS[0];
      m.querySelectorAll('[data-c]').forEach((c) => { c.onclick = () => { cat = c.dataset.c; m.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === c)); }; });
      m.querySelector('#e-r').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { receipt = await compressPhoto(f); m.querySelector('#e-rs').textContent = '✓ receipt added'; } catch (er) { toast(er.message, true); }
      };
      m.querySelector('[data-x2]').onclick = close;
      m.querySelector('[data-ok]').onclick = async (ev) => {
        const amount = Number(m.querySelector('#e-a').value);
        if (!(amount > 0)) { m.querySelector('#e-e').textContent = 'Enter the amount.'; return; }
        const site = sites.find((s) => s.id === m.querySelector('#e-s').value);
        ev.currentTarget.disabled = true;
        try {
          const now = new Date();
          await addDoc(C('petty'), {
            employeeId: S.me.id, employeeName: S.me.name, type: 'expense', amount, category: cat, note: m.querySelector('#e-n').value.trim(),
            siteId: site?.id || '', siteName: site?.name || '', receipt, status: 'pending', createdBy: S.me.id, createdByName: S.me.name,
            date: dateKey(now), month: monthKey(now), tz: tzNow(), createdAt: serverTimestamp(),
          });
          toast('Expense submitted for approval'); close();
        } catch (e) { m.querySelector('#e-e').textContent = friendlyError(e); ev.currentTarget.disabled = false; }
      };
    },
  });
}

// ================================================================== ME (profile + own ID documents)
function drawMe(main) {
  const i = S.idInfo || {};
  main.innerHTML = `
    <div class="st-card pad" style="display:flex;gap:12px;align-items:center">${avatar(S.me.name, 52)}
      <div class="grow"><b style="font-size:17px">${esc(S.me.name)}</b><div class="small muted">${esc(S.me.designation || 'Staff')} · ID ${esc(S.me.loginId)}${S.me.phone ? ` · ${esc(S.me.phone)}` : ''}</div></div></div>
    <h3 class="st-h">My ID documents <span class="small muted" style="font-weight:500">· photo or PDF, max 2 MB</span></h3>
    ${DOC_KINDS.map((k) => {
      const files = S.idFiles.filter((f) => f.kind === k.k);
      return `<div class="st-card pad st-doc">
        <div class="row"><b>${esc(k.label)}</b><span class="spacer"></span>${k.exp ? expiryPill(i[k.exp]) : ''}</div>
        ${k.num ? `<div class="row" style="gap:8px;flex-wrap:nowrap;margin-top:6px"><input data-f="${k.num}" placeholder="Number" value="${esc(i[k.num] || '')}" style="flex:3">
          <input data-f="${k.exp}" type="date" value="${esc(i[k.exp] || '')}" style="flex:2"></div>` : ''}
        <div class="row" style="gap:6px;margin-top:8px">${files.map((f) => `<span class="pchip"><a href="javascript:void 0" data-view="${f.id}">${f.mime === 'application/pdf' ? 'PDF' : 'IMG'} ${esc(f.name.slice(0, 16))}</a><button data-delf="${f.id}">×</button></span>`).join('')}
          <label class="st-btn sm">${icon('plus', 14)} Upload<input type="file" accept="image/*,application/pdf" data-up="${k.k}" hidden></label></div>
      </div>`;
    }).join('')}
    <label class="f" style="margin-top:10px"><span>Nationality</span><input data-f="nationality" value="${esc(i.nationality || '')}"></label>
    <button class="st-btn primary block" id="me-save">Save numbers & dates</button>
    <div class="st-card pad" style="margin-top:18px">
      ${isIOS && !standalone ? `<div class="small" style="margin-bottom:10px">${icon('download', 14)} Install on iPhone: Safari → <b>Share</b> → <b>Add to Home Screen</b>.</div>` : ''}
      <button class="st-btn block" id="me-out">${icon('logout', 16)} Sign out</button>
      <div class="small muted" style="text-align:center;margin-top:8px">LLCT Attendance · web app</div></div>`;
  main.querySelector('#me-save').onclick = async (ev) => {
    const data = {};
    main.querySelectorAll('[data-f]').forEach((x) => { data[x.dataset.f] = x.value.trim(); });
    ev.currentTarget.disabled = true;
    try { await saveIdInfo(S.me.id, 'staff', { ...data, name: S.me.name }); toast('Saved'); } catch (e) { toast(friendlyError(e), true); }
    ev.currentTarget.disabled = false;
  };
  main.querySelectorAll('[data-up]').forEach((inp) => {
    inp.onchange = async () => {
      const f = inp.files[0]; inp.value = '';
      if (!f) return;
      busy('Uploading…');
      try {
        const p = await prepareFile(f);
        await uploadIdFile({ ownerId: S.me.id, ownerType: 'staff', ownerName: S.me.name, kind: inp.dataset.up, ...p });
        toast('Uploaded');
      } catch (e) { toast(friendlyError(e), true); }
      busy('');
    };
  });
  main.querySelectorAll('[data-view]').forEach((a) => { a.onclick = () => viewFile(S.idFiles.find((f) => f.id === a.dataset.view)); });
  main.querySelectorAll('[data-delf]').forEach((b) => {
    b.onclick = async () => {
      const f = S.idFiles.find((x) => x.id === b.dataset.delf);
      if (!f || !await confirmBox('Delete copy?', `Delete ${f.name}?`, { ok: 'Delete', danger: true })) return;
      try { await deleteIdFile(f); toast('Deleted'); } catch (e) { toast(friendlyError(e), true); }
    };
  });
  main.querySelector('#me-out').onclick = async () => {
    if (S.open && !await confirmBox('Sign out?', `You are still checked in at ${S.open.siteName}. Sign out anyway?`, { ok: 'Sign out' })) return;
    logout();
  };
}

// ================================================================== small dialog
function alertBox(title, message) {
  return new Promise((res) => modal({
    title, body: `<p style="margin:0;white-space:pre-wrap">${esc(message)}</p>`,
    foot: '<button class="st-btn primary" data-ok style="flex:1">OK</button>',
    onMount: (m, close) => { m.querySelector('[data-ok]').onclick = () => { close(); res(); }; },
  }));
}

