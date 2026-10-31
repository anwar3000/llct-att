// LLCT Service Desk — staff console (admins, managers, assigners and technicians).
// Sign in with the same login as LLCT Attendance.
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  app, db, collection, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, Timestamp, writeBatch, arrayUnion, deleteField,
  SERVICE_TYPES, PRIORITIES, SLOTS, STATUS, OPEN_STATUSES, typeLabel, prio, st, slotLabel, clientMessage, publicView,
  $, $$, esc, toDate, fmtDate, fmtTime, fmtDT, ago, dateKey, localInput, hasGPS, distM, fmtDist, mapsLink, telLink, waLink,
  randToken, newTicketNo, reportLink, reportViewLink, toast, friendly, beep,
} from './sd.js';

const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});
const LOGIN_DOMAIN = 'staff.attendance.app';
const loginToEmail = (l) => { const s = String(l || '').trim().toLowerCase(); return s.includes('@') ? s : `${s}@${LOGIN_DOMAIN}`; };
const root = $('#app');
const PORTAL_BASE = new URL('./', location.href).href;
const portalUrl = (token) => `${PORTAL_BASE}?c=${token}`;

const S = {
  me: null, view: 'tickets', filter: 'open', q: '', fPrio: '', fTech: '',
  open: new Map(), recent: new Map(), users: [], portals: [], clients: [], clientsErr: '',
  unsub: [], loadedOpen: false, popQueue: [], popOn: false, rangeFrom: '', rangeTo: '', rClient: '', rTech: '',
  sound: lsGet('llct-sd-sound', '1') === '1', synced: false,
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
  root.innerHTML = `<div class="card login"><img src="img/logo.png" alt="LLCT"><h1 style="text-align:center">Service Desk</h1>
    <p class="muted" style="text-align:center;margin-top:4px">Sign in with your LLCT Attendance login</p>
    <form id="lf" class="stack" style="margin-top:16px"><label class="field"><span>Login ID</span><input id="lid" autocomplete="username" required></label>
    <label class="field"><span>Password</span><input id="lpw" type="password" autocomplete="current-password" required></label>
    <div class="small" style="color:var(--danger);min-height:1em" id="lerr">${esc(err)}</div>
    <button class="btn primary block" id="lgo">Sign in</button></form></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault(); $('#lgo').disabled = true; $('#lerr').textContent = '';
    try { await signInWithEmailAndPassword(auth, loginToEmail($('#lid').value), $('#lpw').value); }
    catch (er) { $('#lerr').textContent = friendly(er); $('#lgo').disabled = false; }
  };
}

// ================================================================== data
function startData() {
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
    S.unsub.push(onSnapshot(collection(db, 'svcPortals'), (q) => {
      S.portals = q.docs.map((d) => ({ id: d.id, ...d.data() })); refresh(); syncPortalSites();
    }, (e) => console.warn('portals', e)));
    S.unsub.push(onSnapshot(collection(db, 'inv_clients'), (q) => {
      S.clients = q.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      S.clientsErr = ''; refresh(); syncPortalSites();
    }, (e) => { S.clientsErr = 'Clients come from LLCT Invoicing — ask an admin to give you invoicing access (Staff & access).'; console.warn('clients', e); refresh(); }));
  }
  // Remember where this desk lives so the attendance app & dashboard can link to it.
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
function syncPortalSites() {
  if (!canAssign() || !S.clients.length || !S.portals.length) return;
  S.portals.filter((p) => p.active).forEach((p) => {
    const c = S.clients.find((x) => x.id === p.clientId); if (!c) return;
    const sites = sitesFromPlaces(c);
    if (JSON.stringify(sites) !== JSON.stringify(p.sites || []) || (c.name && c.name !== p.clientName)) {
      updateDoc(doc(db, 'svcPortals', p.id), { sites, clientName: c.name || p.clientName, updatedAt: serverTimestamp() }).catch(() => {});
    }
  });
}

// ================================================================== popups
function queuePop(t, kind) {
  if (S.sound) beep(kind === 'new' && t.priority === 'critical' ? 5 : 3);
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(kind === 'new' ? `New service request · ${prio(t.priority).t}` : 'Job assigned to you', {
        body: `${t.clientName} – ${t.siteName}\n${typeLabel(t.category)}`, icon: 'img/icon-192.png', tag: t.id,
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
      <div><b>${esc(typeLabel(t.category))}</b><div class="muted">${esc(t.description)}</div></div>
      <div class="small">Preferred: ${esc(fmtDate(t.preferredDate))} · ${esc(slotLabel(t.preferredSlot))}</div>
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
  const base = 'Service Desk · LLCT'; let on = false;
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
  if (t.portal) {
    const merged = { ...t, ...changes };
    const pub = { status: merged.status, priority: merged.priority || 'normal', updatedAt: serverTimestamp() };
    pub.assignedName = merged.assignedTo ? (merged.assignedName || '') : deleteField();
    pub.scheduledAt = merged.scheduledAt && merged.assignedTo ? merged.scheduledAt : deleteField();
    if (merged.reportNo) pub.reportNo = merged.reportNo;
    if (clientText) pub.log = arrayUnion({ at, t: clientText });
    b.set(doc(db, 'svcPortals', t.portal, 'tickets', t.id), pub, { merge: true });
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
function refresh() {
  if (!S.me) return;
  // keep open forms (assign, new ticket, links) intact
  if (document.querySelector('.overlay:not(.alertpop):not([data-tid])')) { drawNav(); return; }
  render();
  // an open ticket follows live changes
  const d = document.querySelector('.overlay[data-tid]');
  if (d) {
    const id = d.dataset.tid, sc = d.querySelector('.modal').scrollTop, note = (d.querySelector('#tn') || {}).value || '';
    d.remove(); openTicket(id);
    const n = document.querySelector('.overlay[data-tid]');
    if (n) { n.querySelector('.modal').scrollTop = sc; if (note && n.querySelector('#tn')) n.querySelector('#tn').value = note; }
  }
}
function drawNav() {
  const n = $('#dnav'); if (!n) return;
  const newN = [...S.open.values()].filter((t) => t.status === 'new').length;
  const mine = [...S.open.values()].filter((t) => t.assignedTo === S.me.id).length;
  const items = [['tickets', 'Tickets', newN], ...(canAssign() ? [['clients', 'Clients & links', 0], ['reports', 'Reports', 0]] : []), ...(isAdmin() ? [['settings', 'Settings', 0]] : [])];
  n.innerHTML = items.map(([k, l, c]) => `<button data-nav="${k}" class="${S.view === k ? 'on' : ''}">${l}${c ? `<span class="n">${c}</span>` : ''}</button>`).join('')
    + (mine ? `<button data-nav="tickets" data-mine="1">My jobs<span class="n" style="background:var(--info)">${mine}</span></button>` : '');
  $$('[data-nav]', n).forEach((b) => (b.onclick = () => { S.view = b.dataset.nav; if (b.dataset.mine) S.filter = 'mine'; render(); }));
}
function render() {
  const sy = window.scrollY;
  root.innerHTML = `<header class="dtop"><div class="in"><img src="img/logo.png" alt=""><span class="ttl">Service Desk</span><nav class="dnav" id="dnav"></nav>
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
  if (S.q) { const q = S.q.toLowerCase(); list = list.filter((t) => [t.number, t.clientName, t.siteName, t.description, typeLabel(t.category), t.assignedName, t.contactName, t.contactPhone].join(' ').toLowerCase().includes(q)); }
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
      <button class="btn sm" id="snd">${S.sound ? '🔊 Sound on' : '🔇 Sound off'}</button></div>
    <div class="card tlist">${list.length ? list.map(rowHtml).join('') : `<div class="empty">${S.loadedOpen ? 'No tickets here.' : 'Loading…'}</div>`}</div>`;
  $$('[data-f]', m).forEach((e) => (e.onclick = () => { S.filter = S.filter === e.dataset.f ? 'open' : e.dataset.f; render(); }));
  $('#ff', m).onchange = (e) => { S.filter = e.target.value; render(); };
  $('#fp', m).onchange = (e) => { S.fPrio = e.target.value; render(); };
  $('#ft', m).onchange = (e) => { S.fTech = e.target.value; render(); };
  const fq = $('#fq', m); fq.oninput = () => { S.q = fq.value; clearTimeout(fq._t); fq._t = setTimeout(() => { render(); const n = $('#fq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  const np = $('#nperm', m); if (np) np.onclick = () => Notification.requestPermission().then(() => render());
  $('#snd', m).onclick = () => { S.sound = !S.sound; lsSet('llct-sd-sound', S.sound ? '1' : '0'); if (S.sound) beep(1); render(); };
  $$('[data-open]', m).forEach((e) => (e.onclick = () => openTicket(e.dataset.open)));
}
function rowHtml(t) {
  const s = st(t.status), p = prio(t.priority), od = overdue(t);
  const fresh = t.status === 'new' && toDate(t.createdAt) && Date.now() - toDate(t.createdAt).getTime() < 120000;
  return `<div class="trow ${fresh ? 'fresh' : ''}" data-open="${esc(t.id)}"><span class="bar" style="background:${p.c}"></span>
    <div style="min-width:0"><div class="row"><span class="t1">${esc(t.clientName)}</span><span class="muted">·</span><span>${esc(t.siteName)}</span></div>
      <div class="t2">${esc(typeLabel(t.category))} — ${esc(String(t.description || '').slice(0, 110))}</div>
      <div class="t2 mono small">${esc(t.number || t.id)} · ${esc(ago(t.createdAt))}${t.source === 'staff' ? ' · by staff' : ''}${t.reportNo ? ' · ' + esc(t.reportNo) : ''}</div></div>
    <div class="r"><span class="chip" style="background:${s.c}1f;color:${s.c}"><span class="dot" style="background:${s.c}"></span>${esc(s.t)}</span>
      <span class="chip" style="background:${p.c}14;color:${p.c}">${esc(p.t)}</span>
      <span class="small ${od ? '' : 'muted'}" style="${od ? 'color:var(--danger);font-weight:700' : ''}">${t.assignedName ? '👷 ' + esc(t.assignedName) : od ? 'Overdue' : 'Unassigned'}</span>
      <span class="small muted">${t.scheduledAt ? '🗓 ' + esc(fmtDT(t.scheduledAt)) : '⏱ ' + esc(fmtDate(t.preferredDate)) + ' · ' + esc((slotLabel(t.preferredSlot) || '').split(' (')[0])}</span></div></div>`;
}

// ================================================================== ticket detail
function openTicket(id) {
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
  const nav = mapsLink(t);
  const o = modal(`<div class="grow"><div class="row"><h2 class="mono">${esc(t.number || t.id)}</h2><span class="chip" style="background:${s.c}1f;color:${s.c}"><span class="dot" style="background:${s.c}"></span>${esc(s.staff)}</span><span class="chip" style="background:${p.c};color:#fff">${esc(p.t)}</span>${overdue(t) ? '<span class="chip" style="background:#fde3e3;color:var(--danger)">Over response time</span>' : ''}</div></div>`,
    `<div class="dgrid"><div class="stack">
      <div class="card pad"><div style="font-size:17px"><b>${esc(t.clientName)}</b></div><div>${esc(t.siteName)}</div>${t.siteAddress ? `<div class="muted small" style="white-space:pre-line">${esc(t.siteAddress)}</div>` : ''}
        <div class="row" style="margin-top:10px">${nav ? `<a class="btn sm primary" href="${nav}" target="_blank" rel="noopener">🧭 Navigate</a>` : '<span class="small muted">No GPS for this site — add it to the client\'s site in Invoicing.</span>'}
        ${hasGPS(t) ? `<span class="small muted mono">${t.lat.toFixed(5)}, ${t.lng.toFixed(5)}</span>` : ''}</div></div>
      <div class="card pad"><div class="kv">
        <span>Service</span><b>${esc(typeLabel(t.category))}</b>
        <span>Problem</span><span style="white-space:pre-line">${esc(t.description)}</span>
        ${t.cameras ? `<span>Devices</span><span>${esc(t.cameras)}</span>` : ''}
        <span>Preferred</span><span>${esc(fmtDate(t.preferredDate))} · ${esc(slotLabel(t.preferredSlot))}</span>
        <span>Respond by</span><span>${esc(fmtDT(dueAt(t)))}</span>
        <span>Contact</span><span>${esc(t.contactName)}${t.contactPhone ? `<br><a href="${telLink(t.contactPhone)}">📞 ${esc(t.contactPhone)}</a> · <a href="${waLink(t.contactPhone, '')}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${t.contactEmail ? `<br>${esc(t.contactEmail)}` : ''}</span>
        <span>Raised</span><span>${esc(fmtDT(t.createdAt))} · ${t.source === 'staff' ? 'by staff' : 'client link'}</span>
      </div>${Array.isArray(t.photos) && t.photos.length ? `<div class="thumbs" style="margin-top:12px">${t.photos.map((ph, i) => `<img src="${ph}" data-ph="${i}" alt="photo">`).join('')}</div>` : ''}</div>
    </div><div class="stack">
      <div class="card pad"><h3>Assignment</h3>
        ${t.assignedTo ? `<div class="row" style="margin-top:8px">${avatar(t.assignedName)}<div class="grow"><b>${esc(t.assignedName)}</b><div class="small muted">${t.assignedByName && t.assignedBy !== t.assignedTo ? 'assigned by ' + esc(t.assignedByName) : 'picked up the job'} · ${esc(ago(t.assignedAt))}</div></div></div>
          <div class="small" style="margin-top:6px">Visit: <b>${t.scheduledAt ? esc(fmtDT(t.scheduledAt)) : 'as per preferred time'}</b></div>`
          : '<div class="muted" style="margin-top:6px">Not assigned yet.</div>'}
        ${t.techNote ? `<div class="small" style="margin-top:8px"><b>Technician note:</b> ${esc(t.techNote)}</div>` : ''}
        <div class="row" style="margin-top:12px">${acts.join('')}</div></div>
      <div class="card pad"><h3>Client is told</h3><div class="small" style="margin-top:6px;background:#f6f4f0;border-radius:10px;padding:9px 11px">${esc(clientMessage(t))}</div>
        <div class="row" style="margin-top:8px">${t.contactPhone ? `<a class="btn sm" target="_blank" rel="noopener" href="${waLink(t.contactPhone, waText(t))}">Send update on WhatsApp</a>` : ''}${t.portal ? '<span class="small muted">Also visible live on the client\'s link.</span>' : ''}</div></div>
      <div class="card pad"><h3>Timeline</h3><div class="timeline">${(t.log || []).slice().reverse().map((l) => `<div><b>${esc(l.t)}</b><br><span class="muted small">${esc(fmtDT(l.at))}${l.byName ? ' · ' + esc(l.byName) : ''}</span></div>`).join('')}</div>
        ${A || mine ? '<div class="row" style="margin-top:8px"><input id="tn" placeholder="Add an internal note…" class="grow"><button class="btn sm" id="tnb">Add</button></div>' : ''}</div>
    </div></div>`, '', { wide: true });
  o.dataset.tid = t.id;
  $$('[data-a]', o).forEach((b) => (b.onclick = async () => {
    const a = b.dataset.a, cur = getT(t.id) || t;
    if (a === 'assign') { close(o); return assignModal(cur); }
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
  const tnb = $('#tnb', o);
  if (tnb) tnb.onclick = async () => { const v = $('#tn', o).value.trim(); if (!v) return; tnb.disabled = true; $('#tn', o).value = ''; await updateTicket(getT(t.id) || t, mine && !A ? { techNote: v } : {}, 'Note: ' + v); };
}
function waText(t) {
  return `Leaders Line Service – ${t.number || t.id}\n${t.clientName} – ${t.siteName}\n${typeLabel(t.category)}\n\n${clientMessage(t)}${t.portal ? `\n\nTrack: ${portalUrl(t.portal)}` : ''}`;
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
    const d = toDate(t.preferredDate) || new Date(); const h = { morning: 9, afternoon: 13, evening: 17 }[t.preferredSlot];
    d.setHours(h || 9, 0, 0, 0);
    const n = new Date(Date.now() + 2 * 3600e3); n.setMinutes(0, 0, 0);
    return localInput(n > d ? n : d); // never in the past
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
      <div class="sec-t" style="margin-top:14px">Service</div><div class="tiles">${SERVICE_TYPES.map((x) => `<button type="button" class="tile ${F.category === x.k ? 'on' : ''}" data-cat="${x.k}"><span class="ti">${x.i}</span><span>${esc(x.t)}</span></button>`).join('')}</div>
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
      contactName: v('#nt-cname'), contactPhone: v('#nt-cphone'), category: F.category, description: v('#nt-desc'), priority: F.priority,
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
  m.innerHTML = `<div class="row" style="margin-bottom:12px"><h1 class="grow">Clients &amp; service links</h1><input id="cq" placeholder="Search client…" value="${esc(S.cq || '')}" style="max-width:280px"></div>
    <p class="muted small" style="margin-top:-4px">Each client gets one private link to raise and track service requests. Sites and GPS come from the client's sites in LLCT Invoicing and stay in sync.</p>
    ${S.clientsErr ? `<div class="card pad" style="color:var(--danger)">${esc(S.clientsErr)}</div>` : ''}
    <div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>Client</th><th>Sites</th><th>Tickets</th><th>Last request</th><th>Service link</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="click" data-hist="${esc(r.c.id)}" style="cursor:pointer"><b>${esc(r.c.name)}</b>${r.c.phone ? `<div class="small muted">${esc(r.c.contact || '')} ${esc(r.c.phone)}</div>` : ''}</td>
      <td>${r.sites}<div class="small ${r.gps < r.sites ? '' : 'muted'}" style="${r.gps < r.sites ? 'color:var(--warning)' : ''}">${r.gps} with GPS</div></td>
      <td>${r.n}${r.open ? ` <span class="chip" style="background:#fde3e3;color:var(--danger)">${r.open} open</span>` : ''}</td>
      <td class="small">${r.last ? esc(fmtDate(r.last)) : '—'}</td>
      <td>${r.p ? `<div class="linkbox"><input readonly value="${esc(portalUrl(r.p.id))}"><button class="btn sm" data-copy="${esc(r.p.id)}">Copy</button>
          <a class="btn sm" target="_blank" rel="noopener" href="${waLink(r.c.phone || '', linkMsg(r.c, r.p))}">WhatsApp</a><button class="btn sm" data-more="${esc(r.p.id)}">⋯</button></div>`
        : `<button class="btn sm primary" data-mk="${esc(r.c.id)}">Create link</button>`}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">${S.clients.length ? 'No match.' : 'No clients yet.'}</td></tr>`}
    </tbody></table></div>`;
  const cq = $('#cq', m); cq.oninput = () => { S.cq = cq.value; clearTimeout(cq._t); cq._t = setTimeout(() => { render(); const n = $('#cq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  $$('[data-mk]', m).forEach((b) => (b.onclick = () => makePortal(S.clients.find((c) => c.id === b.dataset.mk), b)));
  $$('[data-copy]', m).forEach((b) => (b.onclick = () => copy(portalUrl(b.dataset.copy))));
  $$('[data-more]', m).forEach((b) => (b.onclick = () => portalMenu(S.portals.find((p) => p.id === b.dataset.more))));
  $$('[data-hist]', m).forEach((e) => (e.onclick = () => clientHistory(e.dataset.hist)));
}
const linkMsg = (c, p) => `Dear ${c.contact || c.name},\n\nFor any CCTV / security service request please use your Leaders Line service link:\n${portalUrl(p.id)}\n\nYou can choose the site, describe the problem, set the priority and preferred visit time, and follow the status of every request.\n\nLeaders Line Trading LLC · 04 880 5577`;
function copy(text) { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Link copied'), () => prompt('Copy this link:', text)); }
async function makePortal(c, btn) {
  if (!c) return; if (btn) btn.disabled = true;
  const token = randToken();
  try {
    await setDoc(doc(db, 'svcPortals', token), { active: true, clientId: c.id, clientName: c.name || '', contact: c.contact || '', phone: c.phone || '', sites: sitesFromPlaces(c), createdAt: serverTimestamp(), createdBy: S.me.id, createdByName: S.me.name || '', updatedAt: serverTimestamp() });
    toast('Link created'); copy(portalUrl(token));
  } catch (e) { toast(friendly(e), true); if (btn) btn.disabled = false; }
}
function portalMenu(p) {
  if (!p) return; const c = S.clients.find((x) => x.id === p.clientId) || { name: p.clientName };
  const o = modal(`<h2 class="grow">${esc(c.name)} — service link</h2>`,
    `<div class="linkbox"><input readonly value="${esc(portalUrl(p.id))}"><button class="btn sm" id="pm-c">Copy</button><a class="btn sm" href="${portalUrl(p.id)}" target="_blank" rel="noopener">Open</a></div>
     <p class="small muted">Created ${esc(fmtDT(p.createdAt))}${p.createdByName ? ' by ' + esc(p.createdByName) : ''}. ${(p.sites || []).length} site(s) on the link.</p>
     <div class="small">${(p.sites || []).map((s) => `• ${esc(s.name)} ${hasGPS(s) ? '<span style="color:var(--success)">GPS</span>' : '<span class="muted">no GPS</span>'}`).join('<br>')}</div>`,
    `<button class="btn bad" id="pm-off">Disable link</button><button class="btn" id="pm-new">Replace with new link</button><button class="btn" data-x>Done</button>`);
  $('#pm-c', o).onclick = () => copy(portalUrl(p.id));
  $('#pm-off', o).onclick = async () => { if (!confirm('Disable this link? The client will no longer be able to open it.')) return; await updateDoc(doc(db, 'svcPortals', p.id), { active: false, updatedAt: serverTimestamp() }).catch((e) => toast(friendly(e), true)); close(o); };
  $('#pm-new', o).onclick = async () => { if (!confirm('Create a new link and disable the old one?')) return; await updateDoc(doc(db, 'svcPortals', p.id), { active: false, updatedAt: serverTimestamp() }).catch(() => {}); close(o); makePortal(S.clients.find((x) => x.id === p.clientId)); };
}
async function clientHistory(clientId) {
  const c = S.clients.find((x) => x.id === clientId) || { name: '' };
  const o = modal(`<h2 class="grow">${esc(c.name)} — ticket history</h2>`, '<div class="loading">Loading…</div>', `<button class="btn sm primary" id="ch-new">+ New ticket</button><button class="btn sm" id="ch-csv">Export CSV</button><button class="btn" data-x>Close</button>`, { wide: true });
  let ts = [];
  try { ts = (await getDocs(query(collection(db, 'svcTickets'), where('clientId', '==', clientId)))).docs.map((d) => ({ id: d.id, ...d.data() })); }
  catch (e) { ts = allTickets().filter((t) => t.clientId === clientId); }
  ts.sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
  const bySite = {}; ts.forEach((t) => { bySite[t.siteName] = (bySite[t.siteName] || 0) + 1; });
  $('.mb', o).innerHTML = `<div class="row small" style="margin-bottom:10px"><b>${ts.length}</b> tickets · ${ts.filter((t) => t.open).length} open · ${Object.entries(bySite).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ')}</div>
    <div style="overflow:auto"><table class="tbl"><thead><tr><th>Ticket</th><th>Raised</th><th>Site</th><th>Service</th><th>Priority</th><th>Status</th><th>Technician</th><th>Report</th></tr></thead><tbody>
    ${ts.map((t) => `<tr class="click" data-open="${esc(t.id)}"><td class="mono">${esc(t.number || t.id)}</td><td class="small">${esc(fmtDT(t.createdAt))}</td><td>${esc(t.siteName)}</td><td>${esc(typeLabel(t.category))}</td><td>${esc(prio(t.priority).t)}</td><td>${esc(st(t.status).t)}</td><td>${esc(t.assignedName || '')}</td><td>${esc(t.reportNo || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No tickets yet.</td></tr>'}</tbody></table></div>`;
  $$('[data-open]', o).forEach((e) => (e.onclick = () => { close(o); openTicket(e.dataset.open); }));
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
      <button class="btn sm" id="rcsv">Export CSV</button></div>
    <div class="kpis"><div class="card kpi"><div class="v">${ts.length}</div><div class="l">Tickets</div></div>
      <div class="card kpi"><div class="v">${ts.filter((t) => ['completed', 'closed'].includes(t.status)).length}</div><div class="l">Completed</div></div>
      <div class="card kpi"><div class="v">${ts.filter((t) => t.open).length}</div><div class="l">Still open</div></div>
      <div class="card kpi"><div class="v">${fmtMins(avg(ts.map((t) => mins(t.createdAt, t.assignedAt))))}</div><div class="l">Avg time to assign</div></div>
      <div class="card kpi"><div class="v">${fmtMins(avg(ts.map((t) => mins(t.createdAt, t.arrivedAt))))}</div><div class="l">Avg time to reach site</div></div>
      <div class="card kpi"><div class="v">${fmtMins(avg(ts.map((t) => mins(t.createdAt, t.completedAt))))}</div><div class="l">Avg time to complete</div></div></div>
    <div class="dgrid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${box('By client', by((t) => t.clientName).slice(0, 15))}${box('By service type', by((t) => typeLabel(t.category)))}${box('By technician', by((t) => t.assignedName || 'Not assigned'))}${box('By priority', by((t) => prio(t.priority).t))}</div>
    <div class="card" style="overflow:auto;margin-top:14px"><table class="tbl"><thead><tr><th>Ticket</th><th>Raised</th><th>Client</th><th>Site</th><th>Service</th><th>Priority</th><th>Status</th><th>Technician</th><th>Assigned in</th><th>Completed in</th><th>Report</th></tr></thead><tbody>
    ${ts.map((t) => `<tr class="click" data-open="${esc(t.id)}"><td class="mono">${esc(t.number || t.id)}</td><td class="small">${esc(fmtDT(t.createdAt))}</td><td>${esc(t.clientName)}</td><td>${esc(t.siteName)}</td><td>${esc(typeLabel(t.category))}</td><td>${esc(prio(t.priority).t)}</td><td>${esc(st(t.status).t)}</td><td>${esc(t.assignedName || '')}</td><td>${fmtMins(mins(t.createdAt, t.assignedAt))}</td><td>${fmtMins(mins(t.createdAt, t.completedAt))}</td><td>${esc(t.reportNo || '')}</td></tr>`).join('') || '<tr><td colspan="11" class="empty">No tickets in this period.</td></tr>'}
    </tbody></table></div><p class="small muted">Covers tickets from the last 4 months (open tickets: all).</p>`;
  $('#rf', m).onchange = (e) => { S.rangeFrom = e.target.value; render(); };
  $('#rt', m).onchange = (e) => { S.rangeTo = e.target.value; render(); };
  $('#rc', m).onchange = (e) => { S.rClient = e.target.value; render(); };
  $('#rte', m).onchange = (e) => { S.rTech = e.target.value; render(); };
  $('#rcsv', m).onclick = () => downloadCsv(ts, `service-tickets-${S.rangeFrom}-to-${S.rangeTo}.csv`);
  $$('[data-open]', m).forEach((e) => (e.onclick = () => openTicket(e.dataset.open)));
}
function downloadCsv(ts, name) {
  const cols = [['Ticket', (t) => t.number || t.id], ['Raised', (t) => fmtDT(t.createdAt)], ['Client', (t) => t.clientName], ['Site', (t) => t.siteName], ['Address', (t) => t.siteAddress],
    ['Service', (t) => typeLabel(t.category)], ['Problem', (t) => t.description], ['Priority', (t) => prio(t.priority).t], ['Preferred', (t) => `${fmtDate(t.preferredDate)} ${slotLabel(t.preferredSlot)}`],
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
    <div class="card pad stack"><h3>Links</h3>
      <div class="field"><span>Staff desk (this page)</span><div class="linkbox"><input readonly value="${esc(new URL('desk.html', PORTAL_BASE).href)}"><button class="btn sm" id="cp1">Copy</button></div></div>
      <div class="field"><span>Client links start with</span><input readonly value="${esc(PORTAL_BASE)}?c=…"></div>
      <p class="small muted">Saved automatically to the shared settings, so the attendance app and llct.net dashboard open this desk.</p>
      <h3>Alerts</h3><p class="small muted">New requests pop up on this desk, in the attendance app (staff &amp; management) and on the llct.net dashboard. Keep this page open on the office PC with sound on.</p>
      <div class="row"><button class="btn sm" id="tst">Test popup &amp; sound</button>${'Notification' in window ? `<span class="small muted">Desktop alerts: ${Notification.permission}</span>` : ''}</div></div></div>`;
  $$('[data-asg]', m).forEach((c) => (c.onchange = () => updateDoc(doc(db, 'users', c.dataset.asg), { canAssignService: c.checked }).then(() => toast('Saved'), (e) => { toast(friendly(e), true); c.checked = !c.checked; })));
  $('#cp1', m).onclick = () => copy(new URL('desk.html', PORTAL_BASE).href);
  $('#tst', m).onclick = () => {
    const fake = { id: '_test', number: 'SR-TEST-0000', clientName: 'Test client', siteName: 'Main office', category: 'camera', description: 'This is only a test popup.', priority: 'critical', preferredDate: dateKey(), preferredSlot: 'asap', createdAt: new Date(), status: 'new' };
    S.open.set('_test', fake); queuePop(fake, 'new'); setTimeout(() => S.open.delete('_test'), 60000);
  };
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = 'Service Desk · LLCT'; });
