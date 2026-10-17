// Firebase setup + all Firestore reads/writes for the web dashboard.
// Uses the same collections as the Android app.
import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, setPersistence, browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, Timestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './config.js';
import { dateKey, monthKey, atTz, fromTz } from './util.js';

export const LOGIN_DOMAIN = 'staff.attendance.app';
export const loginToEmail = (l) => {
  const s = String(l || '').trim().toLowerCase();
  return s.includes('@') ? s : `${s}@${LOGIN_DOMAIN}`;
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

export { onAuthStateChanged, serverTimestamp, Timestamp };

export const login = (id, pw) => signInWithEmailAndPassword(auth, loginToEmail(id), pw);
export const logout = () => signOut(auth);

const C = (name) => collection(db, name);
const toDate = (v) => (v && typeof v.toDate === 'function' ? v.toDate() : v instanceof Date ? v : null);
const tzOf = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
const num = (v, d = 0) => (typeof v === 'number' && !Number.isNaN(v) ? v : d);

// ------------------------------------------------------------------ mappers
export function mapUser(d) {
  const m = d.data() || {};
  const ll = m.lastLocation || null;
  return {
    id: d.id,
    name: m.name || 'Unnamed',
    loginId: m.loginId || '',
    email: m.email || '',
    phone: m.phone || '',
    designation: m.designation || '',
    role: m.role || 'employee',
    active: m.active !== false,
    weeklyOffDays: Array.isArray(m.weeklyOffDays) ? m.weeklyOffDays.filter((x) => typeof x === 'number') : [],
    monthlyOffQuota: num(m.monthlyOffQuota, 4),
    createdAt: toDate(m.createdAt),
    lastLocation: ll && typeof ll.lat === 'number' && typeof ll.lng === 'number'
      ? { lat: ll.lat, lng: ll.lng, accuracy: num(ll.accuracy), at: toDate(ll.at), checkedIn: ll.checkedIn === true, siteName: ll.siteName || '' }
      : null,
  };
}
export function mapSite(d) {
  const m = d.data() || {};
  return {
    id: d.id, name: m.name || 'Site', address: m.address || '', lat: num(m.lat), lng: num(m.lng),
    radius: num(m.radius, 200), active: m.active !== false, progress: num(m.progress), status: m.status || 'active',
    notes: m.notes || '', projectId: m.projectId || '',
    addedBy: m.addedByEmployee === true ? (m.createdByName || 'staff') : '',
    createdBy: m.createdBy || '',
    approved: m.approved !== false,
  };
}
export function mapProject(d) {
  const m = d.data() || {};
  return {
    id: d.id, name: m.name || 'Project', code: m.code || '', client: m.client || '', description: m.description || '',
    startDate: m.startDate || '', endDate: m.endDate || '', budget: num(m.budget), status: m.status || 'active',
    manager: m.manager || '', siteIds: Array.isArray(m.siteIds) ? m.siteIds : [], createdAt: toDate(m.createdAt),
  };
}
export function mapSession(d) {
  const m = d.data() || {};
  return localise({
    id: d.id, employeeId: m.employeeId || '', employeeName: m.employeeName || '', siteId: m.siteId || '',
    siteName: m.siteName || '', date: m.date || '', month: m.month || '',
    checkIn: toDate(m.checkIn) || new Date(), checkOut: toDate(m.checkOut),
    inLat: m.inLat ?? null, inLng: m.inLng ?? null, inAccuracy: m.inAccuracy ?? null, inDistance: m.inDistance ?? null,
    inOutside: m.inOutside === true, outLat: m.outLat ?? null, outLng: m.outLng ?? null, outDistance: m.outDistance ?? null,
    outOutside: m.outOutside === true, mocked: m.mocked === true, note: m.note || '', status: m.status || '',
    tz: tzOf(m.tz), outTz: tzOf(m.outTz) ?? tzOf(m.tz), editedAt: toDate(m.editedAt), editedBy: m.editedBy || '',
  });
}
/** Adds inLocal/outLocal (site wall-clock) to a session or worker entry. */
const localise = (o) => Object.assign(o, { inLocal: atTz(o.checkIn, o.tz), outLocal: atTz(o.checkOut, o.outTz ?? o.tz) });
export function mapPetty(d) {
  const m = d.data() || {};
  return {
    id: d.id, employeeId: m.employeeId || '', employeeName: m.employeeName || '', type: m.type || 'expense',
    amount: num(m.amount), category: m.category || '', note: m.note || '', siteId: m.siteId || '', siteName: m.siteName || '',
    receipt: m.receipt || '', status: m.status || 'pending', reviewNote: m.reviewNote || '', reviewedBy: m.reviewedBy || '',
    createdByName: m.createdByName || '', createdAt: toDate(m.createdAt), date: m.date || '',
    tz: tzOf(m.tz), createdLocal: atTz(toDate(m.createdAt), tzOf(m.tz)),
  };
}
export function mapUpdate(d) {
  const m = d.data() || {};
  return {
    id: d.id, siteId: m.siteId || '', siteName: m.siteName || '', employeeId: m.employeeId || '',
    employeeName: m.employeeName || '', category: m.category || 'Progress', note: m.note || '',
    progress: typeof m.progress === 'number' ? m.progress : null, photos: Array.isArray(m.photos) ? m.photos : [],
    lat: m.lat ?? null, lng: m.lng ?? null, createdAt: toDate(m.createdAt), date: m.date || '',
    tz: tzOf(m.tz), createdLocal: atTz(toDate(m.createdAt), tzOf(m.tz)),
    editedAt: toDate(m.editedAt), editedBy: m.editedBy || '',
  };
}
export function mapOff(d) {
  const m = d.data() || {};
  return {
    id: d.id, employeeId: m.employeeId || '', employeeName: m.employeeName || '', date: m.date || '',
    month: m.month || '', reason: m.reason || '', status: m.status || 'pending', createdAt: toDate(m.createdAt),
  };
}
export function mapAlert(d) {
  const m = d.data() || {};
  return {
    id: d.id, employeeId: m.employeeId || '', employeeName: m.employeeName || '', siteId: m.siteId || '',
    siteName: m.siteName || '', sessionId: m.sessionId || '', type: m.type || 'left_site',
    lat: m.lat ?? null, lng: m.lng ?? null, distance: m.distance ?? null, at: toDate(m.at), date: m.date || '',
    resolved: m.resolved === true, resolvedBy: m.resolvedBy || '',
    tz: tzOf(m.tz), atLocal: atTz(toDate(m.at), tzOf(m.tz)),
  };
}
export const alertLabel = (a) => (a.type === 'gps_off'
  ? 'Location unavailable while checked in'
  : `Left ${a.siteName || 'site'} without checking out${a.distance != null ? ` (${Math.round(a.distance)} m away)` : ''}`);

export function mapSchedule(d) {
  const m = d.data() || {};
  return {
    id: d.id, employeeId: m.employeeId || '', employeeName: m.employeeName || '', siteId: m.siteId || '',
    siteName: m.siteName || '', date: m.date || '', startTime: m.startTime || '', endTime: m.endTime || '', note: m.note || '',
  };
}
export function mapWorker(d) {
  const m = d.data() || {};
  return {
    id: d.id, name: m.name || 'Worker', phone: m.phone || '', company: m.company || '', trade: m.trade || '',
    nationality: m.nationality || '', code: m.code || '', active: m.active !== false, createdAt: toDate(m.createdAt),
    addedBy: m.addedByEmployee === true ? (m.createdBy || 'staff') : '',
  };
}
export function mapWorkerLock(d) {
  const m = d.data() || {};
  return {
    id: d.id, workerId: d.id, recordId: m.recordId || '', sessionId: m.sessionId || '', employeeId: m.employeeId || '',
    employeeName: m.employeeName || '', siteId: m.siteId || '', siteName: m.siteName || '', since: toDate(m.since),
  };
}
export function mapWorkerEntry(d) {
  const m = d.data() || {};
  return localise({
    id: d.id, workerId: m.workerId || '', workerName: m.workerName || '', company: m.company || '', trade: m.trade || '',
    sessionId: m.sessionId || '', employeeId: m.employeeId || '', employeeName: m.employeeName || '',
    siteId: m.siteId || '', siteName: m.siteName || '', date: m.date || '', month: m.month || '',
    checkIn: toDate(m.checkIn) || new Date(), checkOut: toDate(m.checkOut), open: m.open === true, note: m.note || '',
    tz: tzOf(m.tz),
  });
}
export function mapIdInfo(d) {
  const m = d.data() || {};
  const o = { id: d.id, ownerType: m.ownerType || '', updatedAt: toDate(m.updatedAt) };
  for (const k of ID_FIELDS) o[k] = m[k] || '';
  return o;
}
export function mapIdFile(d) {
  const m = d.data() || {};
  return {
    id: d.id, ownerId: m.ownerId || '', ownerType: m.ownerType || '', kind: m.kind || 'other', name: m.name || 'file',
    mime: m.mime || 'application/octet-stream', size: num(m.size), chunks: num(m.chunks, 1), uploadedAt: toDate(m.uploadedAt),
    uploadedBy: m.uploadedBy || '', pending: m.pending === true, requestId: m.requestId || '', ownerName: m.ownerName || '',
  };
}
/** Text fields kept in idInfo/{ownerId}. */
export const ID_FIELDS = ['nationality', 'passportNo', 'passportExpiry', 'eidNo', 'eidExpiry', 'siraNo', 'siraExpiry',
  'visaNo', 'visaExpiry', 'labourCardNo', 'labourCardExpiry', 'idNotes'];

/** Minimum working minutes per day (admin setting, default 8 h). */
export const minDayMins = () => Math.round((store.settings?.minDailyHours || 8) * 60);
/** A finished day (not today with someone still on site) that is below the minimum. */
export const isShortDay = (date, mins, stillOpen = false) => mins > 0 && mins < minDayMins() && !(stillOpen && date === dateKey(new Date()));
export const saveSettings = (data) => setDoc(doc(db, 'settings', 'general'), data, { merge: true });
export const saveWorkerRate = (workerId, dailyRate) =>
  setDoc(doc(db, 'workerRates', workerId), { dailyRate, updatedAt: serverTimestamp(), updatedBy: store.me?.name || '' });

export const sessionMinutes = (s, now = new Date()) =>
  Math.max(0, Math.round(((s.checkOut || now) - s.checkIn) / 60000));
export const sessionFlagged = (s) => s.inOutside || s.outOutside || s.mocked;

// ------------------------------------------------------------------ roles
// admin   = full access incl. accounts (petty cash, budgets) and staff logins
// manager = everything operational, but no accounts and no staff-login admin
export const isAdmin = () => store.me?.role === 'admin';
export const isManagerOrAdmin = () => ['admin', 'manager'].includes(store.me?.role);
export const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', employee: 'Employee', docs: 'Document clerk' };

// ------------------------------------------------------------------ live store
// One set of listeners shared by every page. Pages subscribe with store.on().
export const store = {
  me: null, users: [], sites: [], projects: [], open: [], today: [], schedulesToday: [],
  pendingPetty: [], pendingOff: [], monthOff: [], petty: [], alerts: [], loaded: false, error: null,
  workers: [], workerLocks: [], idInfo: [], idFiles: [], _wToday: [], _wOpen: [], requests: [], settings: { minDailyHours: 8 }, rates: {},
  _subs: [], _listeners: new Set(), _day: null, errors: {},
  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
  emit() { this._listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); },
  start() {
    this.stop();
    const now = new Date();
    this._day = dateKey(now);
    this.errors = {};
    const LABELS = { _wToday: 'external worker attendance', _wOpen: 'external workers on site', workerLocks: 'external worker locks',
      workers: 'external workers', requests: 'change requests', idInfo: 'ID details', idFiles: 'ID copies' };
    const sub = (q, key, mapper, after) => this._subs.push(onSnapshot(q, (snap) => {
      this[key] = snap.docs.map(mapper);
      delete this.errors[key];
      if (after) after(this[key]);
      this.emit();
    }, (e) => { console.error(key, e); this.error = e; this.errors[key] = `${LABELS[key] || key}: ${e.code || e.message}`; this.emit(); }));
    const byName = (a, b) => a.name.localeCompare(b.name);
    sub(C('users'), 'users', mapUser, (l) => { l.sort(byName); this.loaded = true; });
    sub(C('sites'), 'sites', mapSite, (l) => l.sort(byName));
    sub(C('projects'), 'projects', mapProject, (l) => l.sort(byName));
    sub(query(C('attendance'), where('status', '==', 'open')), 'open', mapSession);
    sub(query(C('attendance'), where('date', '==', this._day)), 'today', mapSession, (l) => l.sort((a, b) => a.checkIn - b.checkIn));
    sub(query(C('schedules'), where('date', '==', this._day)), 'schedulesToday', mapSchedule);
    if (isAdmin()) sub(query(C('petty'), where('status', '==', 'pending')), 'pendingPetty', mapPetty);
    sub(query(C('offDays'), where('status', '==', 'pending')), 'pendingOff', mapOff);
    sub(query(C('alerts'), where('resolved', '==', false)), 'alerts', mapAlert, (l) => l.sort((a, b) => (b.at || 0) - (a.at || 0)));
    sub(query(C('offDays'), where('month', '==', monthKey(now))), 'monthOff', mapOff);
    if (isAdmin()) sub(query(C('petty'), orderBy('createdAt', 'desc'), limit(3000)), 'petty', mapPetty);
    sub(C('extWorkers'), 'workers', mapWorker, (l) => l.sort(byName));
    sub(C('workerLocks'), 'workerLocks', mapWorkerLock);
    sub(query(C('changeRequests'), where('status', '==', 'pending')), 'requests', mapRequest, (l) => l.sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0)));
    this._subs.push(onSnapshot(doc(db, 'settings', 'general'), (d) => {
      const m = (d.exists() ? d.data() : null) || {};
      this.settings = { minDailyHours: typeof m.minDailyHours === 'number' && m.minDailyHours > 0 ? m.minDailyHours : 8 };
      this.emit();
    }, () => {}));
    if (isAdmin()) {
      this._subs.push(onSnapshot(C('workerRates'), (snap) => {
        this.rates = Object.fromEntries(snap.docs.map((d) => [d.id, num(d.data().dailyRate)]));
        this.emit();
      }, () => {}));
    }
    // Today's worker entries PLUS any still open from earlier (e.g. checked in before midnight).
    sub(query(C('workerAttendance'), where('date', '==', this._day)), '_wToday', mapWorkerEntry);
    sub(query(C('workerAttendance'), where('open', '==', true)), '_wOpen', mapWorkerEntry);
    sub(C('idInfo'), 'idInfo', mapIdInfo);
    sub(C('idFiles'), 'idFiles', mapIdFile, (l) => l.sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0)));
    this._tick = setInterval(() => {
      if (dateKey(new Date()) !== this._day) this.start(); else this.emit();
    }, 30000);
  },
  stop() {
    this._subs.forEach((u) => u()); this._subs = [];
    if (this._tick) clearInterval(this._tick);
  },
  get employees() { return this.users.filter((u) => u.role === 'employee'); },
  get activeEmployees() { return this.users.filter((u) => u.role === 'employee' && u.active); },
  user(id) { return this.users.find((u) => u.id === id) || null; },
  site(id) { return this.sites.find((s) => s.id === id) || null; },
  project(id) { return this.projects.find((p) => p.id === id) || null; },
  get workersToday() {
    const m = new Map();
    [...this._wToday, ...this._wOpen].forEach((e) => m.set(e.id, e));
    return [...m.values()];
  },
  /** External workers on site now — from open attendance entries (works even if a lock is missing). */
  get extOnSite() {
    const m = new Map();
    for (const e of this._wOpen) {
      const prev = m.get(e.workerId);
      if (!prev || e.checkIn > prev.since) {
        m.set(e.workerId, { workerId: e.workerId, recordId: e.id, sessionId: e.sessionId, employeeId: e.employeeId, employeeName: e.employeeName,
          siteId: e.siteId, siteName: e.siteName, since: e.checkIn, name: e.workerName });
      }
    }
    for (const l of this.workerLocks) if (!m.has(l.workerId)) m.set(l.workerId, { ...l, name: '' });
    return [...m.values()];
  },
  worker(id) { return this.workers.find((w) => w.id === id) || null; },
  workerLock(id) { return this.extOnSite.find((l) => l.workerId === id) || null; },
  info(ownerId) { return this.idInfo.find((i) => i.id === ownerId) || null; },
  files(ownerId) { return this.idFiles.filter((f) => f.ownerId === ownerId && !f.pending); },
  get pendingSites() { return this.sites.filter((s) => !s.approved && s.status !== 'rejected'); },
};

/** Today's status for every active employee. */
export function staffStatuses() {
  const now = new Date();
  const today = dateKey(now);
  const order = { onDuty: 0, done: 1, off: 2, notIn: 3 };
  return store.activeEmployees.map((u) => {
    const sessions = store.today.filter((s) => s.employeeId === u.id);
    const open = store.open.find((s) => s.employeeId === u.id) || null;
    const off = u.weeklyOffDays.includes(isoWeekday(now)) ||
      store.monthOff.some((o) => o.employeeId === u.id && o.date === today && o.status === 'approved');
    let state = 'notIn';
    if (open) state = 'onDuty'; else if (sessions.length) state = 'done'; else if (off) state = 'off';
    let minutes = sessions.filter((s) => s.checkOut).reduce((a, s) => a + sessionMinutes(s), 0);
    if (open) minutes += sessionMinutes(open, now);
    return { user: u, state, sessions, open, minutes, forgot: !!open && open.date !== today };
  }).sort((a, b) => order[a.state] - order[b.state] || a.user.name.localeCompare(b.user.name));
}
export const isoWeekday = (d) => (d.getDay() === 0 ? 7 : d.getDay());

// ------------------------------------------------------------------ queries (one-off)
export async function sessionsInRange(from, to) {
  const snap = await getDocs(query(C('attendance'), where('date', '>=', from), where('date', '<=', to)));
  return snap.docs.map(mapSession).sort((a, b) => a.checkIn - b.checkIn);
}
export async function sessionsForSites(siteIds) {
  if (!siteIds.length) return [];
  const out = [];
  for (let i = 0; i < siteIds.length; i += 30) {
    const snap = await getDocs(query(C('attendance'), where('siteId', 'in', siteIds.slice(i, i + 30))));
    out.push(...snap.docs.map(mapSession));
  }
  return out.sort((a, b) => a.checkIn - b.checkIn);
}
export async function updatesInRange(from, to) {
  const snap = await getDocs(query(C('siteUpdates'), where('date', '>=', from), where('date', '<=', to)));
  return snap.docs.map(mapUpdate).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
export async function updatesForSites(siteIds) {
  if (!siteIds.length) return [];
  const out = [];
  for (let i = 0; i < siteIds.length; i += 30) {
    const snap = await getDocs(query(C('siteUpdates'), where('siteId', 'in', siteIds.slice(i, i + 30))));
    out.push(...snap.docs.map(mapUpdate));
  }
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
export async function recentUpdates(n = 40) {
  const snap = await getDocs(query(C('siteUpdates'), orderBy('createdAt', 'desc'), limit(n)));
  return snap.docs.map(mapUpdate);
}
export async function offDaysForMonth(month) {
  const snap = await getDocs(query(C('offDays'), where('month', '==', month)));
  return snap.docs.map(mapOff);
}
export async function offDaysInRange(from, to) {
  const snap = await getDocs(query(C('offDays'), where('date', '>=', from), where('date', '<=', to)));
  return snap.docs.map(mapOff);
}
export async function schedulesForDate(date) {
  const snap = await getDocs(query(C('schedules'), where('date', '==', date)));
  return snap.docs.map(mapSchedule).sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.startTime.localeCompare(b.startTime));
}
export async function trackForDay(uid, date) {
  const snap = await getDocs(query(collection(db, 'users', uid, 'track'), where('date', '==', date)));
  return snap.docs.map((d) => ({ lat: d.data().lat, lng: d.data().lng, at: toDate(d.data().at) }))
    .filter((p) => typeof p.lat === 'number').sort((a, b) => (a.at || 0) - (b.at || 0));
}
export async function getMe(uid) {
  const d = await getDoc(doc(db, 'users', uid));
  return d.exists() ? mapUser(d) : null;
}

// ------------------------------------------------------------------ writes
export const saveSite = async (id, data) => {
  if (id) await setDoc(doc(db, 'sites', id), data, { merge: true });
  else await addDoc(C('sites'), { ...data, createdAt: serverTimestamp() });
};
export const deleteSite = (id) => deleteDoc(doc(db, 'sites', id));
export const approveSite = (id, ok) => updateDoc(doc(db, 'sites', id),
  ok ? { approved: true } : { approved: false, active: false, status: 'rejected' });
export const resolveAlert = (id, by) => updateDoc(doc(db, 'alerts', id), { resolved: true, resolvedBy: by, resolvedAt: serverTimestamp() });
export async function alertsInRange(from, to) {
  const snap = await getDocs(query(C('alerts'), where('date', '>=', from), where('date', '<=', to)));
  return snap.docs.map(mapAlert).sort((a, b) => (a.at || 0) - (b.at || 0));
}

export async function saveProject(id, data) {
  let pid = id;
  if (id) await setDoc(doc(db, 'projects', id), data, { merge: true });
  else pid = (await addDoc(C('projects'), { ...data, createdAt: serverTimestamp() })).id;
  // Tag sites with their project so the link works in both directions.
  const batch = writeBatch(db);
  for (const s of store.sites) {
    const inProject = data.siteIds.includes(s.id);
    if (inProject && s.projectId !== pid) batch.update(doc(db, 'sites', s.id), { projectId: pid, projectName: data.name });
    if (!inProject && s.projectId === pid) batch.update(doc(db, 'sites', s.id), { projectId: '', projectName: '' });
  }
  await batch.commit();
  return pid;
}
export const deleteProject = (id) => deleteDoc(doc(db, 'projects', id));

export const updateUser = (id, data) => setDoc(doc(db, 'users', id), data, { merge: true });

export async function createStaff({ loginId, password, name, phone, designation, role, weeklyOffDays, monthlyOffQuota }) {
  const second = getApps().find((a) => a.name === 'staffCreator') || initializeApp(firebaseConfig, 'staffCreator');
  const sAuth = getAuth(second);
  const email = loginToEmail(loginId);
  const cred = await createUserWithEmailAndPassword(sAuth, email, password);
  const uid = cred.user.uid;
  await signOut(sAuth);
  await setDoc(doc(db, 'users', uid), {
    name, loginId: loginId.trim(), email, phone, designation, role, active: true,
    weeklyOffDays, monthlyOffQuota, createdAt: serverTimestamp(),
  });
  return uid;
}

export function addSchedule(emp, site, date, startTime, endTime, note) {
  return addDoc(C('schedules'), {
    employeeId: emp.id, employeeName: emp.name, siteId: site.id, siteName: site.name,
    date: dateKey(date), month: monthKey(date), startTime, endTime, note, createdAt: serverTimestamp(),
  });
}
export const deleteSchedule = (id) => deleteDoc(doc(db, 'schedules', id));

export async function closeSession(s, at) {
  await updateDoc(doc(db, 'attendance', s.id), {
    checkOut: Timestamp.fromDate(at), durationMin: Math.round((at - s.checkIn) / 60000), status: 'closed',
    note: `${s.note} [closed by management]`.trim(), ...(s.tz != null ? { outTz: s.tz } : {}),
  });
  await closeWorkersForSession(s.id, at);
}
export async function deleteSession(id) {
  await deleteDoc(doc(db, 'attendance', id));
  const snap = await getDocs(query(C('workerAttendance'), where('sessionId', '==', id)));
  const b = writeBatch(db);
  snap.docs.forEach((d) => {
    b.delete(d.ref);
    const lk = store.workerLock(d.data().workerId);
    if (lk && lk.recordId === d.id) b.delete(doc(db, 'workerLocks', lk.workerId));
  });
  await b.commit();
}

// ------------------------------------------------------------------ admin corrections
/**
 * Admin: change a check-in's times (entered as site-local wall-clock Dates).
 * `outWall` null keeps it open. External workers on the same check-in follow the new times.
 */
export async function editSessionTimes(s, inWall, outWall, { applyWorkers = true, reason = '' } = {}) {
  const tz = s.tz;
  const newIn = fromTz(inWall, tz);
  const newOut = outWall ? fromTz(outWall, s.outTz ?? tz) : null;
  if (newOut && newOut <= newIn) throw new Error('Check-out must be after check-in.');
  const day = atTz(newIn, tz) || newIn;
  const data = {
    checkIn: Timestamp.fromDate(newIn), date: dateKey(day), month: monthKey(day),
    editedBy: store.me?.name || 'admin', editedAt: serverTimestamp(),
    note: `${s.note ? `${s.note} ` : ''}[times edited by ${store.me?.name || 'admin'}${reason ? `: ${reason}` : ''}]`.trim(),
  };
  if (!s.editedAt) data.originalCheckIn = Timestamp.fromDate(s.checkIn);
  if (!s.editedAt && s.checkOut) data.originalCheckOut = Timestamp.fromDate(s.checkOut);
  if (newOut) Object.assign(data, { checkOut: Timestamp.fromDate(newOut), durationMin: Math.round((newOut - newIn) / 60000), status: 'closed' });
  await updateDoc(doc(db, 'attendance', s.id), data);
  if (!applyWorkers) return;
  const snap = await getDocs(query(C('workerAttendance'), where('sessionId', '==', s.id)));
  const near = (a, b) => a && b && Math.abs(a - b) < 90000;
  for (const d of snap.docs) {
    const e = mapWorkerEntry(d);
    let eIn = near(e.checkIn, s.checkIn) ? newIn : new Date(Math.max(e.checkIn, newIn));
    let eOut = e.checkOut ? (near(e.checkOut, s.checkOut) ? newOut || e.checkOut : e.checkOut) : null;
    if (newOut && eOut && eOut > newOut) eOut = newOut;
    if (newOut && eIn > newOut) eIn = newOut;
    const ed = atTz(eIn, e.tz ?? tz) || eIn;
    const upd = { checkIn: Timestamp.fromDate(eIn), date: dateKey(ed), month: monthKey(ed) };
    if (eOut) Object.assign(upd, { checkOut: Timestamp.fromDate(eOut), durationMin: Math.round((eOut - eIn) / 60000) });
    if (!e.open && !eOut && newOut) Object.assign(upd, { checkOut: Timestamp.fromDate(newOut), durationMin: Math.round((newOut - eIn) / 60000) });
    await updateDoc(d.ref, upd);
  }
  // A check-in that is now closed must free its workers.
  if (newOut) await closeWorkersForSession(s.id, newOut);
}

/** Admin: delete every check-in of one employee on one day (and the worker time tied to them). */
export async function deleteWorkDay(employeeId, date) {
  const snap = await getDocs(query(C('attendance'), where('employeeId', '==', employeeId), where('date', '==', date)));
  for (const d of snap.docs) await deleteSession(d.id);
  return snap.size;
}

/** Admin: edit an external worker entry's times (site-local wall clock). */
export async function editWorkerEntryTimes(e, inWall, outWall) {
  const newIn = fromTz(inWall, e.tz);
  const newOut = outWall ? fromTz(outWall, e.tz) : null;
  if (newOut && newOut <= newIn) throw new Error('End must be after start.');
  const day = atTz(newIn, e.tz) || newIn;
  const upd = { checkIn: Timestamp.fromDate(newIn), date: dateKey(day), month: monthKey(day), note: `${e.note ? `${e.note} ` : ''}[times edited by ${store.me?.name || 'admin'}]` };
  if (newOut) Object.assign(upd, { checkOut: Timestamp.fromDate(newOut), durationMin: Math.round((newOut - newIn) / 60000) });
  await updateDoc(doc(db, 'workerAttendance', e.id), upd);
  if (newOut && e.open) await closeWorkerEntry({ ...e, checkIn: newIn }, newOut);
}

async function deleteWhere(col, field, value) {
  const snap = await getDocs(query(C(col), where(field, '==', value)));
  for (let i = 0; i < snap.docs.length; i += 400) {
    const b = writeBatch(db);
    snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  return snap.size;
}

/**
 * Admin: delete a staff member's profile (their login can no longer use the app or dashboard).
 * With `records`, also deletes their attendance, worker time they logged, schedules, off-days, alerts and ID documents.
 * Petty cash entries are always kept for the accounts.
 */
export async function deleteEmployee(u, { records = false } = {}) {
  if (u.id === store.me?.id) throw new Error('You cannot delete your own account.');
  let n = 0;
  if (records) {
    for (const l of store.workerLocks.filter((x) => x.employeeId === u.id)) await deleteDoc(doc(db, 'workerLocks', l.workerId));
    n += await deleteWhere('attendance', 'employeeId', u.id);
    n += await deleteWhere('workerAttendance', 'employeeId', u.id);
    n += await deleteWhere('schedules', 'employeeId', u.id);
    n += await deleteWhere('offDays', 'employeeId', u.id);
    n += await deleteWhere('alerts', 'employeeId', u.id);
    for (const f of store.files(u.id)) { await deleteIdFile(f); n++; }
    await deleteDoc(doc(db, 'idInfo', u.id)).catch(() => {});
  }
  await deleteDoc(doc(db, 'users', u.id));
  return n;
}

// ------------------------------------------------------------------ external workers
export async function saveWorker(id, data) {
  if (id) { await setDoc(doc(db, 'extWorkers', id), data, { merge: true }); return id; }
  return (await addDoc(C('extWorkers'), { ...data, active: true, createdAt: serverTimestamp(), createdBy: store.me?.name || '' })).id;
}
export const deleteWorker = (id) => deleteDoc(doc(db, 'extWorkers', id));

/** End a worker's open entry (and free their lock) at `at`. */
export async function closeWorkerEntry(entry, at = new Date(), note = '') {
  const end = at < entry.checkIn ? entry.checkIn : at;
  const b = writeBatch(db);
  b.update(doc(db, 'workerAttendance', entry.id), {
    checkOut: Timestamp.fromDate(end), durationMin: Math.round((end - entry.checkIn) / 60000), open: false,
    ...(note ? { note } : {}),
  });
  const lk = store.workerLock(entry.workerId);
  if (lk && lk.recordId === entry.id) b.delete(doc(db, 'workerLocks', lk.workerId));
  await b.commit();
}
export async function closeWorkersForSession(sessionId, at) {
  const snap = await getDocs(query(C('workerAttendance'), where('sessionId', '==', sessionId), where('open', '==', true)));
  for (const d of snap.docs) await closeWorkerEntry(mapWorkerEntry(d), at, 'closed by management');
}
/** Free a lock whose entry is gone or already closed (e.g. phone lost connection). */
export async function releaseWorkerLock(lock, at = new Date()) {
  if (lock.recordId) {
    const d = await getDoc(doc(db, 'workerAttendance', lock.recordId));
    if (d.exists() && d.data().open === true) return closeWorkerEntry(mapWorkerEntry(d), at, 'released by management');
  }
  await deleteDoc(doc(db, 'workerLocks', lock.workerId));
}
/** Management: add workers to an employee's open check-in (same rules as the app — one site at a time). */
export async function addWorkersToSession(session, workers) {
  const busy = [];
  const now = new Date();
  const start = now - session.checkIn <= 15 * 60000 ? session.checkIn : now;
  for (const w of workers) {
    const lockRef = doc(db, 'workerLocks', w.id);
    const lock = await getDoc(lockRef);
    if (lock.exists()) {
      const m = lock.data();
      if (m.sessionId !== session.id) busy.push(`${w.name} is already with ${m.employeeName} at ${m.siteName}`);
      continue;
    }
    const rec = doc(C('workerAttendance'));
    const b = writeBatch(db);
    b.set(rec, {
      workerId: w.id, workerName: w.name, company: w.company, trade: w.trade, sessionId: session.id,
      employeeId: session.employeeId, employeeName: session.employeeName, siteId: session.siteId, siteName: session.siteName,
      date: dateKey(atTz(start, session.tz) || start), month: monthKey(atTz(start, session.tz) || start),
      checkIn: Timestamp.fromDate(start), open: true, ...(session.tz != null ? { tz: session.tz } : {}),
      note: `added by ${store.me?.name || 'management'}`, createdAt: serverTimestamp(),
    });
    b.set(lockRef, {
      recordId: rec.id, sessionId: session.id, employeeId: session.employeeId, employeeName: session.employeeName,
      siteId: session.siteId, siteName: session.siteName, since: Timestamp.fromDate(start),
    });
    await b.commit();
  }
  return busy;
}

export const entryMinutes = (e, now = new Date()) => Math.max(0, Math.round(((e.checkOut || now) - e.checkIn) / 60000));
export async function workerEntriesForSites(siteIds) {
  if (!siteIds.length) return [];
  const out = [];
  for (let i = 0; i < siteIds.length; i += 30) {
    const snap = await getDocs(query(C('workerAttendance'), where('siteId', 'in', siteIds.slice(i, i + 30))));
    out.push(...snap.docs.map(mapWorkerEntry));
  }
  return out.sort((a, b) => a.checkIn - b.checkIn);
}

export async function workerEntriesInRange(from, to) {
  const snap = await getDocs(query(C('workerAttendance'), where('date', '>=', from), where('date', '<=', to)));
  return snap.docs.map(mapWorkerEntry).sort((a, b) => a.checkIn - b.checkIn);
}
export const deleteWorkerEntry = (id) => deleteDoc(doc(db, 'workerAttendance', id));

// ------------------------------------------------------------------ ID documents
export const saveIdInfo = (ownerId, ownerType, data) =>
  setDoc(doc(db, 'idInfo', ownerId), { ...data, ownerType, updatedAt: serverTimestamp() }, { merge: true });

const CHUNK = 700000; // characters of base64 per Firestore doc (limit is 1 MiB)
export async function uploadIdFile({ ownerId, ownerType, ownerName, kind, name, mime, base64, pending = false, requestId = '' }) {
  const ref = doc(C('idFiles'));
  const n = Math.max(1, Math.ceil(base64.length / CHUNK));
  const b = writeBatch(db);
  for (let i = 0; i < n; i++) b.set(doc(db, 'idFiles', ref.id, 'chunks', String(i)), { d: base64.slice(i * CHUNK, (i + 1) * CHUNK) });
  b.set(ref, {
    ownerId, ownerType, ownerName, kind, name, mime, size: Math.round(base64.length * 0.75), chunks: n,
    uploadedAt: serverTimestamp(), uploadedBy: store.me?.name || '', uploadedById: store.me?.id || '',
    ...(pending ? { pending: true, requestId } : {}),
  });
  await b.commit();
  return ref.id;
}
export async function readIdFile(f) {
  const snap = await getDocs(collection(db, 'idFiles', f.id, 'chunks'));
  const parts = snap.docs.map((d) => [Number(d.id), d.data().d || '']).sort((a, b) => a[0] - b[0]);
  return parts.map((p) => p[1]).join('');
}
export async function deleteIdFile(f) {
  const snap = await getDocs(collection(db, 'idFiles', f.id, 'chunks'));
  const b = writeBatch(db);
  snap.docs.forEach((d) => b.delete(d.ref));
  b.delete(doc(db, 'idFiles', f.id));
  await b.commit();
}

export function addPetty({ emp, type, amount, category, note, site, me }) {
  const now = new Date();
  return addDoc(C('petty'), {
    employeeId: emp.id, employeeName: emp.name, type, amount, category, note,
    siteId: site?.id || '', siteName: site?.name || '', receipt: '', status: 'approved',
    createdBy: me.id, createdByName: me.name, date: dateKey(now), month: monthKey(now), createdAt: serverTimestamp(),
  });
}
export const reviewPetty = (id, approve, reviewer, note = '') => updateDoc(doc(db, 'petty', id), {
  status: approve ? 'approved' : 'rejected', reviewedBy: reviewer, reviewNote: note, reviewedAt: serverTimestamp(),
});
export const deletePetty = (id) => deleteDoc(doc(db, 'petty', id));
export const reviewOff = (id, approve) => updateDoc(doc(db, 'offDays', id), { status: approve ? 'approved' : 'rejected' });
export const deleteUpdate = (id) => deleteDoc(doc(db, 'siteUpdates', id));
export const editUpdate = (id, data) => updateDoc(doc(db, 'siteUpdates', id), {
  ...data, editedAt: serverTimestamp(), editedBy: store.me?.name || '',
});

// ------------------------------------------------------------------ Documents Portal: change requests
export function mapRequest(d) {
  const m = d.data() || {};
  return {
    id: d.id, type: m.type || 'update', targetType: m.targetType || 'worker', targetId: m.targetId || '', targetName: m.targetName || '',
    fields: m.fields || {}, info: m.info || {}, newFileIds: Array.isArray(m.newFileIds) ? m.newFileIds : [],
    deleteFileIds: Array.isArray(m.deleteFileIds) ? m.deleteFileIds : [], note: m.note || '', status: m.status || 'pending',
    submittedBy: m.submittedBy || '', submittedById: m.submittedById || '', submittedAt: toDate(m.submittedAt),
    reviewedBy: m.reviewedBy || '', reviewNote: m.reviewNote || '', reviewedAt: toDate(m.reviewedAt), resultId: m.resultId || '',
  };
}
/** Live listener for any collection/query (used by the portal, which has its own small store). */
export function watch(name, mapper, cb, filters = []) {
  const q = filters.length ? query(C(name), ...filters.map(([f, op, v]) => where(f, op, v))) : C(name);
  return onSnapshot(q, (snap) => cb(snap.docs.map(mapper)), (e) => { console.error(e); cb(null, e); });
}
export const newRequestId = () => doc(C('changeRequests')).id;
export const submitRequest = (id, data) => setDoc(doc(db, 'changeRequests', id), {
  ...data, status: 'pending', submittedBy: store.me?.name || '', submittedById: store.me?.id || '', submittedAt: serverTimestamp(),
});
export const withdrawRequest = async (r) => {
  for (const f of store.idFiles.filter((x) => x.requestId === r.id && x.pending)) await deleteIdFile(f);
  await deleteDoc(doc(db, 'changeRequests', r.id));
};

/**
 * Admin approves a portal request: creates/updates the person, saves ID numbers,
 * makes uploaded copies official and removes the copies marked for deletion.
 * `login` = { loginId, password } is needed only for a new LLCT staff member.
 */
export async function approveRequest(r, login = null) {
  let id = r.targetId;
  const f = r.fields || {};
  if (r.type === 'new' && r.targetType === 'worker') {
    id = await saveWorker(null, { name: f.name || r.targetName, phone: f.phone || '', company: f.company || '', trade: f.trade || '', code: f.code || '' });
  } else if (r.type === 'new' && r.targetType === 'staff') {
    if (!login?.loginId || !login?.password) throw new Error('Enter a login ID and password for the new staff member.');
    id = await createStaff({ loginId: login.loginId, password: login.password, name: f.name || r.targetName, phone: f.phone || '',
      designation: f.designation || '', role: 'employee', weeklyOffDays: [], monthlyOffQuota: 4 });
  } else if (r.targetType === 'worker') {
    const upd = {};
    ['name', 'phone', 'company', 'trade', 'code'].forEach((k) => { if (f[k] !== undefined) upd[k] = f[k]; });
    if (Object.keys(upd).length) await saveWorker(id, upd);
  } else {
    const upd = {};
    ['name', 'phone', 'designation'].forEach((k) => { if (f[k] !== undefined) upd[k] = f[k]; });
    if (Object.keys(upd).length) await updateUser(id, upd);
  }
  const name = f.name || r.targetName;
  if (r.info && Object.keys(r.info).length) await saveIdInfo(id, r.targetType, { ...r.info, name });
  for (const fid of r.newFileIds) {
    await updateDoc(doc(db, 'idFiles', fid), { pending: false, ownerId: id, ownerType: r.targetType, ownerName: name, approvedBy: store.me?.name || '' });
  }
  for (const fid of r.deleteFileIds) {
    const file = store.idFiles.find((x) => x.id === fid);
    if (file) await deleteIdFile(file);
  }
  await updateDoc(doc(db, 'changeRequests', r.id), { status: 'approved', reviewedBy: store.me?.name || '', reviewedAt: serverTimestamp(), resultId: id });
  return id;
}
export async function rejectRequest(r, note = '') {
  for (const fid of r.newFileIds) {
    const file = store.idFiles.find((x) => x.id === fid);
    if (file) await deleteIdFile(file);
  }
  await updateDoc(doc(db, 'changeRequests', r.id), { status: 'rejected', reviewNote: note, reviewedBy: store.me?.name || '', reviewedAt: serverTimestamp() });
}
