// Backup & storage (admin only): estimated database size vs the free 1 GB, backups of every
// photo and transaction (ZIP / Excel / JSON), and freeing space by removing old photos & GPS trails
// from the database after they have been backed up. ID documents are never removed here.
import { db, store, isAdmin, mapAcct, mapPetty, mapTrip, mapSession, mapWorkerEntry, autoAcctLines, tripCost, tripKindLabel } from '../fb.js';
import {
  collection, doc, getDocs, getDoc, query, where, limit, getCountFromServer, writeBatch, orderBy, startAfter,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from '../config.js';
import { saveBlob } from '../report-lib.js';
import { esc, icon, toast, confirmBox, friendlyError, dateKey } from '../util.js';

const FREE_BYTES = 1024 ** 3; // Spark (free) plan: 1 GiB Firestore storage
const LS_KEY = 'llct-storage-estimate';
const C = (n) => collection(db, n);

// Every collection in the shared project (attendance + invoicing) and what it holds.
const AREAS = [
  { key: 'siteUpdates', label: 'Site update photos & notes', photo: true },
  { key: 'petty', label: 'Petty cash (with receipt photos)', photo: true },
  { key: 'acctFiles', label: 'Accounts receipt copies', photo: true },
  { key: 'idFiles', label: 'ID document copies', photo: true, sizeField: true },
  { key: 'inv_images', label: 'Invoicing photos & attachments', photo: true },
  { key: '_track', label: 'GPS trails (staff on duty)', sub: true },
  { key: '_points', label: 'Trip & ride routes', sub: true },
  { key: 'attendance', label: 'Attendance' },
  { key: 'workerAttendance', label: 'External worker attendance' },
  { key: 'trips', label: 'Trips & rides' },
  { key: 'acctEntries', label: 'Accounts entries' },
  { key: 'alerts', label: 'Alerts & violations' },
  { key: 'inv_docs', label: 'Invoicing documents' },
  { key: 'inv_payments', label: 'Invoicing payments' },
  { key: 'inv_clients', label: 'Invoicing clients' },
  { key: 'inv_products', label: 'Invoicing products' },
  { key: 'inv_ledger', label: 'Invoicing accounts' },
];
const OTHER = ['users', 'sites', 'projects', 'schedules', 'offDays', 'extWorkers', 'workerLocks', 'idInfo', 'changeRequests', 'settings',
  'workerRates', 'driverPayments', 'siteKeys', 'acctSettings', 'inv_config', 'inv_access', 'inv_counters', 'inv_profiles', 'inv_numbers'];
const ALL_COLLECTIONS = [...new Set([...AREAS.filter((a) => !a.sub).map((a) => a.key), ...OTHER])];

const mb = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(0, Math.round(b / 1024))} KB`);
// Approximate stored size of a document (field data + names + Firestore's per-document overhead).
const docBytes = (data) => { try { return JSON.stringify(data).length + 64; } catch { return 1024; } };

export function mount(el, _p, { setHeader }) {
  if (!isAdmin()) { el.innerHTML = '<div class="card empty"><b>Admins only</b></div>'; return () => {}; }
  setHeader('Backup & storage', 'Database size against the free 1 GB, backups of all photos and transactions, and freeing space');
  let est = null;
  try { est = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { est = null; }
  let busyText = '';
  const now = new Date();
  const yearAgo = dateKey(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()));

  function draw() {
    const used = est ? est.total : 0;
    const pct = est ? Math.min(100, Math.round((used / FREE_BYTES) * 100)) : 0;
    const color = pct >= 90 ? '#D64545' : pct >= 70 ? '#E08E2B' : '#2E9E6A';
    const consoleUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/usage`;
    el.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Database size</h2><span class="spacer"></span>
        <button class="btn sm" id="bk-calc">${est ? 'Recalculate' : 'Calculate size'}</button></div>
      <div class="card-pad">
        ${est ? `
        <div class="row" style="align-items:baseline;gap:10px"><b style="font-size:26px;color:${color}">${mb(used)}</b>
          <span class="muted">of 1 GB free · ${pct}% used · estimated ${esc(new Date(est.at).toLocaleString())}</span></div>
        <div style="height:12px;background:#f0ede8;border-radius:8px;margin:10px 0 6px"><i style="display:block;height:12px;width:${Math.max(1, pct)}%;background:${color};border-radius:8px"></i></div>
        ${pct >= 70 ? `<div class="small" style="color:${color};font-weight:700;margin-bottom:8px">⚠ ${pct >= 90 ? 'Almost full' : 'Getting full'} — download a backup below, then free up space (or move to the Blaze plan).</div>` : ''}
        <div class="small muted" style="margin-bottom:10px">Photos: <b>${mb(est.photos)}</b> · records: <b>${mb(used - est.photos)}</b> · ${est.docs.toLocaleString()} records in total</div>
        <div class="table-wrap"><table class="t tr-t"><thead><tr><th>What</th><th class="num">Records</th><th class="num">Size</th><th style="width:30%"></th></tr></thead><tbody>
          ${est.rows.map((r) => `<tr><td>${r.photo ? '📷 ' : ''}${esc(r.label)}</td><td class="num">${r.count.toLocaleString()}</td><td class="num"><b>${mb(r.bytes)}</b></td>
            <td><div style="height:6px;background:#f0ede8;border-radius:4px"><i style="display:block;height:6px;width:${used ? Math.max(1, Math.round((r.bytes / used) * 100)) : 0}%;background:${r.photo ? '#D98A1A' : '#3A7BD5'};border-radius:4px"></i></div></td></tr>`).join('')}
        </tbody></table></div>`
        : '<div class="empty"><b>Not calculated yet</b>Press “Calculate size”. It counts every collection and samples record sizes (a few hundred reads).</div>'}
        <div class="small muted" style="margin-top:8px">Estimate (Firestore also stores indexes). Exact figures: <a href="${consoleUrl}" target="_blank" rel="noopener">Firebase Console → Firestore → Usage</a>.</div>
      </div>
    </div>

    <div class="grid cols-3 mt">
      <div class="card"><div class="card-head"><h2>${icon('download', 18)} Transactions (Excel)</h2></div><div class="card-pad">
        <p class="small muted" style="margin-top:0">One workbook with every transaction: accounts (incl. petty cash given & driver payments), petty cash, driver payments, trips & rides, attendance, external workers, staff and sites.</p>
        <button class="btn" id="bk-xlsx">Download Excel backup</button></div></div>
      <div class="card"><div class="card-head"><h2>${icon('download', 18)} Photos (ZIP)</h2></div><div class="card-pad">
        <div class="row" style="gap:8px;flex-wrap:wrap"><label class="small">From <input type="date" id="ph-from" value="2000-01-01" style="width:150px"></label>
          <label class="small">To <input type="date" id="ph-to" value="${dateKey(now)}" style="width:150px"></label></div>
        <div class="small" style="margin:8px 0;display:grid;gap:4px">
          ${[['site', 'Site update photos', true], ['petty', 'Petty cash receipts', true], ['acct', 'Accounts receipts', true], ['id', 'ID document copies', false], ['inv', 'Invoicing photos & attachments', false]]
            .map(([k, l, on]) => `<label class="row" style="gap:6px"><input type="checkbox" data-ph="${k}" ${on ? 'checked' : ''}> ${l}</label>`).join('')}
        </div>
        <button class="btn" id="bk-photos">Download photos ZIP</button></div></div>
      <div class="card"><div class="card-head"><h2>${icon('download', 18)} Full data (JSON)</h2></div><div class="card-pad">
        <p class="small muted" style="margin-top:0">Every record of both apps as JSON files (photos left out — use the photos ZIP). Keep it as a complete copy of the database.</p>
        <label class="row small" style="gap:6px;margin-bottom:8px"><input type="checkbox" id="js-gps"> Include GPS trails & trip routes (large)</label>
        <button class="btn" id="bk-json">Download data ZIP</button></div></div>
    </div>

    <div class="card mt" style="border:1px solid #f1c9c9">
      <div class="card-head"><h2 style="color:#b23535">Free up space</h2></div>
      <div class="card-pad">
        <p class="small" style="margin-top:0">Removes old <b>photos</b> and <b>GPS trails</b> from the database to free space. Records stay (amounts, dates, notes) and are marked “photo in backup”. <b>Download the photos ZIP for the same period first.</b> ID documents and invoicing files are never removed here.</p>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center"><label class="small">Older than <input type="date" id="fr-cut" value="${yearAgo}" style="width:150px"></label>
          ${[['site', 'Site update photos'], ['petty', 'Petty cash receipts'], ['acct', 'Accounts receipts'], ['track', 'GPS trails'], ['points', 'Trip & ride routes']]
            .map(([k, l]) => `<label class="row small" style="gap:6px"><input type="checkbox" data-fr="${k}" checked> ${l}</label>`).join('')}</div>
        <label class="row small" style="gap:6px;margin:10px 0"><input type="checkbox" id="fr-ok"> I have downloaded the backup for this period and saved it safely</label>
        <button class="btn danger" id="bk-free">Free up space</button>
      </div>
    </div>
    ${busyText ? `<div class="card pad mt" style="background:#fff4e2;padding:12px 16px"><span class="spin" style="display:inline-block;vertical-align:middle;margin-right:8px"></span>${esc(busyText)}</div>` : ''}`;
    wire();
  }

  const setBusy = (t) => { busyText = t; const b = el.querySelector('.card.pad.mt:last-child'); if (b) b.lastChild.textContent = t; else draw(); };
  const run = (fn) => async () => {
    if (busyText) { toast('Please wait for the current task to finish'); return; }
    try { await fn(); } catch (e) { if (e.code) console.error(e); toast(friendlyError(e), true); }
    busyText = ''; draw();
  };

  function wire() {
    el.querySelector('#bk-calc').onclick = run(async () => { est = await estimate(setBusy); try { localStorage.setItem(LS_KEY, JSON.stringify(est)); } catch { /* ignore */ } toast('Size calculated'); });
    el.querySelector('#bk-xlsx').onclick = run(() => excelBackup(setBusy));
    el.querySelector('#bk-photos').onclick = run(() => {
      const kinds = [...el.querySelectorAll('[data-ph]:checked')].map((x) => x.dataset.ph);
      if (!kinds.length) throw new Error('Choose at least one kind of photo.');
      return photosBackup(el.querySelector('#ph-from').value || '2000-01-01', el.querySelector('#ph-to').value || dateKey(new Date()), kinds, setBusy);
    });
    el.querySelector('#bk-json').onclick = run(() => jsonBackup(el.querySelector('#js-gps').checked, setBusy));
    el.querySelector('#bk-free').onclick = run(async () => {
      const cut = el.querySelector('#fr-cut').value;
      const kinds = [...el.querySelectorAll('[data-fr]:checked')].map((x) => x.dataset.fr);
      if (!cut || !kinds.length) throw new Error('Choose a date and what to remove.');
      if (!el.querySelector('#fr-ok').checked) throw new Error('Tick “I have downloaded the backup” first.');
      if (!await confirmBox('Free up space', `Remove ${kinds.length} kind(s) of photos / GPS data dated before ${cut} from the database? This cannot be undone — only your downloaded backup will have them.`, { ok: 'Remove', danger: true })) return;
      const r = await freeSpace(cut, kinds, setBusy);
      toast(`Done — ${r.photos} photos and ${r.points} GPS points removed (about ${mb(r.bytes)})`);
      est = null; try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    });
  }

  draw();
  return () => {};
}

// ------------------------------------------------------------------ size estimate
async function sampleAvg(q) {
  const snap = await getDocs(query(q, limit(20)));
  if (!snap.size) return 0;
  return snap.docs.reduce((a, d) => a + docBytes(d.data()), 0) / snap.size;
}
async function estimate(progress) {
  const rows = [];
  let total = 0, photos = 0, docs = 0;
  const add = (label, count, bytes, photo = false) => { rows.push({ label, count, bytes: Math.round(bytes), photo }); total += bytes; docs += count; if (photo) photos += bytes; };
  for (const a of AREAS) {
    progress(`Measuring ${a.label}…`);
    if (a.key === '_track') {
      let n = 0, avg = 0;
      for (const u of store.users) {
        const c = collection(db, 'users', u.id, 'track');
        const k = (await getCountFromServer(c)).data().count;
        if (k && !avg) avg = await sampleAvg(c);
        n += k;
      }
      add(a.label, n, n * (avg || 180));
    } else if (a.key === '_points') {
      const t = await getDocs(C('trips'));
      const n = t.docs.reduce((s, d) => s + (Number(d.data().pointsCount) || 0), 0);
      add(a.label, n, n * 120);
    } else if (a.key === 'idFiles') {
      const s = await getDocs(C('idFiles'));
      const bytes = s.docs.reduce((x, d) => x + (Number(d.data().size) || 0) * 1.34 + 400, 0);
      add(a.label, s.size, bytes, true);
    } else {
      const c = C(a.key);
      const n = (await getCountFromServer(c)).data().count;
      const avg = n ? await sampleAvg(c) : 0;
      add(a.label, n, n * avg, !!a.photo);
    }
  }
  progress('Measuring everything else…');
  let on = 0, ob = 0;
  for (const k of OTHER) {
    try {
      const n = (await getCountFromServer(C(k))).data().count;
      on += n; ob += n ? n * (await sampleAvg(C(k))) : 0;
    } catch { /* collection not readable / not present */ }
  }
  add('Other (staff, sites, settings, numbering…)', on, ob);
  rows.sort((a, b) => b.bytes - a.bytes);
  return { at: Date.now(), total: Math.round(total), photos: Math.round(photos), docs, rows };
}

// ------------------------------------------------------------------ helpers
const safe = (s) => String(s || '').replace(/[^a-z0-9\-_. ]+/gi, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'x';
const extOf = (mime) => (mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg');
function b64(data) { // accepts "data:...;base64,XXXX" or raw base64
  const s = String(data || '');
  const i = s.indexOf('base64,');
  return { base64: i >= 0 ? s.slice(i + 7) : s, mime: s.startsWith('data:') ? s.slice(5, s.indexOf(';')) : 'image/jpeg' };
}
async function allDocs(name, ...cons) {
  // Filtered reads in one go; whole collections in pages of 500 (keeps memory and timeouts in check).
  if (cons.length) return (await getDocs(query(C(name), ...cons))).docs;
  const out = [];
  let last = null;
  for (;;) {
    const q = last ? query(C(name), orderBy('__name__'), startAfter(last), limit(500)) : query(C(name), orderBy('__name__'), limit(500));
    const s = await getDocs(q);
    out.push(...s.docs);
    if (s.size < 500) return out;
    last = s.docs[s.docs.length - 1];
  }
}
async function zipAndSave(zip, name, progress) {
  progress('Compressing the ZIP…');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } }, (m) => progress(`Compressing the ZIP… ${Math.round(m.percent)}%`));
  saveBlob(blob, name);
}

// ------------------------------------------------------------------ photos ZIP
async function photosBackup(from, to, kinds, progress) {
  if (!window.JSZip) throw new Error('ZIP library not loaded — reload the page.');
  const zip = new window.JSZip();
  const index = [['Folder / file', 'Date', 'Type', 'Details']];
  let n = 0;
  const inRange = (d) => d && d >= from && d <= to;
  if (kinds.includes('site')) {
    progress('Collecting site update photos…');
    for (const d of await allDocs('siteUpdates', where('date', '>=', from), where('date', '<=', to))) {
      const u = d.data();
      (u.photos || []).forEach((p, i) => {
        const f = b64(p);
        const name = `site-updates/${u.date}_${safe(u.siteName)}_${safe(u.employeeName)}_${d.id.slice(0, 5)}_${i + 1}.${extOf(f.mime)}`;
        zip.file(name, f.base64, { base64: true }); n++;
        index.push([name, u.date, 'Site update', `${u.siteName} · ${u.employeeName} · ${u.category || ''} · ${u.note || ''}`]);
      });
      if (n % 50 === 0) progress(`Site update photos… ${n}`);
    }
  }
  if (kinds.includes('petty')) {
    progress('Collecting petty cash receipts…');
    for (const d of await allDocs('petty', where('date', '>=', from), where('date', '<=', to))) {
      const t = d.data();
      if (!t.receipt) continue;
      const f = b64(t.receipt);
      const name = `petty-receipts/${t.date}_${safe(t.employeeName)}_${safe(t.category || t.type)}_AED${t.amount}_${d.id.slice(0, 5)}.${extOf(f.mime)}`;
      zip.file(name, f.base64, { base64: true }); n++;
      index.push([name, t.date, 'Petty cash', `${t.employeeName} · ${t.category || t.type} · AED ${t.amount} · ${t.note || ''}`]);
    }
  }
  if (kinds.includes('acct')) {
    progress('Collecting accounts receipts…');
    for (const d of await allDocs('acctEntries', where('date', '>=', from), where('date', '<=', to))) {
      const e = mapAcct(d);
      if (!e.hasFile) continue;
      const f = (await getDoc(doc(db, 'acctFiles', e.id))).data();
      if (!f) continue;
      const name = `accounts-receipts/${e.date}_${e.type}_${safe(e.category)}_${safe(e.party)}_AED${e.amount}_${e.id.slice(0, 5)}.${extOf(f.mime)}`;
      zip.file(name, b64(f.base64).base64, { base64: true }); n++;
      index.push([name, e.date, e.type === 'income' ? 'Income' : 'Expense', `${e.category} · ${e.party} · AED ${e.amount} · ${e.method} ${e.reference}`]);
      if (n % 20 === 0) progress(`Accounts receipts… ${n}`);
    }
  }
  if (kinds.includes('id')) {
    progress('Collecting ID document copies…');
    for (const d of await allDocs('idFiles')) {
      const m = d.data();
      if (m.pending) continue;
      const up = m.uploadedAt?.toDate?.();
      if (up && !inRange(dateKey(up))) continue;
      const chunks = await getDocs(collection(db, 'idFiles', d.id, 'chunks'));
      const data = chunks.docs.map((c) => [Number(c.id), c.data().d || '']).sort((a, b) => a[0] - b[0]).map((x) => x[1]).join('');
      const name = `id-documents/${safe(m.ownerName || m.ownerId)}/${safe(m.kind)}_${safe((m.name || 'file').replace(/\.[^.]+$/, ''))}.${extOf(m.mime)}`;
      zip.file(name, data, { base64: true }); n++;
      index.push([name, up ? dateKey(up) : '', 'ID document', `${m.ownerName || ''} · ${m.kind}`]);
      if (n % 20 === 0) progress(`ID documents… ${n}`);
    }
  }
  if (kinds.includes('inv')) {
    progress('Collecting invoicing photos…');
    for (const d of await allDocs('inv_images')) {
      const m = d.data();
      const day = String(m.createdAt || '').slice(0, 10);
      if (day && !inRange(day)) continue;
      const f = b64(m.data);
      const mime = m.mime || f.mime;
      const name = `invoicing/${day || 'undated'}_${safe((m.name || d.id).replace(/\.[^.]+$/, ''))}_${d.id.slice(0, 5)}.${extOf(mime)}`;
      zip.file(name, f.base64, { base64: true }); n++;
      index.push([name, day, 'Invoicing', m.name || '']);
    }
  }
  if (!n) throw new Error('No photos found for this period.');
  zip.file('index.csv', index.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'));
  await zipAndSave(zip, `llct-photos-${from === '2000-01-01' ? 'all' : from}-to-${to}.zip`, progress);
  toast(`${n} photos saved`);
}

// ------------------------------------------------------------------ transactions Excel
async function excelBackup(progress) {
  if (!window.XLSX) throw new Error('Excel library not loaded — reload the page.');
  const X = window.XLSX;
  const wb = X.utils.book_new();
  const sheet = (name, header, rows) => X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([header, ...rows]), name.slice(0, 31));
  const today = dateKey(new Date());
  progress('Accounts…');
  const acct = (await allDocs('acctEntries')).map(mapAcct);
  const auto = await autoAcctLines('2000-01-01', today);
  const ledger = [...acct, ...auto].sort((a, b) => a.date.localeCompare(b.date));
  let bal = 0;
  sheet('Accounts', ['Date', 'Type', 'Category', 'Party', 'Method', 'Cheque / ref', 'Bank', 'Site', 'Note', 'Source', 'Income', 'Expense', 'Running balance'],
    ledger.map((e) => { bal += e.type === 'income' ? e.amount : -e.amount; return [e.date, e.type, e.category, e.party, e.method, e.reference, e.bank || '', e.siteName, e.note, e.source, e.type === 'income' ? e.amount : '', e.type === 'expense' ? e.amount : '', Math.round(bal * 100) / 100]; }));
  progress('Petty cash…');
  sheet('Petty cash', ['Date', 'Employee', 'Type', 'Category', 'Amount', 'Status', 'Site', 'Note', 'By', 'Receipt photo'],
    (await allDocs('petty')).map(mapPetty).sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => [t.date, t.employeeName, t.type === 'credit' ? 'Cash given' : 'Expense', t.category, t.amount, t.status, t.siteName, t.note, t.createdByName, t.receipt ? 'yes' : '']));
  progress('Driver payments…');
  sheet('Driver payments', ['Date', 'Driver', 'Amount', 'Method', 'Note', 'By'],
    (await allDocs('driverPayments')).map((d) => d.data()).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .map((p) => [p.date, p.employeeName, p.amount, p.method, p.note, p.createdBy]));
  progress('Trips & rides…');
  sheet('Trips & rides', ['Date', 'Person', 'Type', 'Driver / taxi', 'From', 'To', 'Charged site', 'Km', 'Cost', 'Status'],
    (await allDocs('trips')).map(mapTrip).sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => [t.date, t.employeeName, tripKindLabel(t), t.kind === 'withDriver' ? t.driverName : t.vehicle, t.startSiteName, t.endSiteName, t.siteName, Math.round(t.distanceM / 10) / 100, tripCost(t), t.status]));
  progress('Attendance…');
  sheet('Attendance', ['Date', 'Employee', 'Site', 'Check-in', 'Check-out', 'Hours', 'Flags'],
    (await allDocs('attendance')).map(mapSession).sort((a, b) => (a.checkIn || 0) - (b.checkIn || 0))
      .map((s) => [s.date, s.employeeName, s.siteName, s.inLocal ? s.inLocal.toLocaleString() : '', s.outLocal ? s.outLocal.toLocaleString() : 'OPEN',
        s.checkOut ? Math.round(((s.checkOut - s.checkIn) / 3600000) * 100) / 100 : '', [s.inOutside && 'in outside', s.outOutside && 'out outside', s.mocked && 'fake GPS', s.violationMark && 'violation mark'].filter(Boolean).join(', ')]));
  progress('External workers…');
  sheet('External workers', ['Date', 'Worker', 'Site', 'With', 'In', 'Out'],
    (await allDocs('workerAttendance')).map(mapWorkerEntry).sort((a, b) => (a.checkIn || 0) - (b.checkIn || 0))
      .map((e) => [e.date, e.workerName, e.siteName, e.employeeName, e.inLocal ? e.inLocal.toLocaleString() : '', e.checkOut ? (e.outLocal || e.checkOut).toLocaleString() : 'ON SITE']));
  sheet('Staff', ['Name', 'Login ID', 'Role', 'Mobile', 'Email', 'Designation', 'Driver', 'Active'],
    store.users.map((u) => [u.name, u.loginId, u.role, u.phone, u.contactEmail, u.designation, u.isDriver ? 'yes' : '', u.active ? 'yes' : 'no']));
  sheet('Sites', ['Name', 'Address', 'Status', 'Progress %', 'Lat', 'Lng', 'Radius m'],
    store.sites.map((s) => [s.name, s.address, s.status, s.progress, s.lat, s.lng, s.radius]));
  progress('Saving…');
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  saveBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `llct-transactions-backup-${today}.xlsx`);
  toast('Excel backup saved');
}

// ------------------------------------------------------------------ full data JSON
const PHOTO_FIELDS = { siteUpdates: ['photos'], petty: ['receipt'], acctFiles: ['base64'], inv_images: ['data'] };
function plain(v) {
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}
async function jsonBackup(withGps, progress) {
  if (!window.JSZip) throw new Error('ZIP library not loaded — reload the page.');
  const zip = new window.JSZip();
  const summary = {};
  for (const name of ALL_COLLECTIONS) {
    progress(`Reading ${name}…`);
    let docsList;
    try { docsList = await allDocs(name); } catch (e) { summary[name] = `not readable: ${e.code || e.message}`; continue; }
    const strip = PHOTO_FIELDS[name] || [];
    const rows = docsList.map((d) => {
      const data = plain(d.data());
      for (const f of strip) if (data[f]) data[f] = Array.isArray(data[f]) ? `[${data[f].length} photo(s) — see photos ZIP]` : '[photo — see photos ZIP]';
      return { id: d.id, ...data };
    });
    summary[name] = rows.length;
    zip.file(`data/${name}.json`, JSON.stringify(rows, null, 1));
  }
  if (withGps) {
    const track = [];
    for (const u of store.users) {
      progress(`GPS trail: ${u.name}…`);
      const s = await getDocs(collection(db, 'users', u.id, 'track'));
      s.docs.forEach((d) => track.push({ userId: u.id, name: u.name, id: d.id, ...plain(d.data()) }));
    }
    zip.file('data/gps-trails.json', JSON.stringify(track));
    summary['gps-trails'] = track.length;
    const pts = [];
    const trips = await allDocs('trips');
    for (const [i, t] of trips.entries()) {
      if (i % 20 === 0) progress(`Trip routes… ${i}/${trips.length}`);
      const s = await getDocs(collection(db, 'trips', t.id, 'points'));
      s.docs.forEach((d) => pts.push({ tripId: t.id, id: d.id, ...plain(d.data()) }));
    }
    zip.file('data/trip-routes.json', JSON.stringify(pts));
    summary['trip-routes'] = pts.length;
  }
  zip.file('README.txt', `LLCT data backup — ${new Date().toISOString()}\nEach file in data/ is one Firestore collection (attendance + invoicing).\nPhotos are not included here — use the photos ZIP.\n\nRecords per collection:\n${Object.entries(summary).map(([k, v]) => `${k}: ${v}`).join('\n')}\n`);
  await zipAndSave(zip, `llct-data-backup-${dateKey(new Date())}.zip`, progress);
  toast('Data backup saved');
}

// ------------------------------------------------------------------ free up space
async function commitAll(ops, progress, label) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach((fn) => fn(b));
    await b.commit();
    progress(`${label}… ${Math.min(ops.length, i + 400)}/${ops.length}`);
  }
}
async function freeSpace(cut, kinds, progress) {
  const stamp = { photoArchivedAt: dateKey(new Date()) };
  let photos = 0, points = 0, bytes = 0;
  if (kinds.includes('site')) {
    progress('Site update photos…');
    const ops = [];
    for (const d of await allDocs('siteUpdates', where('date', '<', cut))) {
      const ph = d.data().photos || [];
      if (!ph.length) continue;
      photos += ph.length; bytes += ph.reduce((a, p) => a + String(p).length, 0);
      ops.push((b) => b.update(d.ref, { photos: [], photosInBackup: ph.length, ...stamp }));
    }
    await commitAll(ops, progress, 'Site update photos');
  }
  if (kinds.includes('petty')) {
    progress('Petty cash receipts…');
    const ops = [];
    for (const d of await allDocs('petty', where('date', '<', cut))) {
      const r = d.data().receipt;
      if (!r) continue;
      photos++; bytes += String(r).length;
      ops.push((b) => b.update(d.ref, { receipt: '', receiptInBackup: true, ...stamp }));
    }
    await commitAll(ops, progress, 'Petty cash receipts');
  }
  if (kinds.includes('acct')) {
    progress('Accounts receipts…');
    const ops = [];
    for (const d of await allDocs('acctEntries', where('date', '<', cut))) {
      if (d.data().hasFile !== true) continue;
      photos++; bytes += 200 * 1024;
      ops.push((b) => b.update(d.ref, { hasFile: false, fileInBackup: d.data().fileName || 'receipt', ...stamp }));
      ops.push((b) => b.delete(doc(db, 'acctFiles', d.id)));
    }
    await commitAll(ops, progress, 'Accounts receipts');
  }
  if (kinds.includes('track')) {
    for (const u of store.users) {
      progress(`GPS trail: ${u.name}…`);
      const s = await getDocs(query(collection(db, 'users', u.id, 'track'), where('date', '<', cut)));
      points += s.size; bytes += s.size * 180;
      await commitAll(s.docs.map((d) => (b) => b.delete(d.ref)), progress, `GPS trail: ${u.name}`);
    }
  }
  if (kinds.includes('points')) {
    const trips = await allDocs('trips', where('date', '<', cut));
    for (const [i, t] of trips.entries()) {
      progress(`Trip routes… ${i + 1}/${trips.length}`);
      const s = await getDocs(collection(db, 'trips', t.id, 'points'));
      if (!s.size) continue;
      points += s.size; bytes += s.size * 120;
      await commitAll(s.docs.map((d) => (b) => b.delete(d.ref)), progress, 'Trip routes');
    }
  }
  return { photos, points, bytes };
}
