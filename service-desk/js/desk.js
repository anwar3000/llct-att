// LLCT Service Desk — staff console (admins, managers, assigners and technicians).
// Sign in with the same login as LLCT Attendance.
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  app, db, collection, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, Timestamp, writeBatch, arrayUnion, deleteField, deleteDoc,
  SERVICE_TYPES, DEFAULT_TYPES, activeTypes, loadTypes, saveTypes, ICON_KEYS, icon, PRIORITIES, SLOTS, STATUS, OPEN_STATUSES, typeLabel, typesText, mirrorPath, hasClientPage, prio, st, slotLabel, clientMessage, publicView, prefText, RESULTS, RESULT_COLOR, faultLabel, leanEquipment, OTHER_TYPES, amcStatus,
  $, $$, esc, toDate, fmtDate, fmtTime, fmtDT, ago, dateKey, localInput, hasGPS, distM, fmtDist, mapsLink, telLink, waLink,
  randToken, newTicketNo, reportLink, reportViewLink, toast, friendly, beep, compressImage,
} from './sd.js?v=13';
import { periodPdf, clientPdf, ticketPdf } from './pdf.js?v=13';
window.__sdStarted = true;

const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});
const LOGIN_DOMAIN = 'staff.attendance.app';
const loginToEmail = (l) => { const s = String(l || '').trim().toLowerCase(); return s.includes('@') ? s : `${s}@${LOGIN_DOMAIN}`; };
const root = $('#app');
const PORTAL_BASE = new URL('./', location.href).href;
const DEFAULT_KEYS = DEFAULT_TYPES.map((x) => x.k);
const portalUrl = (token) => `${PORTAL_BASE}?c=${token}`;
/** Walk-in tracking page (support page). Uses the saved support address if set, else this folder. */
const trackUrl = (pid) => `${S.supportBase || PORTAL_BASE}?t=${pid}`;

const S = {
  me: null, view: 'tickets', filter: 'open', q: '', fPrio: '', fTech: '',
  open: new Map(), recent: new Map(), users: [], portals: [], clients: [], clientsErr: '',
  unsub: [], loadedOpen: false, popQueue: [], popOn: false, rangeFrom: '', rangeTo: '', rClient: '', rTech: '',
  supportBase: new URL('./', location.href).href,
  sound: lsGet('llct-sd-sound', '1') === '1', synced: false, layout: lsGet('llct-sd-layout', 'board'),
};
function lsGet(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* ignore */ } }

const isMgmt = () => S.me && ['admin', 'manager'].includes(S.me.role);
const isAdmin = () => S.me && S.me.role === 'admin';
const canAssign = () => isMgmt() || (S.me && S.me.canAssignService === true);
const allTickets = () => { const m = new Map(S.recent); S.open.forEach((v, k) => m.set(k, v)); return [...m.values()]; };
const getT = (id) => S.open.get(id) || S.recent.get(id);
const userById = (id) => S.users.find((u) => u.id === id);
const dueAt = (t) => { const c = toDate(t.createdAt); return c ? new Date(c.getTime() + prio(t.priority).hrs * 3600e3) : null; };
const overdue = (t) => t.open && dueAt(t) && Date.now() > dueAt(t).getTime();
const initials = (n) => String(n || '?').trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
const AVC = ['#0E5E6F', '#3A7BD5', '#8E5CC4', '#C2557A', '#E08E2B', '#2E9E6A'];
const avatar = (n) => `<span class="av" style="background:${AVC[[...String(n || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVC.length]}">${esc(initials(n))}</span>`;

// ================================================================== auth
onAuthStateChanged(auth, async (u) => {
  S.unsub.forEach((f) => f()); S.unsub = []; S.open.clear(); S.recent.clear(); S.loadedOpen = false; S.synced = false;
  if (!u) return loginView();
  try {
    const d = await getDoc(doc(db, 'users', u.uid));
    const m = d.exists() ? d.data() : null;
    if (!m || m.active === false) { await signOut(auth); return loginView('This login is not active for the service desk.'); }
    S.me = { id: u.uid, ...m, role: m.role || 'employee' };
  } catch (e) { return loginView(friendly(e)); }
  startData(); render();
});

function loginView(err = '') {
  root.innerHTML = `<div class="loginwrap"><div class="card login">
    <div class="band"><div class="ribbon" aria-hidden="true"></div><div class="in"><img class="shield" src="img/shield-256.png" alt="Leaders Line">
      <div><div class="bt1">SERVICE DESK</div><div class="bt2">Leaders Line technical team</div></div></div></div>
    <form id="lf" class="lb stack"><label class="field"><span>Login ID</span><input id="lid" autocomplete="username" required></label>
    <label class="field"><span>Password</span><input id="lpw" type="password" autocomplete="current-password" required></label>
    <div class="small" style="color:var(--trim);min-height:1em" id="lerr">${esc(err)}</div>
    <button class="btn primary block" id="lgo">Sign in</button>
    <p class="small muted" style="margin:0;text-align:center">Use your LLCT Attendance login.</p></form></div></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault(); $('#lgo').disabled = true; $('#lerr').textContent = '';
    try { await signInWithEmailAndPassword(auth, loginToEmail($('#lid').value), $('#lpw').value); }
    catch (er) { $('#lerr').textContent = friendly(er); $('#lgo').disabled = false; }
  };
}

// ================================================================== data
function startData() {
  loadTypes().then(() => refresh());
  const since = Timestamp.fromDate(new Date(Date.now() - 120 * 864e5));
  S.unsub.push(onSnapshot(query(collection(db, 'svcTickets'), where('open', '==', true)), (q) => {
    const first = !S.loadedOpen;
    q.docChanges().forEach((ch) => {
      const t = { id: ch.doc.id, ...ch.doc.data() };
      if (ch.type === 'removed') { S.open.delete(t.id); return; }
      const prev = S.open.get(t.id);
      S.open.set(t.id, t);
      if (first) return;
      if (ch.type === 'added' && t.status === 'new' && t.createdBy !== S.me.id) queuePop(t, 'new');
      else if (t.assignedTo === S.me.id && t.status === 'assigned' && (!prev || prev.assignedTo !== S.me.id)) queuePop(t, 'mine');
    });
    S.loadedOpen = true; refresh();
  }, (e) => { console.warn(e); toast(friendly(e), true); }));
  S.unsub.push(onSnapshot(query(collection(db, 'svcTickets'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(800)), (q) => {
    S.recent = new Map(q.docs.map((d) => [d.id, { id: d.id, ...d.data() }])); refresh();
  }, (e) => console.warn('recent', e)));
  if (canAssign()) {
    S.unsub.push(onSnapshot(collection(db, 'users'), (q) => {
      S.users = q.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.active !== false && u.role !== 'docs')
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      refresh();
    }, (e) => console.warn('users', e)));
    S.profiles = {};
    S.unsub.push(onSnapshot(collection(db, 'svcClients'), (q) => { S.profiles = {}; q.docs.forEach((d) => { S.profiles[d.id] = d.data(); }); if (S.view === 'clients') render(); }, () => {}));
    S.unsub.push(onSnapshot(collection(db, 'svcPortals'), (q) => {
      S.portals = q.docs.map((d) => ({ id: d.id, ...d.data() })); refresh(); syncPortalSites();
    }, (e) => console.warn('portals', e)));
    S.unsub.push(onSnapshot(collection(db, 'inv_clients'), (q) => {
      S.clients = q.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      S.clientsErr = ''; refresh(); syncPortalSites();
    }, (e) => { S.clientsErr = 'Clients come from LLCT Invoicing — ask an admin to give you invoicing access (Staff & access).'; console.warn('clients', e); refresh(); }));
  }
  // Remember where this desk lives so the attendance app & dashboard can link to it.
  getDoc(doc(db, 'settings', 'service')).then((x) => { if (x.exists() && x.data().supportUrl) S.supportBase = x.data().supportUrl; }).catch(() => {});
  if (isAdmin()) getDoc(doc(db, 'settings', 'service')).then((s) => {
    const want = new URL('desk.html', PORTAL_BASE).href;
    if (!s.exists() || s.data().deskUrl !== want || s.data().portalBase !== PORTAL_BASE) setDoc(doc(db, 'settings', 'service'), { deskUrl: want, portalBase: PORTAL_BASE, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
  }).catch(() => {});
}

/** Client sites in links follow the client's places in LLCT Invoicing (name, address, GPS). */
const sitesFromPlaces = (c) => (c.places || []).map((p, i) => {
  const o = { id: String(p.id || 's' + i), name: String(p.name || 'Site'), address: String(p.address || '') };
  if (hasGPS({ lat: +p.lat, lng: +p.lng })) { o.lat = +p.lat; o.lng = +p.lng; }
  if (p.contact) o.contact = String(p.contact); if (p.phone) o.phone = String(p.phone);
  return o;
});
// Firestore hands maps back with their keys in a different order, so compare with sorted keys —
// a plain JSON.stringify never matched and re-wrote every link in an endless loop (each write
// triggered the listener again), burning the whole daily write / read quota.
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
const synced = new Map(); // portal id → last value written (never write the same thing twice)
function syncPortalSites() {
  if (!canAssign() || !S.clients.length || !S.portals.length) return;
  S.portals.filter((p) => p.active).forEach((p) => {
    const c = S.clients.find((x) => x.id === p.clientId); if (!c) return;
    const sites = sitesFromPlaces(c);
    const name = c.name || p.clientName || '';
    const want = canon({ sites, name });
    if (canon({ sites: p.sites || [], name: p.clientName || '' }) === want || synced.get(p.id) === want) return;
    synced.set(p.id, want);
    updateDoc(doc(db, 'svcPortals', p.id), { sites, clientName: name, updatedAt: serverTimestamp() }).catch(() => {});
  });
}

// ================================================================== popups
function queuePop(t, kind) {
  if (S.sound) beep(kind === 'new' && t.priority === 'critical' ? 5 : 3);
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(kind === 'new' ? `New service request · ${prio(t.priority).t}` : 'Job assigned to you', {
        body: `${t.clientName} – ${t.siteName}\n${typesText(t)}`, icon: 'img/icon-192.png', tag: t.id,
      });
      n.onclick = () => { window.focus(); openTicket(t.id); n.close(); };
    }
  } catch (_) { /* ignore */ }
  S.popQueue.push({ id: t.id, kind });
  flashTitle();
  if (!S.popOn) nextPop();
}
function nextPop() {
  const it = S.popQueue.shift(); if (!it) { S.popOn = false; return; }
  const t = getT(it.id); if (!t) return nextPop();
  S.popOn = true;
  const p = prio(t.priority);
  const o = modal(`<span class="chip" style="background:${p.c};color:#fff">${esc(p.t)}</span><h2 class="grow">${it.kind === 'new' ? 'New service request' : 'Job assigned to you'}</h2>`,
    `<div class="stack"><div class="mono"><b>${esc(t.number || t.id)}</b> · ${esc(ago(t.createdAt))}</div>
      <div style="font-size:17px"><b>${esc(t.clientName)}</b><br>${esc(t.siteName)}</div>
      <div><b>${esc(typesText(t))}</b><div class="muted">${esc(t.description)}</div></div>
      <div class="small">Preferred: ${esc(prefText(t))}</div>
      ${t.scheduledAt ? `<div class="small">Visit scheduled: <b>${esc(fmtDT(t.scheduledAt))}</b></div>` : ''}</div>`,
    `<button class="btn" data-x>Later</button><button class="btn" id="pp-v">View</button>
     ${it.kind === 'mine' ? '<button class="btn good" id="pp-a">Accept job</button>' : canAssign() ? '<button class="btn primary" id="pp-as">Assign technician</button>' : '<button class="btn good" id="pp-a">Accept job</button>'}`,
    { cls: 'alertpop', onClose: () => setTimeout(nextPop, 150) });
  $('#pp-v', o).onclick = () => { close(o); openTicket(t.id); };
  const a = $('#pp-a', o); if (a) a.onclick = async () => { close(o); await accept(getT(t.id)); };
  const as = $('#pp-as', o); if (as) as.onclick = () => { close(o); assignModal(getT(t.id)); };
}
let titleT = null;
function flashTitle() {
  if (titleT || !document.hidden) return;
  const base = 'Service Desk – Leaders Line'; let on = false;
  titleT = setInterval(() => { document.title = (on = !on) ? '🔴 New service request' : base; if (!document.hidden) { clearInterval(titleT); titleT = null; document.title = base; } }, 1000);
}

// ================================================================== modal helpers
function modal(head, body, foot, { wide = false, cls = '', onClose } = {}) {
  const o = document.createElement('div'); o.className = 'overlay ' + cls;
  o.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><div class="mh">${head}<button class="btn ghost sm" data-x aria-label="Close">✕</button></div><div class="mb">${body}</div>${foot ? `<div class="mf">${foot}</div>` : ''}</div>`;
  o._onClose = onClose;
  o.addEventListener('click', (e) => { if (e.target === o || e.target.closest('[data-x]')) close(o); });
  document.body.appendChild(o); return o;
}
function close(o) { if (!o || !o.parentNode) return; o.remove(); if (o._onClose) o._onClose(); }

// ================================================================== writes
/** Updates a ticket and (if it came from a client link) the client's view, with one log line each. */
async function updateTicket(t, changes, logText, clientText) {
  const b = writeBatch(db); const at = Timestamp.now();
  b.update(doc(db, 'svcTickets', t.id), { ...changes, updatedAt: serverTimestamp(), log: arrayUnion({ at, by: S.me.id, byName: S.me.name || '', t: logText }) });
  const mp = mirrorPath(t);
  if (mp) {
    const merged = { ...t, ...changes };
    const pub = { status: merged.status, priority: merged.priority || 'normal', updatedAt: serverTimestamp() };
    pub.assignedName = merged.assignedTo ? (merged.assignedName || '') : deleteField();
    pub.scheduledAt = merged.scheduledAt && merged.assignedTo ? merged.scheduledAt : deleteField();
    if (merged.reportNo) pub.reportNo = merged.reportNo;
    if (Array.isArray(merged.faults) && 'faults' in changes) pub.faults = merged.faults.map((f) => ({ kind: f.kind, id: f.id, no: f.no || '', name: f.name || '', nvr: f.nvr || '', ch: f.ch || '', result: f.result || '', note: f.note || '' }));
    if (clientText) pub.log = arrayUnion({ at, t: clientText });
    b.set(doc(db, ...mp), pub, { merge: true });
  }
  try { await b.commit(); return true; } catch (e) { toast(friendly(e), true); return false; }
}
const whenTxt = (ts) => (ts ? ` on ${fmtDT(ts)}` : '');

async function accept(t) {
  if (!t) return;
  if (t.status === 'new' && !t.assignedTo) {
    const sched = t.scheduledAt || null;
    const ok = await updateTicket(t, { status: 'accepted', assignedTo: S.me.id, assignedName: S.me.name || '', assignedAt: serverTimestamp(), assignedBy: S.me.id, assignedByName: S.me.name || '', acceptedAt: serverTimestamp() },
      `Picked up by ${S.me.name}`, `Assigned to our technical team — technician ${S.me.name} will visit${whenTxt(sched) || ' as per your preferred time'}`);
    if (ok) toast('Job accepted');
  } else if (t.assignedTo === S.me.id) {
    const ok = await updateTicket(t, { status: 'accepted', acceptedAt: serverTimestamp() }, `Accepted by ${S.me.name}`, `Technician ${S.me.name} confirmed the visit${whenTxt(t.scheduledAt)}`);
    if (ok) toast('Job accepted');
  } else toast('This job is already taken by ' + (t.assignedName || 'someone else'), true);
}
async function setStatus(t, s) {
  const map = {
    on_way: [{ onWayAt: serverTimestamp() }, 'On the way', `Technician ${t.assignedName || ''} is on the way`],
    on_site: [{ arrivedAt: serverTimestamp() }, 'Arrived at site', `Technician ${t.assignedName || ''} arrived at site`],
    completed: [{ completedAt: serverTimestamp() }, 'Work completed', 'Work completed'],
  }[s];
  if (!map) return;
  const ok = await updateTicket(t, { status: s, ...map[0] }, map[1], map[2]);
  if (ok) toast(st(s).t);
}

// ================================================================== shell
let lastSig = '';
function refresh() {
  if (!S.me) return;
  // keep open forms (assign, new ticket, links) intact
  if (document.querySelector('.overlay:not(.alertpop):not([data-tid])')) { drawNav(); return; }
  // redraw the page only when something on it changed
  const sig = canon([[...S.open.values()], [...S.recent.values()].map((t) => [t.id, t.status, t.updatedAt]), S.users.map((u) => [u.id, u.name, u.active, u.lastLocation]),
    S.portals.map((p) => [p.id, p.active, (p.sites || []).length]), S.clients.map((c) => [c.id, c.name, (c.places || []).length])]);
  if (sig !== lastSig) { lastSig = sig; render(); }
  // an open ticket follows live changes — redrawn only when that ticket changed, without the opening animation
  const d = document.querySelector('.overlay[data-tid]');
  if (d) {
    const id = d.dataset.tid, t = getT(id);
    if (!t || canon(t) === d._sig) return;
    const sc = d.querySelector('.modal').scrollTop, note = (d.querySelector('#tn') || {}).value || '';
    d.remove(); openTicket(id, true);
    const n = document.querySelector('.overlay[data-tid]');
    if (n) { n.querySelector('.modal').scrollTop = sc; if (note && n.querySelector('#tn')) n.querySelector('#tn').value = note; }
  }
}
function drawNav() {
  const n = $('#dnav'); if (!n) return;
  const newN = [...S.open.values()].filter((t) => t.status === 'new').length;
  const mine = [...S.open.values()].filter((t) => t.assignedTo === S.me.id).length;
  const items = [['tickets', 'Tickets', newN], ...(canAssign() ? [['clients', 'Customers', 0], ['reports', 'Reports', 0]] : []), ...(isAdmin() ? [['settings', 'Settings', 0]] : [])];
  n.innerHTML = items.map(([k, l, c]) => `<button data-nav="${k}" class="${S.view === k ? 'on' : ''}">${l}${c ? `<span class="n">${c}</span>` : ''}</button>`).join('')
    + (mine ? `<button data-nav="tickets" data-mine="1">My jobs<span class="n" style="background:var(--info)">${mine}</span></button>` : '');
  $$('[data-nav]', n).forEach((b) => (b.onclick = () => { S.view = b.dataset.nav; if (b.dataset.mine) S.filter = 'mine'; render(); }));
}
function render() {
  const sy = window.scrollY;
  root.innerHTML = `<header class="dtop"><div class="in"><img src="img/shield-256.png" alt="Leaders Line"><span class="ttl">Service Desk<small>Leaders Line</small></span><nav class="dnav" id="dnav"></nav>
    <div class="dme">${canAssign() ? '<button class="btn sm primary" id="nt">+ New ticket</button>' : ''}<span>${esc(S.me.name || '')}</span><button class="btn sm" id="so">Sign out</button></div></div></header>
    <main class="dwrap" id="main"></main>`;
  drawNav();
  $('#so').onclick = () => signOut(auth);
  const nt = $('#nt'); if (nt) nt.onclick = () => newTicketModal();
  const m = $('#main');
  if (S.view === 'clients' && canAssign()) clientsView(m);
  else if (S.view === 'reports' && canAssign()) reportsView(m);
  else if (S.view === 'settings' && isAdmin()) settingsView(m);
  else ticketsView(m);
  window.scrollTo(0, sy);
}

// ================================================================== tickets view
function ticketsView(m) {
  const open = [...S.open.values()];
  const today = dateKey();
  const k = {
    new: open.filter((t) => t.status === 'new').length,
    prog: open.filter((t) => t.status !== 'new').length,
    crit: open.filter((t) => t.priority === 'critical').length,
    over: open.filter(overdue).length,
    done: allTickets().filter((t) => t.completedAt && dateKey(toDate(t.completedAt)) === today).length,
    mine: open.filter((t) => t.assignedTo === S.me.id).length,
  };
  let list = S.filter === 'open' ? open : S.filter === 'new' ? open.filter((t) => t.status === 'new')
    : S.filter === 'prog' ? open.filter((t) => t.status !== 'new') : S.filter === 'crit' ? open.filter((t) => t.priority === 'critical')
    : S.filter === 'over' ? open.filter(overdue) : S.filter === 'mine' ? open.filter((t) => t.assignedTo === S.me.id)
    : S.filter === 'done' ? allTickets().filter((t) => ['completed', 'closed'].includes(t.status)) : allTickets();
  if (S.fPrio) list = list.filter((t) => t.priority === S.fPrio);
  if (S.fTech) list = list.filter((t) => (S.fTech === '_none' ? !t.assignedTo : t.assignedTo === S.fTech));
  if (S.q) { const q = S.q.toLowerCase(); list = list.filter((t) => [t.number, t.clientName, t.siteName, t.description, typesText(t), t.assignedName, t.contactName, t.contactPhone].join(' ').toLowerCase().includes(q)); }
  const po = { critical: 0, high: 1, normal: 2, low: 3 };
  const rank = (t) => (!t.open ? 3 : t.status === 'new' ? 0 : t.status === 'completed' ? 2 : 1);
  list.sort((a, b) => rank(a) - rank(b) || (a.open && b.open ? (po[a.priority] ?? 2) - (po[b.priority] ?? 2) : 0)
    || (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
  const techs = [...new Map(allTickets().filter((t) => t.assignedTo).map((t) => [t.assignedTo, t.assignedName])).entries()];
  const kp = (key, v, l, c = '') => `<div class="card kpi ${S.filter === key ? 'on' : ''}" data-f="${key}"><div class="v" style="${c ? 'color:' + c : ''}">${v}</div><div class="l">${l}</div></div>`;
  m.innerHTML = `<div class="kpis">${kp('new', k.new, 'New · not assigned', 'var(--danger)')}${kp('prog', k.prog, 'Assigned / in progress', 'var(--info)')}${kp('crit', k.crit, 'Critical open', 'var(--danger)')}${kp('over', k.over, 'Over response time', 'var(--warning)')}${kp('mine', k.mine, 'My jobs')}${kp('done', k.done, 'Completed today', 'var(--success)')}</div>
    <div class="filters"><select id="ff">${[['open', 'All open'], ['new', 'New'], ['prog', 'In progress'], ['mine', 'My jobs'], ['crit', 'Critical'], ['over', 'Overdue'], ['done', 'Completed / closed'], ['all', 'Everything (last 4 months)']].map(([v, l]) => `<option value="${v}" ${S.filter === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="fp"><option value="">Any priority</option>${PRIORITIES.map((p) => `<option value="${p.k}" ${S.fPrio === p.k ? 'selected' : ''}>${p.t}</option>`).join('')}</select>
      <select id="ft"><option value="">Any technician</option><option value="_none" ${S.fTech === '_none' ? 'selected' : ''}>Not assigned</option>${techs.map(([id, n]) => `<option value="${esc(id)}" ${S.fTech === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <input id="fq" placeholder="Search ticket, client, site, phone…" value="${esc(S.q)}" style="flex:1">
      ${'Notification' in window && Notification.permission === 'default' ? '<button class="btn sm" id="nperm">🔔 Enable desktop alerts</button>' : ''}
      <div class="seg" role="group" aria-label="Layout"><button class="btn sm ${S.layout === 'board' ? 'on' : ''}" data-lay="board">Board</button><button class="btn sm ${S.layout === 'list' ? 'on' : ''}" data-lay="list">List</button></div>
      <button class="btn sm" id="snd">${S.sound ? 'Sound on' : 'Sound off'}</button></div>
    ${S.layout === 'board' ? boardHtml(list) : `<div class="card tlist">${list.length ? list.map(rowHtml).join('') : `<div class="empty">${S.loadedOpen ? 'No tickets here.' : 'Loading…'}</div>`}</div>`}`;
  $$('[data-f]', m).forEach((e) => (e.onclick = () => { S.filter = S.filter === e.dataset.f ? 'open' : e.dataset.f; render(); }));
  $('#ff', m).onchange = (e) => { S.filter = e.target.value; render(); };
  $('#fp', m).onchange = (e) => { S.fPrio = e.target.value; render(); };
  $('#ft', m).onchange = (e) => { S.fTech = e.target.value; render(); };
  const fq = $('#fq', m); fq.oninput = () => { S.q = fq.value; clearTimeout(fq._t); fq._t = setTimeout(() => { render(); const n = $('#fq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  const np = $('#nperm', m); if (np) np.onclick = () => Notification.requestPermission().then(() => render());
  $('#snd', m).onclick = () => { S.sound = !S.sound; lsSet('llct-sd-sound', S.sound ? '1' : '0'); if (S.sound) beep(1); render(); };
  $$('[data-lay]', m).forEach((b) => (b.onclick = () => { S.layout = b.dataset.lay; lsSet('llct-sd-layout', S.layout); render(); }));
  $$('[data-open]', m).forEach((e) => (e.onclick = () => openTicket(e.dataset.open)));
}
// Board: one column per stage of the job.
const COLS = [
  ['new', 'New', (t) => t.status === 'new'],
  ['assigned', 'Assigned', (t) => ['assigned', 'accepted'].includes(t.status)],
  ['progress', 'On the way / at site', (t) => ['on_way', 'on_site'].includes(t.status)],
  ['done', 'Completed', (t) => ['completed', 'closed'].includes(t.status)],
];
function boardHtml(list) {
  const cols = S.filter === 'all' || S.filter === 'done' ? COLS : COLS.filter((c) => c[0] !== 'done' || list.some(c[2]));
  return `<div class="board">${cols.map(([k, title, f]) => {
    const items = list.filter(f);
    return `<section class="bcol bcol-${k}"><header><b>${title}</b><span>${items.length}</span></header>
      <div class="bitems">${items.map(cardHtml).join('') || `<div class="bempty">${k === 'new' ? 'No new requests' : 'Nothing here'}</div>`}</div></section>`;
  }).join('')}</div>`;
}
function cardHtml(t) {
  const p = prio(t.priority), od = overdue(t);
  return `<button class="bcard" data-open="${esc(t.id)}" style="--pc:${p.c}">
    <div class="bc1"><span class="bprio">${esc(p.t)}</span>${od ? '<span class="bover">Overdue</span>' : ''}${t.source === 'walkin' ? '<span class="bwalk">Walk-in</span>' : ''}<span class="grow"></span><span class="bno">${esc(t.number || t.id)}</span></div>
    <div class="bc2">${esc(t.clientName)}</div><div class="bc3">${esc(t.siteName)}</div>
    <div class="bc4">${esc(typesText(t))}</div>
    <div class="bc5">${t.assignedName ? `${avatar(t.assignedName)}<span>${esc(t.assignedName)}</span>` : '<span class="muted">Not assigned</span>'}<span class="grow"></span>
      <span class="muted">${t.scheduledAt ? esc(fmtDT(t.scheduledAt)) : esc(ago(t.createdAt))}</span></div></button>`;
}
function rowHtml(t) {
  const s = st(t.status), p = prio(t.priority), od = overdue(t);
  const fresh = t.status === 'new' && toDate(t.createdAt) && Date.now() - toDate(t.createdAt).getTime() < 120000;
  return `<div class="trow ${fresh ? 'fresh' : ''}" data-open="${esc(t.id)}"><span class="bar" style="background:${p.c}"></span>
    <div style="min-width:0"><div class="row"><span class="t1">${esc(t.clientName)}</span><span class="muted">·</span><span>${esc(t.siteName)}</span></div>
      <div class="t2">${esc(typesText(t))} — ${esc(String(t.description || '').slice(0, 110))}</div>
      <div class="t2 mono small">${esc(t.number || t.id)} · ${esc(ago(t.createdAt))}${t.source === 'staff' ? ' · by staff' : t.source === 'walkin' ? ' · walk-in' : ''}${t.reportNo ? ' · ' + esc(t.reportNo) : ''}</div></div>
    <div class="r"><span class="chip" style="background:${s.c}1f;color:${s.c}"><span class="dot" style="background:${s.c}"></span>${esc(s.t)}</span>
      <span class="chip" style="background:${p.c}14;color:${p.c}">${esc(p.t)}</span>
      <span class="small ${od ? '' : 'muted'}" style="${od ? 'color:var(--danger);font-weight:700' : ''}">${t.assignedName ? '👷 ' + esc(t.assignedName) : od ? 'Overdue' : 'Unassigned'}</span>
      <span class="small muted">${t.scheduledAt ? '🗓 ' + esc(fmtDT(t.scheduledAt)) : '⏱ ' + esc(prefText(t))}</span></div></div>`;
}

// ================================================================== ticket detail
function openTicket(id, quiet = false) {
  const t = getT(id);
  if (!t) { getDoc(doc(db, 'svcTickets', id)).then((s) => { if (s.exists()) { S.recent.set(id, { id, ...s.data() }); openTicket(id); } }); return; }
  const s = st(t.status), p = prio(t.priority), mine = t.assignedTo === S.me.id, A = canAssign();
  const acts = [];
  if (t.open) {
    if (t.status === 'new' && !t.assignedTo) acts.push('<button class="btn good" data-a="accept">✋ Take this job</button>');
    if (mine && t.status === 'assigned') acts.push('<button class="btn good" data-a="accept">✔ Accept job</button>');
    if ((mine || A) && ['assigned', 'accepted'].includes(t.status) && t.assignedTo) acts.push('<button class="btn" data-a="on_way">🚗 On the way</button>');
    if ((mine || A) && ['assigned', 'accepted', 'on_way'].includes(t.status) && t.assignedTo) acts.push('<button class="btn" data-a="on_site">📍 Arrived at site</button>');
    if ((mine || A) && t.assignedTo && t.status !== 'new') acts.push('<button class="btn good" data-a="completed">✅ Work completed</button>');
    if (A) acts.push(`<button class="btn primary" data-a="assign">${t.assignedTo ? '👷 Re-assign' : '👷 Assign technician'}</button>`);
    if (mine && !A) acts.push('<button class="btn bad" data-a="handback">Hand back</button>');
  }
  if (mine || A) acts.push(`<a class="btn" href="${reportLink(t.id)}" target="_blank" rel="noopener">📝 ${t.reportId ? 'New' : 'Make'} service report</a>`);
  if (t.reportId) acts.push(`<a class="btn" href="${reportViewLink(t.reportId)}" target="_blank" rel="noopener">📄 ${esc(t.reportNo || 'Service report')}</a>`);
  if (A && t.status === 'completed') acts.push('<button class="btn dark" data-a="close">Close ticket</button>');
  if (A && t.open) acts.push('<button class="btn bad" data-a="cancel">Cancel ticket</button>');
  if (A && !t.open) acts.push('<button class="btn" data-a="reopen">Re-open</button>');
  if (t.open && (A || mine) && t.assignedTo) acts.push('<button class="btn" data-a="resched">🗓 Change visit time</button>');
  if (hasClientPage(t) && (A || mine)) acts.push('<label class="btn">📷 Post photo for client<input type="file" accept="image/*" multiple hidden data-postph></label>');
  if (A && !t.clientId) acts.push('<button class="btn" data-a="mkclient">Save as client</button>');
  acts.push('<button class="btn" data-a="pdf">PDF</button>');
  if (isAdmin()) acts.push('<button class="btn bad" data-a="delete">Delete ticket</button>');
  const nav = mapsLink(t);
  const o = modal(`<div class="grow"><div class="row"><h2 class="mono">${esc(t.number || t.id)}</h2><span class="chip" style="background:${s.c}1f;color:${s.c}"><span class="dot" style="background:${s.c}"></span>${esc(s.staff)}</span><span class="chip" style="background:${p.c};color:#fff">${esc(p.t)}</span>${overdue(t) ? '<span class="chip" style="background:#fde3e3;color:var(--danger)">Over response time</span>' : ''}</div></div>`,
    `<div class="dgrid"><div class="stack">
      <div class="card pad"><div style="font-size:17px"><b>${esc(t.clientName)}</b></div><div>${esc(t.siteName)}</div>${t.siteAddress ? `<div class="muted small" style="white-space:pre-line">${esc(t.siteAddress)}</div>` : ''}
        <div class="row" style="margin-top:10px">${nav ? `<a class="btn sm primary" href="${nav}" target="_blank" rel="noopener">🧭 Navigate</a>` : '<span class="small muted">No GPS for this site — add it to the client\'s site in Invoicing.</span>'}
        ${hasGPS(t) ? `<span class="small muted mono">${t.lat.toFixed(5)}, ${t.lng.toFixed(5)}</span>` : ''}</div></div>
      <div class="card pad"><div class="kv">
        <span>Service</span><b>${esc(typesText(t))}</b>
        <span>Problem</span><span style="white-space:pre-line">${esc(t.description)}</span>
        ${t.cameras ? `<span>Devices</span><span>${esc(t.cameras)}</span>` : ''}
        <span>Preferred</span><span>${esc(prefText(t))}</span>
        <span>Respond by</span><span>${esc(fmtDT(dueAt(t)))}</span>
        <span>Contact</span><span>${esc(t.contactName)}${t.contactPhone ? `<br><a href="${telLink(t.contactPhone)}">📞 ${esc(t.contactPhone)}</a> · <a href="${waLink(t.contactPhone, '')}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${t.contactEmail ? `<br>${esc(t.contactEmail)}` : ''}</span>
        <span>Raised</span><span>${esc(fmtDT(t.createdAt))} · ${t.source === 'staff' ? 'by staff' : t.source === 'walkin' ? 'walk-in (support page)' : 'client link'}</span>
      </div>${Array.isArray(t.photos) && t.photos.length ? `<div class="thumbs" style="margin-top:12px">${t.photos.map((ph, i) => `<img src="${ph}" data-ph="${i}" alt="photo">`).join('')}</div>` : ''}</div>
      ${(Array.isArray(t.faults) && t.faults.length) || ((A || mine) && t.open && t.clientId) ? `<div class="card pad"><h3>Equipment checked${(t.faults || []).length ? ` (${t.faults.length})` : ''}</h3>
        ${(t.faults || []).length ? '' : '<p class="small muted" style="margin:4px 0 0">Add the cameras, NVR or devices checked, with a result and comment for each. They go into the service report.</p>'}
        <div class="faults">${(t.faults || []).map((f, i) => `<div class="fault"><span class="fl">${esc(faultLabel(f))}</span>
          ${(A || mine) && t.open ? `<select data-fr="${i}"><option value="">Result…</option>${RESULTS.map((r) => `<option ${f.result === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
            <input class="fnote" data-fn="${i}" value="${esc(f.note || '')}" placeholder="Comment, e.g. cleaned lens, replaced connector">`
            : `<span>${f.result ? `<span class="rchip" style="background:${RESULT_COLOR[f.result] || '#75757a'}22;color:${RESULT_COLOR[f.result] || '#75757a'}">${esc(f.result)}</span>` : '<span class="muted small">Not checked yet</span>'}</span>${f.note ? `<span class="fnote small muted">${esc(f.note)}</span>` : ''}`}</div>`).join('')}</div>
        ${(A || mine) && t.open ? `<div class="row" style="margin-top:8px">${t.clientId ? '<button class="btn sm" id="fr-add">+ Add equipment</button>' : ''}${(t.faults || []).length ? '<button class="btn sm primary" id="fr-save">Save results</button><span class="small muted">They go into the service report automatically.</span>' : ''}</div>` : ''}</div>` : ''}
      ${t.clientId ? '<div class="card pad" id="prof-card"><span class="small muted">Loading site details…</span></div>' : ''}
    </div><div class="stack">
      <div class="card pad"><h3>Assignment</h3>
        ${t.assignedTo ? `<div class="row" style="margin-top:8px">${avatar(t.assignedName)}<div class="grow"><b>${esc(t.assignedName)}</b><div class="small muted">${t.assignedByName && t.assignedBy !== t.assignedTo ? 'assigned by ' + esc(t.assignedByName) : 'picked up the job'} · ${esc(ago(t.assignedAt))}</div></div></div>
          <div class="small" style="margin-top:6px">Visit: <b>${t.scheduledAt ? esc(fmtDT(t.scheduledAt)) : 'as per preferred time'}</b></div>`
          : '<div class="muted" style="margin-top:6px">Not assigned yet.</div>'}
        ${t.techNote ? `<div class="small" style="margin-top:8px"><b>Technician note:</b> ${esc(t.techNote)}</div>` : ''}
        <div class="row" style="margin-top:12px">${acts.join('')}</div></div>
      <div class="card pad"><h3>Client is told</h3><div class="small" style="margin-top:6px;background:#f6f4f0;border-radius:10px;padding:9px 11px">${esc(clientMessage(t))}</div>
        <div class="row" style="margin-top:8px">${t.contactPhone ? `<a class="btn sm" target="_blank" rel="noopener" href="${waLink(t.contactPhone, waText(t))}">Send update on WhatsApp</a>` : ''}${t.portal ? '<span class="small muted">Also visible live on the client\'s link.</span>' : t.publicId ? `<span class="small muted">Walk-in customer's tracking page: <a href="${trackUrl(t.publicId)}" target="_blank" rel="noopener">open</a></span>` : ''}</div></div>
      <div class="card pad"><h3>Timeline</h3><div class="timeline">${(t.log || []).slice().reverse().map((l) => `<div><b>${esc(l.t)}</b><br><span class="muted small">${esc(fmtDT(l.at))}${l.byName ? ' · ' + esc(l.byName) : ''}</span></div>`).join('')}</div>
        ${A || mine ? '<div class="row" style="margin-top:8px"><input id="tn" placeholder="Add an internal note…" class="grow"><button class="btn sm" id="tnb">Add</button></div>' : ''}</div>
      ${hasClientPage(t) ? `<div class="card pad"><h3>Photos for the client</h3><div class="thumbs" id="cph" style="margin-top:8px"><span class="small muted">Loading…</span></div></div>` : ''}
    </div></div>`, '', { wide: true, cls: quiet ? 'noanim' : '' });
  o.dataset.tid = t.id; o._sig = canon(t);
  $$('[data-a]', o).forEach((b) => (b.onclick = async () => {
    const a = b.dataset.a, cur = getT(t.id) || t;
    if (a === 'assign') { close(o); return assignModal(cur); }
    if (a === 'resched') { close(o); return rescheduleModal(cur); }
    if (a === 'mkclient') { close(o); return clientFromTicket(cur); }
    if (a === 'pdf') {
      b.disabled = true;
      let report = null, photos = [];
      const mp = mirrorPath(cur);
      if (mp) {
        try { const m = await getDoc(doc(db, ...mp)); report = (m.exists() && m.data().report) || null; } catch (_) { /* ignore */ }
        try { photos = (await getDocs(query(collection(db, ...mp, 'photos'), orderBy('at', 'asc')))).docs.map((d) => d.data()); } catch (_) { /* ignore */ }
      }
      ticketPdf(cur, { report, photos });
      b.disabled = false;
      return;
    }
    if (a === 'delete') {
      if (!confirm(`Delete ticket ${cur.number || cur.id}? This also removes it from the client's page. This cannot be undone.`)) return;
      b.disabled = true;
      try { await deleteTicket(cur); toast('Ticket deleted'); close(o); } catch (e) { toast(friendly(e), true); b.disabled = false; }
      return;
    }
    b.disabled = true;
    if (a === 'accept') await accept(cur);
    else if (['on_way', 'on_site', 'completed'].includes(a)) await setStatus(cur, a);
    else if (a === 'handback') {
      const why = prompt('Why are you handing this job back? (optional)') ?? null; if (why === null) { b.disabled = false; return; }
      await updateTicket(cur, { status: 'new', assignedTo: null, assignedName: '', assignedAt: null, assignedBy: '', assignedByName: '', acceptedAt: null, scheduledAt: null }, `Handed back by ${S.me.name}${why ? ': ' + why : ''}`, 'Our team is re-assigning a technician');
    } else if (a === 'close') await updateTicket(cur, { status: 'closed', open: false, closedAt: serverTimestamp() }, 'Ticket closed', 'Request closed');
    else if (a === 'cancel') {
      const why = prompt('Reason for cancelling (shown to the client):'); if (why === null) { b.disabled = false; return; }
      await updateTicket(cur, { status: 'cancelled', open: false, closedAt: serverTimestamp() }, `Cancelled${why ? ': ' + why : ''}`, `Cancelled${why ? ': ' + why : ''}`);
    } else if (a === 'reopen') await updateTicket(cur, { status: cur.assignedTo ? 'assigned' : 'new', open: true, closedAt: null }, 'Re-opened', 'Request re-opened');
    b.disabled = false; // the live update redraws this ticket
  }));
  $$('[data-ph]', o).forEach((im) => (im.onclick = () => { const w = window.open(); if (w) w.document.write(`<img src="${im.src}" style="max-width:100%">`); }));
  if (hasClientPage(t)) {
    const box = $('#cph', o);
    getDocs(query(collection(db, ...mirrorPath(t), 'photos'), orderBy('at', 'asc'))).then((q) => {
      if (!box) return;
      box.innerHTML = q.docs.length ? q.docs.map((d) => `<img src="${d.data().data}" alt="" title="${esc(d.data().caption || '')}">`).join('') : '<span class="small muted">None yet. Post photos of the finished work; the client sees them on their request.</span>';
    }).catch(() => { if (box) box.innerHTML = '<span class="small muted">Publish the latest Firestore rules to use client photos.</span>'; });
  }
  const pp = $('[data-postph]', o);
  if (pp) pp.onchange = async () => {
    const files = [...pp.files].slice(0, 6); if (!files.length) return;
    toast('Uploading…');
    try { await postClientPhotos(getT(t.id) || t, files); toast(`${files.length} photo${files.length > 1 ? 's' : ''} posted for the client`); close(o); openTicket(t.id); }
    catch (e) { toast(friendly(e), true); }
  };
  const frs = $('#fr-save', o);
  if (frs) frs.onclick = async () => {
    const cur = getT(t.id) || t;
    const faults = (cur.faults || []).map((f, i) => ({ ...f, result: ($(`[data-fr="${i}"]`, o) || {}).value || f.result || '', note: (($(`[data-fn="${i}"]`, o) || {}).value || '').trim() }));
    const done = faults.filter((f) => f.result).map((f) => `${faultLabel(f)}: ${f.result}`).join('; ');
    frs.disabled = true;
    await updateTicket(cur, { faults }, `Equipment checked — ${done || 'results updated'}`, done ? `Technician checked: ${done}` : undefined);
  };
  const fra = $('#fr-add', o);
  if (fra) fra.onclick = async () => {
    let e = {};
    try { const pr = await getDoc(doc(db, 'svcClients', t.clientId)); e = ((pr.exists() && pr.data().sites) || {})[t.siteId] || {}; } catch (er) { return toast(friendly(er), true); }
    const all = [...(e.nvrs || []).map((n) => ({ kind: 'nvr', id: n.id, no: n.no || '', name: n.name || '' })),
      ...(e.cameras || []).map((c) => ({ kind: 'camera', id: c.id, no: c.no || '', name: c.name || '', nvr: c.nvr || '', ch: c.ch || '' })),
      ...(e.others || []).map((x) => ({ kind: 'other', id: x.id, type: x.type || '', name: x.name || '' }))];
    if (!all.length) return toast('No equipment saved for this site yet — use Edit equipment under Site details first.', true);
    const cur = getT(t.id) || t; const have = new Set((cur.faults || []).map((f) => f.id));
    const m = modal('<h2 class="grow">Add equipment checked</h2>', `<div class="pickl">${all.map((x) => `<label class="pick"><input type="checkbox" data-pk="${esc(x.id)}" ${have.has(x.id) ? 'checked disabled' : ''}> ${esc(faultLabel(x))}${have.has(x.id) ? ' <span class="small muted">(already on this job)</span>' : ''}</label>`).join('')}</div>`,
      '<button class="btn" data-x>Cancel</button><button class="btn primary" id="pk-ok">Add</button>');
    $('#pk-ok', m).onclick = async () => {
      const ids = $$('[data-pk]', m).filter((i) => i.checked && !i.disabled).map((i) => i.dataset.pk);
      if (!ids.length) return close(m);
      const c2 = getT(t.id) || t;
      const faults = [...(c2.faults || []), ...all.filter((x) => ids.includes(x.id)).map((x) => ({ ...x, result: '', note: '' }))];
      $('#pk-ok', m).disabled = true; close(m);
      await updateTicket(c2, { faults }, `Equipment added to check: ${ids.length}`);
    };
  };
  const pc = $('#prof-card', o);
  if (pc) {
    Promise.all([getDoc(doc(db, 'svcClients', t.clientId)), t.siteId ? getDoc(doc(db, 'svcClients', t.clientId, 'sitePhotos', t.siteId)) : Promise.resolve(null)]).then(([pr, ph]) => {
      const prof = pr && pr.exists() ? pr.data() : {}; const img = ph && ph.exists() ? ph.data().data : '';
      const e = (prof.sites || {})[t.siteId] || {};
      const a = amcStatus(prof.amc), tone = { ok: 'var(--success)', warn: 'var(--warning)', bad: 'var(--danger)' }[a.tone] || '';
      const has = prof.tradeLicense || img || (e.nvrs || []).length || (e.cameras || []).length || (e.others || []).length || a.text;
      pc.innerHTML = `<div class="row"><h3 class="grow">Site details</h3>${canAssign() ? `<button class="btn sm" id="pc-edit">${has ? 'Edit equipment' : 'Set up profile'}</button>` : ''}</div>
        ${has ? `<div class="row" style="margin-top:8px;align-items:flex-start;gap:12px">${img ? `<img src="${img}" alt="Building" style="width:150px;height:100px;object-fit:cover;border-radius:8px;border:1px solid var(--silver);cursor:zoom-in" data-bimg>` : ''}
        <div class="small">${a.text ? `<div style="color:${tone};font-weight:650">${esc(a.text)}${prof.amc.no ? ` · ${esc(prof.amc.no)}` : ''}</div>` : ''}${prof.amc && prof.amc.covered ? `<div class="muted">${esc(prof.amc.covered)}</div>` : ''}
        ${prof.tradeLicense ? `<div>Trade licence: <b>${esc(prof.tradeLicense)}</b></div>` : ''}
        <div>${[(e.nvrs || []).length && `${e.nvrs.length} NVR`, (e.cameras || []).length && `${e.cameras.length} cameras`, (e.others || []).length && `${e.others.length} other devices`].filter(Boolean).join(', ') || 'No equipment listed for this site'}</div>
        ${(e.nvrs || []).map((n) => `<div class="muted">NVR ${esc(n.no)}${n.name ? ` – ${esc(n.name)}` : ''}${n.model ? ` · ${esc(n.model)}` : ''}${n.ip ? ` · ${esc(n.ip)}` : ''}</div>`).join('')}
        ${(e.cameras || []).length ? `<details class="eqlist"><summary>All cameras (${e.cameras.length}) — IP, NVR, channel</summary><table class="tbl"><thead><tr><th>No.</th><th>Name</th><th>NVR / ch</th><th>IP</th><th>Model</th><th>Serial</th></tr></thead><tbody>
          ${e.cameras.map((c) => `<tr><td>${esc(c.no)}</td><td>${esc(c.name || '')}</td><td>${c.nvr ? `NVR ${esc(c.nvr)}` : ''}${c.ch ? ` / ${esc(c.ch)}` : ''}</td><td>${c.ip ? `<a href="http://${esc(c.ip)}" target="_blank" rel="noopener">${esc(c.ip)}</a>` : ''}</td><td>${esc(c.model || '')}</td><td>${esc(c.serial || '')}</td></tr>`).join('')}</tbody></table></details>` : ''}
        ${(e.others || []).map((x) => `<div class="muted">${esc(x.type)}${x.name ? ` – ${esc(x.name)}` : ''}${x.model ? ` · ${esc(x.model)}` : ''}${x.ip ? ` · ${esc(x.ip)}` : ''}${+x.qty > 1 ? ` × ${esc(x.qty)}` : ''}</div>`).join('')}</div></div>`
        : '<p class="small muted">No AMC or equipment details for this customer yet.</p>'}`;
      const pe = $('#pc-edit', pc); if (pe) pe.onclick = () => profileModal(t.clientId);
      const bi = $('[data-bimg]', pc); if (bi) bi.onclick = () => { const w = window.open(); if (w) w.document.write(`<img src="${bi.src}" style="max-width:100%">`); };
    }).catch(() => pc.remove());
  }
  const tnb = $('#tnb', o);
  if (tnb) tnb.onclick = async () => { const v = $('#tn', o).value.trim(); if (!v) return; tnb.disabled = true; $('#tn', o).value = ''; await updateTicket(getT(t.id) || t, mine && !A ? { techNote: v } : {}, 'Note: ' + v); };
}
function waText(t) {
  return `Leaders Line Service – ${t.number || t.id}\n${t.clientName} – ${t.siteName}\n${typesText(t)}\n\n${clientMessage(t)}${t.portal ? `\n\nTrack: ${portalUrl(t.portal)}` : t.publicId ? `\n\nTrack: ${trackUrl(t.publicId)}` : ''}`;
}

/** Walk-in customer → a client in LLCT Invoicing (with this store as a site), and link the ticket. */
function clientFromTicket(t) {
  const existing = S.clients.filter((c) => String(c.name || '').trim().toLowerCase() === String(t.clientName || '').trim().toLowerCase());
  const o = modal(`<h2 class="grow">Save ${esc(t.clientName)} as a client</h2>`,
    `<p class="small muted" style="margin-top:0">${existing.length ? 'A client with this name exists. Add this store as a site there, or create a new client.' : 'Creates the client in LLCT Invoicing with this store as its first site.'}</p>
     <div class="stack">
      <label class="field"><span>Client / brand name</span><input id="mc-name" value="${esc(t.clientName || '')}"></label>
      <label class="field"><span>Store / site name</span><input id="mc-site" value="${esc(t.siteName || '')}"></label>
      <label class="field"><span>Address</span><input id="mc-addr" value="${esc(t.siteAddress || '')}"></label>
      <div class="grid2"><label class="field"><span>Contact</span><input id="mc-contact" value="${esc(t.contactName || '')}"></label><label class="field"><span>Mobile</span><input id="mc-phone" value="${esc(t.contactPhone || '')}"></label></div>
      <label class="field"><span>Email</span><input id="mc-email" value="${esc(t.contactEmail || '')}"></label>
     </div>`,
    `<button class="btn" data-x>Cancel</button>${existing.length ? `<button class="btn" id="mc-add">Add site to ${esc(existing[0].name)}</button>` : ''}<button class="btn primary" id="mc-new">Create new client</button>`);
  const site = () => {
    const x = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: $('#mc-site', o).value.trim() || 'Store', address: $('#mc-addr', o).value.trim(), addedAt: new Date().toISOString() };
    if (hasGPS(t)) { x.lat = t.lat; x.lng = t.lng; x.radius = 150; }
    return x;
  };
  const link = async (cid, cname, si) => {
    await updateTicket(t, { clientId: cid, clientName: cname, siteId: si.id, siteName: si.name }, `Saved as client ${cname}`);
    toast(`${cname} saved as a client`); close(o); openTicket(t.id);
  };
  $('#mc-new', o).onclick = async () => {
    const name = $('#mc-name', o).value.trim(); if (!name) return toast('Enter the client name', true);
    const si = site(); const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'inv_clients', id), { name, contact: $('#mc-contact', o).value.trim(), phone: $('#mc-phone', o).value.trim(), email: $('#mc-email', o).value.trim(),
        address: si.address, taxId: '', creditDays: 0, openingBalance: 0, places: [si], createdAt: now, updatedAt: now, createdBy: S.me.id, source: 'walk-in' });
      await link(id, name, si);
    } catch (e) { toast(String(e.code || '').includes('permission') ? 'You need "clients & products" permission in LLCT Invoicing.' : friendly(e), true); }
  };
  const add = $('#mc-add', o);
  if (add) add.onclick = async () => {
    const c = existing[0]; const si = site();
    try { await updateDoc(doc(db, 'inv_clients', c.id), { places: [...(c.places || []), si], updatedAt: new Date().toISOString() }); await link(c.id, c.name, si); }
    catch (e) { toast(friendly(e), true); }
  };
}

async function deleteTicket(t) {
  const mp = mirrorPath(t);
  if (mp) {
    try {
      const ph = await getDocs(collection(db, ...mp, 'photos'));
      await Promise.all(ph.docs.map((d) => deleteDoc(d.ref)));
    } catch (_) { /* no photos / older rules */ }
    await deleteDoc(doc(db, ...mp)).catch(() => {});
  }
  await deleteDoc(doc(db, 'svcTickets', t.id));
  S.open.delete(t.id); S.recent.delete(t.id); refresh();
}
async function postClientPhotos(t, files) {
  const at = Timestamp.now(); let n = 0;
  for (const f of files) {
    const data = await compressImage(f, 1280, 0.7);
    await setDoc(doc(collection(db, ...mirrorPath(t), 'photos')), { data, caption: '', by: S.me.id, byName: S.me.name || '', at });
    n++;
  }
  await updateTicket(t, { photosPosted: (t.photosPosted || 0) + n }, `${n} photo${n > 1 ? 's' : ''} posted for the client`, `${n} photo${n > 1 ? 's' : ''} of the work added`);
}
function preferredDateTime(t) {
  const d = toDate(t.preferredDate) || new Date(); const h = { morning: 9, afternoon: 13, evening: 17, night: 22, latenight: 1 }[t.preferredSlot];
  if (t.preferredSlot === 'latenight') d.setDate(d.getDate() + 1);
  if (t.preferredSlot === 'exact' && t.preferredTime) { const [hh, mm] = t.preferredTime.split(':').map(Number); d.setHours(hh || 9, mm || 0, 0, 0); return d; }
  d.setHours(h || 9, 0, 0, 0);
  const n = new Date(Date.now() + 2 * 3600e3); n.setMinutes(0, 0, 0);
  return n > d ? n : d; // never in the past
}
function rescheduleModal(t) {
  const cur = t.scheduledAt ? toDate(t.scheduledAt) : preferredDateTime(t);
  const o = modal(`<h2 class="grow">Visit time for ${esc(t.number || t.id)}</h2>`,
    `<p class="small muted" style="margin-top:0">Client asked for ${esc(prefText(t))}.</p>
     <div class="row"><button class="btn sm" id="rs-pref" type="button">Use the client's preferred time</button></div>
     <label class="field" style="margin-top:12px"><span>Visit date and time</span><input type="datetime-local" id="rs-when" value="${esc(localInput(cur))}"></label>
     <label class="field" style="margin-top:10px"><span>Reason (shown to the client, optional)</span><input id="rs-why" placeholder="e.g. Technician availability"></label>`,
    `<button class="btn" data-x>Cancel</button><button class="btn primary" id="rs-go">Save visit time</button>`);
  $('#rs-pref', o).onclick = () => { $('#rs-when', o).value = localInput(preferredDateTime(t)); };
  $('#rs-go', o).onclick = async () => {
    const v = $('#rs-when', o).value; if (!v) return toast('Choose the date and time', true);
    const when = Timestamp.fromDate(new Date(v)); const why = $('#rs-why', o).value.trim();
    $('#rs-go', o).disabled = true;
    const ok = await updateTicket(t, { scheduledAt: when }, `Visit time set to ${fmtDT(when)}${why ? ` (${why})` : ''}`,
      `Visit ${t.scheduledAt ? 'rescheduled' : 'scheduled'} for ${fmtDT(when)}${why ? ` — ${why}` : ''}`);
    if (ok) { toast('Visit time saved'); close(o); openTicket(t.id); } else $('#rs-go', o).disabled = false;
  };
}

// ================================================================== assign
function staffFor(t) {
  return S.users.filter((u) => ['employee', 'manager', 'admin'].includes(u.role || 'employee')).map((u) => {
    const ll = u.lastLocation && typeof u.lastLocation.lat === 'number' ? u.lastLocation : null;
    const at = ll && toDate(ll.at);
    const fresh = at && Date.now() - at.getTime() < 15 * 60e3;
    const d = ll && hasGPS(t) ? distM(t, ll) : null;
    const jobs = [...S.open.values()].filter((x) => x.assignedTo === u.id).length;
    return { u, d, fresh, onDuty: !!(ll && ll.checkedIn && fresh), siteNow: ll && ll.checkedIn ? ll.siteName || '' : '', at, jobs };
  }).sort((a, b) => (a.d == null) - (b.d == null) || (a.d ?? 0) - (b.d ?? 0) || (b.onDuty - a.onDuty) || a.jobs - b.jobs);
}
function assignModal(t) {
  if (!t) return;
  const list = staffFor(t);
  let pick = t.assignedTo || '';
  const def = t.scheduledAt ? localInput(t.scheduledAt) : (() => {
    return localInput(preferredDateTime(t));
  })();
  const o = modal(`<h2 class="grow">Assign ${esc(t.number || t.id)}</h2>`,
    `<div class="small muted" style="margin-bottom:10px">${esc(t.clientName)} – ${esc(t.siteName)}. ${hasGPS(t) ? 'Staff are sorted by distance from the site (live location from the attendance app).' : 'This site has no GPS, so staff are listed by workload.'}</div>
     <div id="sl">${list.map((x) => `<div class="staff ${pick === x.u.id ? 'on' : ''}" data-u="${esc(x.u.id)}">${avatar(x.u.name)}
       <div style="min-width:0"><b>${esc(x.u.name)}</b>${x.u.designation ? ` <span class="small muted">· ${esc(x.u.designation)}</span>` : ''}
        <div class="small muted">${x.onDuty ? `<span style="color:var(--success)">● On duty${x.siteNow ? ' at ' + esc(x.siteNow) : ''}</span>` : x.at ? `Last seen ${esc(ago(x.at))}` : 'No location yet'} · ${x.jobs} open job${x.jobs === 1 ? '' : 's'}</div></div>
       <div style="text-align:right"><b>${x.d != null ? esc(fmtDist(x.d)) : '—'}</b>${x.d != null && !x.fresh ? '<div class="small muted">old GPS</div>' : ''}</div></div>`).join('') || '<div class="empty">No staff found.</div>'}</div>
     <div class="row" style="margin-top:14px;align-items:flex-end"><label class="field" style="flex:1;min-width:200px"><span>Visit date &amp; time</span><input type="datetime-local" id="as-when" value="${esc(def)}"></label>
       <label class="field" style="flex:1;min-width:140px"><span>Priority</span><select id="as-p">${PRIORITIES.map((p) => `<option value="${p.k}" ${t.priority === p.k ? 'selected' : ''}>${p.t}</option>`).join('')}</select></label></div>
     <label class="field" style="margin-top:10px"><span>Note for the technician (internal)</span><input id="as-n" placeholder="e.g. Carry 4TB HDD; ask for Mr. Ali at reception"></label>`,
    `<button class="btn" data-x>Cancel</button><button class="btn primary" id="as-go">Assign</button>`);
  $$('[data-u]', o).forEach((e) => (e.onclick = () => { pick = e.dataset.u; $$('[data-u]', o).forEach((x) => x.classList.toggle('on', x === e)); }));
  $('#as-go', o).onclick = async () => {
    const u = userById(pick); if (!u) return toast('Choose a technician', true);
    const w = $('#as-when', o).value; const when = w ? Timestamp.fromDate(new Date(w)) : null;
    const note = $('#as-n', o).value.trim(); const pr = $('#as-p', o).value;
    $('#as-go', o).disabled = true;
    const same = t.assignedTo === u.id;
    const ok = await updateTicket(t, {
      status: same && ['accepted', 'on_way', 'on_site'].includes(t.status) ? t.status : 'assigned',
      assignedTo: u.id, assignedName: u.name || '', assignedAt: serverTimestamp(), assignedBy: S.me.id, assignedByName: S.me.name || '',
      scheduledAt: when, priority: pr, ...(note ? { techNote: note } : {}),
    }, `${same ? 'Visit updated' : 'Assigned to ' + u.name}${when ? ' — visit ' + fmtDT(when) : ''}${note ? ' (note: ' + note + ')' : ''}`,
    `Assigned to our technical team — technician ${u.name} will visit${whenTxt(when) || ' as per your preferred time'}`);
    if (ok) { toast(`Assigned to ${u.name}`); close(o); if (!document.querySelector('.overlay[data-tid]')) openTicket(t.id); } else $('#as-go', o).disabled = false;
  };
}

// ================================================================== new ticket (staff)
function newTicketModal(preClientId = '') {
  const F = { clientId: preClientId, siteId: '', category: '', priority: 'normal' };
  const o = modal('<h2 class="grow">New service ticket</h2>', '<div id="ntb"></div>', '<button class="btn" data-x>Cancel</button><button class="btn primary" id="nt-go">Create ticket</button>', { wide: true });
  const draw = () => {
    const c = S.clients.find((x) => x.id === F.clientId); const sites = c ? sitesFromPlaces(c) : [];
    const keep = (id) => { const e = $(id, o); return e ? e.value : ''; };
    const vals = { name: keep('#nt-cname'), phone: keep('#nt-cphone'), desc: keep('#nt-desc'), date: keep('#nt-date') || dateKey(), slot: keep('#nt-slot') || 'asap', oname: keep('#nt-oname'), oaddr: keep('#nt-oaddr') };
    if (!vals.name && c) vals.name = c.contact || ''; if (!vals.phone && c) vals.phone = c.phone || '';
    $('#ntb', o).innerHTML = `${S.clientsErr ? `<div class="small" style="color:var(--danger)">${esc(S.clientsErr)}</div>` : ''}
      <div class="row" style="align-items:flex-end"><label class="field" style="flex:1;min-width:220px"><span>Client</span><select id="nt-c"><option value="">Choose client…</option>${S.clients.map((x) => `<option value="${esc(x.id)}" ${x.id === F.clientId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field" style="flex:1;min-width:220px"><span>Site</span><select id="nt-s"><option value="">${c ? 'Choose site…' : '—'}</option>${sites.map((s) => `<option value="${esc(s.id)}" ${s.id === F.siteId ? 'selected' : ''}>${esc(s.name)}${hasGPS(s) ? '' : ' (no GPS)'}</option>`).join('')}<option value="_other" ${F.siteId === '_other' ? 'selected' : ''}>Other location…</option></select></label></div>
      ${F.siteId === '_other' ? `<div class="row" style="margin-top:8px"><input id="nt-oname" placeholder="Location name" value="${esc(vals.oname)}" style="flex:1"><input id="nt-oaddr" placeholder="Address" value="${esc(vals.oaddr)}" style="flex:2"></div>` : ''}
      <div class="sec-t" style="margin-top:14px">Service</div><div class="tiles">${activeTypes().map((x) => `<button type="button" class="tile ${F.category === x.k ? 'on' : ''}" data-cat="${x.k}"><span class="ti">${icon(x.i || x.k, 20)}</span><span>${esc(x.t)}</span></button>`).join('')}</div>
      <label class="field" style="margin-top:10px"><span>Problem</span><textarea id="nt-desc" rows="3">${esc(vals.desc)}</textarea></label>
      <div class="sec-t" style="margin-top:12px">Priority</div><div class="ptiles">${PRIORITIES.map((p) => `<button type="button" class="tile ptile ${F.priority === p.k ? 'on' : ''}" data-prio="${p.k}" style="border-left-color:${p.c}"><span><b style="color:${p.c}">${p.t}</b><small>${esc(p.s)}</small></span></button>`).join('')}</div>
      <div class="row" style="margin-top:12px;align-items:flex-end"><label class="field" style="flex:1;min-width:150px"><span>Preferred date</span><input type="date" id="nt-date" value="${esc(vals.date)}"></label>
        <label class="field" style="flex:1;min-width:180px"><span>Time</span><select id="nt-slot">${SLOTS.map((s) => `<option value="${s.k}" ${vals.slot === s.k ? 'selected' : ''}>${esc(s.t)}</option>`).join('')}</select></label>
        <label class="field" style="flex:1;min-width:160px"><span>Contact name</span><input id="nt-cname" value="${esc(vals.name)}"></label>
        <label class="field" style="flex:1;min-width:150px"><span>Contact mobile</span><input id="nt-cphone" value="${esc(vals.phone)}"></label></div>`;
    $('#nt-c', o).onchange = (e) => { F.clientId = e.target.value; F.siteId = ''; draw(); };
    $('#nt-s', o).onchange = (e) => { F.siteId = e.target.value; draw(); };
    $$('[data-cat]', o).forEach((b) => (b.onclick = () => { F.category = b.dataset.cat; $$('[data-cat]', o).forEach((x) => x.classList.toggle('on', x === b)); }));
    $$('[data-prio]', o).forEach((b) => (b.onclick = () => { F.priority = b.dataset.prio; $$('[data-prio]', o).forEach((x) => x.classList.toggle('on', x === b)); }));
  };
  draw();
  $('#nt-go', o).onclick = async () => {
    const c = S.clients.find((x) => x.id === F.clientId); const site = c && sitesFromPlaces(c).find((s) => s.id === F.siteId);
    const v = (id) => ($(id, o) ? $(id, o).value.trim() : '');
    if (!c) return toast('Choose a client', true);
    if (!site && !(F.siteId === '_other' && v('#nt-oname'))) return toast('Choose the site', true);
    if (!F.category) return toast('Choose the type of service', true);
    if (!v('#nt-desc')) return toast('Describe the problem', true);
    const portal = S.portals.filter((p) => p.active && p.clientId === c.id).sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0))[0];
    const t = {
      clientId: c.id, clientName: c.name || '', siteId: site ? site.id : '', siteName: site ? site.name : v('#nt-oname'), siteAddress: site ? site.address : v('#nt-oaddr'),
      contactName: v('#nt-cname'), contactPhone: v('#nt-cphone'), category: F.category, categories: [F.category], categoryLabels: [typeLabel(F.category)], description: v('#nt-desc'), priority: F.priority,
      preferredDate: v('#nt-date') || dateKey(), preferredSlot: v('#nt-slot') || 'asap', status: 'new', open: true, source: 'staff',
      createdBy: S.me.id, createdByName: S.me.name || '',
    };
    if (site && hasGPS(site)) { t.lat = site.lat; t.lng = site.lng; }
    if (portal) t.portal = portal.id;
    $('#nt-go', o).disabled = true;
    for (let i = 0; i < 4; i++) {
      const id = newTicketNo();
      const full = { ...t, number: id, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), log: [{ at: Timestamp.now(), by: S.me.id, byName: S.me.name || '', t: `Raised by ${S.me.name} (staff)` }] };
      try {
        const ex = await getDoc(doc(db, 'svcTickets', id)); if (ex.exists()) continue;
        const b = writeBatch(db); b.set(doc(db, 'svcTickets', id), full);
        if (portal) b.set(doc(db, 'svcPortals', portal.id, 'tickets', id), { ...publicView(full), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), log: [{ at: Timestamp.now(), t: 'Request registered by Leaders Line' }] });
        close(o); await b.commit(); toast(`Ticket ${id} created`); setTimeout(() => openTicket(id), 60); return;
      } catch (e) { toast(friendly(e), true); break; }
    }
    $('#nt-go', o).disabled = false;
  };
}

// ================================================================== clients & links
function clientsView(m) {
  const all = allTickets();
  const q = (S.cq || '').toLowerCase();
  const rows = S.clients.filter((c) => !q || String(c.name).toLowerCase().includes(q)).map((c) => {
    const ps = S.portals.filter((p) => p.clientId === c.id).sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
    const p = ps.find((x) => x.active) || null;
    const ts = all.filter((t) => t.clientId === c.id);
    return { c, p, n: ts.length, open: ts.filter((t) => t.open).length, last: ts.map((t) => toDate(t.createdAt)).filter(Boolean).sort((a, b) => b - a)[0], sites: (c.places || []).length, gps: (c.places || []).filter((x) => hasGPS({ lat: +x.lat, lng: +x.lng })).length };
  });
  m.innerHTML = `<div class="row" style="margin-bottom:12px"><h1 class="grow">Customers</h1><input id="cq" placeholder="Search client…" value="${esc(S.cq || '')}" style="max-width:280px"></div>
    <p class="muted small" style="margin-top:-4px">Set up each customer's service profile — AMC contract, trade licence, building photos and the equipment we maintain (NVRs, cameras, other devices) — then share their private service link. Sites and GPS come from LLCT Invoicing.</p>
    ${S.clientsErr ? `<div class="card pad" style="color:var(--danger)">${esc(S.clientsErr)}</div>` : ''}
    <div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>Client</th><th>Sites</th><th>Service profile</th><th>Tickets</th><th>Last request</th><th>Service link</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="click" data-hist="${esc(r.c.id)}" style="cursor:pointer"><b>${esc(r.c.name)}</b>${r.c.phone ? `<div class="small muted">${esc(r.c.contact || '')} ${esc(r.c.phone)}</div>` : ''}</td>
      <td>${r.sites}<div class="small ${r.gps < r.sites ? '' : 'muted'}" style="${r.gps < r.sites ? 'color:var(--warning)' : ''}">${r.gps} with GPS</div></td>
      <td>${profSummary(r.c.id)}</td>
      <td>${r.n}${r.open ? ` <span class="chip" style="background:#fde3e3;color:var(--danger)">${r.open} open</span>` : ''}</td>
      <td class="small">${r.last ? esc(fmtDate(r.last)) : '—'}</td>
      <td>${r.p ? `<div class="linkbox"><input readonly value="${esc(portalUrl(r.p.id))}"><button class="btn sm" data-copy="${esc(r.p.id)}">Copy</button>
          <a class="btn sm" target="_blank" rel="noopener" href="${waLink(r.c.phone || '', linkMsg(r.c, r.p))}">WhatsApp</a><button class="btn sm" data-more="${esc(r.p.id)}">⋯</button></div>`
        : `<button class="btn sm primary" data-mk="${esc(r.c.id)}">Create link</button>`}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">${S.clients.length ? 'No match.' : 'No clients yet.'}</td></tr>`}
    </tbody></table></div>`;
  const cq = $('#cq', m); cq.oninput = () => { S.cq = cq.value; clearTimeout(cq._t); cq._t = setTimeout(() => { render(); const n = $('#cq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  $$('[data-mk]', m).forEach((b) => (b.onclick = () => makePortal(S.clients.find((c) => c.id === b.dataset.mk), b)));
  $$('[data-prof]', m).forEach((b) => (b.onclick = () => profileModal(b.dataset.prof)));
  $$('[data-copy]', m).forEach((b) => (b.onclick = () => copy(portalUrl(b.dataset.copy))));
  $$('[data-more]', m).forEach((b) => (b.onclick = () => portalMenu(S.portals.find((p) => p.id === b.dataset.more))));
  $$('[data-hist]', m).forEach((e) => (e.onclick = () => clientHistory(e.dataset.hist)));
}
function profSummary(cid) {
  const pr = (S.profiles || {})[cid];
  if (!pr) return `<button class="btn sm primary" data-prof="${esc(cid)}">Set up profile</button>`;
  let n = 0, c = 0, o = 0; Object.values(pr.sites || {}).forEach((e) => { n += (e.nvrs || []).length; c += (e.cameras || []).length; o += (e.others || []).length; });
  const a = amcStatus(pr.amc);
  const tone = { ok: 'var(--success)', warn: 'var(--warning)', bad: 'var(--danger)' }[a.tone] || 'var(--steel)';
  return `<button class="btn sm" data-prof="${esc(cid)}">Edit profile</button>
    <div class="small" style="margin-top:4px">${[n && `${n} NVR`, c && `${c} cam`, o && `${o} other`].filter(Boolean).join(' · ') || '<span class="muted">No equipment</span>'}</div>
    ${a.text ? `<div class="small" style="color:${tone}">${esc(a.text)}</div>` : ''}${pr.tradeLicense ? `<div class="small muted">TL ${esc(pr.tradeLicense)}</div>` : ''}`;
}
const linkMsg = (c, p) => `Dear ${c.contact || c.name},\n\nFor any CCTV / security service request please use your Leaders Line service link:\n${portalUrl(p.id)}\n\nYou can choose the site, describe the problem, set the priority and preferred visit time, and follow the status of every request.\n\nLeaders Line Trading LLC · 04 880 5577`;
function copy(text) { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Link copied'), () => prompt('Copy this link:', text)); }
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/** Fields of the service profile the client's link may show (equipment names only, no serials or IPs). */
function clientProfileForLink(prof) {
  const eq = {};
  Object.entries((prof && prof.sites) || {}).forEach(([sid, e]) => { const l = leanEquipment(e); if (l.nvrs.length || l.cameras.length || l.others.length) eq[sid] = l; });
  const a = (prof && prof.amc) || {};
  return { tradeLicense: (prof && prof.tradeLicense) || '', equipment: eq, amc: { no: a.no || '', end: a.end || '' }, services: (prof && Array.isArray(prof.services)) ? prof.services : [] };
}
/** Copy a site's building photo onto every service link of the client, so the client page can show it. */
async function syncSitePhoto(clientId, sid, data) {
  await Promise.all(S.portals.filter((p) => p.clientId === clientId).map((p) => {
    const r = doc(db, 'svcPortals', p.id, 'sitePhotos', sid);
    return (data ? setDoc(r, { data, at: serverTimestamp() }) : deleteDoc(r)).catch(() => {});
  }));
}
async function syncAllSitePhotos(clientId, siteIds) {
  await Promise.all(siteIds.map((sid) => getDoc(doc(db, 'svcClients', clientId, 'sitePhotos', sid))
    .then((d) => syncSitePhoto(clientId, sid, d.exists() && d.data().data ? d.data().data : null)).catch(() => {})));
}
// ------------------------------------------------------------------ Excel import of equipment
let XLSX = null;
async function xlsxLib() {
  if (XLSX) return XLSX;
  for (const u of ['https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs', './vendor/xlsx.mjs']) {
    try { XLSX = await import(u); return XLSX; } catch (_) { /* try next */ }
  }
  throw new Error('Could not load the Excel reader. Check the internet connection, or save the sheet as CSV and try again.');
}
const normH = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const HEAD = {
  type: ['type', 'device', 'devicetype', 'category', 'equipment', 'item', 'kind'],
  no: ['no', 'number', 'sr', 'srno', 'sno', 'slno', 'cameraNo', 'camno', 'camerano', 'nvrno', 'id', 'num'],
  name: ['name', 'location', 'cameraname', 'description', 'desc', 'label', 'area', 'position', 'title'],
  nvr: ['nvr', 'nvrno', 'recorder', 'dvr', 'connectedto', 'nvrdvr'],
  ch: ['ch', 'channel', 'channelno', 'chno', 'port'],
  ip: ['ip', 'ipaddress', 'ipaddr', 'address'],
  model: ['model', 'modelno', 'make', 'brandmodel', 'partno'],
  serial: ['serial', 'serialno', 'sn', 'serialnumber', 'snno'],
  channels: ['channels', 'totalchannels', 'noofchannels', 'channelcount'],
  qty: ['qty', 'quantity', 'count', 'nos'],
};
function kindFrom(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(nvr|dvr|recorder|xvr)\b/.test(t)) return 'nvr';
  if (/\b(cam|camera|cameras|ipc|bullet|dome|ptz|turret)\b/.test(t)) return 'camera';
  return '';
}
function otherType(text) {
  const t = String(text || '').toLowerCase();
  const map = [[/switch|poe/, 'Network switch'], [/hdd|hard ?dis[kc]|storage/, 'Hard disk'], [/monitor|tv|screen|display/, 'Monitor / TV'], [/ups|battery/, 'UPS'],
    [/router|wi-?fi|access point|\bap\b/, 'Router / Wi-Fi'], [/access|door|biometric|card reader/, 'Access control'], [/intercom|vdp|door phone/, 'Intercom'],
    [/fire|smoke/, 'Fire alarm panel'], [/o2iot|iot/, 'O2IOT switch'], [/o2|oxygen/, 'Oxygen O2 device']];
  const m = map.find(([re]) => re.test(t)); return m ? m[1] : (text ? String(text).trim() : 'Other');
}
async function readEquipmentFile(file) {
  const L = await xlsxLib();
  const wb = L.read(await file.arrayBuffer(), { type: 'array' });
  const out = { nvrs: [], cameras: [], others: [], skipped: 0 };
  wb.SheetNames.forEach((sn) => {
    const rows = L.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: false });
    // first row that looks like headings
    let hi = rows.findIndex((r) => r.filter((c) => Object.values(HEAD).some((l) => l.map(normH).includes(normH(c)))).length >= 2);
    if (hi < 0) return;
    const col = {}; rows[hi].forEach((c, i) => { const h = normH(c); Object.entries(HEAD).forEach(([k, l]) => { if (col[k] === undefined && l.map(normH).includes(h)) col[k] = i; }); });
    const sheetKind = kindFrom(sn) || (/other|device|misc|network|access/i.test(sn) ? 'other' : '');
    rows.slice(hi + 1).forEach((r) => {
      const g = (k) => (col[k] === undefined ? '' : String(r[col[k]] ?? '').trim());
      if (!r.some((c) => String(c).trim())) return;
      const typ = g('type');
      const kind = kindFrom(typ) || (typ ? 'other' : '') || sheetKind || (g('nvr') || g('ch') ? 'camera' : '');
      const rec = { id: newId() + Math.random().toString(36).slice(2, 5), no: g('no'), name: g('name'), model: g('model'), serial: g('serial'), ip: g('ip') };
      if (!rec.no && !rec.name && !rec.ip && !rec.serial && !rec.model) { out.skipped++; return; }
      if (kind === 'nvr') out.nvrs.push({ ...rec, no: rec.no || String(out.nvrs.length + 1), channels: g('channels') });
      else if (kind === 'camera') out.cameras.push({ ...rec, no: rec.no || String(out.cameras.length + 1).padStart(2, '0'), nvr: g('nvr').replace(/^nvr\s*/i, ''), ch: g('ch') });
      else if (kind === 'other') out.others.push({ id: rec.id, type: otherType(typ || sn), name: rec.name, model: rec.model, serial: rec.serial, ip: rec.ip, qty: g('qty') || '1' });
      else out.skipped++;
    });
  });
  return out;
}
async function equipmentTemplate() {
  const L = await xlsxLib();
  const wb = L.utils.book_new();
  const add = (name, rows, w) => { const ws = L.utils.aoa_to_sheet(rows); ws['!cols'] = w.map((x) => ({ wch: x })); L.utils.book_append_sheet(wb, ws, name); };
  add('NVR', [['No', 'Name', 'Model', 'Serial', 'IP', 'Channels'], ['1', 'Main office rack', 'Hikvision DS-7616NI', 'DS7616-001', '192.168.1.64', '16']], [6, 24, 22, 18, 16, 10]);
  add('Cameras', [['No', 'Name', 'NVR', 'Channel', 'IP', 'Model', 'Serial'], ['01', 'Main gate', '1', '1', '192.168.1.101', 'DS-2CD2043G2', 'CAM-0001'], ['02', 'Cash counter', '1', '2', '192.168.1.102', 'DS-2CD2143G2', 'CAM-0002']], [6, 24, 6, 9, 16, 20, 16]);
  add('Other', [['Type', 'Name', 'Model', 'Serial', 'IP', 'Qty'], ['Network switch', 'Rack PoE switch', 'TP-Link TL-SG1016PE', 'SW-01', '192.168.1.2', '1'], ['Hard disk', 'NVR 1 storage', 'WD Purple 4TB', 'WX12AB345', '', '2'], ['UPS', 'Server room', 'APC 3kVA', 'UPS-01', '', '1']], [18, 22, 22, 16, 16, 6]);
  L.writeFile(wb, 'equipment-template.xlsx');
}

/** Service profile of a client: trade licence, and per site the building photo and the equipment we maintain. */
async function profileModal(clientId) {
  const c = S.clients.find((x) => x.id === clientId); if (!c) return;
  const sites = sitesFromPlaces(c);
  let prof = { tradeLicense: '', sites: {}, services: [], amc: {} };
  try { const d = await getDoc(doc(db, 'svcClients', clientId)); if (d.exists()) prof = { tradeLicense: '', sites: {}, services: [], amc: {}, ...d.data() }; } catch (e) { return toast(friendly(e), true); }
  let sid = sites[0] ? sites[0].id : '';
  const eqOf = (id) => { const e = prof.sites[id] = prof.sites[id] || {}; e.nvrs = e.nvrs || []; e.cameras = e.cameras || []; e.others = e.others || []; return e; };
  const o = modal(`<h2 class="grow">${esc(c.name)} — service profile</h2>`, '<div id="pf"></div>',
    `<button class="btn" data-x>Close</button><button class="btn primary" id="pf-save">Save profile</button>`, { wide: true });
  const keep = () => {
    const tl = $('#pf-tl', o); if (tl) prof.tradeLicense = tl.value.trim();
    if ($('#pf-amc', o)) { prof.amc = prof.amc || {}; $$('[data-amc]', o).forEach((i) => { prof.amc[i.dataset.amc] = i.value.trim(); }); }
    if ($('#pf-svc', o)) prof.services = $$('[data-svc]', o).filter((i) => i.checked).map((i) => i.dataset.svc);
    if (!sid) return; const e = eqOf(sid);
    $$('[data-nf]', o).forEach((i) => { const [k, f] = i.dataset.nf.split(':'); e.nvrs[+k][f] = i.value.trim(); });
    $$('[data-cf]', o).forEach((i) => { const [k, f] = i.dataset.cf.split(':'); e.cameras[+k][f] = i.value.trim(); });
    $$('[data-of]', o).forEach((i) => { const [k, f] = i.dataset.of.split(':'); e.others[+k][f] = i.value.trim(); });
  };
  const draw = () => {
    const e = sid ? eqOf(sid) : { nvrs: [], cameras: [], others: [] };
    const am = prof.amc || {};
    const nvrOpts = (v) => `<option value="">—</option>${v && !e.nvrs.some((n) => String(n.no) === String(v)) ? `<option value="${esc(v)}" selected>NVR ${esc(v)}</option>` : ''}${e.nvrs.map((n) => `<option value="${esc(n.no)}" ${String(v) === String(n.no) ? 'selected' : ''}>NVR ${esc(n.no)}</option>`).join('')}`;
    $('#pf', o).innerHTML = `
      <div class="grid2"><label class="field"><span>Trade licence number</span><input id="pf-tl" value="${esc(prof.tradeLicense || '')}" placeholder="e.g. 123456"></label>
        <label class="field"><span>Site</span><select id="pf-site">${sites.map((x) => `<option value="${esc(x.id)}" ${x.id === sid ? 'selected' : ''}>${esc(x.name)}</option>`).join('') || '<option value="">Add sites to this client in LLCT Invoicing first</option>'}</select></label></div>
      <div id="pf-amc" class="pfsec"><b>AMC contract</b>
        <div class="grid4"><label class="field"><span>Contract no.</span><input data-amc="no" value="${esc(am.no || '')}" placeholder="e.g. AMC-2026-014"></label>
          <label class="field"><span>Start</span><input type="date" data-amc="start" value="${esc(am.start || '')}"></label>
          <label class="field"><span>End</span><input type="date" data-amc="end" value="${esc(am.end || '')}"></label>
          <label class="field"><span>Visits / year</span><input type="number" min="0" data-amc="visits" value="${esc(am.visits || '')}" placeholder="4"></label></div>
        <label class="field" style="margin-top:8px"><span>Covered products &amp; services</span><input data-amc="covered" value="${esc(am.covered || '')}" placeholder="e.g. Preventive maintenance, labour, breakdown calls 24/7 — spare parts chargeable"></label></div>
      <div id="pf-svc" style="margin-top:14px"><b>Service options this client sees</b><span class="small muted"> — tick only what they have (e.g. CCTV only). None ticked = show all. "Other" always shows.</span>
        <div class="svcpick">${activeTypes().filter((t) => t.k !== 'other').map((t) => `<label><input type="checkbox" data-svc="${esc(t.k)}" ${(prof.services || []).includes(t.k) ? 'checked' : ''}>${esc(t.t)}</label>`).join('')}</div></div>
      ${sid ? `<div class="row" style="margin-top:14px;align-items:flex-start;gap:14px">
        <div id="pf-ph" class="pfph"><span class="small muted">Loading photo…</span></div>
        <div class="grow"><b>Building photo</b><p class="small muted" style="margin:2px 0 8px">Shown to the client on their request page and to the technician.</p>
          <label class="btn sm">Upload photo<input type="file" accept="image/*" hidden id="pf-up"></label> <button class="btn sm bad" id="pf-rm" type="button">Remove</button></div></div>
      <div class="pfsec impbox"><div class="row" style="align-items:center;gap:10px;flex-wrap:wrap"><div class="grow"><b>Import from Excel</b><div class="small muted">NVRs, cameras (with IPs) and other equipment for <b>${esc((sites.find((x) => x.id === sid) || {}).name || '')}</b> — .xlsx, .xls or .csv.</div></div>
        <button class="btn sm" id="pf-tpl" type="button">Download template</button><label class="btn sm primary">Choose Excel file<input type="file" hidden id="pf-xls" accept=".xlsx,.xls,.csv"></label></div><div id="pf-imp"></div></div>
      <h3 style="margin-top:18px">NVR / DVR <span class="muted small">(${e.nvrs.length})</span></h3>
      <div style="overflow:auto"><table class="tbl eqt"><thead><tr><th style="width:70px">No.</th><th>Name / location</th><th>Model</th><th>Serial</th><th>IP</th><th style="width:80px">Channels</th><th style="width:40px"></th></tr></thead><tbody>
        ${e.nvrs.map((n, k) => `<tr>${['no', 'name', 'model', 'serial', 'ip', 'channels'].map((f) => `<td><input data-nf="${k}:${f}" value="${esc(n[f] || '')}"></td>`).join('')}<td><button class="btn sm bad" data-nrm="${k}" type="button">✕</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No NVR yet.</td></tr>'}
      </tbody></table></div>
      <button class="btn sm" id="pf-addn" type="button" style="margin-top:6px">+ NVR</button>
      <h3 style="margin-top:18px">Cameras <span class="muted small">(${e.cameras.length})</span></h3>
      <div style="overflow:auto"><table class="tbl eqt"><thead><tr><th style="width:70px">No.</th><th>Name / location</th><th style="width:100px">NVR</th><th style="width:70px">Ch.</th><th>IP</th><th>Model</th><th>Serial</th><th style="width:40px"></th></tr></thead><tbody>
        ${e.cameras.map((cm, k) => `<tr><td><input data-cf="${k}:no" value="${esc(cm.no || '')}"></td><td><input data-cf="${k}:name" value="${esc(cm.name || '')}"></td>
          <td><select data-cf="${k}:nvr">${nvrOpts(cm.nvr)}</select></td><td><input data-cf="${k}:ch" value="${esc(cm.ch || '')}"></td><td><input data-cf="${k}:ip" value="${esc(cm.ip || '')}"></td>
          <td><input data-cf="${k}:model" value="${esc(cm.model || '')}"></td><td><input data-cf="${k}:serial" value="${esc(cm.serial || '')}"></td><td><button class="btn sm bad" data-crm="${k}" type="button">✕</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No cameras yet.</td></tr>'}
      </tbody></table></div>
      <div class="row" style="margin-top:6px"><button class="btn sm" id="pf-addc" type="button">+ Camera</button><button class="btn sm" id="pf-addmany" type="button">+ Several cameras…</button></div>
      <h3 style="margin-top:18px">Other equipment under maintenance <span class="muted small">(${e.others.length})</span></h3>
      <div style="overflow:auto"><table class="tbl eqt"><thead><tr><th style="width:170px">Type</th><th>Name / location</th><th>Model</th><th>Serial</th><th>IP</th><th style="width:70px">Qty</th><th style="width:40px"></th></tr></thead><tbody>
        ${e.others.map((x, k) => `<tr><td><select data-of="${k}:type">${OTHER_TYPES.map((t) => `<option ${x.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></td>
          ${['name', 'model', 'serial', 'ip', 'qty'].map((f) => `<td><input data-of="${k}:${f}" value="${esc(x[f] || '')}"></td>`).join('')}<td><button class="btn sm bad" data-orm="${k}" type="button">✕</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Switches, hard disks, UPS, monitors, access control, O2 devices…</td></tr>'}
      </tbody></table></div>
      <button class="btn sm" id="pf-addo" type="button" style="margin-top:6px">+ Other equipment</button>` : ''}`;
    const ss = $('#pf-site', o); if (ss) ss.onchange = () => { keep(); sid = ss.value; draw(); };
    if (!sid) return;
    $('#pf-addn', o).onclick = () => { keep(); e.nvrs.push({ id: newId(), no: String(e.nvrs.length + 1), name: '', model: '', serial: '', ip: '', channels: '' }); draw(); };
    $('#pf-addc', o).onclick = () => { keep(); e.cameras.push({ id: newId(), no: String(e.cameras.length + 1).padStart(2, '0'), name: '', nvr: e.nvrs[0] ? e.nvrs[0].no : '', ch: String(e.cameras.length + 1), model: '', serial: '' }); draw(); };
    $('#pf-addmany', o).onclick = () => {
      keep(); const n = parseInt(prompt('How many cameras to add?', '8'), 10); if (!(n > 0 && n <= 128)) return;
      const nv = e.nvrs[0] ? e.nvrs[0].no : '';
      for (let i = 0; i < n; i++) { const k = e.cameras.length + 1; e.cameras.push({ id: newId(), no: String(k).padStart(2, '0'), name: '', nvr: nv, ch: String(k), model: '', serial: '' }); }
      draw();
    };
    $$('[data-nrm]', o).forEach((b) => (b.onclick = () => { keep(); e.nvrs.splice(+b.dataset.nrm, 1); draw(); }));
    $$('[data-crm]', o).forEach((b) => (b.onclick = () => { keep(); e.cameras.splice(+b.dataset.crm, 1); draw(); }));
    $('#pf-tpl', o).onclick = () => equipmentTemplate().catch((er) => toast(er.message || 'Could not make the template', true));
    $('#pf-xls', o).onchange = async (ev) => {
      const file = ev.target.files[0]; ev.target.value = ''; if (!file) return;
      const box = $('#pf-imp', o); box.innerHTML = '<p class="small muted">Reading file…</p>';
      let got; try { got = await readEquipmentFile(file); } catch (er) { box.innerHTML = `<p class="small" style="color:var(--danger)">${esc(er.message || 'Could not read this file')}</p>`; return; }
      const n = got.nvrs.length + got.cameras.length + got.others.length;
      if (!n) { box.innerHTML = '<p class="small" style="color:var(--danger)">No equipment rows found. Use the template, or make sure the first row has headings like Type, No, Name, NVR, Channel, IP, Model, Serial.</p>'; return; }
      const cur = e.nvrs.length + e.cameras.length + e.others.length;
      box.innerHTML = `<div class="impres"><b>Found ${got.nvrs.length} NVR, ${got.cameras.length} cameras, ${got.others.length} other devices</b>${got.skipped ? `<span class="small muted"> · ${got.skipped} empty / unreadable rows skipped</span>` : ''}
        <div class="small muted" style="margin:4px 0 8px">${got.cameras.slice(0, 4).map((c) => `Cam ${esc(c.no)} ${esc(c.name)}${c.ip ? ' · ' + esc(c.ip) : ''}`).join(' — ')}${got.cameras.length > 4 ? ' …' : ''}</div>
        <div class="row">${cur ? `<button class="btn sm primary" id="pi-rep" type="button">Replace current list (${cur})</button><button class="btn sm" id="pi-add" type="button">Add to current list</button>` : '<button class="btn sm primary" id="pi-add" type="button">Add to this site</button>'}<button class="btn sm" id="pi-x" type="button">Cancel</button></div></div>`;
      const apply = (replace) => { keep(); if (replace) { e.nvrs = []; e.cameras = []; e.others = []; } e.nvrs.push(...got.nvrs); e.cameras.push(...got.cameras); e.others.push(...got.others); prof.sites[sid] = e; draw(); toast(`Imported ${n} items — press Save profile to keep them`); };
      const r = $('#pi-rep', box); if (r) r.onclick = () => apply(true);
      $('#pi-add', box).onclick = () => apply(false);
      $('#pi-x', box).onclick = () => { box.innerHTML = ''; };
    };
    $$('[data-orm]', o).forEach((b) => (b.onclick = () => { keep(); e.others.splice(+b.dataset.orm, 1); draw(); }));
    $('#pf-addo', o).onclick = () => { keep(); e.others.push({ id: newId(), type: OTHER_TYPES[0], name: '', model: '', serial: '', qty: '1' }); draw(); };
    const box = $('#pf-ph', o), here = sid;
    getDoc(doc(db, 'svcClients', clientId, 'sitePhotos', sid)).then((d) => { if (sid === here && box) box.innerHTML = d.exists() && d.data().data ? `<img src="${d.data().data}" alt="Building">` : '<span class="small muted">No photo</span>'; }).catch(() => { if (box) box.innerHTML = '<span class="small muted">—</span>'; });
    $('#pf-up', o).onchange = async (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      try { const data = await compressImage(f, 1280, 0.72); await setDoc(doc(db, 'svcClients', clientId, 'sitePhotos', sid), { data, by: S.me.id, at: serverTimestamp() }); await syncSitePhoto(clientId, sid, data); box.innerHTML = `<img src="${data}" alt="Building">`; toast('Photo saved'); }
      catch (e2) { toast(friendly(e2), true); }
    };
    $('#pf-rm', o).onclick = async () => { await deleteDoc(doc(db, 'svcClients', clientId, 'sitePhotos', sid)).catch(() => {}); await syncSitePhoto(clientId, sid, null); box.innerHTML = '<span class="small muted">No photo</span>'; };
  };
  draw();
  $('#pf-save', o).onclick = async () => {
    keep();
    // tidy: drop empty rows
    Object.values(prof.sites).forEach((e) => { e.nvrs = (e.nvrs || []).filter((n) => n.no || n.name); e.cameras = (e.cameras || []).filter((x) => x.no || x.name); e.others = (e.others || []).filter((x) => x.name || x.model || x.serial || x.type); });
    $('#pf-save', o).disabled = true;
    try {
      await setDoc(doc(db, 'svcClients', clientId), { tradeLicense: prof.tradeLicense || '', sites: prof.sites, services: prof.services || [], amc: prof.amc || {}, clientName: c.name || '', updatedAt: serverTimestamp(), updatedBy: S.me.name || '' });
      const extra = clientProfileForLink(prof);
      await Promise.all(S.portals.filter((p) => p.clientId === clientId).map((p) => updateDoc(doc(db, 'svcPortals', p.id), extra).catch(() => {})));
      await syncAllSitePhotos(clientId, sites.map((x) => x.id));
      toast('Service profile saved — the client can now pick this equipment'); close(o);
    } catch (e) { toast(friendly(e), true); $('#pf-save', o).disabled = false; }
  };
}

async function makePortal(c, btn) {
  if (!c) return; if (btn) btn.disabled = true;
  const token = randToken();
  try {
    let extra = {};
    try { const pr = await getDoc(doc(db, 'svcClients', c.id)); if (pr.exists()) extra = clientProfileForLink(pr.data()); } catch (_) { /* no profile yet */ }
    await setDoc(doc(db, 'svcPortals', token), { active: true, clientId: c.id, clientName: c.name || '', contact: c.contact || '', phone: c.phone || '', sites: sitesFromPlaces(c), ...extra, createdAt: serverTimestamp(), createdBy: S.me.id, createdByName: S.me.name || '', updatedAt: serverTimestamp() });
    await Promise.all(sitesFromPlaces(c).map((x) => getDoc(doc(db, 'svcClients', c.id, 'sitePhotos', x.id)).then((d) => (d.exists() && d.data().data ? setDoc(doc(db, 'svcPortals', token, 'sitePhotos', x.id), { data: d.data().data, at: serverTimestamp() }) : null)).catch(() => {})));
    toast('Link created'); copy(portalUrl(token));
  } catch (e) { toast(friendly(e), true); if (btn) btn.disabled = false; }
}
function portalMenu(p) {
  if (!p) return; const c = S.clients.find((x) => x.id === p.clientId) || { name: p.clientName };
  const o = modal(`<h2 class="grow">${esc(c.name)} — service link</h2>`,
    `<div class="linkbox"><input readonly value="${esc(portalUrl(p.id))}"><button class="btn sm" id="pm-c">Copy</button><a class="btn sm" href="${portalUrl(p.id)}" target="_blank" rel="noopener">Open</a></div>
     <p class="small muted">Created ${esc(fmtDT(p.createdAt))}${p.createdByName ? ' by ' + esc(p.createdByName) : ''}. ${(p.sites || []).length} site(s) on the link.</p>
     <div class="small">${(p.sites || []).map((s) => `• ${esc(s.name)} ${hasGPS(s) ? '<span style="color:var(--success)">GPS</span>' : '<span class="muted">no GPS</span>'}`).join('<br>')}</div>`,
    `${isMgmt() ? '<button class="btn bad" id="pm-del">Delete link</button>' : ''}<button class="btn bad" id="pm-off">Disable link</button><button class="btn" id="pm-new">Replace with new link</button><button class="btn" data-x>Done</button>`);
  const pd = $('#pm-del', o);
  if (pd) pd.onclick = async () => { if (!confirm('Delete this link? The client can no longer open it. Their past tickets stay in the desk.')) return; await deleteDoc(doc(db, 'svcPortals', p.id)).then(() => toast('Link deleted'), (e) => toast(friendly(e), true)); close(o); };
  $('#pm-c', o).onclick = () => copy(portalUrl(p.id));
  $('#pm-off', o).onclick = async () => { if (!confirm('Disable this link? The client will no longer be able to open it.')) return; await updateDoc(doc(db, 'svcPortals', p.id), { active: false, updatedAt: serverTimestamp() }).catch((e) => toast(friendly(e), true)); close(o); };
  $('#pm-new', o).onclick = async () => { if (!confirm('Create a new link and disable the old one?')) return; await updateDoc(doc(db, 'svcPortals', p.id), { active: false, updatedAt: serverTimestamp() }).catch(() => {}); close(o); makePortal(S.clients.find((x) => x.id === p.clientId)); };
}
async function clientHistory(clientId) {
  const c = S.clients.find((x) => x.id === clientId) || { name: '' };
  const o = modal(`<h2 class="grow">${esc(c.name)} — ticket history</h2>`, '<div class="loading">Loading…</div>', `<button class="btn sm primary" id="ch-new">+ New ticket</button><button class="btn sm" id="ch-pdf">PDF</button><button class="btn sm" id="ch-csv">Export CSV</button><button class="btn" data-x>Close</button>`, { wide: true });
  let ts = [];
  try { ts = (await getDocs(query(collection(db, 'svcTickets'), where('clientId', '==', clientId)))).docs.map((d) => ({ id: d.id, ...d.data() })); }
  catch (e) { ts = allTickets().filter((t) => t.clientId === clientId); }
  ts.sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
  const bySite = {}; ts.forEach((t) => { bySite[t.siteName] = (bySite[t.siteName] || 0) + 1; });
  $('.mb', o).innerHTML = `<div class="row small" style="margin-bottom:10px"><b>${ts.length}</b> tickets · ${ts.filter((t) => t.open).length} open · ${Object.entries(bySite).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ')}</div>
    <div style="overflow:auto"><table class="tbl"><thead><tr><th>Ticket</th><th>Raised</th><th>Site</th><th>Service</th><th>Priority</th><th>Status</th><th>Technician</th><th>Report</th></tr></thead><tbody>
    ${ts.map((t) => `<tr class="click" data-open="${esc(t.id)}"><td class="mono">${esc(t.number || t.id)}</td><td class="small">${esc(fmtDT(t.createdAt))}</td><td>${esc(t.siteName)}</td><td>${esc(typesText(t))}</td><td>${esc(prio(t.priority).t)}</td><td>${esc(st(t.status).t)}</td><td>${esc(t.assignedName || '')}</td><td>${esc(t.reportNo || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No tickets yet.</td></tr>'}</tbody></table></div>`;
  $$('[data-open]', o).forEach((e) => (e.onclick = () => { close(o); openTicket(e.dataset.open); }));
  $('#ch-pdf', o).onclick = () => clientPdf(c.name || '', ts);
  $('#ch-csv', o).onclick = () => downloadCsv(ts, `tickets-${(c.name || 'client').replace(/\W+/g, '-')}.csv`);
  $('#ch-new', o).onclick = () => { close(o); newTicketModal(clientId); };
}

// ================================================================== reports
const mins = (a, b) => { const x = toDate(a), y = toDate(b); return x && y ? (y - x) / 60000 : null; };
const fmtMins = (v) => (v == null || isNaN(v) ? '—' : v < 60 ? `${Math.round(v)} min` : v < 1440 ? `${(v / 60).toFixed(1)} h` : `${(v / 1440).toFixed(1)} d`);
const avg = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
function reportsView(m) {
  if (!S.rangeFrom) { const d = new Date(); d.setDate(1); S.rangeFrom = dateKey(d); S.rangeTo = dateKey(); }
  const from = new Date(S.rangeFrom + 'T00:00:00'), to = new Date(S.rangeTo + 'T23:59:59');
  let ts = allTickets().filter((t) => { const c = toDate(t.createdAt); return c && c >= from && c <= to; });
  if (S.rClient) ts = ts.filter((t) => t.clientId === S.rClient);
  if (S.rTech) ts = ts.filter((t) => t.assignedTo === S.rTech);
  ts.sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
  const by = (f) => { const o = {}; ts.forEach((t) => { const k = f(t) || '—'; o[k] = (o[k] || 0) + 1; }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
  const clientsIn = [...new Map(allTickets().map((t) => [t.clientId, t.clientName])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const techsIn = [...new Map(allTickets().filter((t) => t.assignedTo).map((t) => [t.assignedTo, t.assignedName])).entries()];
  const box = (title, rows) => `<div class="card pad"><h3>${title}</h3><table class="tbl" style="margin-top:6px">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right"><b>${v}</b></td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</table></div>`;
  m.innerHTML = `<div class="row" style="margin-bottom:12px"><h1 class="grow">Reports</h1>
      <input type="date" id="rf" value="${S.rangeFrom}" style="width:auto"><span>to</span><input type="date" id="rt" value="${S.rangeTo}" style="width:auto">
      <select id="rc" style="width:auto;max-width:220px"><option value="">All clients</option>${clientsIn.map(([id, n]) => `<option value="${esc(id)}" ${S.rClient === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <select id="rte" style="width:auto"><option value="">All technicians</option>${techsIn.map(([id, n]) => `<option value="${esc(id)}" ${S.rTech === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <button class="btn sm primary" id="rpdf">PDF report</button><button class="btn sm" id="rcsv">Export CSV</button></div>
    <div class="kpis"><div class="card kpi"><div class="v">${ts.length}</div><div class="l">Tickets</div></div>
      <div class="card kpi"><div class="v">${ts.filter((t) => ['completed', 'closed'].includes(t.status)).length}</div><div class="l">Completed</div></div>
      <div class="card kpi"><div class="v">${ts.filter((t) => t.open).length}</div><div class="l">Still open</div></div>
      <div class="card kpi"><div class="v">${fmtMins(avg(ts.map((t) => mins(t.createdAt, t.assignedAt))))}</div><div class="l">Avg time to assign</div></div>
      <div class="card kpi"><div class="v">${fmtMins(avg(ts.map((t) => mins(t.createdAt, t.arrivedAt))))}</div><div class="l">Avg time to reach site</div></div>
      <div class="card kpi"><div class="v">${fmtMins(avg(ts.map((t) => mins(t.createdAt, t.completedAt))))}</div><div class="l">Avg time to complete</div></div></div>
    <div class="dgrid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${box('By client', by((t) => t.clientName).slice(0, 15))}${box('By service type', by((t) => typesText(t)))}${box('By technician', by((t) => t.assignedName || 'Not assigned'))}${box('By priority', by((t) => prio(t.priority).t))}</div>
    <div class="card" style="overflow:auto;margin-top:14px"><table class="tbl"><thead><tr><th>Ticket</th><th>Raised</th><th>Client</th><th>Site</th><th>Service</th><th>Priority</th><th>Status</th><th>Technician</th><th>Assigned in</th><th>Completed in</th><th>Report</th></tr></thead><tbody>
    ${ts.map((t) => `<tr class="click" data-open="${esc(t.id)}"><td class="mono">${esc(t.number || t.id)}</td><td class="small">${esc(fmtDT(t.createdAt))}</td><td>${esc(t.clientName)}</td><td>${esc(t.siteName)}</td><td>${esc(typesText(t))}</td><td>${esc(prio(t.priority).t)}</td><td>${esc(st(t.status).t)}</td><td>${esc(t.assignedName || '')}</td><td>${fmtMins(mins(t.createdAt, t.assignedAt))}</td><td>${fmtMins(mins(t.createdAt, t.completedAt))}</td><td>${esc(t.reportNo || '')}</td></tr>`).join('') || '<tr><td colspan="11" class="empty">No tickets in this period.</td></tr>'}
    </tbody></table></div><p class="small muted">Covers tickets from the last 4 months (open tickets: all).</p>`;
  $('#rf', m).onchange = (e) => { S.rangeFrom = e.target.value; render(); };
  $('#rt', m).onchange = (e) => { S.rangeTo = e.target.value; render(); };
  $('#rc', m).onchange = (e) => { S.rClient = e.target.value; render(); };
  $('#rte', m).onchange = (e) => { S.rTech = e.target.value; render(); };
  $('#rcsv', m).onclick = () => downloadCsv(ts, `service-tickets-${S.rangeFrom}-to-${S.rangeTo}.csv`);
  $('#rpdf', m).onclick = () => periodPdf(ts, {
    from: S.rangeFrom, to: S.rangeTo,
    clientName: S.rClient ? (clientsIn.find((x) => x[0] === S.rClient) || [])[1] || '' : '',
    techName: S.rTech ? (techsIn.find((x) => x[0] === S.rTech) || [])[1] || '' : '',
  });
  $$('[data-open]', m).forEach((e) => (e.onclick = () => openTicket(e.dataset.open)));
}
function downloadCsv(ts, name) {
  const cols = [['Ticket', (t) => t.number || t.id], ['Raised', (t) => fmtDT(t.createdAt)], ['Client', (t) => t.clientName], ['Site', (t) => t.siteName], ['Address', (t) => t.siteAddress],
    ['Service', (t) => typesText(t)], ['Problem', (t) => t.description], ['Priority', (t) => prio(t.priority).t], ['Preferred', (t) => prefText(t)],
    ['Status', (t) => st(t.status).t], ['Technician', (t) => t.assignedName], ['Visit', (t) => fmtDT(t.scheduledAt)], ['Arrived', (t) => fmtDT(t.arrivedAt)], ['Completed', (t) => fmtDT(t.completedAt)],
    ['Report', (t) => t.reportNo], ['Contact', (t) => t.contactName], ['Mobile', (t) => t.contactPhone], ['Source', (t) => t.source]];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.map((c) => q(c[0])).join(','), ...ts.map((t) => cols.map((c) => q(c[1](t))).join(','))].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ================================================================== settings (admin)
function settingsView(m) {
  const staff = S.users.filter((u) => !['admin', 'manager'].includes(u.role));
  m.innerHTML = `<h1 style="margin-bottom:12px">Settings</h1><div class="dgrid">
    <div class="card pad"><h3>Who can assign tickets</h3><p class="small muted">Admins and managers can always assign. Tick staff who may also assign jobs to others (everyone can pick up a new job for themselves).</p>
      ${staff.map((u) => `<div class="row" style="padding:7px 0;border-top:1px solid var(--line)">${avatar(u.name)}<span class="grow"><b>${esc(u.name)}</b><div class="small muted">${esc(u.designation || u.role || '')}</div></span>
        <label class="switch"><input type="checkbox" data-asg="${esc(u.id)}" ${u.canAssignService ? 'checked' : ''}><i></i></label></div>`).join('') || '<div class="muted">No staff.</div>'}</div>
    <div class="card pad" style="grid-column:1/-1"><div class="row"><h3 class="grow">Service options for customers</h3>
        <button class="btn sm" id="so-reset">Restore defaults</button><button class="btn sm" id="so-add">+ Add option</button><button class="btn sm primary" id="so-save">Save options</button></div>
      <p class="small muted">What customers can tick under "What needs attention" on client links and the walk-in support page. Hide, rename, reorder or add your own.</p>
      <div id="so-list"></div></div>
    <div class="card pad stack"><h3>Links</h3>
      <div class="field"><span>Staff desk (this page)</span><div class="linkbox"><input readonly value="${esc(new URL('desk.html', PORTAL_BASE).href)}"><button class="btn sm" id="cp1">Copy</button></div></div>
      <div class="field"><span>Client links start with</span><input readonly value="${esc(PORTAL_BASE)}?c=…"></div>
      <div class="field"><span>Walk-in support page (public form for any customer)</span><div class="linkbox"><input id="sup-url" value="${esc(S.supportBase)}"><button class="btn sm" id="sup-save">Save</button></div>
        <small class="muted">Walk-in customers get tracking links on this address. Normally the same folder as this desk.</small></div>
      <p class="small muted">Saved automatically to the shared settings, so the attendance app and llct.net dashboard open this desk.</p>
      <h3>Alerts</h3><p class="small muted">New requests pop up on this desk, in the attendance app (staff &amp; management) and on the llct.net dashboard. Keep this page open on the office PC with sound on.</p>
      <div class="row"><button class="btn sm" id="tst">Test popup &amp; sound</button>${'Notification' in window ? `<span class="small muted">Desktop alerts: ${Notification.permission}</span>` : ''}</div></div></div>`;
  $$('[data-asg]', m).forEach((c) => (c.onchange = () => updateDoc(doc(db, 'users', c.dataset.asg), { canAssignService: c.checked }).then(() => toast('Saved'), (e) => { toast(friendly(e), true); c.checked = !c.checked; })));
  $('#cp1', m).onclick = () => copy(new URL('desk.html', PORTAL_BASE).href);
  // service options editor
  let opts = SERVICE_TYPES.filter((x) => !x.retired).map((x) => ({ ...x }));
  const drawOpts = () => {
    $('#so-list', m).innerHTML = `<table class="tbl"><thead><tr><th style="width:44px">Show</th><th style="width:150px">Icon</th><th>Text customers see</th><th style="width:120px">Order</th><th style="width:60px"></th></tr></thead><tbody>
      ${opts.map((x, i) => `<tr><td><label class="switch"><input type="checkbox" data-on="${i}" ${x.on !== false ? 'checked' : ''}><i></i></label></td>
        <td><div class="row" style="flex-wrap:nowrap"><span style="color:var(--ribbon)">${icon(x.i || x.k, 22)}</span><select data-ic="${i}" style="padding:6px">${ICON_KEYS.map((k) => `<option ${((x.i || x.k) === k) ? 'selected' : ''}>${k}</option>`).join('')}</select></div></td>
        <td><input data-t="${i}" value="${esc(x.t)}"></td>
        <td><button class="btn sm" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button> <button class="btn sm" data-dn="${i}" ${i === opts.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></td>
        <td>${DEFAULT_KEYS.includes(x.k) ? '' : `<button class="btn sm bad" data-del="${i}" aria-label="Delete">✕</button>`}</td></tr>`).join('')}</tbody></table>`;
    $$('[data-on]', m).forEach((e) => (e.onchange = () => { opts[+e.dataset.on].on = e.checked; }));
    $$('[data-t]', m).forEach((e) => (e.oninput = () => { opts[+e.dataset.t].t = e.value; }));
    $$('[data-ic]', m).forEach((e) => (e.onchange = () => { opts[+e.dataset.ic].i = e.value; drawOpts(); }));
    $$('[data-up]', m).forEach((e) => (e.onclick = () => { const i = +e.dataset.up; [opts[i - 1], opts[i]] = [opts[i], opts[i - 1]]; drawOpts(); }));
    $$('[data-dn]', m).forEach((e) => (e.onclick = () => { const i = +e.dataset.dn; [opts[i + 1], opts[i]] = [opts[i], opts[i + 1]]; drawOpts(); }));
    $$('[data-del]', m).forEach((e) => (e.onclick = () => { opts.splice(+e.dataset.del, 1); drawOpts(); }));
  };
  drawOpts();
  $('#so-add', m).onclick = () => { opts.push({ k: 'c' + Date.now().toString(36), t: 'New option', i: 'other', on: true }); drawOpts(); const ins = $$('[data-t]', m); ins[ins.length - 1].select(); };
  $('#so-reset', m).onclick = () => { if (!confirm('Restore the default options? Your own options are removed.')) return; opts = DEFAULT_TYPES.map((x) => ({ ...x, on: true })); drawOpts(); };
  $('#so-save', m).onclick = async () => {
    const clean = opts.map((x) => ({ ...x, t: String(x.t || '').trim() })).filter((x) => x.t);
    if (!clean.some((x) => x.on !== false)) return toast('Show at least one option', true);
    try { await saveTypes(clean); await loadTypes(); toast('Service options saved — customers see them straight away'); } catch (e) { toast(friendly(e), true); }
  };
  $('#sup-save', m).onclick = () => {
    let v = $('#sup-url', m).value.trim(); if (!v) return; if (!v.endsWith('/') && !v.endsWith('.html')) v += '/';
    setDoc(doc(db, 'settings', 'service'), { supportUrl: v, updatedAt: serverTimestamp() }, { merge: true }).then(() => { S.supportBase = v; toast('Saved'); }, (e) => toast(friendly(e), true));
  };
  $('#tst', m).onclick = () => {
    const fake = { id: '_test', number: 'SR-TEST-0000', clientName: 'Test client', siteName: 'Main office', category: 'camera', description: 'This is only a test popup.', priority: 'critical', preferredDate: dateKey(), preferredSlot: 'asap', createdAt: new Date(), status: 'new' };
    S.open.set('_test', fake); queuePop(fake, 'new'); setTimeout(() => S.open.delete('_test'), 60000);
  };
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = 'Service Desk – Leaders Line'; });
