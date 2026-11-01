// LLCT Service Desk — client portal. Each client gets a private link: index.html?c=<token>
// Installable as a phone app (the link is remembered on this device).
import {
  db, doc, getDoc, collection, onSnapshot, query, orderBy, limit, writeBatch, serverTimestamp, Timestamp,
  SERVICE_TYPES, activeTypes, loadTypes, PRIORITIES, SLOTS, typeLabel, typesText, prio, st, slotLabel, clientMessage, publicView, prefText, COMPANY, icon, randToken,
  $, $$, esc, fmtDate, fmtDT, ago, dateKey, hasGPS, newTicketNo, compressImage, toast, friendly, toDate,
} from './sd.js';

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
const S = { portal: null, tickets: [], tab: 'new', form: freshForm(), photos: [], open: null, sent: null, busy: false, shots: {}, shotSub: null };
const LS = 'llct-sd-contact';
const STEPS = ['new', 'assigned', 'accepted', 'on_way', 'on_site', 'completed'];
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return dateKey(d); };

function freshForm() {
  let c = {};
  try { c = JSON.parse(lsGet(LS) || '{}'); } catch (_) { /* ignore */ }
  return { brand: c.brand || '', store: c.store || '', area: c.area || '', siteId: '', otherName: '', otherAddress: '', gps: null, cats: [], priority: 'normal', preferredDate: dateKey(), preferredSlot: 'asap', description: '', cameras: 0, contactName: c.name || '', contactPhone: c.phone || '', contactEmail: c.email || '' };
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
  const sites = S.portal.sites || [];
  if (sites.length === 1) S.form.siteId = sites[0].id;
  if (!S.form.contactName && S.portal.contact) S.form.contactName = S.portal.contact;
  if (!S.form.contactPhone && S.portal.phone) S.form.contactPhone = S.portal.phone;
  onSnapshot(query(collection(db, 'svcPortals', token, 'tickets'), orderBy('createdAt', 'desc'), limit(200)), (q) => {
    S.tickets = q.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (S.tab === 'list' && !S.sent) render(); else renderTabs();
  }, (e) => console.warn('tickets', e));
  render();
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
    <button role="tab" data-tab="list" class="${S.tab === 'list' ? 'on' : ''}">My requests${S.tickets.length ? `<span class="n">${openCount() || S.tickets.length}</span>` : ''}</button></div>`;
}
function renderTabs() { const t = $('#tabs'); if (t) { t.outerHTML = tabsHtml(); bindTabs(); } }
function bindTabs() { $$('[data-tab]').forEach((b) => (b.onclick = () => { readForm(); S.tab = b.dataset.tab; S.sent = null; render(); window.scrollTo(0, 0); })); }

function render() {
  if (!S.portal) return;
  const body = S.sent ? sentHtml() : S.tab === 'list' ? listHtml() : formHtml();
  app.innerHTML = (S.companyLink && S.portal.walkin ? `<div class="card pad small" style="margin-bottom:14px">Your company has its own service page. <a href="${S.companyLink}"><b>Open my company page</b></a></div>` : '') + tabsHtml() + body + footHtml();
  bindTabs();
  bindInstall();
  if (S.sent) {
    $('#again').onclick = () => { S.sent = null; S.tab = 'new'; render(); };
    $('#see').onclick = () => { S.open = S.sent._pid || S.sent.id; S.sent = null; S.tab = 'list'; watchShots(S.open); render(); };
    const tc = $('#trk-c'); if (tc) tc.onclick = () => { const i = $('#trk'); (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(() => toast('Link copied'), () => { i.select(); document.execCommand('copy'); toast('Link copied'); }); };
  }
  else if (S.tab === 'list') bindList();
  else bindForm();
}

function footHtml() {
  return `<div class="foot"><div id="inst" class="hidden"><button class="btn sm" id="inst-b" type="button">Add to home screen</button><div class="small muted" id="inst-t"></div></div>
    <p><img src="img/shield-256.png" alt="">${esc(COMPANY.name)}, Airport Road, Dubai. Call <a href="tel:048805577">${COMPANY.phone}</a> or email <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>.</p></div>`;
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
function formHtml() {
  const f = S.form, sites = S.portal.sites || [];
  const other = f.siteId === '_other';
  const asCards = sites.length <= 8;
  const siteCard = (id, name, sub, gps) => `<button type="button" class="opt ${f.siteId === id ? 'on' : ''}" data-site="${esc(id)}" role="radio" aria-checked="${f.siteId === id}">
      <span class="ot">${esc(name)}</span>${sub ? `<span class="os">${esc(sub)}</span>` : ''}${gps ? '<span class="og" title="Location saved">Location saved</span>' : ''}</button>`;
  const asap = f.preferredSlot === 'asap';
  const dateSel = asap ? 'asap' : f.preferredDate === dateKey() ? 'today' : f.preferredDate === tomorrow() ? 'tomorrow' : 'pick';
  const step1 = S.portal.walkin ? `<div class="step"><span class="sn">1</span><div class="sb"><h2>Your business</h2><p class="hint">Who and where is the visit for?</p>
    <div class="grid2"><label class="field"><span>Brand or company name <b>*</b></span><input id="f-brand" autocomplete="organization" value="${esc(f.brand)}" placeholder="e.g. Al Noor Pharmacy"></label>
      <label class="field"><span>Store or location <b>*</b></span><input id="f-store" value="${esc(f.store)}" placeholder="e.g. Dubai Mall branch"></label></div>
    <label class="field" style="margin-top:12px"><span>Address or area</span><input id="f-area" autocomplete="street-address" value="${esc(f.area)}" placeholder="Building, street, area, emirate"></label>
    <div class="row" style="margin-top:10px"><button type="button" class="btn sm" id="f-gps">${f.gps ? 'Update my location' : 'Use my current location'}</button><span class="small muted" id="f-gpst">${f.gps ? `Location captured (±${Math.round(f.gps.acc || 0)} m)` : 'Helps the technician find you — only if you are at the store now.'}</span></div>
  </div></div>` : '';
  const siteStep = `<div class="step"><span class="sn">1</span><div class="sb"><h2>Site</h2><p class="hint">Which of your sites needs the visit?</p>
    ${asCards ? `<div class="opts" role="radiogroup">${sites.map((s) => siteCard(s.id, s.name, String(s.address || '').split('\n')[0], hasGPS(s))).join('')}${siteCard('_other', 'Another location', 'Not in this list', false)}</div>`
      : `<select id="f-site" aria-label="Site"><option value="">Choose the site…</option>${sites.map((s) => `<option value="${esc(s.id)}" ${f.siteId === s.id ? 'selected' : ''}>${esc(s.name)}${s.address ? ' — ' + esc(String(s.address).split('\n')[0]) : ''}</option>`).join('')}<option value="_other" ${other ? 'selected' : ''}>Another location (not in the list)</option></select>`}
    ${other ? `<div class="stack" style="margin-top:12px"><label class="field"><span>Location name <b>*</b></span><input id="f-oname" value="${esc(f.otherName)}" placeholder="e.g. Warehouse 3, Al Quoz"></label>
      <label class="field"><span>Address or landmark</span><input id="f-oaddr" value="${esc(f.otherAddress)}" placeholder="Building, street, area"></label>
      <div class="row"><button type="button" class="btn sm" id="f-gps">${f.gps ? 'Update my location' : 'Use my current location'}</button><span class="small muted" id="f-gpst">${f.gps ? `Location captured (±${Math.round(f.gps.acc || 0)} m)` : 'Only if you are at the site now.'}</span></div></div>` : ''}
  </div></div>`;
  return `<form id="f" novalidate><div class="sheet">
  ${step1}${S.portal.walkin ? '' : siteStep}

  <div class="step"><span class="sn">2</span><div class="sb"><h2>What needs attention</h2><p class="hint">Tap everything that applies.${f.cats.length ? ` <b>${f.cats.length} selected</b>` : ''}</p>
    <div class="ctiles">${activeTypes().map((t) => `<button type="button" class="ctile ${f.cats.includes(t.k) ? 'on' : ''}" data-cat="${t.k}" aria-pressed="${f.cats.includes(t.k)}">${icon(t.i || t.k, 26)}<span>${esc(t.t)}</span><i class="ck" aria-hidden="true"></i></button>`).join('')}</div>
    <label class="field" style="margin-top:16px"><span>Tell us more <b>*</b></span><textarea id="f-desc" rows="3" placeholder="e.g. Camera 4 at the main gate shows no picture since yesterday evening.">${esc(f.description)}</textarea></label>
    <div class="row" style="margin-top:14px;gap:16px;align-items:flex-start">
      <div class="field"><span>Cameras or devices affected</span><div class="stepper"><button type="button" data-cam="-1" aria-label="Fewer">−</button><output id="f-cams">${f.cameras || '–'}</output><button type="button" data-cam="1" aria-label="More">+</button></div></div>
      <div class="field grow"><span>Photos, if they help</span><div class="photos">${S.photos.map((p, i) => `<div class="ph"><img src="${p}" alt=""><button type="button" data-rmph="${i}" aria-label="Remove photo">×</button></div>`).join('')}
        ${S.photos.length < 3 ? `<label class="addph">${icon('camera', 22)}<span>Add</span><input type="file" accept="image/*" id="f-ph" hidden multiple></label>` : ''}</div></div>
    </div>
  </div></div>

  <div class="step"><span class="sn">3</span><div class="sb"><h2>Priority</h2><p class="hint">Choose Critical only when the system is down or there is a security risk.</p>
    <div class="prios" role="radiogroup">${PRIORITIES.map((p) => `<button type="button" class="prio ${f.priority === p.k ? 'on' : ''}" data-prio="${p.k}" role="radio" aria-checked="${f.priority === p.k}" style="--pc:${p.c}"><span class="pd"></span><b>${p.t}</b><small>${esc(p.s)}</small></button>`).join('')}</div>
  </div></div>

  <div class="step"><span class="sn">4</span><div class="sb"><h2>Preferred visit</h2><p class="hint">We confirm the visit time when a technician is assigned. Pick a day, and a time, only if you need a particular one.</p>
    <div class="chips" role="radiogroup" aria-label="When">
      <button type="button" class="pchip ${dateSel === 'asap' ? 'on' : ''}" data-day="asap">As soon as possible</button>
      <button type="button" class="pchip ${dateSel === 'today' ? 'on' : ''}" data-day="today">Today</button>
      <button type="button" class="pchip ${dateSel === 'tomorrow' ? 'on' : ''}" data-day="tomorrow">Tomorrow</button>
      <label class="pchip ${dateSel === 'pick' ? 'on' : ''}">${dateSel === 'pick' ? esc(fmtDate(f.preferredDate)) : 'Pick a date'}<input type="date" id="f-date" min="${dateKey()}" value="${esc(f.preferredDate)}"></label>
    </div>
    ${asap ? '' : `<div class="chips" role="radiogroup" aria-label="Time" style="margin-top:10px">${SLOTS.filter((s) => s.k !== 'asap').map((s) => `<button type="button" class="pchip ${f.preferredSlot === s.k ? 'on' : ''}" data-slot="${s.k}">${esc(s.t)}</button>`).join('')}
      <button type="button" class="pchip ${f.preferredSlot === 'exact' ? 'on' : ''}" data-slot="exact">Exact time</button></div>
      ${f.preferredSlot === 'exact' ? (() => { const [hh, mm] = (f.preferredTime || '10:00').split(':'); return `<div class="row" style="margin-top:10px;gap:6px" aria-label="Exact time, 24-hour">
        <select id="f-hh" style="width:auto" aria-label="Hour">${Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map((h) => `<option ${h === hh ? 'selected' : ''}>${h}</option>`).join('')}</select>
        <b>:</b><select id="f-mm" style="width:auto" aria-label="Minutes">${['00', '15', '30', '45'].map((m) => `<option ${m === mm ? 'selected' : ''}>${m}</option>`).join('')}</select>
        <span class="small muted">24-hour time</span></div>`; })() : ''}`}
  </div></div>

  <div class="step"><span class="sn">5</span><div class="sb"><h2>Contact at site</h2><p class="hint">Who should the technician ask for?</p>
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

function readForm() {
  const f = S.form, v = (id) => { const e = $(id); return e ? e.value.trim() : null; };
  const set = (k, id) => { const x = v(id); if (x !== null) f[k] = x; };
  if ($('#f-site')) f.siteId = $('#f-site').value || f.siteId;
  set('description', '#f-desc'); set('contactName', '#f-cname'); set('contactPhone', '#f-cphone'); set('contactEmail', '#f-cemail');
  set('otherName', '#f-oname'); set('otherAddress', '#f-oaddr');
  set('brand', '#f-brand'); set('store', '#f-store'); set('area', '#f-area');
}

function bindForm() {
  const f = S.form;
  const redraw = () => { readForm(); const y = window.scrollY; render(); window.scrollTo(0, y); };
  if ($('#f-site')) $('#f-site').onchange = () => { f.siteId = $('#f-site').value; redraw(); };
  $$('[data-site]').forEach((b) => (b.onclick = () => { readForm(); f.siteId = b.dataset.site; redraw(); }));
  $$('[data-cat]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.cat; const i = f.cats.indexOf(k);
    if (i >= 0) f.cats.splice(i, 1); else f.cats.push(k);
    b.classList.toggle('on', i < 0); b.setAttribute('aria-pressed', String(i < 0));
    const h = b.closest('.sb').querySelector('.hint'); h.innerHTML = `Tap everything that applies.${f.cats.length ? ` <b>${f.cats.length} selected</b>` : ''}`;
  }));
  $$('[data-prio]').forEach((b) => (b.onclick = () => { f.priority = b.dataset.prio; $$('[data-prio]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); }));
  $$('[data-cam]').forEach((b) => (b.onclick = () => { f.cameras = Math.max(0, Math.min(999, (f.cameras || 0) + Number(b.dataset.cam))); $('#f-cams').textContent = f.cameras || '–'; }));
  $$('[data-day]').forEach((b) => (b.onclick = () => {
    const d = b.dataset.day;
    if (d === 'asap') { f.preferredDate = dateKey(); f.preferredSlot = 'asap'; }
    else { f.preferredDate = d === 'today' ? dateKey() : tomorrow(); if (f.preferredSlot === 'asap') f.preferredSlot = 'any'; }
    redraw();
  }));
  const di = $('#f-date'); if (di) di.onchange = () => { if (di.value) { f.preferredDate = di.value; if (f.preferredSlot === 'asap') f.preferredSlot = 'any'; redraw(); } };
  $$('[data-slot]').forEach((b) => (b.onclick = () => { f.preferredSlot = b.dataset.slot; f.preferredTime = b.dataset.slot === 'exact' ? (f.preferredTime || '10:00') : ''; redraw(); }));
  const setTime = () => { f.preferredTime = `${$('#f-hh').value}:${$('#f-mm').value}`; };
  if ($('#f-hh')) { $('#f-hh').onchange = setTime; $('#f-mm').onchange = setTime; }
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
  if (!f.cats.length) miss.push('what needs attention');
  if (f.description.length < 4) miss.push('a short description');
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
    category: f.cats[0], categories: f.cats.slice(), categoryLabels: f.cats.map(typeLabel), description: f.description, priority: f.priority,
    preferredDate: f.preferredDate || dateKey(), preferredSlot: f.preferredSlot,
    status: 'new', open: true, source: walk ? 'walkin' : 'portal',
  });
  if (f.preferredSlot === 'exact' && f.preferredTime) t.preferredTime = f.preferredTime;
  const gps = site && hasGPS(site) ? site : (other || walk) && f.gps ? f.gps : null;
  if (gps) { t.lat = +gps.lat; t.lng = +gps.lng; }
  if (f.contactEmail) t.contactEmail = f.contactEmail;
  if (f.cameras > 0) t.cameras = f.cameras;
  if (S.photos.length) t.photos = S.photos.slice(0, 3);

  S.busy = true; render();
  let lastErr = null, withCats = true;
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newTicketNo();
    const data = { ...t };
    if (!withCats) { // older rules without the 'categories' field: keep the extra choices in the description
      delete data.categories; delete data.categoryLabels; delete data.preferredTime;
      if (t.categories.length > 1) data.description = `${t.description}\nAlso: ${t.categories.slice(1).map(typeLabel).join(', ')}`;
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
