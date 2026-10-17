import { store, updatesInRange, deleteUpdate, editUpdate } from '../fb.js';
import { esc, icon, avatar, pill, fmtDateTime, dateKey, addDays, toast, confirmBox, b64img, photoViewer, modal, friendlyError, tzLabel } from '../util.js';
import { updatesReport, downloadReport } from '../report-lib.js';

const CAT_COLOR = { Issue: 'red', Material: 'blue', Safety: 'amber', Progress: 'green' };

export function mount(el, _p, { setHeader }) {
  let from = dateKey(addDays(new Date(), -13)), to = dateKey(new Date());
  let site = '', cat = '', rows = null;
  setHeader('Site updates', 'Progress notes, issues, material requests and photos from the field',
    `<button class="btn ghost" data-dl="xlsx">${icon('download', 16)} Excel</button><button class="btn ghost" data-dl="pdf">${icon('download', 16)} PDF</button>`);
  document.querySelectorAll('[data-dl]').forEach((b) => {
    b.onclick = async () => { try { await downloadReport(await updatesReport(from, to, site || null), b.dataset.dl); } catch (e) { toast(e.message, true); } };
  });

  async function load() { rows = null; draw(); rows = await updatesInRange(from, to); draw(); }

  function draw() {
    const list = (rows || []).filter((u) => (!site || u.siteId === site) && (!cat || u.category === cat));
    el.innerHTML = `
    <div class="card card-pad"><div class="filters">
      <label class="f"><span>From</span><input type="date" id="u-f" value="${from}"></label>
      <label class="f"><span>To</span><input type="date" id="u-t" value="${to}"></label>
      <label class="f"><span>Site</span><select id="u-s"><option value="">All sites</option>${store.sites.map((s) => `<option value="${s.id}" ${site === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <div class="chips">${['', 'Progress', 'Issue', 'Material', 'Safety'].map((c) => `<span class="chip ${cat === c ? 'on' : ''}" data-c="${c}">${c || 'All'}</span>`).join('')}</div>
    </div></div>
    <div class="card mt">${rows === null ? '<div class="empty">Loading…</div>' : list.length ? list.map((u) => `
      <div class="update"><div class="row">${avatar(u.employeeName, 32)}<div><b>${esc(u.employeeName)}</b> <span class="muted">· ${esc(u.siteName)}</span>
        <div class="small muted">${fmtDateTime(u.createdLocal)}${u.tz != null ? ` (${tzLabel(u.tz)})` : ''}${u.editedAt ? ` · edited${u.editedBy ? ` by ${esc(u.editedBy)}` : ''}` : ''}${u.lat != null ? ` · <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${u.lat}&mlon=${u.lng}#map=18/${u.lat}/${u.lng}">GPS</a>` : ''}</div></div>
        <span class="spacer"></span>${pill(u.category, CAT_COLOR[u.category] || 'gray')}
        <button class="btn sm ghost icon" data-edit="${u.id}" title="Edit">${icon('edit', 14)}</button>
        <button class="btn sm ghost icon" data-del="${u.id}" title="Delete">${icon('trash', 14)}</button></div>
        ${u.note ? `<div style="margin:8px 0 0 44px;white-space:pre-wrap">${esc(u.note)}</div>` : ''}
        ${u.progress != null ? `<div class="small" style="margin:6px 0 0 44px">Progress set to <b>${u.progress}%</b></div>` : ''}
        ${u.photos.length ? `<div class="photos" style="margin:10px 0 0 44px">${u.photos.map((p) => `<img src="${b64img(p)}" data-photo>`).join('')}</div>` : ''}
      </div>`).join('') : '<div class="empty"><b>No updates</b>Try a wider date range.</div>'}</div>`;
    el.querySelector('#u-f').onchange = (e) => { from = e.target.value; load(); };
    el.querySelector('#u-t').onchange = (e) => { to = e.target.value; load(); };
    el.querySelector('#u-s').onchange = (e) => { site = e.target.value; draw(); };
    el.querySelectorAll('[data-c]').forEach((c) => { c.onclick = () => { cat = c.dataset.c; draw(); }; });
    el.querySelectorAll('[data-photo]').forEach((i) => { i.onclick = () => photoViewer(i.src); });
    el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => editDialog(rows.find((x) => x.id === b.dataset.edit), load); });
    el.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!await confirmBox('Delete update?', 'This cannot be undone.', { ok: 'Delete', danger: true })) return;
        await deleteUpdate(b.dataset.del); toast('Deleted'); load();
      };
    });
  }
  load();
  return () => {};
}

export function editDialog(u, done) {
  const photos = [...u.photos];
  modal({
    title: `Edit update · ${u.siteName}`,
    body: `<div class="fields">
      <label class="f"><span>Category</span><select id="ue-c">${['Progress', 'Issue', 'Material', 'Safety'].map((c) => `<option ${c === u.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="f"><span>Progress % (blank = not set)</span><input id="ue-p" type="number" min="0" max="100" value="${u.progress ?? ''}"></label>
      <label class="f full"><span>Note</span><textarea id="ue-n" rows="4">${esc(u.note)}</textarea></label></div>
      <div class="photos" id="ue-ph"></div>
      <div class="small muted" style="margin-top:6px">Posted by ${esc(u.employeeName)} · ${fmtDateTime(u.createdLocal)}</div>`,
    foot: `<button class="btn ghost" data-x2>Cancel</button><button class="btn" data-ok>Save changes</button>`,
    onMount: (m, close) => {
      const drawPh = () => {
        m.querySelector('#ue-ph').innerHTML = photos.map((p, i) => `<span style="position:relative;display:inline-block"><img src="${b64img(p)}">
          <button class="btn sm danger icon" data-rm="${i}" title="Remove photo" style="position:absolute;top:2px;right:2px;padding:2px">${icon('close', 12)}</button></span>`).join('');
        m.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { photos.splice(Number(b.dataset.rm), 1); drawPh(); }; });
      };
      drawPh();
      m.querySelector('[data-x2]').onclick = close;
      m.querySelector('[data-ok]').onclick = async (ev) => {
        const pv = m.querySelector('#ue-p').value.trim();
        const progress = pv === '' ? null : Math.max(0, Math.min(100, Math.round(Number(pv))));
        ev.currentTarget.disabled = true;
        try {
          await editUpdate(u.id, { category: m.querySelector('#ue-c').value, note: m.querySelector('#ue-n').value.trim(), progress, photos });
          toast('Update saved'); close(); done?.();
        } catch (e) { toast(friendlyError(e), true); ev.currentTarget.disabled = false; }
      };
    },
  });
}
