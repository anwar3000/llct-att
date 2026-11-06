// LLCT Service Desk — client portal. Each client gets a private link: index.html?c=<token>
// Installable as a phone app (the link is remembered on this device).
import {
  db, doc, getDoc, collection, onSnapshot, query, orderBy, limit, writeBatch, serverTimestamp, Timestamp,
  SERVICE_TYPES, activeTypes, loadTypes, PRIORITIES, SLOTS, typeLabel, typesText, prio, st, slotLabel, clientMessage, publicView, prefText, faultLabel, amcStatus, RESULT_COLOR, DEVICE_LISTS, listOfOther, DOC_TYPES, docTypeOf, expiryStatus, uploadDocFile, openDocFile, deleteDocFile, fmtSize, groupDocs, newGroupId, DOC_MAX, COMPANY, icon, randToken,
  $, $$, esc, fmtDate, fmtDT, ago, dateKey, hasGPS, newTicketNo, compressImage, toast, friendly, toDate,
} from './sd.js?v=28';

window.__sdStarted = true;

const app = $('#app');
const TK = 'llct-sd-token';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };
const QS = new URLSearchParams(location.search);
const urlToken = QS.get('c') || (location.hash.match(/c=([\w-]+)/) || [])[1] || '';
const trackId = QS.get('t') || '';
// 'link': a client's private link · 'walkin': public support page (any customer) · 'track': one walk-in request
// Without a link the page is the walk-in form; the installed app (?app=1) reopens this phone's client page.
const MODE = urlToken ? 'link' : trackId ? 'track' : (QS.get('app') === '1' && lsGet(TK) ? 'link' : 'walkin');
const token = MODE === 'link' ? (urlToken || lsGet(TK) || '') : '';
const WK = 'llct-sd-walkins'; // this device's walk-in requests (tracking ids)
const myWalkins = () => { try { return JSON.parse(lsGet(WK) || '[]'); } catch (_) { return []; } };
const addWalkin = (pid, number) => { const l = myWalkins().filter((x) => x.pid !== pid); l.unshift({ pid, number }); lsSet(WK, JSON.stringify(l.slice(0, 20))); };
const S = { portal: null, tickets: [], docs: [], tab: 'new', form: freshForm(), photos: [], open: null, sent: null, busy: false, shots: {}, shotSub: null };
const LS = 'llct-sd-contact';
const STEPS = ['new', 'assigned', 'accepted', 'on_way', 'on_site', 'completed'];
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return dateKey(d); };

function freshForm() {
  let c = {};
  try { c = JSON.parse(lsGet(LS) || '{}'); } catch (_) { /* ignore */ }
  return { brand: c.brand || '', store: c.store || '', area: c.area || '', siteId: '', otherName: '', otherAddress: '', gps: null, cats: [], eq: [], priority: 'normal', preferredDate: dateKey(), preferredSlot: 'asap', description: '', cameras: 0, contactName: c.name || '', contactPhone: c.phone || '', contactEmail: c.email || '' };
}

function fail(title, msg) {
  $('#p-client').textContent = title;
  $('#p-sub').textContent = msg;
  app.innerHTML = `<div class="card pad"><p style="margin:0">For help, call <a href="tel:048805577"><b>${COMPANY.phone}</b></a> or email <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>.</p></div>`;
}

async function start() {
  if (MODE !== 'link') return startPublic();
  if (!token) return fail('Open your service link', 'Please open the full service request link you received from Leaders Line.');
  try {
    const s = await getDoc(doc(db, 'svcPortals', token));
    if (!s.exists() || s.data().active !== true) return fail('This link is not active', 'Please contact Leaders Line for a new service request link.');
    S.portal = { id: s.id, ...s.data() };
  } catch (e) {
    console.warn(e);
    return fail('This link is not active', 'Please contact Leaders Line for a new service request link.');
  }
  lsSet(TK, token); // the installed app opens this client's page next time
  if (!urlToken) history.replaceState(null, '', `?c=${token}`);
  $('#p-client').textContent = S.portal.clientName || 'Service request';
  document.title = `Service request – ${S.portal.clientName || 'Leaders Line'}`;
  const amc = amcStatus(S.portal.amc);
  if (amc.text) $('#p-client').insertAdjacentHTML('afterend', `<div class="amcb ${amc.tone}">${esc(amc.text)}${S.portal.amc.no ? ` · Contract ${esc(S.portal.amc.no)}` : ''}</div>`);
  const sites = S.portal.sites || [];
  if (sites.length === 1) S.form.siteId = sites[0].id;
  loadSitePhotos(sites);
  if (!S.form.contactName && S.portal.contact) S.form.contactName = S.portal.contact;
  if (!S.form.contactPhone && S.portal.phone) S.form.contactPhone = S.portal.phone;
  onSnapshot(collection(db, 'svcPortals', token, 'docs'), (q) => {
    S.docs = q.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.complete !== false || d.by === 'client')
      .sort((a, b) => DOC_TYPES.findIndex((x) => x.k === a.type) - DOC_TYPES.findIndex((x) => x.k === b.type) || String(a.number).localeCompare(String(b.number)));
    if (S.tab === 'docs' && !S.docBusy) render(); else renderTabs();
  }, (e) => console.warn('docs', e));
  onSnapshot(query(collection(db, 'svcPortals', token, 'tickets'), orderBy('createdAt', 'desc'), limit(200)), (q) => {
    S.tickets = q.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (S.tab === 'list' && !S.sent) render(); else renderTabs();
  }, (e) => console.warn('tickets', e));
  render();
}

// Building photos the office added for each site (copied onto this link by the Service Desk).
function loadSitePhotos(sites) {
  S.photos = S.photos || {};
  sites.forEach((x) => getDoc(doc(db, 'svcPortals', token, 'sitePhotos', x.id)).then((d) => {
    S.photos[x.id] = d.exists() && d.data().data ? d.data().data : null; applyPhotos();
  }, () => { S.photos[x.id] = null; }));
}
function applyPhotos() {
  $$('[data-sphoto]').forEach((e) => {
    const src = S.photos && S.photos[e.dataset.sphoto];
    if (src && !e.classList.contains('has')) { e.style.backgroundImage = `url("${src}")`; e.classList.add('has'); }
  });
}

// Walk-in customers: public form, and their requests followed through tracking ids saved on this device.
const pubSubs = new Map();
function startPublic() {
  S.portal = { clientName: '', sites: [], walkin: true };
  $('#p-client').textContent = MODE === 'track' ? 'Your service request' : 'Request a service visit';
  $('#p-sub').textContent = MODE === 'track' ? 'Follow your request here until the work is done.' : 'For CCTV, security and network faults or maintenance. Tell us where you are and what needs attention — our team will call you to confirm.';
  document.title = 'Service request – Leaders Line';
  if (trackId) { addWalkin(trackId, ''); S.tab = 'list'; S.open = trackId; }
  if (lsGet(TK)) S.companyLink = `?c=${lsGet(TK)}`;
  const watch = () => {
    myWalkins().forEach(({ pid }) => {
      if (pubSubs.has(pid)) return;
      pubSubs.set(pid, onSnapshot(doc(db, 'svcPublic', pid), (d) => {
        S.tickets = S.tickets.filter((x) => x._pid !== pid);
        if (d.exists()) S.tickets.push({ id: pid, _pid: pid, ...d.data() });
        S.tickets.sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
        if (S.tab === 'list' && !S.sent) render(); else renderTabs();
      }, () => {}));
    });
  };
  S.watchPublic = watch;
  watch();
  if (S.open) watchShots(S.open);
  render();
}

const openCount = () => S.tickets.filter((t) => !['completed', 'closed', 'cancelled'].includes(t.status)).length;
function tabsHtml() {
  return `<div class="tabs" id="tabs" role="tablist"><button role="tab" data-tab="new" class="${S.tab === 'new' ? 'on' : ''}">New request</button>
    <button role="tab" data-tab="list" class="${S.tab === 'list' ? 'on' : ''}">My requests${S.tickets.length ? `<span class="n">${openCount() || S.tickets.length}</span>` : ''}</button>${S.portal && !S.portal.walkin ? `<button role="tab" data-tab="docs" class="${S.tab === 'docs' ? 'on' : ''}">Documents${docAlerts() ? `<span class="n" style="background:var(--trim)">${docAlerts()}</span>` : S.docs.length ? `<span class="n" style="background:var(--steel)">${groupDocs(S.docs).length}</span>` : ''}</button>` : ''}</div>`;
}
function renderTabs() { const t = $('#tabs'); if (t) { t.outerHTML = tabsHtml(); bindTabs(); } }
function bindTabs() { $$('[data-tab]').forEach((b) => (b.onclick = () => { readForm(); S.tab = b.dataset.tab; S.sent = null; render(); window.scrollTo(0, 0); })); }

function render() {
  if (!S.portal) return;
  const body = S.sent ? sentHtml() : S.tab === 'list' ? listHtml() : S.tab === 'docs' ? docsHtml() : formHtml();
  app.innerHTML = (S.companyLink && S.portal.walkin ? `<div class="card pad small" style="margin-bottom:14px">Your company has its own service page. <a href="${S.companyLink}"><b>Open my company page</b></a></div>` : '') + tabsHtml() + body + footHtml();
  bindTabs();
  bindInstall();
  if (S.sent) {
    $('#again').onclick = () => { S.sent = null; S.tab = 'new'; render(); };
    $('#see').onclick = () => { S.open = S.sent._pid || S.sent.id; S.sent = null; S.tab = 'list'; watchShots(S.open); render(); };
    const tc = $('#trk-c'); if (tc) tc.onclick = () => { const i = $('#trk'); (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(() => toast('Link copied'), () => { i.select(); document.execCommand('copy'); toast('Link copied'); }); };
  }
  else if (S.tab === 'list') bindList();
  else if (S.tab === 'docs') bindDocs();
  else bindForm();
}

function footHtml() {
  return `<div class="foot"><div id="inst" class="hidden"><button class="btn sm" id="inst-b" type="button">Add to home screen</button><div class="small muted" id="inst-t"></div></div>
    <p><img src="img/shield-256.png" alt="">${esc(COMPANY.name)}, Airport Road, Dubai. Call <a href="tel:048805577">${COMPANY.phone}</a> or email <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>.</p></div>`;
}

// ------------------------------------------------------------------ documents
const docBase = () => ['svcPortals', token, 'docs'];
const docAlerts = () => groupDocs(S.docs).filter((g) => ['bad', 'warn'].includes(expiryStatus(g.head.expiry).tone)).length;
const fileIcon = (d) => (/pdf/i.test(d.mime) ? 'PDF' : /image/i.test(d.mime) ? 'IMG' : 'FILE');
function docsHtml() {
  const f = S.docForm || (S.docForm = { type: 'tl', number: '', expiry: '', siteId: '', notes: '' });
  const files = S.docFiles || (S.docFiles = []);
  const groups = groupDocs(S.docs);
  const into = S.docAddTo ? groups.find((g) => g.key === S.docAddTo) : null; // adding pages to an existing document
  const ty = docTypeOf(into ? into.head.type : f.type); const sites = S.portal.sites || [];
  const total = files.reduce((n, x) => n + x.size, 0);
  return `<div class="sheet docsheet">
    <div class="dochead"><div><h2>Your documents</h2><p class="small muted">Trade licence, SIRA certificate and NOC, approved drawings and other papers for your sites. A document can have several files — e.g. every page of a drawing. Our team is reminded before anything expires.</p></div>
      <button type="button" class="btn primary" id="dn-open">${S.docAdd ? 'Close' : '+ Upload document'}</button></div>
    ${S.docAdd ? `<div class="docform">
      ${into ? `<div class="intohead">Adding files to <b>${esc(ty.t)}</b>${into.head.number ? ` · ${esc(into.head.number)}` : ''} <span class="muted">(${into.docs.length} file${into.docs.length === 1 ? '' : 's'} already)</span></div>` : `<div class="docgrid">
        <label class="field"><span>Document type <b>*</b></span><select id="dn-type">${DOC_TYPES.map((x) => `<option value="${x.k}" ${x.k === f.type ? 'selected' : ''}>${esc(x.t)}</option>`).join('')}</select></label>
        <label class="field"><span>${esc(ty.num)}</span><input id="dn-num" value="${esc(f.number)}" placeholder="e.g. ${f.type === 'tl' ? '123456' : 'ABC-2026-001'}"></label>
        <label class="field"><span>Expiry date${ty.exp ? '' : ' (if any)'}</span><input type="date" id="dn-exp" value="${esc(f.expiry)}"></label>
        ${sites.length > 1 ? `<label class="field"><span>For site</span><select id="dn-site"><option value="">All sites</option>${sites.map((x) => `<option value="${esc(x.id)}" ${x.id === f.siteId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
      </div>
      <label class="field" style="margin-top:10px"><span>Notes (optional)</span><input id="dn-notes" value="${esc(f.notes)}" placeholder="e.g. Renewed, issued by Dubai Economy"></label>`}
      <div class="docfile"><label class="btn"><span>${files.length ? '+ Add more files' : 'Choose files (PDF or photos)'}</span><input type="file" id="dn-file" hidden multiple accept="application/pdf,image/*,.dwg,.dxf,.doc,.docx,.xls,.xlsx"></label>
        <span class="small muted">${files.length ? `${files.length} file${files.length === 1 ? '' : 's'} · ${fmtSize(total)}` : 'Select several at once for multi-page documents. Up to 8 MB each, 20 files.'}</span></div>
      ${files.length ? `<div class="flist2">${files.map((x, k) => `<div class="frow"><span class="fpg">${k + 1}</span><span class="fnm">${esc(x.name)}</span><span class="small muted">${fmtSize(x.size)}</span>${x.size > DOC_MAX && !/^image\//.test(x.type) ? '<span class="xp bad small">too big</span>' : ''}
          <button type="button" data-fup="${k}" ${k === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button type="button" data-frm="${k}" aria-label="Remove">✕</button></div>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:12px;justify-content:flex-end"><span class="small muted grow" id="dn-prog"></span><button type="button" class="btn primary" id="dn-save" ${S.docBusy || !files.length ? 'disabled' : ''}>${S.docBusy ? 'Uploading…' : `Upload${files.length > 1 ? ` ${files.length} files` : ''}`}</button></div>
    </div>` : ''}
    ${groups.length ? `<div class="doclist">${groups.map((g) => {
      const d = g.head, x = expiryStatus(d.expiry); const site = sites.find((s2) => s2.id === d.siteId); const n = g.docs.length;
      return `<div class="docrow ${x.tone}"><div class="dic">${n > 1 ? `${n}<small>files</small>` : fileIcon(d)}</div>
        <div class="dtx"><b>${esc(docTypeOf(d.type).t)}</b>${d.number ? ` <span class="muted">· ${esc(d.number)}</span>` : ''}
          <div class="small">${x.text ? `<span class="xp ${x.tone}">${esc(x.text)}</span>` : '<span class="muted">No expiry</span>'}${site ? ` · ${esc(site.name)}` : ''}${g.verified ? ' · <span style="color:var(--success);font-weight:650">✓ Checked by Leaders Line</span>' : ''}</div>
          <div class="fchips">${g.docs.map((dd, k) => dd.complete === false ? `<span class="fchip off">${n > 1 ? 'Page ' + (dd.page || k + 1) : esc(dd.name)} · uploading…</span>` : `<button type="button" class="fchip" data-dv="${esc(dd.id)}" title="${esc(dd.name || '')}">${fileIcon(dd)} ${n > 1 ? `Page ${dd.page || k + 1}` : esc(dd.name || 'View')}</button>`).join('')}
            <span class="small muted">${fmtSize(g.size)}</span></div></div>
        <div class="dact"><button type="button" class="btn sm" data-dadd="${esc(g.key)}" title="Add more files to this document">+ Files</button>${!g.verified && d.by === 'client' ? `<button type="button" class="btn sm bad" data-dd="${esc(g.key)}" aria-label="Delete">✕</button>` : ''}</div></div>`;
    }).join('')}</div>` : `<p class="muted" style="padding:18px 4px">No documents yet. Upload your trade licence first — it takes a minute.</p>`}
  </div>`;
}
function bindDocs() {
  const f = S.docForm; S.docFiles = S.docFiles || [];
  const keep = () => { if (!$('#dn-type')) return; f.type = $('#dn-type').value; f.number = $('#dn-num').value.trim(); f.expiry = $('#dn-exp').value; f.notes = $('#dn-notes').value.trim(); f.siteId = $('#dn-site') ? $('#dn-site').value : ''; };
  $('#dn-open').onclick = () => { keep(); S.docAdd = !S.docAdd; S.docAddTo = null; if (!S.docAdd) S.docFiles = []; render(); };
  if ($('#dn-type')) $('#dn-type').onchange = () => { keep(); render(); };
  const fi = $('#dn-file'); if (fi) fi.onchange = () => { keep(); S.docFiles = [...S.docFiles, ...fi.files].slice(0, 20); render(); };
  $$('[data-frm]').forEach((b) => (b.onclick = () => { keep(); S.docFiles.splice(+b.dataset.frm, 1); render(); }));
  $$('[data-fup]').forEach((b) => (b.onclick = () => { keep(); const k = +b.dataset.fup; const l = S.docFiles; [l[k - 1], l[k]] = [l[k], l[k - 1]]; render(); }));
  $$('[data-dadd]').forEach((b) => (b.onclick = () => { S.docAdd = true; S.docAddTo = b.dataset.dadd; S.docFiles = []; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  const sv = $('#dn-save');
  if (sv) sv.onclick = async () => {
    keep();
    const files = S.docFiles; if (!files.length) return toast('Please choose the file(s)', true);
    const g = S.docAddTo ? groupDocs(S.docs).find((x) => x.key === S.docAddTo) : null;
    if (!g && docTypeOf(f.type).exp && f.type !== 'other' && !f.expiry) { if (!confirm('No expiry date entered. Upload anyway?')) return; }
    const h = g ? g.head : null;
    const meta = h ? { type: h.type, typeLabel: h.typeLabel || docTypeOf(h.type).t, number: h.number || '', expiry: h.expiry || '', siteId: h.siteId || '', notes: h.notes || '' }
      : { type: f.type, typeLabel: docTypeOf(f.type).t, number: f.number, expiry: f.expiry, siteId: f.siteId, notes: f.notes };
    const group = g ? g.key : newGroupId();
    const start = g ? Math.max(...g.docs.map((d) => d.page || 1)) : 0;
    S.docBusy = true; render();
    let done = 0;
    try {
      for (let k = 0; k < files.length; k++) {
        await uploadDocFile(docBase(), { ...meta, group, page: start + k + 1, by: 'client', byName: S.form.contactName || '', clientId: S.portal.clientId || '' }, files[k],
          (p) => { const e = $('#dn-prog'); if (e) e.textContent = `Uploading file ${k + 1} of ${files.length}… ${Math.round(p * 100)}%`; });
        done++;
      }
      S.docFiles = []; S.docAdd = false; S.docAddTo = null; S.docForm = null; toast(files.length > 1 ? `${files.length} files uploaded — thank you` : 'Document uploaded — thank you');
    } catch (e) { S.docFiles = S.docFiles.slice(done); toast(`${done ? done + ' uploaded; ' : ''}${friendly(e)}`, true); }
    S.docBusy = false; render();
  };
  $$('[data-dv]').forEach((b) => (b.onclick = () => { const d = S.docs.find((x) => x.id === b.dataset.dv); if (d) openDocFile(docBase(), d).catch((e) => toast(friendly(e), true)); }));
  $$('[data-dd]').forEach((b) => (b.onclick = async () => {
    const g = groupDocs(S.docs).find((x) => x.key === b.dataset.dd); if (!g) return;
    if (!confirm(`Delete ${docTypeOf(g.head.type).t}${g.head.number ? ' ' + g.head.number : ''}${g.docs.length > 1 ? ` (all ${g.docs.length} files)` : ''}?`)) return;
    try { for (const d of g.docs) await deleteDocFile(docBase(), d); toast('Deleted'); } catch (e) { toast(friendly(e), true); }
  }));
}

// ------------------------------------------------------------------ install as an app
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; bindInstall(); });
function bindInstall() {
  const box = $('#inst'); if (!box) return;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (deferredPrompt) {
    box.classList.remove('hidden');
    $('#inst-b').onclick = async () => { deferredPrompt.prompt(); await deferredPrompt.userChoice.catch(() => {}); deferredPrompt = null; box.classList.add('hidden'); };
  } else if (ios) {
    box.classList.remove('hidden'); $('#inst-b').classList.add('hidden');
    $('#inst-t').textContent = 'To keep this page as an app: tap Share, then "Add to Home Screen".';
  }
}

// ------------------------------------------------------------------ form
/** Quick yes / no checks the client answers; the answers are added to the description. */
const QCHECKS = [
  { k: 'noise', t: 'Any abnormal noise?' },
  { k: 'wall', t: 'Any missing video on the video wall / display?' },
  { k: 'ups', t: 'Any sound (beeping) from the UPS?' },
];
function formHtml() {
  const f = S.form, sites = S.portal.sites || [];
  if (!S.portal.walkin && !f.siteId && sites.length) f.siteId = sites[0].id; // a site is always chosen
  const other = f.siteId === '_other';
  const addr1 = (x) => String(x.address || '').split('\n')[0];
  const gpsRow = (hint) => `<div class="row" style="margin-top:10px"><button type="button" class="btn sm" id="f-gps">${f.gps ? 'Update my location' : 'Use my current location'}</button><span class="small muted" id="f-gpst">${f.gps ? `Location captured (±${Math.round(f.gps.acc || 0)} m)` : hint}</span></div>`;
  const step1 = S.portal.walkin ? `<div class="step"><span class="sn">1</span><div class="sb"><h2>Your business</h2>
    <div class="grid2"><label class="field"><span>Brand or company name <b>*</b></span><input id="f-brand" autocomplete="organization" value="${esc(f.brand)}" placeholder="e.g. Al Noor Pharmacy"></label>
      <label class="field"><span>Store or location <b>*</b></span><input id="f-store" value="${esc(f.store)}" placeholder="e.g. Dubai Mall branch"></label></div>
    <label class="field" style="margin-top:12px"><span>Address or area</span><input id="f-area" autocomplete="street-address" value="${esc(f.area)}" placeholder="Building, street, area, emirate"></label>
    ${gpsRow('Helps the technician find you — only if you are at the store now.')}
  </div></div>` : '';

  // ---- site: compact rows, name left, address right
  let siteBody;
  if (other) {
    siteBody = `<div class="row" style="justify-content:space-between"><b>Another location</b>${sites.length ? `<button type="button" class="linkbtn" data-site="${esc(sites[0].id)}">Back to my site${sites.length > 1 ? 's' : ''}</button>` : ''}</div>
      <div class="stack" style="margin-top:10px"><label class="field"><span>Location name <b>*</b></span><input id="f-oname" value="${esc(f.otherName)}" placeholder="e.g. Warehouse 3, Al Quoz"></label>
      <label class="field"><span>Address or landmark</span><input id="f-oaddr" value="${esc(f.otherAddress)}" placeholder="Building, street, area"></label></div>${gpsRow('Only if you are at the site now.')}`;
  } else if (sites.length > 8) {
    siteBody = `<select id="f-site" aria-label="Site">${sites.map((x) => `<option value="${esc(x.id)}" ${x.id === f.siteId ? 'selected' : ''}>${esc(x.name)}${x.address ? ' — ' + esc(addr1(x)) : ''}</option>`).join('')}<option value="_other">Another location (not in the list)</option></select>`;
  } else {
    siteBody = `<div class="srows" role="radiogroup">${sites.map((x) => `<button type="button" class="srow ${x.id === f.siteId ? 'on' : ''}" data-site="${esc(x.id)}" role="radio" aria-checked="${x.id === f.siteId}">
        <span class="sth" data-sphoto="${esc(x.id)}"><span class="sini">${esc((x.name || '?').trim().charAt(0).toUpperCase())}</span></span><span class="stx"><span class="sname">${esc(x.name)}</span>${addr1(x) ? `<span class="saddr">${esc(addr1(x))}</span>` : ''}${hasGPS(x) ? '<span class="sgps">📍 Location on file</span>' : ''}</span><span class="srad" aria-hidden="true"></span></button>`).join('')}</div>`;
  }
  const siteStep = `<div class="step"><span class="sn">1</span><div class="sb"><div class="shead"><h2>Site</h2>${!other ? '<button type="button" class="linkbtn sm" data-site="_other">Different location?</button>' : ''}</div>${siteBody}</div></div>`;

  // ---- faulty devices: one dropdown, picked devices listed one per line
  const eqSite = !S.portal.walkin && f.siteId && S.portal.equipment ? S.portal.equipment[f.siteId] : null;
  const EQ = eqSite ? eqModel(eqSite) : null;
  const picked = EQ ? f.eq.map((id) => EQ.byId[id]).filter(Boolean) : [];
  const devHtml = EQ && EQ.count ? `<label class="field"><span>Faulty device${picked.length ? ` — <b>${picked.length} selected</b>` : ''}</span>
      <select id="f-eqi"><option value="">Select a device to add…</option>${EQ.groups.map((g) => {
        const left = g.items.filter((it) => !f.eq.includes(it.id));
        return left.length ? `<optgroup label="${esc(g.label)} (${g.items.length})">${left.map((it) => `<option value="${esc(it.id)}">${esc(it.name)}</option>`).join('')}</optgroup>` : '';
      }).join('')}</select></label>
      ${picked.length ? `<div class="devlist">${picked.map((x) => `<div class="devrow"><span class="dk">${esc(x.group)}</span><span class="dn">${esc(x.name)}</span><button type="button" data-eqrm="${esc(x.id)}" aria-label="Remove ${esc(x.name)}">✕</button></div>`).join('')}</div>` : ''}` : '';
  const types = clientTypes();
  const typeSel = `<label class="field"><span>Type of problem${EQ && EQ.count ? ' <span class="muted">(optional)</span>' : ' <b>*</b>'}</span><select id="f-type"><option value="">${EQ && EQ.count ? 'Same as the devices selected' : 'Choose…'}</option>${types.map((x) => `<option value="${esc(x.k)}" ${f.cats[0] === x.k ? 'selected' : ''}>${esc(x.t)}</option>`).join('')}</select></label>`;

  // ---- preferred visit: one row
  const when = f.preferredSlot === 'asap' ? 'asap' : f.preferredSlot === 'exact' ? 'pick' : f.preferredDate === tomorrow() ? 'tomorrow' : 'pick';
  const dtVal = `${f.preferredDate || tomorrow()}T${f.preferredTime || '10:00'}`;
  const now = new Date(); const minDt = `${dateKey()}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const pr = PRIORITIES.slice().reverse(); // Low → Critical
  return `<form id="f" novalidate><div class="sheet">
  ${step1}${S.portal.walkin ? '' : siteStep}

  <div class="step"><span class="sn">2</span><div class="sb"><h2>What is the problem?</h2>
    ${devHtml}
    <div class="gtight">${typeSel}</div>
    <label class="field" style="margin-top:12px"><span>Description of the work <b>*</b></span><textarea id="f-desc" rows="3" placeholder="e.g. No picture since yesterday evening.">${esc(f.description)}</textarea></label>
    <div class="qchecks"><div class="qct">Quick checks</div>${QCHECKS.map((q) => `<div class="qrow"><span>${esc(q.t)}</span><div class="seg mini" role="radiogroup" aria-label="${esc(q.t)}">${['Yes', 'No'].map((v) => `<button type="button" class="${(f.checks || {})[q.k] === v ? 'on' : ''}" data-qc="${q.k}" data-v="${v}">${v}</button>`).join('')}</div></div>`).join('')}</div>
    <div class="phhint"><b>Please attach a photo of the screen</b><span class="small muted"> — NVR / video wall / monitor showing the problem. Up to 3 photos.</span></div>
    <div class="photos sm" style="margin-top:8px">${S.photos.map((ph, k) => `<div class="ph"><img src="${ph}" alt=""><button type="button" data-rmph="${k}" aria-label="Remove photo">×</button></div>`).join('')}
      ${S.photos.length < 3 ? `<label class="addph">${icon('camera', 18)}<span>Add photo</span><input type="file" accept="image/*" id="f-ph" hidden multiple></label>` : ''}</div>
  </div></div>

  <div class="step"><span class="sn">3</span><div class="sb"><h2>Priority &amp; visit</h2>
    <div class="seg" role="radiogroup" aria-label="Priority">${pr.map((x) => `<button type="button" class="${f.priority === x.k ? 'on' : ''}" data-prio="${x.k}" role="radio" aria-checked="${f.priority === x.k}" style="--pc:${x.c}">${x.t}</button>`).join('')}</div>
    <p class="small muted" id="f-ph-hint" style="margin:6px 2px 0">${esc(prio(f.priority).s)}</p>
    <div class="seg" role="radiogroup" aria-label="Preferred visit" style="margin-top:14px">
      <button type="button" class="${when === 'asap' ? 'on' : ''}" data-day="asap">ASAP</button>
      <button type="button" class="${when === 'tomorrow' ? 'on' : ''}" data-day="tomorrow">Tomorrow</button>
      <button type="button" class="${when === 'pick' ? 'on' : ''}" data-day="pick">Date &amp; time</button>
    </div>
    ${when === 'pick' ? `<input type="datetime-local" id="f-dt" class="dtin" min="${minDt}" value="${esc(dtVal)}" aria-label="Preferred date and time">` : ''}
  </div></div>

  <div class="step"><span class="sn">4</span><div class="sb"><h2>Contact at site</h2>
    <div class="grid2">
      <label class="field"><span>Name <b>*</b></span><input id="f-cname" autocomplete="name" value="${esc(f.contactName)}"></label>
      <label class="field"><span>Mobile <b>*</b></span><input id="f-cphone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(f.contactPhone)}" placeholder="05X XXX XXXX"></label>
    </div>
    <label class="field" style="margin-top:12px"><span>Email (optional)</span><input id="f-cemail" type="email" autocomplete="email" value="${esc(f.contactEmail)}"></label>
  </div></div>
  </div>
  <div class="sendbar"><button class="btn primary block" id="f-send" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Sending…' : 'Send service request'}</button></div>
  </form>`;
}

/** Equipment of a site for the dropdown: groups in device-list order, and a lookup by id. */
function eqModel(e) {
  const byId = {}, groups = [];
  const all = [...(e.cameras || []).map((x) => ({ ...x, kind: 'camera', _k: 'cameras' })), ...(e.nvrs || []).map((x) => ({ ...x, kind: 'nvr', _k: 'nvrs' })), ...(e.others || []).map((x) => ({ ...x, kind: 'other', _k: listOfOther(x) }))];
  DEVICE_LISTS.forEach((l) => {
    const items = all.filter((x) => x._k === l.k).map((x) => {
      const name = x.kind === 'camera' && x.no ? `${x.no}${x.name ? ' ' + x.name : ''}` : x.kind === 'nvr' && x.no ? `NVR ${x.no}${x.name ? ' ' + x.name : ''}` : (l.k === 'other' && x.type && x.type !== 'Other' ? `${x.type} – ${x.name || ''}` : (x.name || x.type || 'Device'));
      const it = { ...x, name, group: l.s, cat: l.cat };
      byId[x.id] = it; return it;
    });
    if (items.length) groups.push({ k: l.k, label: l.t, items });
  });
  return { groups, byId, count: all.length };
}

/** Service options for this client: the ones the office ticked in the client's profile (all when none ticked). */
function clientTypes() {
  const all = activeTypes();
  if (!S.portal || S.portal.walkin) return all;
  const other = all.find((t) => t.k === 'other') || { k: 'other', t: 'Other' };
  const std = all.filter((t) => t.k !== 'other');
  const ownL = Array.isArray(S.portal.customTypes) ? S.portal.customTypes : [];
  // a line worded like a standard type keeps that type (so it matches the devices picked)
  const own = ownL.map((t) => std.find((x) => x.t.toLowerCase() === String(t).trim().toLowerCase()) || { k: 'c_' + slugT(t), t: String(t).trim(), own: true });
  if (S.portal.hideStd && own.length) return [...own, other];
  const want = Array.isArray(S.portal.services) ? S.portal.services : [];
  const base = want.length ? std.filter((t) => want.includes(t.k)) : std;
  return [...own, ...base.filter((b) => !own.some((o) => o.k === b.k)), other];
}
const slugT = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
/** Label of a problem type, including this client's own types. */
const catLabel = (k) => { const c = clientTypes().find((x) => x.k === k); return c ? c.t : typeLabel(k); };

function readForm() {
  const f = S.form, v = (id) => { const e = $(id); return e ? e.value.trim() : null; };
  const set = (k, id) => { const x = v(id); if (x !== null) f[k] = x; };
  if ($('#f-site')) f.siteId = $('#f-site').value || f.siteId;
  { const d = $('#f-desc'); if (d) f.description = d.value; } set('contactName', '#f-cname'); set('contactPhone', '#f-cphone'); set('contactEmail', '#f-cemail');
  set('otherName', '#f-oname'); set('otherAddress', '#f-oaddr');
  set('brand', '#f-brand'); set('store', '#f-store'); set('area', '#f-area');
}

function bindForm() {
  const f = S.form;
  const redraw = () => { readForm(); const y = window.scrollY; render(); window.scrollTo(0, y); };
  if ($('#f-site')) $('#f-site').onchange = () => { readForm(); f.eq = []; f.siteId = $('#f-site').value; redraw(); };
  $$('[data-site]').forEach((b) => (b.onclick = () => { readForm(); if (f.siteId !== b.dataset.site) f.eq = []; f.siteId = b.dataset.site; redraw(); }));
  applyPhotos();
  $$('[data-qc]').forEach((b) => (b.onclick = () => {
    f.checks = f.checks || {}; const k = b.dataset.qc;
    f.checks[k] = f.checks[k] === b.dataset.v ? '' : b.dataset.v;
    $$(`[data-qc="${k}"]`).forEach((x) => x.classList.toggle('on', x.dataset.v === f.checks[k]));
  }));
  const ty = $('#f-type'); if (ty) ty.onchange = () => { f.cats = ty.value ? [ty.value] : []; };
  const eqSiteB = !S.portal.walkin && f.siteId && S.portal.equipment ? S.portal.equipment[f.siteId] : null;
  const it = $('#f-eqi');
  if (it && eqSiteB) it.onchange = () => { readForm(); if (it.value && !f.eq.includes(it.value)) f.eq.push(it.value); redraw(); };
  $$('[data-eqrm]').forEach((b) => (b.onclick = () => { readForm(); f.eq = f.eq.filter((x) => x !== b.dataset.eqrm); redraw(); }));
  $$('[data-prio]').forEach((b) => (b.onclick = () => {
    f.priority = b.dataset.prio;
    $$('[data-prio]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    const h = $('#f-ph-hint'); if (h) h.textContent = prio(f.priority).s;
  }));
  $$('[data-day]').forEach((b) => (b.onclick = () => {
    const d = b.dataset.day;
    if (d === 'asap') { f.preferredDate = dateKey(); f.preferredSlot = 'asap'; f.preferredTime = ''; }
    else if (d === 'tomorrow') { f.preferredDate = tomorrow(); f.preferredSlot = 'any'; f.preferredTime = ''; }
    else { if (f.preferredSlot !== 'exact') { f.preferredDate = tomorrow(); f.preferredTime = '10:00'; } f.preferredSlot = 'exact'; }
    redraw();
    if (d === 'pick') { const dt = $('#f-dt'); if (dt) { dt.focus(); try { dt.showPicker && dt.showPicker(); } catch (_) { /* some browsers only open on tap */ } } }
  }));
  const dt = $('#f-dt');
  if (dt) dt.onchange = () => { const v = dt.value; if (v && v.length >= 16) { f.preferredDate = v.slice(0, 10); f.preferredTime = v.slice(11, 16); f.preferredSlot = 'exact'; } };
  $$('[data-rmph]').forEach((b) => (b.onclick = () => { S.photos.splice(+b.dataset.rmph, 1); redraw(); }));
  const ph = $('#f-ph');
  if (ph) ph.onchange = async () => {
    for (const file of [...ph.files].slice(0, 3 - S.photos.length)) {
      try { S.photos.push(await compressImage(file)); } catch (e) { toast(e.message, true); }
    }
    redraw();
  };
  const g = $('#f-gps');
  if (g) g.onclick = () => {
    readForm();
    if (!navigator.geolocation) return toast('Location is not available on this device', true);
    $('#f-gpst').textContent = 'Getting your location…';
    navigator.geolocation.getCurrentPosition((p) => { f.gps = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; redraw(); },
      () => { $('#f-gpst').textContent = 'Location not allowed. You can still send the request.'; }, { enableHighAccuracy: true, timeout: 20000 });
  };
  $('#f').onsubmit = (e) => { e.preventDefault(); readForm(); submit(); };
}

async function submit() {
  const f = S.form, sites = S.portal.sites || [];
  const site = sites.find((s) => s.id === f.siteId);
  const other = f.siteId === '_other';
  const walk = !!S.portal.walkin;
  const miss = [];
  if (walk) { if (!f.brand) miss.push('brand or company name'); if (!f.store) miss.push('store or location'); }
  else if (!site && !(other && f.otherName)) miss.push('site');
  const eqS = !walk && site && S.portal.equipment ? S.portal.equipment[site.id] : null;
  const EQM = eqS ? eqModel(eqS) : null;
  const devs = EQM ? f.eq.map((id) => EQM.byId[id]).filter(Boolean) : [];
  const known = activeTypes().map((x) => x.k);
  const cats = [...new Set([...f.cats, ...devs.map((d) => (known.includes(d.cat) ? d.cat : 'other'))])].filter(Boolean);
  if (!cats.length) miss.push(EQM && EQM.count ? 'a faulty device or the type of problem' : 'the type of problem');
  if (f.description.trim().length < 4) miss.push('a short description');
  if (!f.contactName) miss.push('contact name');
  if (f.contactPhone.replace(/\D/g, '').length < 7) miss.push('mobile number');
  if (miss.length) return toast('Please add: ' + miss.join(', '), true);
  lsSet(LS, JSON.stringify({ name: f.contactName, phone: f.contactPhone, email: f.contactEmail, brand: f.brand, store: f.store, area: f.area }));

  const pid = walk ? randToken(24) : '';
  const t = walk ? { publicId: pid, clientId: '', clientName: f.brand, brand: f.brand, siteName: f.store, siteAddress: f.area } : {
    portal: token, clientId: S.portal.clientId || '', clientName: S.portal.clientName || '',
    siteId: site ? site.id : '', siteName: site ? site.name : f.otherName,
    siteAddress: site ? (site.address || '') : f.otherAddress,
  };
  Object.assign(t, {
    contactName: f.contactName, contactPhone: f.contactPhone,
    category: cats[0], categories: cats, categoryLabels: cats.map(catLabel), description: [f.description.split('\n').map((l) => l.trimEnd()).join('\n').trim(),
      QCHECKS.filter((q) => (f.checks || {})[q.k]).map((q) => `${q.t.replace('?', '')}: ${f.checks[q.k]}`).join('\n')].filter(Boolean).join('\n\nQuick checks:\n'), priority: f.priority,
    preferredDate: f.preferredDate || dateKey(), preferredSlot: f.preferredSlot,
    status: 'new', open: true, source: walk ? 'walkin' : 'portal',
  });
  if (f.preferredSlot === 'exact' && f.preferredTime) t.preferredTime = f.preferredTime;
  if (devs.length) {
    const raw = [...(eqS.cameras || []), ...(eqS.nvrs || []), ...(eqS.others || [])];
    t.faults = devs.map((x) => { const r = raw.find((y) => y.id === x.id) || x; return { kind: x.kind, id: x.id, no: r.no || '', name: r.name || '', nvr: r.nvr || '', ch: r.ch || '', ...(r.type ? { type: r.type } : {}), result: '', note: '' }; });
  }
  const gps = site && hasGPS(site) ? site : (other || walk) && f.gps ? f.gps : null;
  if (gps) { t.lat = +gps.lat; t.lng = +gps.lng; }
  if (f.contactEmail) t.contactEmail = f.contactEmail;
  if (devs.length) t.cameras = devs.length;
  if (S.photos.length) t.photos = S.photos.slice(0, 3);

  S.busy = true; render();
  let lastErr = null, withCats = true;
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newTicketNo();
    const data = { ...t };
    if (!withCats) { // older rules without the 'categories' field: keep the extra choices in the description
      delete data.categories; delete data.categoryLabels; delete data.preferredTime;
      if (data.faults) { data.description = `${data.description}\nEquipment: ${data.faults.map(faultLabel).join(', ')}`; delete data.faults; }
      if (cats.length > 1) data.description = `${t.description}\nAlso: ${t.categories.slice(1).map(catLabel).join(', ')}`;
    }
    const full = { ...data, number: id, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      log: [{ at: Timestamp.now(), byName: f.contactName, t: 'Request raised by client' }] };
    const pub = { ...publicView({ ...full, categories: t.categories }), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      log: [{ at: Timestamp.now(), t: 'Request received' }] };
    try {
      const b = writeBatch(db);
      b.set(doc(db, 'svcTickets', id), full);
      if (walk) b.set(doc(db, 'svcPublic', pid), { ...pub, number: id, clientName: f.brand });
      else b.set(doc(db, 'svcPortals', token, 'tickets', id), pub);
      await b.commit();
      if (walk) { addWalkin(pid, id); if (S.watchPublic) S.watchPublic(); }
      S.busy = false; S.sent = { ...full, id, _pid: pid }; S.form = freshForm(); S.photos = [];
      render(); window.scrollTo(0, 0);
      return;
    } catch (e) {
      lastErr = e;
      if (!String(e.code || '').includes('permission')) break;
      if (attempt === 1) withCats = false;
    }
  }
  S.busy = false; render();
  toast('Could not send: ' + friendly(lastErr), true);
}

function sentHtml() {
  const t = S.sent;
  return `<div class="card done-box"><img src="img/shield-256.png" alt="" style="width:64px"><h2>Request received</h2>
    <div class="tno">${esc(t.number)}</div>
    <p>Thank you, ${esc(t.contactName)}. Your request for ${esc(t.siteName)} is with our technical team. We will assign a technician and confirm the visit time here and by phone.</p>
    ${t._pid ? (() => { const u = `${location.origin}${location.pathname}?t=${t._pid}`; return `<div class="trackbox"><b>Your tracking link</b><p class="small muted" style="margin:4px 0 8px">Save it to follow this request from any phone. It is also remembered on this device.</p>
      <div class="linkbox"><input readonly value="${esc(u)}" id="trk"><button class="btn sm" type="button" id="trk-c">Copy</button><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('My Leaders Line service request ' + t.number + ': ' + u)}">WhatsApp</a></div></div>`; })() : ''}
    <div class="row" style="justify-content:center"><button class="btn" id="again">Raise another request</button><button class="btn primary" id="see">Follow my requests</button></div></div>`;
}

// ------------------------------------------------------------------ my requests
function reportHtml(r) {
  if (!r) return '';
  const items = Array.isArray(r.items) ? r.items : [];
  return `<div class="rep"><div class="row"><b class="grow">${esc(r.kind || 'Service report')} ${esc(r.number || '')}</b><button type="button" class="btn sm" data-print>Print or save PDF</button></div>
    <div class="small muted">${esc(fmtDate(r.date))}${r.technician ? ` · Technician ${esc(r.technician)}` : ''}${r.timeIn || r.timeOut ? ` · ${esc(r.timeIn || '–')} to ${esc(r.timeOut || '–')}` : ''}</div>
    ${r.complaint ? `<h4>Complaint</h4><p>${esc(r.complaint)}</p>` : ''}
    ${r.workDone ? `<h4>Work carried out</h4><p>${esc(r.workDone)}</p>` : ''}
    ${items.length ? `<h4>Parts and items</h4><ul>${items.map((i) => `<li>${esc(i.name)}${i.qty ? ` × ${esc(i.qty)} ${esc(i.unit || '')}` : ''}${i.status ? ` — ${esc(i.status)}` : ''}${i.serials && i.serials.length ? `<div class="small muted">S/N ${esc(i.serials.join(', '))}</div>` : ''}</li>`).join('')}</ul>` : ''}
    ${r.signedAt ? `<p class="small">Signed by ${esc(r.receiver || 'customer')} on ${esc(fmtDT(r.signedAt))}</p>` : '<p class="small muted">Waiting for your signature at the site.</p>'}
  </div>`;
}

function listHtml() {
  if (!S.tickets.length) return `<div class="card empty">${S.portal.walkin ? 'Requests you send from this phone appear here. You can also open the tracking link you received.' : 'No service requests yet. Use New request to report a fault or book a visit.'}</div>`;
  return `<div class="card tklist">${S.tickets.map((t) => {
    const s = st(t.status), p = prio(t.priority), i = STEPS.indexOf(t.status), open = S.open === t.id;
    const shots = S.shots[t.id] || [];
    return `<article class="tk ${open ? 'open' : ''}" data-t="${esc(t.id)}">
      <div class="row"><b class="mono">${esc(t.number || t.id)}</b><span class="chip" style="background:${s.c}1a;color:${s.c}"><span class="dot" style="background:${s.c}"></span>${esc(s.t)}</span>
        ${t.priority !== 'normal' ? `<span class="chip" style="background:${p.c}14;color:${p.c}">${esc(p.t)}</span>` : ''}<span class="grow"></span><span class="small muted">${esc(ago(t.createdAt))}</span></div>
      <div class="tkt"><b>${esc(typesText(t))}</b><span class="muted"> at ${esc(t.siteName)}</span></div>
      ${i >= 0 ? `<div class="steps" aria-hidden="true">${STEPS.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>` : ''}
      <div class="msg">${esc(clientMessage(t))}</div>
      ${open ? `<div class="tkd">
        <p class="muted" style="white-space:pre-line">${esc(t.description)}</p>
        <div class="small">Raised ${esc(fmtDT(t.createdAt))}· preferred ${esc(prefText(t))}</div>
        ${t.assignedName ? `<div class="small">Technician <b>${esc(t.assignedName)}</b>${t.scheduledAt ? `, visit ${esc(fmtDT(t.scheduledAt))}` : ''}</div>` : ''}
        ${Array.isArray(t.faults) && t.faults.length ? `<h4>Equipment</h4><ul class="flist">${t.faults.map((x) => `<li>${esc(faultLabel(x))}${x.result ? ` <span class="rchip" style="background:${RESULT_COLOR[x.result] || '#75757a'}22;color:${RESULT_COLOR[x.result] || '#75757a'}">${esc(x.result)}</span>` : ''}${x.note ? `<div class="small muted">${esc(x.note)}</div>` : ''}</li>`).join('')}</ul>` : ''}
        ${shots.length ? `<h4>Photos from our technician</h4><div class="thumbs">${shots.map((ph) => `<img src="${ph.data}" alt="${esc(ph.caption || 'Photo')}" data-zoom>`).join('')}</div>` : ''}
        ${reportHtml(t.report)}
        <h4>Progress</h4><div class="timeline">${(t.log || []).slice().reverse().map((l) => `<div><b>${esc(l.t)}</b><br><span class="muted">${esc(fmtDT(l.at))}</span></div>`).join('')}</div>
      </div>` : '<div class="small muted" style="margin-top:8px">Tap for details</div>'}
    </article>`;
  }).join('')}</div>`;
}

function watchShots(id) {
  if (S.shotSub) { S.shotSub(); S.shotSub = null; }
  if (!id) return;
  const tk = S.tickets.find((x) => x.id === id);
  const col = (tk && tk._pid) || MODE !== 'link' ? collection(db, 'svcPublic', id, 'photos') : collection(db, 'svcPortals', token, 'tickets', id, 'photos');
  S.shotSub = onSnapshot(query(col, orderBy('at', 'asc'), limit(30)), (q) => {
    S.shots[id] = q.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (S.tab === 'list' && S.open === id) render();
  }, () => { /* rules not published yet */ });
}

function printReport(t) {
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print the report', true);
  const r = t.report || {};
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.kind || 'Service report')} ${esc(r.number || '')}</title>
    <style>body{font:14px/1.5 Arial,sans-serif;color:#18202E;max-width:760px;margin:30px auto;padding:0 20px}h1{color:#0E1F45;font-size:22px;margin:0}h4{color:#1C47AE;margin:18px 0 4px}
    .hd{display:flex;gap:14px;align-items:center;border-bottom:3px solid #1C47AE;padding-bottom:12px;margin-bottom:12px}.hd img{width:60px}table{width:100%;border-collapse:collapse}td{padding:4px 0;vertical-align:top}</style></head><body>
    <div class="hd"><img src="${new URL('img/shield-256.png', location.href).href}" alt=""><div><b>LEADERS LINE TRADING LLC</b><br><span>${esc(COMPANY.phone)} · ${esc(COMPANY.email)}</span></div></div>
    <h1>${esc(r.kind || 'Service report')} ${esc(r.number || '')}</h1>
    <table><tr><td>Client</td><td><b>${esc(t.clientName || S.portal.clientName || '')}</b></td></tr><tr><td>Site</td><td>${esc(t.siteName || '')}</td></tr>
    <tr><td>Date</td><td>${esc(fmtDate(r.date))}</td></tr><tr><td>Request</td><td>${esc(t.number || '')}</td></tr>${r.technician ? `<tr><td>Technician</td><td>${esc(r.technician)}</td></tr>` : ''}</table>
    ${reportHtml(r).replace(/<button[^>]*>.*?<\/button>/, '')}
    <script>setTimeout(function(){print()},400)<\/script></body></html>`);
  w.document.close();
}

function bindList() {
  $$('[data-t]').forEach((e) => (e.onclick = (ev) => {
    if (ev.target.closest('[data-print],[data-zoom],a')) return;
    S.open = S.open === e.dataset.t ? null : e.dataset.t; watchShots(S.open); render();
  }));
  $$('[data-print]').forEach((b) => (b.onclick = () => printReport(S.tickets.find((x) => x.id === b.closest('[data-t]').dataset.t))));
  $$('[data-zoom]').forEach((im) => (im.onclick = () => {
    const o = document.createElement('div'); o.className = 'overlay'; o.innerHTML = `<img src="${im.src}" alt="" style="max-width:100%;max-height:90vh;border-radius:12px">`;
    o.onclick = () => o.remove(); document.body.appendChild(o);
  }));
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
loadTypes().finally(start);
