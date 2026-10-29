// ID documents (passport, Emirates ID, SIRA, visa, labour card…) for staff and external workers:
// edit panel, viewer, and "send to customer" downloads (ZIP of copies, PDF ID pack, Excel list).
import {
  store, ID_FIELDS, ROLE_LABEL, saveIdInfo, uploadIdFile, readIdFile, deleteIdFile,
} from './fb.js';
import { esc, icon, pill, toast, modal, confirmBox, friendlyError, dateKey, fmtDate, parseKey } from './util.js';
import { downloadReport, saveBlob, loadLogo } from './report-lib.js';

export const DOC_KINDS = [
  { k: 'passport', label: 'Passport', num: 'passportNo', exp: 'passportExpiry' },
  { k: 'eid', label: 'Emirates ID', num: 'eidNo', exp: 'eidExpiry' },
  { k: 'sira', label: 'SIRA card', num: 'siraNo', exp: 'siraExpiry' },
  { k: 'visa', label: 'Visa', num: 'visaNo', exp: 'visaExpiry' },
  { k: 'mcc', label: 'Abu Dhabi MCC certificate', num: 'mccNo', exp: 'mccExpiry' },
  { k: 'labour', label: 'Labour card / work permit', num: 'labourCardNo', exp: 'labourCardExpiry' },
  { k: 'photo', label: 'Photo' },
  { k: 'other', label: 'Other documents' },
];
const KIND_LABEL = Object.fromEntries(DOC_KINDS.map((d) => [d.k, d.label]));

/** One place per copy, in this order. */
export const ID_SLOTS = [
  { kind: 'eid', side: 'front', label: 'Emirates ID - front', short: 'EID FRONT' },
  { kind: 'eid', side: 'back', label: 'Emirates ID - back', short: 'EID BACK' },
  { kind: 'visa', side: 'front', label: 'Visa', short: 'VISA' },
  { kind: 'passport', side: 'front', label: 'Passport - front (photo page)', short: 'PASSPORT FRONT' },
  { kind: 'passport', side: 'back', label: 'Passport - address page', short: 'PASSPORT ADDRESS' },
  { kind: 'sira', side: 'front', label: 'SIRA card', short: 'SIRA', optional: true },
  { kind: 'mcc', side: 'front', label: 'Abu Dhabi MCC certificate', short: 'ABU DHABI MCC', optional: true },
  { kind: 'photo', side: 'front', label: 'Passport-size photo', short: 'PHOTO' },
  { kind: 'labour', side: 'front', label: 'Labour card / work permit', short: 'LABOUR CARD', optional: true },
].map((x) => ({ ...x, key: `${x.kind}/${x.side}` }));
const TWO_SIDED = ['eid', 'passport'];

/** Puts each copy in its slot (newest wins); older copies without a side fill empty slots; the rest are "additional". */
export function assignSlots(files) {
  const slot = {};
  const extra = [];
  const loose = [];
  const t = (f) => (f.uploadedAt ? +f.uploadedAt : 9e15);
  for (const f of [...files].sort((a, b) => t(b) - t(a))) {
    const kinds = ID_SLOTS.filter((x) => x.kind === f.kind);
    if (!kinds.length) { extra.push(f); continue; }
    const side = f.side || (kinds.length === 1 ? kinds[0].side : '');
    const key = `${f.kind}/${side}`;
    if (side && kinds.some((x) => x.key === key) && !slot[key]) slot[key] = f; else loose.push(f);
  }
  for (const f of loose.reverse()) {
    const free = ID_SLOTS.find((x) => x.kind === f.kind && !slot[x.key]);
    if (!f.side && free) slot[free.key] = f; else extra.push(f);
  }
  extra.sort((a, b) => t(a) - t(b));
  return { slot, extra };
}
export function fileHeading(f) {
  if (f.title) return f.title;
  if (f.kind === 'other' || !KIND_LABEL[f.kind]) return f.name;
  return `${KIND_LABEL[f.kind]} (extra copy)`;
}
const OTHER_SUGGEST = ['Driving licence', 'Health card', 'Insurance card', 'Degree certificate', 'Experience letter', 'Labour contract'];
export function askHeading(title = 'Additional document', suggestions = OTHER_SUGGEST) {
  return new Promise((resolve) => {
    modal({
      title,
      body: `<label class="f"><span>Heading</span><input id="ah-t" placeholder="e.g. ${esc(suggestions[0] || 'Document')}"></label>
        <div class="chips" style="margin-top:8px">${suggestions.map((x) => `<span class="chip" data-s="${esc(x)}">${esc(x)}</span>`).join('')}</div>`,
      foot: '<button class="btn ghost" data-no>Cancel</button><button class="btn" data-yes>Next: choose file</button>',
      onMount: (m, close) => {
        const inp = m.querySelector('#ah-t');
        inp.focus();
        m.querySelectorAll('[data-s]').forEach((c) => { c.onclick = () => { inp.value = c.dataset.s; inp.focus(); }; });
        const ok = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } close(); resolve(v); };
        inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
        m.querySelector('[data-no]').onclick = () => { close(); resolve(null); };
        m.querySelector('[data-x]').addEventListener('click', () => resolve(null));
        m.querySelector('[data-yes]').onclick = ok;
      },
    });
  });
}
/** Lets the user pick a file (hidden input) — resolves with a File or null. */
export function chooseFile(accept = 'image/*,application/pdf') {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => resolve(i.files[0] || null);
    i.click();
  });
}

/**
 * Slot list (EID front, EID back, visa, passport front, passport address page, SIRA, MCC, photo, labour)
 * plus additional documents with headings. Used by the dashboard and the iPhone app.
 * ctx: { files(), info(), fieldAttr, upload({kind, side, title, ...prepared}), remove(f), busy?(msg) }
 */
export function slotListHtml(ctx) {
  const { slot, extra } = assignSlots(ctx.files());
  const info = ctx.info() || {};
  const fa = ctx.fieldAttr || 'data-field';
  const seen = new Set();
  const when = (f) => (f.uploadedAt ? ` ${fmtDate(f.uploadedAt)}` : '');
  return `<div class="slots">${ID_SLOTS.map((sl) => {
    const f = slot[sl.key];
    const k = DOC_KINDS.find((d) => d.k === sl.kind);
    const nums = k.num && !seen.has(k.k);
    if (nums) seen.add(k.k);
    return `<div class="slot ${f ? 'has' : ''}" data-slot="${sl.key}">
      <div class="slot-th" ${f ? `data-view="${f.id}" title="View"` : `data-pick="${sl.key}" title="Upload"`}>${f ? (isImg(f) ? '' : '<b>PDF</b>') : icon('plus', 18)}</div>
      <div class="slot-main"><div class="slot-t">${sl.short}</div>
        <div class="small ${f ? 'green-t' : sl.optional ? 'muted' : 'red-t'}">${f ? `Uploaded${esc(when(f))}${isImg(f) ? '' : ' · PDF'}` : sl.optional ? 'Not uploaded (if available)' : 'Not uploaded'}</div>
        ${nums ? `<div class="slot-nums"><input ${fa}="${k.num}" value="${esc(info[k.num] || '')}" placeholder="${esc(k.label.replace(' / work permit', ''))} number">
          <input type="date" ${fa}="${k.exp}" value="${esc(info[k.exp] || '')}" title="Expiry date"><span data-exp="${k.k}">${expiryPill(info[k.exp])}</span></div>` : ''}
      </div>
      <div class="slot-act">${f ? `<button class="btn sm ghost" data-pick="${sl.key}" title="Replace">${icon('upload', 14)} Replace</button>
        <button class="btn sm ghost icon" data-del="${f.id}" title="Delete">${icon('trash', 14)}</button>`
        : `<button class="btn sm" data-pick="${sl.key}">${icon('upload', 14)} Upload</button>`}</div>
    </div>`;
  }).join('')}
  <div class="slot-sec"><b>ADDITIONAL DOCUMENTS</b><span class="spacer"></span><button class="btn sm ghost" data-add-other>${icon('plus', 14)} Add with heading</button></div>
  ${extra.length ? extra.map((f) => `<div class="slot has">
      <div class="slot-th" data-view="${f.id}">${isImg(f) ? '' : '<b>PDF</b>'}</div>
      <div class="slot-main"><div class="slot-t">${esc(fileHeading(f))}</div><div class="small muted">${isImg(f) ? 'Photo' : 'PDF'}${esc(when(f))}</div></div>
      <div class="slot-act"><button class="btn sm ghost icon" data-del="${f.id}" title="Delete">${icon('trash', 14)}</button></div></div>`).join('')
    : '<div class="small muted" style="padding:4px 2px 8px">Driving licence, health card, certificates… add each one with its own heading.</div>'}
  </div>`;
}
export function wireSlotList(el, ctx) {
  const all = () => ctx.files();
  const find = (id) => all().find((f) => f.id === id);
  el.querySelectorAll('.slot-th[data-view]').forEach(async (t) => {
    const f = find(t.dataset.view);
    if (!f || !isImg(f)) return;
    try { const b64 = await fileData(f); t.innerHTML = `<img src="${dataUrl(f, b64)}" alt="">`; } catch { /* ignore */ }
  });
  el.querySelectorAll('[data-view]').forEach((t) => { t.onclick = () => { const f = find(t.dataset.view); if (f) viewFile(f); }; });
  const doUpload = async (file, meta, old) => {
    ctx.busy?.('Uploading…');
    try {
      const p = await prepareFile(file);
      await ctx.upload({ ...p, ...meta });
      if (old) { try { await ctx.remove(old); cache.delete(old.id); } catch { /* keep old */ } }
      toast(`${meta.title || ID_SLOTS.find((x) => x.key === `${meta.kind}/${meta.side}`)?.label || 'Document'} uploaded`);
    } catch (e) { toast(friendlyError(e), true); }
    ctx.busy?.('');
  };
  el.querySelectorAll('[data-pick]').forEach((b) => {
    b.onclick = async () => {
      const sl = ID_SLOTS.find((x) => x.key === b.dataset.pick);
      const file = await chooseFile();
      if (!file) return;
      const old = assignSlots(all()).slot[sl.key];
      const ext = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name) ? 'pdf' : 'jpg';
      await doUpload(file, { kind: sl.kind, side: sl.side, name: `${sl.short.replace(/ /g, '_')}.${ext}` }, old);
    };
  });
  el.querySelector('[data-add-other]')?.addEventListener('click', async () => {
    const title = await askHeading();
    if (!title) return;
    const file = await chooseFile();
    if (!file) return;
    await doUpload(file, { kind: 'other', side: '', title }, null);
  });
  el.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const f = find(b.dataset.del);
      if (!f || !await confirmBox('Delete copy?', `Delete ${fileHeading(f)}?`, { ok: 'Delete', danger: true })) return;
      try { await ctx.remove(f); cache.delete(f.id); toast('Deleted'); } catch (e) { toast(friendlyError(e), true); }
    };
  });
  el.querySelectorAll('input[type=date]').forEach((i) => {
    i.addEventListener('change', () => {
      const k = DOC_KINDS.find((d) => d.exp === (i.dataset.field || i.dataset.f));
      const box = k && el.querySelector(`[data-exp="${k.k}"]`);
      if (box) box.innerHTML = expiryPill(i.value);
    });
  });
}
export const MAX_FILE = 2 * 1024 * 1024; // 2 MB per document copy

// ------------------------------------------------------------------ owners
export const ownerFromUser = (u) => ({
  id: u.id, type: 'staff', name: u.name, code: u.loginId, org: u.designation || ROLE_LABEL[u.role] || '', trade: '', phone: u.phone,
  active: u.active,
});
export const ownerFromWorker = (w) => ({
  id: w.id, type: 'worker', name: w.name, code: w.code, org: w.company, trade: w.trade, phone: w.phone, active: w.active,
});
export function allOwners() {
  return [...store.users.map(ownerFromUser), ...store.workers.map(ownerFromWorker)];
}

// ------------------------------------------------------------------ expiry
export function expiryState(v) {
  if (!v) return '';
  const d = parseKey(v);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((d - parseKey(dateKey(new Date()))) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'ok';
}
export function expiryPill(v) {
  const s = expiryState(v);
  if (!s) return '';
  const label = fmtDate(parseKey(v));
  return s === 'expired' ? pill(`Expired ${label}`, 'red') : s === 'soon' ? pill(`Expires ${label}`, 'amber') : pill(`Valid to ${label}`, 'green');
}
/** Worst expiry status across an owner's documents (for list badges). */
export function ownerExpiry(ownerId) {
  const info = store.info(ownerId);
  if (!info) return { state: '', items: [] };
  const items = DOC_KINDS.filter((k) => k.exp && info[k.exp]).map((k) => ({ label: k.label, date: info[k.exp], state: expiryState(info[k.exp]) }));
  const state = items.some((i) => i.state === 'expired') ? 'expired' : items.some((i) => i.state === 'soon') ? 'soon' : items.length ? 'ok' : '';
  return { state, items };
}
export function docsSummaryHtml(ownerId) {
  const files = store.files(ownerId);
  const have = new Set(files.map((f) => f.kind));
  const ex = ownerExpiry(ownerId);
  const tags = ['passport', 'eid', 'sira'].map((k) => `<span class="doc-tag ${have.has(k) ? 'on' : ''}" title="${esc(KIND_LABEL[k])}${have.has(k) ? ' uploaded' : ' missing'}">${{ passport: 'PP', eid: 'EID', sira: 'SIRA' }[k]}</span>`).join('');
  const warn = ex.state === 'expired' ? pill('Expired', 'red') : ex.state === 'soon' ? pill('Expiring', 'amber') : '';
  return `<span class="doc-tags">${tags}</span> ${warn}`;
}

// ------------------------------------------------------------------ file prep
function readAsDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
}
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read this image. Use JPG, PNG or PDF (iPhone HEIC photos: export as JPG first).')); i.src = src; });
}
/** Images are resized to ≤2000 px JPEG (sharp enough to read, small enough to store). PDFs kept as-is. Max 2 MB each. */
export async function prepareFile(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_FILE) throw new Error(`${file.name} is larger than 2 MB. Compress the PDF or upload a photo of it.`);
    const url = await readAsDataUrl(file);
    return { name: file.name, mime: 'application/pdf', base64: url.split(',')[1] };
  }
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name)) {
    throw new Error(`${file.name}: only images (JPG/PNG) or PDF can be uploaded.`);
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    let out = c.toDataURL('image/jpeg', 0.85);
    if (out.length * 0.75 > MAX_FILE) out = c.toDataURL('image/jpeg', 0.6);
    if (out.length * 0.75 > MAX_FILE) throw new Error(`${file.name} is still larger than 2 MB after compressing.`);
    return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', base64: out.split(',')[1] };
  } finally { URL.revokeObjectURL(url); }
}

const cache = new Map();
async function fileData(f) {
  if (!cache.has(f.id)) cache.set(f.id, readIdFile(f).catch((e) => { cache.delete(f.id); throw e; }));
  return cache.get(f.id);
}
const dataUrl = (f, b64) => `data:${f.mime};base64,${b64}`;
const isImg = (f) => f.mime.startsWith('image/');
const sizeTxt = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export async function viewFile(f) {
  try {
    const b64 = await fileData(f);
    if (isImg(f)) {
      modal({ title: `${KIND_LABEL[f.kind] || 'Document'} — ${f.name}`, wide: true,
        body: `<img src="${dataUrl(f, b64)}" style="width:100%;border-radius:10px">`,
        foot: `<button class="btn" data-dl>${icon('download', 16)} Download</button>`,
        onMount: (m) => { m.querySelector('[data-dl]').onclick = () => saveBlob(b64ToBlob(b64, f.mime), f.name); } });
    } else {
      const url = URL.createObjectURL(b64ToBlob(b64, f.mime));
      const w = window.open(url, '_blank');
      if (!w) saveBlob(b64ToBlob(b64, f.mime), f.name);
    }
  } catch (e) { toast(friendlyError(e), true); }
}
export function b64ToBlob(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ------------------------------------------------------------------ edit panel
/**
 * Renders the ID document editor for one person into `el`.
 * Returns a cleanup function.
 */
export function docsPanel(el, owner) {
  const ctx = {
    files: () => store.files(owner.id),
    info: () => store.info(owner.id) || {},
    fieldAttr: 'data-field',
    upload: (p) => uploadIdFile({ ownerId: owner.id, ownerType: owner.type, ownerName: owner.name, ...p }),
    remove: (f) => deleteIdFile(f),
  };
  const draw = () => {
    // keep typed numbers / dates while copies change
    const typed = {};
    el.querySelectorAll('[data-field]').forEach((i) => { typed[i.dataset.field] = i.value; });
    el.innerHTML = `
    <div class="row" style="margin-bottom:10px;gap:10px"><button class="btn" data-scan style="background:#D98A1A;border-color:#D98A1A">📷 Scan documents step by step</button>
      <span class="small muted">or upload each one below · photo or PDF, max 2 MB</span></div>
    ${slotListHtml(ctx)}
    <div class="row" style="margin-top:12px;gap:12px;align-items:flex-end">
      <label class="f" style="margin:0;flex:1;min-width:160px"><span>Nationality</span><input data-field="nationality" value="${esc((store.info(owner.id) || {}).nationality || '')}"></label>
      <label class="f" style="margin:0;flex:2;min-width:200px"><span>Notes</span><input data-field="idNotes" value="${esc((store.info(owner.id) || {}).idNotes || '')}"></label>
      <button class="btn" data-save-info>${icon('check', 16)} Save numbers & dates</button>
    </div>
    <div class="small muted" style="margin-top:6px">Copies upload straight away. Numbers and expiry dates are saved with the button.</div>`;
    el.querySelectorAll('[data-field]').forEach((i) => { if (typed[i.dataset.field] != null) i.value = typed[i.dataset.field]; });
    wireSlotList(el, ctx);
    el.querySelector('[data-scan]').onclick = () => scanWizard({
      owner,
      files: () => store.files(owner.id),
      info: () => store.info(owner.id) || {},
      upload: (st, p) => uploadIdFile({ ownerId: owner.id, ownerType: owner.type, ownerName: owner.name, kind: st.kind, side: st.side,
        name: `${st.kind}-${st.side}.${p.mime === 'application/pdf' ? 'pdf' : 'jpg'}`, mime: p.mime, base64: p.base64 }),
      remove: async (f) => { await deleteIdFile(f); cache.delete(f.id); },
      saveInfo: (fields) => saveIdInfo(owner.id, owner.type, fields),
      onDone: () => draw(),
    });
    el.querySelector('[data-save-info]').onclick = async (ev) => {
      const btn = ev.currentTarget;
      const data = {};
      el.querySelectorAll('[data-field]').forEach((i) => { data[i.dataset.field] = i.value.trim(); });
      btn.disabled = true;
      try { await saveIdInfo(owner.id, owner.type, { ...data, name: owner.name }); toast('ID details saved'); } catch (e) { toast(friendlyError(e), true); }
      btn.disabled = false;
    };
  };
  draw();
  let sig = JSON.stringify(store.files(owner.id).map((f) => f.id));
  return store.on(() => {
    const s2 = JSON.stringify(store.files(owner.id).map((f) => f.id));
    if (s2 !== sig) { sig = s2; draw(); }
  });
}

// ------------------------------------------------------------------ downloads
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'person';

function detailRow(o) {
  const i = store.info(o.id) || {};
  const files = store.files(o.id);
  return [
    o.type === 'worker' ? 'External worker' : 'Staff', o.name, o.code || '', o.org || '', o.trade || '', o.phone || '', i.nationality || '',
    i.passportNo || '', i.passportExpiry || '', i.eidNo || '', i.eidExpiry || '', i.siraNo || '', i.siraExpiry || '',
    i.visaNo || '', i.visaExpiry || '', i.labourCardNo || '', i.labourCardExpiry || '',
    files.map((f) => KIND_LABEL[f.kind] || f.kind).filter((v, n, a) => a.indexOf(v) === n).join(', '),
  ];
}
const DETAIL_COLS = ['Type', 'Name', 'ID / Code', 'Company / Designation', 'Trade', 'Phone', 'Nationality', 'Passport no', 'Passport expiry',
  'Emirates ID no', 'EID expiry', 'SIRA no', 'SIRA expiry', 'Visa no', 'Visa expiry', 'Labour card no', 'Labour card expiry', 'Copies on file'];

export function idListReport(owners, title = 'Staff ID details') {
  return {
    title, subtitle: `${owners.length} people · generated ${fmtDate(new Date())}`, filename: `${safe(title)}-${dateKey(new Date())}`,
    orientation: 'landscape', pdfFont: 7,
    sheets: [{ name: 'ID details', columns: DETAIL_COLS, widths: [13, 24, 11, 20, 14, 15, 13, 14, 12, 20, 12, 14, 12, 14, 12, 14, 14, 30],
      rows: owners.map(detailRow), pdfColumns: [1, 3, 5, 6, 7, 8, 9, 10, 11, 12] }],
  };
}
export const downloadIdList = (owners, title, fmt = 'xlsx') => downloadReport(idListReport(owners, title), fmt);

async function ownerFiles(o, progress) {
  const out = [];
  for (const f of store.files(o.id)) {
    progress?.(`${o.name}: ${f.name}`);
    out.push({ f, b64: await fileData(f) });
  }
  return out;
}

/** ZIP: one folder per person with their copies, plus an Excel sheet of all the numbers. */
export async function downloadIdZip(owners, title = 'ID documents', progress) {
  const JSZip = window.JSZip;
  if (!JSZip) throw new Error('ZIP library did not load — check your internet connection and reload.');
  const zip = new JSZip();
  const used = new Set();
  let count = 0;
  for (const o of owners) {
    let folder = safe(o.name);
    while (used.has(folder)) folder += ' ';
    used.add(folder);
    const dir = zip.folder(folder.trim());
    const n = {};
    const files = await ownerFiles(o, progress);
    const { slot } = assignSlots(files.map((x) => x.f));
    const slotOf = Object.fromEntries(Object.entries(slot).map(([k, f]) => [f.id, ID_SLOTS.find((x) => x.key === k)]));
    for (const { f, b64 } of files) {
      const sl = slotOf[f.id];
      const base = sl ? sl.label : fileHeading(f);
      n[base] = (n[base] || 0) + 1;
      const ext = f.mime === 'application/pdf' ? 'pdf' : 'jpg';
      dir.file(`${safe(o.name)} - ${safe(base)}${n[base] > 1 ? ` ${n[base]}` : ''}.${ext}`, b64, { base64: true });
      count++;
    }
  }
  if (window.XLSX) {
    const rep = idListReport(owners, title);
    const ws = window.XLSX.utils.aoa_to_sheet([[rep.title], [rep.subtitle], [], DETAIL_COLS, ...rep.sheets[0].rows]);
    ws['!cols'] = rep.sheets[0].widths.map((w) => ({ wch: w }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'ID details');
    zip.file('ID details.xlsx', window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  }
  progress?.('Compressing…');
  const blob = await zip.generateAsync({ type: 'blob' });
  saveBlob(blob, `${safe(title)}-${dateKey(new Date())}.zip`);
  return count;
}

/** One PDF: a page per person with their details and every image copy (PDF copies are listed — they're in the ZIP). */
export async function downloadIdPack(owners, title = 'ID documents', progress) {
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) throw new Error('PDF library did not load — check your internet connection.');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const clean = (v) => (v == null ? '' : String(v).replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, ''));
  const logo = await loadLogo();
  const header = (name, sub) => {
    doc.setFillColor(255, 247, 233); doc.rect(0, 0, W, 54, 'F');
    doc.setFillColor(252, 176, 64); doc.rect(0, 54, W, 2.5, 'F');
    let tx = 28;
    if (logo) { doc.addImage(logo, 'PNG', 28, 10, 70, 33); doc.setDrawColor(238, 214, 170); doc.setLineWidth(0.8); doc.line(108, 12, 108, 42); tx = 120; }
    doc.setTextColor(43, 43, 44); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(clean(name), tx, 27);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(115, 112, 106); doc.text(clean(sub), tx, 42);
    doc.setTextColor(28, 42, 51);
  };
  for (let idx = 0; idx < owners.length; idx++) {
    const o = owners[idx];
    if (idx) doc.addPage();
    header(o.name, `${o.type === 'worker' ? 'External worker' : 'Staff'}${o.org ? ` · ${o.org}` : ''}${o.trade ? ` · ${o.trade}` : ''}`);
    const i = store.info(o.id) || {};
    const rows = [['Phone', o.phone || ''], ['Nationality', i.nationality || '']];
    DOC_KINDS.filter((k) => k.num).forEach((k) => {
      if (i[k.num] || i[k.exp]) rows.push([k.label, `${i[k.num] || ''}${i[k.exp] ? `   (expiry ${i[k.exp]})` : ''}`]);
    });
    doc.autoTable({
      startY: 70, body: rows.map((r) => r.map(clean)), theme: 'grid', margin: { left: 28, right: 28 },
      styles: { fontSize: 9.5, cellPadding: 4 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 130, fillColor: [247, 246, 243] } },
    });
    let y = doc.lastAutoTable.finalY + 16;
    const files = await ownerFiles(o, progress);
    const pdfs = files.filter((x) => !isImg(x.f));
    if (pdfs.length) {
      doc.setFontSize(8.5); doc.setTextColor(120, 120, 125);
      doc.text(clean(`PDF copies (in the ZIP download): ${pdfs.map((x) => x.f.name).join(', ')}`), 28, y, { maxWidth: W - 56 });
      doc.setTextColor(28, 42, 51); y += 18;
    }
    for (const { f, b64 } of files.filter((x) => isImg(x.f))) {
      const img = await loadImage(dataUrl(f, b64));
      const maxW = W - 56, maxH = H * 0.42;
      const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1.5);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      if (y + h + 20 > H - 24) { doc.addPage(); header(o.name, 'continued'); y = 72; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text(clean(KIND_LABEL[f.kind] || 'Document'), 28, y);
      doc.addImage(dataUrl(f, b64), 'JPEG', 28, y + 6, w, h);
      y += h + 24;
    }
    if (!files.length) { doc.setFontSize(10); doc.setTextColor(150, 150, 150); doc.text('No copies uploaded yet.', 28, y + 4); doc.setTextColor(28, 42, 51); }
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(140, 140, 140);
    doc.text(clean(`${title} · confidential · page ${p} of ${pages}`), 28, H - 12);
  }
  doc.save(`${safe(title)}-${dateKey(new Date())}.pdf`);
}

// ------------------------------------------------------------------ ID sheets (3 pages per person)
// Page 1: Emirates ID front & back · Page 2: visa page + document table, photo, SIRA card · Page 3: passport front & back.
let pdfjsPromise = null;
function pdfjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        res(window.pdfjsLib);
      };
      s.onerror = () => { pdfjsPromise = null; rej(new Error('PDF reader did not load — check your internet connection.')); };
      document.head.appendChild(s);
    });
  }
  return pdfjsPromise;
}
/** A PDF copy → its first pages as JPEG images (page 1 = front, page 2 = back). */
async function pdfToImages(b64, max = 2) {
  const lib = await pdfjs();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const pdf = await lib.getDocument({ data: bytes }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(max, pdf.numPages); i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(c.toDataURL('image/jpeg', 0.85));
  }
  return out;
}
/** Crops an image to a box ratio (for the passport photo). */
async function coverCrop(src, ratio) {
  const img = await loadImage(src);
  const iw = img.naturalWidth, ih = img.naturalHeight;
  let w = iw, h = iw / ratio;
  if (h > ih) { h = ih; w = ih * ratio; }
  const c = document.createElement('canvas');
  c.width = Math.round(Math.min(w, 600)); c.height = Math.round(c.width / ratio);
  c.getContext('2d').drawImage(img, (iw - w) / 2, (ih - h) / 4, w, h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

export async function downloadIdSheets(owners, title = 'ID documents', progress) {
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) throw new Error('PDF library did not load — check your internet connection.');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 30, CW = W - M * 2;
  const clean = (v) => (v == null ? '' : String(v).replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, ''));
  const logo = await loadLogo();
  const fmtD = (v) => { if (!v) return '-'; const d = parseKey(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
  let first = true;

  const header = (o, section) => {
    if (!first) doc.addPage();
    first = false;
    // Light bar in the logo's colours: cream background, orange rule, charcoal text.
    const BH = 66;
    doc.setFillColor(255, 247, 233); doc.rect(0, 0, W, BH, 'F');
    doc.setFillColor(252, 176, 64); doc.rect(0, BH, W, 2.5, 'F');
    let tx = M;
    if (logo) {
      doc.addImage(logo, 'PNG', M, 14, 80, 38);
      doc.setDrawColor(238, 214, 170); doc.setLineWidth(0.8); doc.line(M + 94, 16, M + 94, 50);
      tx = M + 108;
    }
    doc.setTextColor(43, 43, 44); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(clean(o.name), tx, 31);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(115, 112, 106);
    doc.text(clean([o.type === 'worker' ? 'External worker' : 'Staff', o.org, o.trade, o.code ? `ID ${o.code}` : ''].filter(Boolean).join('  |  ')), tx, 45);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(150, 145, 136);
    doc.text('LEADERS LINE TRADING LLC', W - M, 24, { align: 'right' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(43, 43, 44);
    const sec = clean(section.toUpperCase());
    doc.text(sec, W - M, 39, { align: 'right' });
    const sw = doc.getTextWidth(sec);
    doc.setFillColor(252, 176, 64); doc.rect(W - M - Math.min(sw, 40), 43.5, Math.min(sw, 40), 2.2, 'F');
    doc.setTextColor(40, 40, 40);
  };
  // A framed slot with a label; the image is fitted inside (or "not uploaded").
  const slot = async (src, x, y, w, h, label, missing) => {
    doc.setDrawColor(225, 222, 216); doc.setLineWidth(0.8);
    doc.setFillColor(250, 249, 247); doc.roundedRect(x, y, w, h, 8, 8, src ? 'S' : 'FD');
    if (src) {
      try {
        const img = await loadImage(src);
        const pad = 10, lw = w - pad * 2, lh = h - pad * 2 - 14;
        const s = Math.min(lw / img.naturalWidth, lh / img.naturalHeight);
        const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
        doc.addImage(src, src.startsWith('data:image/png') ? 'PNG' : 'JPEG', x + (w - iw) / 2, y + 18 + (lh - ih) / 2 + pad / 2, iw, ih, undefined, 'MEDIUM');
      } catch { src = null; }
    }
    if (!src) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(165, 165, 165);
      doc.text(clean(missing), x + w / 2, y + h / 2, { align: 'center' });
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.setFillColor(252, 176, 64); doc.roundedRect(x + 8, y + 7, doc.getTextWidth(clean(label)) * 1.05 + 14, 15, 4, 4, 'F');
    doc.setTextColor(43, 43, 44);
    doc.text(clean(label), x + 15, y + 17.5);
    doc.setTextColor(40, 40, 40);
  };
  // Front and back (or address page) on one page.
  const twoSides = async (front, back, name, backName = 'back') => {
    const top = 80, gap = 14, h = (H - 40 - top - gap) / 2;
    await slot(front, M, top, CW, h, `${name} - FRONT`, `${name} front - not uploaded`);
    await slot(back, M, top + h + gap, CW, h, `${name} - ${backName.toUpperCase()}`, `${name} ${backName} - not uploaded`);
  };

  for (let n = 0; n < owners.length; n++) {
    const o = owners[n];
    progress?.(`${o.name} (${n + 1}/${owners.length})`);
    const files = await ownerFiles(o, progress);
    const i = store.info(o.id) || {};
    const { slot: sl } = assignSlots(files.map((x) => x.f));
    const b64Of = new Map(files.map((x) => [x.f.id, x.b64]));
    // Images of one slot (a PDF gives up to 2 pages — e.g. both sides of the EID in one PDF).
    const imgs = async (key) => {
      const f = sl[key];
      if (!f) return [];
      const b64 = b64Of.get(f.id);
      if (isImg(f)) return [dataUrl(f, b64)];
      try { return await pdfToImages(b64, 2); } catch (e) { console.warn('pdf render', e); return []; }
    };
    const pair = async (kind) => {
      const fr = await imgs(`${kind}/front`), bk = await imgs(`${kind}/back`);
      return [fr[0] || null, bk[0] || (sl[`${kind}/back`] ? null : fr[1] || null)];
    };
    const eid = await pair('eid');
    const visa = await imgs('visa/front');
    const pass = await pair('passport');
    const sira = await imgs('sira/front');
    const photo = (await imgs('photo/front'))[0];

    // Page 1 — Emirates ID
    header(o, 'Emirates ID');
    await twoSides(eid[0], eid[1], 'Emirates ID');

    // Page 2 — Visa (top) · details, photo, SIRA (bottom)
    header(o, 'Visa & details');
    const top = 80, half = (H - 40 - top - 14) / 2;
    await slot(visa[0], M, top, CW, half, 'VISA', 'Visa page - not uploaded');
    const y2 = top + half + 14;
    const rightW = 150, leftW = CW - rightW - 14, rx = M + leftW + 14;
    const today = parseKey(dateKey(new Date()));
    // Only documents this person actually has (a number, an expiry date or an uploaded copy).
    const rows = DOC_KINDS.filter((k) => k.num && (String(i[k.num] || '').trim() || i[k.exp] || files.some((x) => x.f.kind === k.k))).map((k) => {
      const exp = i[k.exp];
      let status = '-';
      if (exp) {
        const days = Math.floor((parseKey(exp) - today) / 86400000);
        status = Number.isNaN(days) ? '-' : days < 0 ? 'Expired' : days <= 30 ? `Expires in ${days} d` : 'Valid';
      }
      return [k.label.replace(' / work permit', ''), i[k.num] || '-', fmtD(exp), status];
    });
    if (!rows.length) rows.push(['No document numbers recorded', '-', '-', '-']);
    doc.autoTable({
      startY: y2, margin: { left: M, right: W - M - leftW }, tableWidth: leftW,
      head: [['Document', 'Number', 'Expiry', 'Status']], body: rows.map((r) => r.map(clean)), theme: 'grid',
      styles: { fontSize: 9, cellPadding: 5, lineColor: [225, 222, 216], textColor: [40, 40, 40] },
      headStyles: { fillColor: [64, 64, 65], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [252, 249, 243] },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 92 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 74 }, 3: { cellWidth: 72 } },
      didParseCell: (d) => {
        if (d.section !== 'body' || d.column.index !== 3) return;
        const t = String(d.cell.raw);
        d.cell.styles.fontStyle = 'bold';
        d.cell.styles.textColor = t === 'Expired' ? [214, 69, 69] : t.startsWith('Expires') ? [224, 142, 43] : t === 'Valid' ? [46, 158, 106] : [160, 160, 160];
      },
    });
    let ly = doc.lastAutoTable.finalY + 10;
    const nat = i.nationality ? `Nationality: ${i.nationality}` : '';
    if (sira.length) {
      const sh = Math.min(H - 40 - ly, 170);
      if (sh > 80) await slot(sira[0], M, ly, leftW, sh, 'SIRA CARD', '');
    }
    // Right column: passport-size photo + contact
    const pw = 110, ph = pw * 45 / 35, px = rx + (rightW - pw) / 2;
    doc.setDrawColor(225, 222, 216); doc.setFillColor(250, 249, 247); doc.roundedRect(px - 4, y2 - 4, pw + 8, ph + 8, 6, 6, photo ? 'S' : 'FD');
    if (photo) { try { doc.addImage(await coverCrop(photo, 35 / 45), 'JPEG', px, y2, pw, ph); } catch { /* skip */ } }
    else { doc.setFontSize(8.5); doc.setTextColor(165, 165, 165); doc.text('Photo not', px + pw / 2, y2 + ph / 2 - 4, { align: 'center' }); doc.text('uploaded', px + pw / 2, y2 + ph / 2 + 8, { align: 'center' }); }
    let cy = y2 + ph + 22;
    doc.setTextColor(40, 40, 40); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.splitTextToSize(clean(o.name), rightW).forEach((l) => { doc.text(l, rx + rightW / 2, cy, { align: 'center' }); cy += 12; });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(100, 100, 100);
    [o.org, o.trade, nat, o.phone ? `Tel ${o.phone}` : ''].filter(Boolean).forEach((t) => {
      doc.splitTextToSize(clean(t), rightW).forEach((l) => { doc.text(l, rx + rightW / 2, cy, { align: 'center' }); cy += 11; });
    });

    // Page 3 — Passport
    header(o, 'Passport');
    await twoSides(pass[0], pass[1], 'Passport', 'address page');

    // Page 4 — Abu Dhabi MCC certificate (only when uploaded)
    const mcc = await imgs('mcc/front');
    if (mcc.length) {
      header(o, 'MCC certificate');
      await slot(mcc[0], M, 74, CW, H - 40 - 74, 'ABU DHABI MCC CERTIFICATE', '');
    }
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(235, 232, 226); doc.line(M, H - 26, W - M, H - 26);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(140, 140, 140);
    doc.text(clean(`Leaders Line Trading LLC  ·  ${title}  ·  confidential`), M, H - 14);
    doc.text(`Page ${p} of ${pages}  ·  ${new Date().toLocaleDateString('en-GB')}`, W - M, H - 14, { align: 'right' });
  }
  doc.save(`${safe(title)}-${dateKey(new Date())}.pdf`);
}

// ------------------------------------------------------------------ guided scanning
// One document at a time, in a fixed order, with tips for a clear photo and a blur / light check.
export const SCAN_STEPS = [
  { kind: 'eid', side: 'front', title: 'EID front', shape: 'card', num: 'eidNo', exp: 'eidExpiry', numLabel: 'Emirates ID number' },
  { kind: 'eid', side: 'back', title: 'EID back', shape: 'card' },
  { kind: 'visa', side: 'front', title: 'Visa', shape: 'page', num: 'visaNo', exp: 'visaExpiry', numLabel: 'Visa / file number' },
  { kind: 'passport', side: 'front', title: 'Passport front (photo page)', shape: 'page', num: 'passportNo', exp: 'passportExpiry', numLabel: 'Passport number' },
  { kind: 'passport', side: 'back', title: 'Passport address page', shape: 'page' },
  { kind: 'sira', side: 'front', title: 'SIRA card (if you have one)', shape: 'card', num: 'siraNo', exp: 'siraExpiry', numLabel: 'SIRA number', optional: true },
  { kind: 'mcc', side: 'front', title: 'Abu Dhabi MCC certificate (if you have one)', shape: 'page', num: 'mccNo', exp: 'mccExpiry', numLabel: 'Certificate number', optional: true },
  { kind: 'photo', side: 'front', title: 'Passport-size photo', shape: 'photo' },
];
const SHAPE = { card: [85.6, 54], page: [125, 88], photo: [35, 45] };
const TIPS = {
  card: 'Put the card flat on a dark table. Hold the phone straight above it so the card fills the frame. Avoid shadows and light reflections.',
  page: 'Open the page fully, flat, in good light. All four corners and every line of text must be visible. No fingers on the page.',
  photo: 'Plain white or light background, face straight to the camera, shoulders visible, good light. Or upload an existing passport photo.',
};

/** Prepares a scan: straightens EXIF rotation, resizes to ≤2000 px, lightly sharpens contrast, checks blur & light. */
export async function processScan(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return { ...(await prepareFile(file)), warn: [] };
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    bmp = await loadImage(URL.createObjectURL(file));
  }
  const iw = bmp.width || bmp.naturalWidth, ih = bmp.height || bmp.naturalHeight;
  const sc = Math.min(1, 2000 / Math.max(iw, ih));
  const c = document.createElement('canvas');
  c.width = Math.round(iw * sc); c.height = Math.round(ih * sc);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.filter = 'contrast(1.1) brightness(1.03)';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  ctx.filter = 'none';
  // Quality check on a small grey copy: Laplacian variance (sharpness) and mean brightness.
  const q = document.createElement('canvas');
  const qs = 360 / Math.max(c.width, c.height);
  q.width = Math.round(c.width * qs); q.height = Math.round(c.height * qs);
  const qx = q.getContext('2d');
  qx.drawImage(bmp, 0, 0, q.width, q.height); // the original, before contrast adjustment
  const px = qx.getImageData(0, 0, q.width, q.height).data;
  const g = new Float32Array(q.width * q.height);
  let sum = 0, bright = 0;
  for (let i = 0; i < g.length; i++) { g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]; sum += g[i]; if (g[i] >= 254) bright++; }
  const mean = sum / g.length;
  let lv = 0, ls = 0, n = 0;
  for (let y = 1; y < q.height - 1; y++) for (let x = 1; x < q.width - 1; x++) {
    const i = y * q.width + x;
    const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - q.width] - g[i + q.width];
    ls += l; lv += l * l; n++;
  }
  const sharp = n ? lv / n - (ls / n) ** 2 : 0;
  const warn = [];
  if (sharp < 60) warn.push('The photo looks blurry — hold the phone still and tap the screen to focus.');
  if (mean < 70) warn.push('The photo is too dark — move to better light.');
  if (bright / g.length > 0.2) warn.push('There is glare / reflection on the document — tilt it slightly away from the light.');
  let out = c.toDataURL('image/jpeg', 0.88);
  if (out.length * 0.75 > MAX_FILE) out = c.toDataURL('image/jpeg', 0.7);
  return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', base64: out.split(',')[1], warn, sharp: Math.round(sharp), mean: Math.round(mean) };
}

/**
 * Guided scan wizard.
 * ctx: { owner, files: () => current files, info: () => current numbers, upload(step, prepared), remove(file), saveInfo(fields) }
 */
export function scanWizard(ctx, startAt = 0) {
  let idx = startAt, prepared = null, busy = false;
  const status = (st) => ctx.files().filter((f) => f.kind === st.kind && (f.side === st.side || (!f.side && st.side === 'front' && !['eid', 'passport'].includes(st.kind))));
  const { el, close } = modal({ title: `Scan documents — ${ctx.owner.name}`, wide: true, body: '<div id="sw"></div>' });
  const box = el.querySelector('#sw');
  const draw = () => {
    const st = SCAN_STEPS[idx];
    const done = status(st);
    const info = ctx.info() || {};
    const [rw, rh] = SHAPE[st.shape];
    box.innerHTML = `
      <div class="sw-dots">${SCAN_STEPS.map((s2, i) => `<span class="${i === idx ? 'on' : ''} ${status(s2).length ? 'ok' : ''}" title="${esc(s2.title)}" data-go="${i}">${status(s2).length ? '✓' : i + 1}</span>`).join('')}</div>
      <h3 style="margin:10px 0 2px">${idx + 1}. ${esc(st.title)}</h3>
      <div class="small muted">${esc(TIPS[st.shape])}</div>
      <div class="sw-frame" style="aspect-ratio:${rw}/${rh};max-width:${st.shape === 'photo' ? 220 : 520}px;width:min(100%, calc(36vh * ${(rw / rh).toFixed(3)}))">
        ${prepared ? (prepared.mime === 'application/pdf' ? '<div class="sw-pdf">PDF selected</div>' : `<img src="data:${prepared.mime};base64,${prepared.base64}" alt="">`)
          : `<div class="sw-guide"><span>${done.length ? '✓ Already scanned — take a new photo to replace it' : 'Fit the document inside this frame'}</span></div>`}
      </div>
      ${prepared && prepared.warn?.length ? `<div class="sw-warn">${prepared.warn.map((w) => `⚠ ${esc(w)}`).join('<br>')}<br><b>Retake</b> for a clearer copy, or use it anyway.</div>` : ''}
      ${prepared && !prepared.warn?.length && prepared.mime !== 'application/pdf' ? '<div class="sw-ok">✓ Looks clear</div>' : ''}
      ${st.num ? `<div class="grid cols-2" style="gap:10px;margin-top:10px">
        <label class="f"><span>${esc(st.numLabel)}</span><input id="sw-num" value="${esc(info[st.num] || '')}"></label>
        <label class="f"><span>Expiry date</span><input id="sw-exp" type="date" value="${esc(info[st.exp] || '')}"></label></div>` : ''}
      <div class="sw-actions">
        <label class="btn">${icon('plus', 16)} ${prepared || done.length ? 'Retake photo' : 'Take photo'}<input type="file" accept="image/*" capture="environment" id="sw-cam" hidden></label>
        <label class="btn ghost">Choose file / PDF<input type="file" accept="image/*,application/pdf" id="sw-file" hidden></label>
        <span class="spacer"></span>
        ${idx > 0 ? '<button class="btn ghost" id="sw-back">Back</button>' : ''}
        <button class="btn ghost" id="sw-skip">${done.length && !prepared ? 'Next' : st.optional ? "Don't have it" : 'Skip'}</button>
        ${prepared ? `<button class="btn" id="sw-save" style="background:#2E9E6A;border-color:#2E9E6A">${idx === SCAN_STEPS.length - 1 ? 'Save & finish' : 'Save & next'}</button>` : ''}
      </div>
      <div class="small muted" id="sw-msg" style="margin-top:6px"></div>`;
    const msg = (t) => { box.querySelector('#sw-msg').textContent = t; };
    const pick = async (inp) => {
      const f = inp.files[0];
      inp.value = '';
      if (!f) return;
      msg('Checking the photo…');
      try { prepared = await processScan(f); draw(); } catch (e) { msg(friendlyError(e)); }
    };
    box.querySelector('#sw-cam').onchange = (e) => pick(e.target);
    box.querySelector('#sw-file').onchange = (e) => pick(e.target);
    box.querySelectorAll('[data-go]').forEach((d) => { d.onclick = () => { if (!busy) { idx = Number(d.dataset.go); prepared = null; draw(); } }; });
    box.querySelector('#sw-back')?.addEventListener('click', () => { idx--; prepared = null; draw(); });
    const saveNumbers = async () => {
      if (!st.num) return;
      const num = box.querySelector('#sw-num').value.trim(), exp = box.querySelector('#sw-exp').value;
      if (num !== (info[st.num] || '') || exp !== (info[st.exp] || '')) await ctx.saveInfo({ [st.num]: num, [st.exp]: exp });
    };
    const next = () => {
      prepared = null;
      if (idx < SCAN_STEPS.length - 1) { idx++; draw(); } else { close(); toast('Documents saved'); ctx.onDone?.(); }
    };
    box.querySelector('#sw-skip').onclick = async () => { try { await saveNumbers(); } catch (e) { msg(friendlyError(e)); return; } next(); };
    box.querySelector('#sw-save')?.addEventListener('click', async () => {
      if (busy) return;
      busy = true; msg('Saving…');
      try {
        await saveNumbers();
        const old = status(st);
        await ctx.upload(st, prepared);
        for (const f of old) { try { await ctx.remove(f); } catch { /* keep the old copy if it can't be removed */ } }
        busy = false; next();
      } catch (e) { busy = false; msg(friendlyError(e)); }
    });
  };
  draw();
}

/** Shared "send to customer" action bar handler. */
export function exportMenu(owners, title) {
  if (!owners.length) { toast('Select at least one person first', true); return; }
  modal({
    title: `Download IDs — ${owners.length} ${owners.length === 1 ? 'person' : 'people'}`,
    body: `<label class="f"><span>File name / title</span><input id="ix-t" value="${esc(title)}"></label>
      <div class="grid" style="gap:10px;margin-top:14px">
        <button class="btn block" data-x="sheets">${icon('download', 16)} ID sheets (PDF) — per person: Emirates ID · Visa & details · Passport (+ MCC certificate)</button>
        <button class="btn ghost block" data-x="zip">ZIP — all copies in folders + Excel list</button>
        <button class="btn ghost block" data-x="pack">PDF ID pack — one page per person with copies</button>
        <button class="btn ghost block" data-x="xlsx">Excel — numbers & expiry dates only</button>
      </div>
      <div class="small muted" id="ix-p" style="margin-top:12px">${owners.map((o) => esc(o.name)).join(', ')}</div>`,
    onMount: (m) => {
      const p = m.querySelector('#ix-p');
      m.querySelectorAll('[data-x]').forEach((b) => {
        b.onclick = async () => {
          const t = m.querySelector('#ix-t').value.trim() || title;
          m.querySelectorAll('[data-x]').forEach((x) => { x.disabled = true; });
          const progress = (s) => { p.textContent = `Preparing… ${s}`; };
          try {
            if (b.dataset.x === 'sheets') { await downloadIdSheets(owners, t, progress); toast('ID sheets ready'); }
            else if (b.dataset.x === 'zip') { const n = await downloadIdZip(owners, t, progress); toast(`ZIP ready — ${n} copies`); }
            else if (b.dataset.x === 'pack') { await downloadIdPack(owners, t, progress); toast('PDF ready'); }
            else await downloadIdList(owners, t);
            p.textContent = 'Done.';
          } catch (e) { console.error(e); toast(friendlyError(e), true); p.textContent = friendlyError(e); }
          m.querySelectorAll('[data-x]').forEach((x) => { x.disabled = false; });
        };
      });
    },
  });
}
