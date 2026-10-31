// LLCT Service Desk — client portal. Each client gets a private link: index.html?c=<token>
import {
  db, doc, getDoc, collection, onSnapshot, query, orderBy, limit, writeBatch, serverTimestamp, Timestamp,
  SERVICE_TYPES, PRIORITIES, SLOTS, typeLabel, prio, st, clientMessage, publicView, COMPANY,
  $, $$, esc, fmtDate, fmtDT, ago, dateKey, hasGPS, newTicketNo, compressImage, toast, friendly,
} from './sd.js';

const app = $('#app');
const token = new URLSearchParams(location.search).get('c') || (location.hash.match(/c=([\w-]+)/) || [])[1] || '';
const S = { portal: null, tickets: [], tab: 'new', form: freshForm(), photos: [], open: null, sent: null, busy: false };
const LS = 'llct-sd-contact';
const STEPS = ['new', 'assigned', 'accepted', 'on_way', 'on_site', 'completed'];

function freshForm() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (_) { /* private mode */ }
  return { siteId: '', otherName: '', otherAddress: '', gps: null, category: '', priority: 'normal', preferredDate: dateKey(), preferredSlot: 'asap', description: '', cameras: '', contactName: c.name || '', contactPhone: c.phone || '', contactEmail: c.email || '' };
}

function fail(title, msg) {
  app.innerHTML = `<div class="card pad done-box"><div class="big">🔒</div><h2>${esc(title)}</h2><p class="muted">${esc(msg)}</p>
    <p class="small">Leaders Line service: <a href="tel:048805577"><b>${COMPANY.phone}</b></a> · ${COMPANY.email}</p></div>`;
}

async function start() {
  if (!token) return fail('Link incomplete', 'Please open the full service request link you received from Leaders Line.');
  try {
    const s = await getDoc(doc(db, 'svcPortals', token));
    if (!s.exists() || s.data().active !== true) return fail('This link is not active', 'Please contact Leaders Line for a new service request link.');
    S.portal = { id: s.id, ...s.data() };
  } catch (e) {
    console.warn(e);
    return fail('This link is not active', 'Please contact Leaders Line for a new service request link.');
  }
  $('#p-client').textContent = S.portal.clientName || 'Service Request';
  document.title = `Service Request · ${S.portal.clientName || 'Leaders Line'}`;
  const sites = S.portal.sites || [];
  if (sites.length === 1) S.form.siteId = sites[0].id;
  if (!S.form.contactName && S.portal.contact) S.form.contactName = S.portal.contact;
  if (!S.form.contactPhone && S.portal.phone) S.form.contactPhone = S.portal.phone;
  onSnapshot(query(collection(db, 'svcPortals', token, 'tickets'), orderBy('createdAt', 'desc'), limit(200)), (q) => {
    S.tickets = q.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (S.tab === 'list' || !app.querySelector('form')) render(); else renderTabs();
  }, (e) => console.warn('tickets', e));
  render();
}

const openCount = () => S.tickets.filter((t) => !['completed', 'closed', 'cancelled'].includes(t.status)).length;
function tabsHtml() {
  return `<div class="tabs" id="tabs"><button data-tab="new" class="${S.tab === 'new' ? 'on' : ''}">New request</button>
    <button data-tab="list" class="${S.tab === 'list' ? 'on' : ''}">My requests${S.tickets.length ? `<span class="n">${openCount() || S.tickets.length}</span>` : ''}</button></div>`;
}
function renderTabs() { const t = $('#tabs'); if (t) { t.outerHTML = tabsHtml(); bindTabs(); } }
function bindTabs() { $$('[data-tab]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; S.sent = null; render(); window.scrollTo(0, 0); })); }

function render() {
  if (!S.portal) return;
  let body;
  if (S.sent) body = sentHtml();
  else if (S.tab === 'list') body = listHtml();
  else body = formHtml();
  app.innerHTML = tabsHtml() + body + `<div class="foot">${esc(COMPANY.name)} · <a href="tel:048805577">${COMPANY.phone}</a> · ${COMPANY.email}</div>`;
  bindTabs();
  if (S.sent) { $('#again').onclick = () => { S.sent = null; S.tab = 'new'; render(); }; $('#see').onclick = () => { S.sent = null; S.tab = 'list'; render(); }; }
  else if (S.tab === 'list') bindList();
  else bindForm();
}

// ------------------------------------------------------------------ form
function formHtml() {
  const f = S.form, sites = S.portal.sites || [];
  const other = f.siteId === '_other';
  return `<form id="f" class="stack" novalidate>
  <div class="card pad stack">
    <div class="sec-t">1 · Site</div>
    <label class="field"><span>Which site needs service? <b>*</b></span>
      <select id="f-site"><option value="">Choose the site…</option>
        ${sites.map((s) => `<option value="${esc(s.id)}" ${f.siteId === s.id ? 'selected' : ''}>${esc(s.name)}${s.address ? ' — ' + esc(String(s.address).split('\n')[0]) : ''}</option>`).join('')}
        <option value="_other" ${other ? 'selected' : ''}>Another location (not in the list)</option></select></label>
    ${other ? `<div class="stack"><label class="field"><span>Location name <b>*</b></span><input id="f-oname" value="${esc(f.otherName)}" placeholder="e.g. Warehouse 3, Al Quoz"></label>
      <label class="field"><span>Address / landmark</span><textarea id="f-oaddr" rows="2" placeholder="Building, street, area">${esc(f.otherAddress)}</textarea></label>
      <div class="row"><button type="button" class="btn sm" id="f-gps">📍 ${f.gps ? 'Update my location' : 'Use my current location'}</button><span class="small muted" id="f-gpst">${f.gps ? `Location captured (±${Math.round(f.gps.acc || 0)} m)` : 'Helps the technician navigate — only if you are at the site.'}</span></div></div>` : ''}
  </div>
  <div class="card pad stack">
    <div class="sec-t">2 · What do you need?</div>
    <div class="tiles">${SERVICE_TYPES.map((t) => `<button type="button" class="tile ${f.category === t.k ? 'on' : ''}" data-cat="${t.k}"><span class="ti">${t.i}</span><span>${esc(t.t)}</span></button>`).join('')}</div>
    <label class="field"><span>Describe the problem <b>*</b></span><textarea id="f-desc" rows="3" placeholder="e.g. Camera 4 at the main gate shows no picture since yesterday evening.">${esc(f.description)}</textarea></label>
    <label class="field" style="max-width:240px"><span>Cameras / devices affected</span><input id="f-cams" inputmode="numeric" value="${esc(f.cameras)}" placeholder="e.g. 2"></label>
    <div><div class="field"><span>Photos (optional, up to 3)</span></div>
      <div class="photos" id="f-photos">${S.photos.map((p, i) => `<div class="ph"><img src="${p}" alt=""><button type="button" data-rmph="${i}">×</button></div>`).join('')}
      ${S.photos.length < 3 ? '<label class="addph">📷<br>Add photo<input type="file" accept="image/*" id="f-ph" hidden multiple></label>' : ''}</div></div>
  </div>
  <div class="card pad stack">
    <div class="sec-t">3 · Priority</div>
    <div class="ptiles">${PRIORITIES.map((p) => `<button type="button" class="tile ptile ${f.priority === p.k ? 'on' : ''}" data-prio="${p.k}" style="border-left-color:${p.c}"><span><b style="color:${p.c}">${p.t}</b><small>${esc(p.s)}</small></span></button>`).join('')}</div>
  </div>
  <div class="card pad stack">
    <div class="sec-t">4 · Preferred visit time</div>
    <div class="row" style="align-items:flex-end">
      <label class="field" style="flex:1;min-width:160px"><span>Date</span><input type="date" id="f-date" min="${dateKey()}" value="${esc(f.preferredDate)}"></label>
      <label class="field" style="flex:2;min-width:200px"><span>Time</span><select id="f-slot">${SLOTS.map((s) => `<option value="${s.k}" ${f.preferredSlot === s.k ? 'selected' : ''}>${esc(s.t)}</option>`).join('')}</select></label>
    </div>
  </div>
  <div class="card pad stack">
    <div class="sec-t">5 · Contact person at site</div>
    <div class="row" style="align-items:flex-end">
      <label class="field" style="flex:1;min-width:180px"><span>Name <b>*</b></span><input id="f-cname" autocomplete="name" value="${esc(f.contactName)}"></label>
      <label class="field" style="flex:1;min-width:180px"><span>Mobile <b>*</b></span><input id="f-cphone" type="tel" autocomplete="tel" value="${esc(f.contactPhone)}" placeholder="05X XXX XXXX"></label>
    </div>
    <label class="field"><span>Email (optional)</span><input id="f-cemail" type="email" autocomplete="email" value="${esc(f.contactEmail)}"></label>
  </div>
  <button class="btn primary block" id="f-send" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Sending…' : 'Submit service request'}</button>
  </form>`;
}

function readForm() {
  const f = S.form, v = (id) => { const e = $(id); return e ? e.value.trim() : ''; };
  f.siteId = v('#f-site') || f.siteId; f.description = v('#f-desc'); f.cameras = v('#f-cams');
  f.preferredDate = v('#f-date'); f.preferredSlot = v('#f-slot') || 'asap';
  f.contactName = v('#f-cname'); f.contactPhone = v('#f-cphone'); f.contactEmail = v('#f-cemail');
  if ($('#f-oname')) { f.otherName = v('#f-oname'); f.otherAddress = v('#f-oaddr'); }
}

function bindForm() {
  $('#f-site').onchange = () => { readForm(); S.form.siteId = $('#f-site').value; render(); };
  $$('[data-cat]').forEach((b) => (b.onclick = () => { readForm(); S.form.category = b.dataset.cat; $$('[data-cat]').forEach((x) => x.classList.toggle('on', x === b)); }));
  $$('[data-prio]').forEach((b) => (b.onclick = () => { S.form.priority = b.dataset.prio; $$('[data-prio]').forEach((x) => x.classList.toggle('on', x === b)); }));
  $$('[data-rmph]').forEach((b) => (b.onclick = () => { readForm(); S.photos.splice(+b.dataset.rmph, 1); render(); }));
  const ph = $('#f-ph');
  if (ph) ph.onchange = async () => {
    readForm();
    for (const file of [...ph.files].slice(0, 3 - S.photos.length)) {
      try { S.photos.push(await compressImage(file)); } catch (e) { toast(e.message, true); }
    }
    render();
  };
  const g = $('#f-gps');
  if (g) g.onclick = () => {
    readForm();
    if (!navigator.geolocation) return toast('Location is not available on this device', true);
    $('#f-gpst').textContent = 'Getting your location…';
    navigator.geolocation.getCurrentPosition((p) => {
      S.form.gps = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; render();
    }, () => { $('#f-gpst').textContent = 'Location not allowed. You can still submit without it.'; }, { enableHighAccuracy: true, timeout: 20000 });
  };
  $('#f').onsubmit = (e) => { e.preventDefault(); readForm(); submit(); };
}

async function submit() {
  const f = S.form, sites = S.portal.sites || [];
  const site = sites.find((s) => s.id === f.siteId);
  const other = f.siteId === '_other';
  const miss = [];
  if (!site && !(other && f.otherName)) miss.push('site');
  if (!f.category) miss.push('type of service');
  if (f.description.length < 4) miss.push('problem description');
  if (!f.contactName) miss.push('contact name');
  if (f.contactPhone.replace(/\D/g, '').length < 7) miss.push('mobile number');
  if (miss.length) return toast('Please fill in: ' + miss.join(', '), true);
  try { localStorage.setItem(LS, JSON.stringify({ name: f.contactName, phone: f.contactPhone, email: f.contactEmail })); } catch (_) { /* ignore */ }

  const t = {
    portal: token, clientId: S.portal.clientId || '', clientName: S.portal.clientName || '',
    siteId: site ? site.id : '', siteName: site ? site.name : f.otherName,
    siteAddress: site ? (site.address || '') : f.otherAddress,
    contactName: f.contactName, contactPhone: f.contactPhone,
    category: f.category, description: f.description, priority: f.priority,
    preferredDate: f.preferredDate || dateKey(), preferredSlot: f.preferredSlot,
    status: 'new', open: true, source: 'portal',
  };
  const gps = site && hasGPS(site) ? site : other && f.gps ? f.gps : null;
  if (gps) { t.lat = +gps.lat; t.lng = +gps.lng; }
  if (f.contactEmail) t.contactEmail = f.contactEmail;
  if (+f.cameras > 0) t.cameras = Math.min(999, Math.round(+f.cameras));
  if (S.photos.length) t.photos = S.photos.slice(0, 3);

  S.busy = true; render();
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const id = newTicketNo();
    const full = { ...t, number: id, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      log: [{ at: Timestamp.now(), byName: f.contactName, t: 'Request raised by client' }] };
    const pub = { ...publicView(full), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      log: [{ at: Timestamp.now(), t: 'Request received' }] };
    try {
      const b = writeBatch(db);
      b.set(doc(db, 'svcTickets', id), full);
      b.set(doc(db, 'svcPortals', token, 'tickets', id), pub);
      await b.commit();
      S.busy = false; S.sent = { ...full, id }; S.form = freshForm(); S.photos = [];
      render(); window.scrollTo(0, 0);
      return;
    } catch (e) { lastErr = e; if (!String(e.code || '').includes('permission')) break; }
  }
  S.busy = false; render();
  toast('Could not send: ' + friendly(lastErr), true);
}

function sentHtml() {
  const t = S.sent;
  return `<div class="card done-box"><div class="big">✅</div><h2>Request received</h2>
    <div class="tno">${esc(t.number)}</div>
    <p>Thank you, ${esc(t.contactName)}. Your request for <b>${esc(t.siteName)}</b> has been passed to our <b>technical team</b>.
    A technician will be assigned and will visit at the scheduled time. You can follow the status here any time.</p>
    <div class="row" style="justify-content:center"><button class="btn" id="again">Raise another request</button><button class="btn primary" id="see">Track my requests</button></div></div>`;
}

// ------------------------------------------------------------------ list
function listHtml() {
  if (!S.tickets.length) return '<div class="card empty">No service requests yet.</div>';
  return `<div class="card">${S.tickets.map((t) => {
    const s = st(t.status), p = prio(t.priority), i = STEPS.indexOf(t.status), open = S.open === t.id;
    return `<div class="tk" data-t="${esc(t.id)}">
      <div class="row"><b class="mono">${esc(t.number || t.id)}</b><span class="chip" style="background:${s.c}1f;color:${s.c}"><span class="dot" style="background:${s.c}"></span>${esc(s.t)}</span>
        <span class="chip" style="background:${p.c}14;color:${p.c}">${esc(p.t)}</span><span class="grow"></span><span class="small muted">${esc(ago(t.createdAt))}</span></div>
      <div style="margin-top:4px"><b>${esc(typeLabel(t.category))}</b> · ${esc(t.siteName)}</div>
      ${i >= 0 ? `<div class="steps">${STEPS.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>` : ''}
      <div class="msg">${esc(clientMessage(t))}</div>
      ${open ? `<div style="margin-top:10px" class="small">
        <div class="muted">${esc(t.description)}</div>
        <div style="margin-top:6px">Raised ${esc(fmtDT(t.createdAt))}${t.preferredDate ? ` · preferred ${esc(fmtDate(t.preferredDate))}` : ''}</div>
        ${t.assignedName ? `<div>Technician: <b>${esc(t.assignedName)}</b>${t.scheduledAt ? ` · visit ${esc(fmtDT(t.scheduledAt))}` : ''}</div>` : ''}
        ${t.reportNo ? `<div>Service report: <b>${esc(t.reportNo)}</b></div>` : ''}
        <div class="timeline">${(t.log || []).slice().reverse().map((l) => `<div><b>${esc(l.t)}</b><br><span class="muted">${esc(fmtDT(l.at))}</span></div>`).join('')}</div>
      </div>` : '<div class="small muted" style="margin-top:6px">Tap for details</div>'}
    </div>`;
  }).join('')}</div>`;
}
function bindList() { $$('[data-t]').forEach((e) => (e.onclick = () => { S.open = S.open === e.dataset.t ? null : e.dataset.t; render(); })); }

start();
