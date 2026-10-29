// Company documents: LLCT trade license, Abu Dhabi trade license, Chamber of Commerce, WC insurance…
// plus additional documents with their own heading. Numbers, issue / expiry dates and copies (photo or PDF, max 2 MB).
import {
  COMPANY_DOC_TYPES, watchCompanyDocs, watchCompanyFiles, saveCompanyDoc, uploadCompanyFile, readCompanyFile,
  deleteCompanyFile, deleteCompanyDoc, companyDueState, daysUntil,
} from '../fb.js';
import { esc, icon, pill, toast, modal, confirmBox, friendlyError, fmtDate, parseKey, dateKey } from '../util.js';
import { prepareFile, chooseFile, askHeading, b64ToBlob } from '../iddocs.js';
import { saveBlob } from '../report-lib.js';

const cache = new Map();
const bytes = (f) => {
  if (!cache.has(f.id)) cache.set(f.id, readCompanyFile(f).catch((e) => { cache.delete(f.id); throw e; }));
  return cache.get(f.id);
};
const isImg = (f) => f.mime.startsWith('image/');
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'document';
const ext = (f) => (f.mime === 'application/pdf' ? 'pdf' : f.mime === 'image/png' ? 'png' : 'jpg');
const fmtD = (v) => (v ? fmtDate(parseKey(v)) : '');

/** Company documents: reminder 15 days before expiry. */
const dueState = (exp) => companyDueState(exp);
function statusPill(exp) {
  const s = dueState(exp);
  if (!s) return '';
  const n = daysUntil(exp);
  return s === 'expired' ? pill(`Expired ${fmtD(exp)}`, 'red') : s === 'soon' ? pill(n === 0 ? 'Expires today' : `Expires in ${n} d`, 'amber') : pill(`Valid to ${fmtD(exp)}`, 'green');
}

async function viewFile(f, title) {
  try {
    const b64 = await bytes(f);
    const blob = b64ToBlob(b64, f.mime);
    if (isImg(f)) {
      modal({ title, wide: true, body: `<img src="data:${f.mime};base64,${b64}" style="width:100%;border-radius:10px">`,
        foot: `<button class="btn" data-dl>${icon('download', 16)} Download</button>`,
        onMount: (m) => { m.querySelector('[data-dl]').onclick = () => saveBlob(blob, `${safe(title)}.${ext(f)}`); } });
    } else {
      const w = window.open(URL.createObjectURL(blob), '_blank');
      if (!w) saveBlob(blob, `${safe(title)}.${ext(f)}`);
    }
  } catch (e) { toast(friendlyError(e), true); }
}

export function mount(el, _p, { setHeader }) {
  setHeader('Company documents', 'Trade licenses, Chamber of Commerce, WC insurance and more — numbers, expiry dates and copies',
    `<button class="btn" id="cd-add">${icon('plus', 16)} Additional document</button>
     <button class="btn ghost" id="cd-zip">${icon('download', 16)} Download all (ZIP)</button>`);
  let docs = null, files = null, err = null;

  const entries = () => {
    const std = COMPANY_DOC_TYPES.map((t) => {
      const d = docs.find((x) => x.id === t.key);
      return { id: t.key, key: t.key, title: d?.title || t.label, doc: d || null, custom: false };
    });
    const keys = new Set(COMPANY_DOC_TYPES.map((t) => t.key));
    const add = docs.filter((d) => !keys.has(d.id)).sort((a, b) => a.title.localeCompare(b.title))
      .map((d) => ({ id: d.id, key: d.key, title: d.title, doc: d, custom: true }));
    return { std, add };
  };
  const filesOf = (id) => files.filter((f) => f.docId === id);

  async function upload(e) {
    const file = await chooseFile();
    if (!file) return;
    try {
      const p = await prepareFile(file);
      if (!e.doc) await saveCompanyDoc({ id: e.id, key: e.key, title: e.title, custom: e.custom });
      await uploadCompanyFile({ docId: e.id, name: `${safe(e.title)}.${p.mime === 'application/pdf' ? 'pdf' : 'jpg'}`, mime: p.mime, base64: p.base64 });
      toast(`${e.title} uploaded`);
      // Ask for the document number and expiry date right away if they're missing.
      if (!e.doc?.number || !e.doc?.expiry) edit({ ...e, doc: e.doc || null });
    } catch (x) { toast(friendlyError(x), true); }
  }

  function edit(e) {
    const d = e.doc || {};
    modal({
      title: e.title,
      body: `<div class="fields">
        ${e.custom ? `<label class="f full"><span>Heading</span><input name="title" value="${esc(e.title)}"></label>` : ''}
        <label class="f full"><span>Number (license / policy / certificate no.)</span><input name="number" value="${esc(d.number || '')}"></label>
        <label class="f"><span>Issue date</span><input type="date" name="issueDate" value="${esc(d.issueDate || '')}"></label>
        <label class="f"><span>Expiry date</span><input type="date" name="expiry" value="${esc(d.expiry || '')}"></label>
        <label class="f full"><span>Notes</span><input name="notes" value="${esc(d.notes || '')}"></label></div>`,
      foot: '<button class="btn ghost" data-no>Cancel</button><button class="btn" data-yes>Save</button>',
      onMount: (m, close) => {
        m.querySelector('[data-no]').onclick = close;
        m.querySelector('[data-yes]').onclick = async () => {
          const v = (n) => (m.querySelector(`[name=${n}]`)?.value || '').trim();
          try {
            await saveCompanyDoc({ id: e.id, key: e.key, title: (e.custom && v('title')) || e.title, number: v('number'),
              issueDate: v('issueDate'), expiry: v('expiry'), notes: v('notes'), custom: e.custom });
            toast('Saved'); close();
          } catch (x) { toast(friendlyError(x), true); }
        };
      },
    });
  }

  async function addAdditional() {
    const title = await askHeading('Additional company document', ['ISO certificate', 'Bank letter', 'Civil defence certificate', 'Municipality approval', 'Vehicle registration', 'Owner passport']);
    if (!title) return;
    try {
      const id = await saveCompanyDoc({ title, custom: true });
      await upload({ id, key: '', title, doc: { id }, custom: true });
    } catch (x) { toast(friendlyError(x), true); }
  }

  async function zipAll() {
    if (!window.JSZip) { toast('ZIP library did not load — reload the page.', true); return; }
    if (!files?.length) { toast('No files uploaded yet'); return; }
    const { std, add } = entries();
    const zip = new window.JSZip();
    const rows = [['Document', 'Number', 'Issue date', 'Expiry date', 'Status', 'Files', 'Notes']];
    toast('Preparing ZIP…');
    try {
      for (const e of [...std, ...add]) {
        const fl = filesOf(e.id);
        for (let i = 0; i < fl.length; i++) zip.file(`${safe(e.title)}${fl.length > 1 ? ` ${i + 1}` : ''}.${ext(fl[i])}`, await bytes(fl[i]), { base64: true });
        const d = e.doc || {};
        const st = dueState(d.expiry);
        rows.push([e.title, d.number || '', d.issueDate || '', d.expiry || '', { expired: 'Expired', soon: 'Expiring', ok: 'Valid' }[st] || '', fl.length, d.notes || '']);
      }
      if (window.XLSX) {
        const ws = window.XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 40 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 40 }];
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, 'Company documents');
        zip.file('Company documents list.xlsx', window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
      }
      saveBlob(await zip.generateAsync({ type: 'blob' }), `LLCT company documents-${dateKey(new Date())}.zip`);
    } catch (x) { toast(friendlyError(x), true); }
  }

  const card = (e) => {
    const fl = filesOf(e.id);
    const d = e.doc || {};
    const info = `<span class="cd-kv"><span>DOC NO.</span><b class="mono">${esc(d.number || '—')}</b></span>
      <span class="cd-kv"><span>EXPIRY</span><b>${esc(d.expiry ? fmtD(d.expiry) : '—')}</b></span>
      ${d.issueDate ? `<span class="cd-kv"><span>ISSUED</span><b>${esc(fmtD(d.issueDate))}</b></span>` : ''}
      ${!d.number || !d.expiry ? `<a href="javascript:void 0" class="small" data-ed="${esc(e.id)}">+ Add number & expiry</a>` : ''}`;
    return `<div class="slot ${fl.length ? 'has' : ''}" data-e="${esc(e.id)}" style="grid-template-columns:1fr auto">
      <div class="slot-main">
        <div class="row" style="gap:8px"><span class="slot-t">${esc(e.title.toUpperCase())}</span>${statusPill(d.expiry)}</div>
        <div class="cd-info">${info}</div>${d.notes ? `<div class="small muted">${esc(d.notes)}</div>` : ''}
        <div class="row" style="gap:8px;margin-top:8px">${fl.map((f, i) => `<div class="slot-th cd-th" data-view="${f.id}" title="${esc(e.title)} ${i + 1} — click to view">${isImg(f) ? '' : '<b>PDF</b>'}
            <button class="x" data-delf="${f.id}" title="Delete file">${icon('close', 11)}</button></div>`).join('')}
          ${fl.length ? '' : '<span class="small red-t">Not uploaded</span>'}</div>
      </div>
      <div class="slot-act" style="flex-direction:column;align-items:stretch">
        <button class="btn sm" data-up="${esc(e.id)}">${icon('upload', 14)} Upload</button>
        <button class="btn sm ghost" data-ed="${esc(e.id)}">${icon('edit', 14)} Number & dates</button>
        ${e.custom ? `<button class="btn sm ghost" data-rm="${esc(e.id)}">${icon('trash', 14)} Delete</button>` : ''}
      </div></div>`;
  };

  function draw() {
    if (err) { el.innerHTML = `<div class="card empty"><b>Could not load company documents</b>${esc(String(err.message || err).includes('permission') ? 'Publish the latest firestore.rules in Firebase (it adds company documents).' : friendlyError(err))}</div>`; return; }
    if (!docs || !files) { el.innerHTML = '<div class="card empty">Loading…</div>'; return; }
    const { std, add } = entries();
    const all = [...std, ...add];
    const bad = all.filter((e) => ['expired', 'soon'].includes(dueState(e.doc?.expiry)));
    el.innerHTML = `
      ${bad.length ? `<div class="card" style="background:#fff4e2;border-color:#f3d7a6"><b>${icon('warn', 16, '#D98A1A')} Renew soon:</b>
        ${bad.map((e) => `${esc(e.title)} ${statusPill(e.doc.expiry)}`).join(' &nbsp; ')}</div>` : ''}
      <div class="card ${bad.length ? 'mt' : ''}"><div class="card-head"><h2>Company documents</h2><span class="small muted">${files.length} file${files.length === 1 ? '' : 's'}</span></div>
        <div class="slots">${std.map(card).join('')}</div></div>
      <div class="card mt"><div class="card-head"><h2>Additional documents</h2><button class="btn sm ghost" id="cd-add2">${icon('plus', 14)} Add with heading</button></div>
        ${add.length ? `<div class="slots">${add.map(card).join('')}</div>` : '<div class="empty small">ISO certificate, bank letter, civil defence… add each one with its own heading.</div>'}</div>`;
    const find = (id) => all.find((x) => x.id === id);
    el.querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => upload(find(b.dataset.up)); });
    el.querySelectorAll('[data-ed]').forEach((b) => { b.onclick = () => edit(find(b.dataset.ed)); });
    el.querySelectorAll('[data-rm]').forEach((b) => {
      b.onclick = async () => {
        const e = find(b.dataset.rm);
        if (!await confirmBox(`Delete ${e.title}?`, 'The document and all its files will be deleted.', { ok: 'Delete', danger: true })) return;
        try { await deleteCompanyDoc(e.id, files); toast('Deleted'); } catch (x) { toast(friendlyError(x), true); }
      };
    });
    el.querySelectorAll('[data-view]').forEach(async (t) => {
      const f = files.find((x) => x.id === t.dataset.view);
      const e = find(f.docId);
      t.onclick = (ev) => { if (!ev.target.closest('[data-delf]')) viewFile(f, e?.title || f.name); };
      if (isImg(f)) {
        try { const b64 = await bytes(f); t.insertAdjacentHTML('afterbegin', `<img src="data:${f.mime};base64,${b64}" alt="">`); } catch { /* ignore */ }
      }
    });
    el.querySelectorAll('[data-delf]').forEach((b) => {
      b.onclick = async () => {
        const f = files.find((x) => x.id === b.dataset.delf);
        if (!f || !await confirmBox('Delete file?', 'Delete this copy?', { ok: 'Delete', danger: true })) return;
        try { await deleteCompanyFile(f); cache.delete(f.id); toast('Deleted'); } catch (x) { toast(friendlyError(x), true); }
      };
    });
    el.querySelector('#cd-add2').onclick = addAdditional;
  }

  document.getElementById('cd-add').onclick = addAdditional;
  document.getElementById('cd-zip').onclick = zipAll;
  draw();
  const u1 = watchCompanyDocs((l, e) => { docs = l || []; if (e) err = e; draw(); });
  const u2 = watchCompanyFiles((l, e) => { files = l || []; if (e) err = e; draw(); });
  return () => { u1(); u2(); };
}
