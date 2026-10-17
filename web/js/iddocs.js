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
  { k: 'labour', label: 'Labour card / work permit', num: 'labourCardNo', exp: 'labourCardExpiry' },
  { k: 'photo', label: 'Photo' },
  { k: 'other', label: 'Other documents' },
];
const KIND_LABEL = Object.fromEntries(DOC_KINDS.map((d) => [d.k, d.label]));
const MAX_PDF = 6 * 1024 * 1024;

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
/** Images are resized to ≤2000 px JPEG (sharp enough to read, small enough to store). PDFs kept as-is. */
export async function prepareFile(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_PDF) throw new Error(`${file.name} is larger than 6 MB. Compress the PDF or upload a photo of it.`);
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
    const out = c.toDataURL('image/jpeg', 0.85);
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
function b64ToBlob(b64, mime) {
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
  const info = store.info(owner.id) || {};
  el.innerHTML = `
    <div class="idgrid">
      ${DOC_KINDS.map((k) => `<div class="idcard" data-kind="${k.k}">
        <div class="idhead"><b>${esc(k.label)}</b><span data-exp="${k.k}">${k.exp ? expiryPill(info[k.exp]) : ''}</span></div>
        ${k.num ? `<div class="idfields">
          <label class="f"><span>Number</span><input data-field="${k.num}" value="${esc(info[k.num] || '')}"></label>
          <label class="f"><span>Expiry</span><input type="date" data-field="${k.exp}" value="${esc(info[k.exp] || '')}"></label></div>` : ''}
        <div class="idfiles" data-files="${k.k}"></div>
        <label class="btn sm ghost upl">${icon('plus', 14)} Upload copy<input type="file" multiple accept="image/*,application/pdf" data-up="${k.k}" hidden></label>
      </div>`).join('')}
    </div>
    <div class="fields" style="margin-top:12px">
      <label class="f"><span>Nationality</span><input data-field="nationality" value="${esc(info.nationality || '')}"></label>
      <label class="f"><span>Notes</span><input data-field="idNotes" value="${esc(info.idNotes || '')}"></label>
    </div>
    <div class="row" style="margin-top:12px"><span class="small muted">Copies upload straight away. Numbers and dates are saved with the button.</span>
      <span class="spacer"></span><button class="btn" data-save-info>${icon('check', 16)} Save ID details</button></div>`;

  const drawFiles = () => {
    el.querySelectorAll('[data-files]').forEach((box) => {
      const files = store.files(owner.id).filter((f) => f.kind === box.dataset.files);
      box.innerHTML = files.length ? files.map((f) => `<div class="idfile" data-fid="${f.id}">
        <div class="thumb">${isImg(f) ? '<span class="muted small">…</span>' : '<b>PDF</b>'}</div>
        <div class="grow"><div class="nm">${esc(f.name)}</div><div class="small muted">${sizeTxt(f.size)}${f.uploadedAt ? ` · ${fmtDate(f.uploadedAt)}` : ''}</div></div>
        <button class="btn sm ghost icon" data-del="${f.id}" title="Delete">${icon('trash', 14)}</button></div>`).join('')
        : '<div class="small muted" style="padding:6px 0">No copy uploaded</div>';
      files.filter(isImg).forEach(async (f) => {
        try {
          const b64 = await fileData(f);
          const t = box.querySelector(`[data-fid="${f.id}"] .thumb`);
          if (t) t.innerHTML = `<img src="${dataUrl(f, b64)}" alt="">`;
        } catch { /* ignore thumbnail errors */ }
      });
    });
    el.querySelectorAll('[data-fid]').forEach((row) => {
      row.onclick = (e) => {
        if (e.target.closest('[data-del]')) return;
        const f = store.idFiles.find((x) => x.id === row.dataset.fid);
        if (f) viewFile(f);
      };
    });
    el.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const f = store.idFiles.find((x) => x.id === b.dataset.del);
        if (!f || !await confirmBox('Delete copy?', `Delete ${f.name}?`, { ok: 'Delete', danger: true })) return;
        try { await deleteIdFile(f); cache.delete(f.id); toast('Deleted'); } catch (e) { toast(friendlyError(e), true); }
      };
    });
  };

  el.querySelectorAll('[data-up]').forEach((inp) => {
    inp.onchange = async () => {
      const files = [...inp.files];
      inp.value = '';
      const lbl = inp.closest('label');
      for (const file of files) {
        lbl.classList.add('busy');
        try {
          const p = await prepareFile(file);
          await uploadIdFile({ ownerId: owner.id, ownerType: owner.type, ownerName: owner.name, kind: inp.dataset.up, ...p });
          toast(`Uploaded ${p.name}`);
        } catch (e) { toast(friendlyError(e), true); }
        lbl.classList.remove('busy');
      }
    };
  });
  el.querySelectorAll('input[type=date][data-field]').forEach((i) => {
    i.onchange = () => {
      const k = DOC_KINDS.find((d) => d.exp === i.dataset.field);
      el.querySelector(`[data-exp="${k.k}"]`).innerHTML = expiryPill(i.value);
    };
  });
  el.querySelector('[data-save-info]').onclick = async (ev) => {
    const btn = ev.currentTarget;
    const data = {};
    el.querySelectorAll('[data-field]').forEach((i) => { data[i.dataset.field] = i.value.trim(); });
    btn.disabled = true;
    try { await saveIdInfo(owner.id, owner.type, { ...data, name: owner.name }); toast('ID details saved'); } catch (e) { toast(friendlyError(e), true); }
    btn.disabled = false;
  };

  drawFiles();
  let sig = '';
  return store.on(() => {
    const s = JSON.stringify(store.files(owner.id).map((f) => f.id));
    if (s !== sig) { sig = s; drawFiles(); }
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
    for (const { f, b64 } of await ownerFiles(o, progress)) {
      const base = KIND_LABEL[f.kind] || 'Document';
      n[base] = (n[base] || 0) + 1;
      const ext = f.mime === 'application/pdf' ? 'pdf' : 'jpg';
      dir.file(`${safe(o.name)} - ${base}${n[base] > 1 ? ` ${n[base]}` : ''}.${ext}`, b64, { base64: true });
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
    doc.setFillColor(64, 64, 65); doc.rect(0, 0, W, 54, 'F');
    doc.setFillColor(252, 176, 64); doc.rect(0, 54, W, 3, 'F');
    let tx = 28;
    if (logo) { doc.addImage(logo, 'PNG', 28, 10, 70, 33); tx = 110; }
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(clean(name), tx, 27);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(252, 176, 64); doc.text(clean(sub), tx, 42);
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

/** Shared "send to customer" action bar handler. */
export function exportMenu(owners, title) {
  if (!owners.length) { toast('Select at least one person first', true); return; }
  modal({
    title: `Download IDs — ${owners.length} ${owners.length === 1 ? 'person' : 'people'}`,
    body: `<label class="f"><span>File name / title</span><input id="ix-t" value="${esc(title)}"></label>
      <div class="grid" style="gap:10px;margin-top:14px">
        <button class="btn block" data-x="zip">${icon('download', 16)} ZIP — all copies in folders + Excel list</button>
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
            if (b.dataset.x === 'zip') { const n = await downloadIdZip(owners, t, progress); toast(`ZIP ready — ${n} copies`); }
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
