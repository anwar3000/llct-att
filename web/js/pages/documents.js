// One place to pick staff and/or external workers and download their IDs for a customer.
import { store } from '../fb.js';
import { esc, icon, avatar, pill, fmtDate, parseKey, modal, toast, friendlyError } from '../util.js';
import { allOwners, docsSummaryHtml, exportMenu, ownerExpiry, expiryState as ownerExpiryState, fillMissingFromCopies } from '../iddocs.js';

export function mount(el, _p, { setHeader }) {
  setHeader('ID documents', 'Select people, then download a ZIP, PDF ID pack or Excel list to send to a customer',
    `<button class="btn ghost" id="d-read" title="Fill empty ID numbers and expiry dates from the uploaded copies">🔍 Read numbers from copies</button>
     <button class="btn" id="d-dl">${icon('download', 16)} Download selected</button>`);
  let q = '', filter = 'all', site = '';
  const sel = new Set();
  document.getElementById('d-dl').onclick = () => {
    const owners = allOwners().filter((o) => sel.has(o.id));
    exportMenu(owners, 'ID documents');
  };

  document.getElementById('d-read').onclick = () => {
    const picked = allOwners().filter((o) => sel.has(o.id));
    const owners = (picked.length ? picked : allOwners().filter((o) => o.active))
      .filter((o) => store.files(o.id).length);
    const { el: m, close } = modal({
      title: 'Read numbers & expiry from copies',
      body: `<p style="margin-top:0">${picked.length ? `${picked.length} selected` : 'Everyone'} with uploaded copies (${owners.length}). Only <b>empty</b> numbers and expiry dates are filled — nothing typed in is changed. Reading photos takes a few seconds each.</p>
        <div id="rd-msg" class="small muted"></div><div id="rd-out" style="max-height:340px;overflow:auto;margin-top:8px"></div>`,
      foot: '<button class="btn ghost" data-no>Close</button><button class="btn" data-go>Start</button>',
      onMount: (mm, cl) => { mm.querySelector('[data-no]').onclick = cl; },
    });
    m.querySelector('[data-go]').onclick = async (ev) => {
      ev.currentTarget.disabled = true;
      const msg = m.querySelector('#rd-msg');
      try {
        const r = await fillMissingFromCopies(owners, (t) => { msg.textContent = t; });
        msg.textContent = r.length ? `Filled for ${r.length} ${r.length === 1 ? 'person' : 'people'} — please check:` : 'Nothing new found — numbers already filled, or the copies are not clear enough to read.';
        m.querySelector('#rd-out').innerHTML = r.map((x) => `<a class="list-item" style="color:inherit" href="#/${x.owner.type === 'worker' ? 'workers' : 'employees'}/${x.owner.id}">
          ${avatar(x.owner.name, 26)}<div class="grow"><b>${esc(x.owner.name)}</b><div class="small">${esc(x.text)}</div></div></a>`).join('');
        m.querySelectorAll('#rd-out a').forEach((a) => a.addEventListener('click', close));
      } catch (e) { msg.textContent = friendlyError(e); toast(friendlyError(e), true); }
    };
  };

  const onSite = (o) => {
    if (o.type === 'worker') return store.workerLock(o.id)?.siteId || '';
    return store.open.find((s) => s.employeeId === o.id)?.siteId || '';
  };

  function shown() {
    const ql = q.toLowerCase();
    return allOwners().filter((o) => {
      if (!o.active && filter !== 'inactive') return false;
      if (filter === 'inactive' && o.active) return false;
      if (filter === 'staff' && o.type !== 'staff') return false;
      if (filter === 'worker' && o.type !== 'worker') return false;
      if (filter === 'expiry' && !['expired', 'soon'].includes(ownerExpiry(o.id).state)) return false;
      if (filter === 'missing' && ['passport', 'eid'].every((k) => store.files(o.id).some((f) => f.kind === k))) return false;
      if (site && onSite(o) !== site) return false;
      if (!ql) return true;
      const i = store.info(o.id) || {};
      return [o.name, o.phone, o.org, o.trade, o.code, i.passportNo, i.eidNo, i.siraNo, i.nationality].join(' ').toLowerCase().includes(ql);
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  function draw() {
    const rows = shown();
    const expiring = allOwners().filter((o) => o.active).flatMap((o) => ownerExpiry(o.id).items
      .filter((it) => it.state === 'expired' || it.state === 'soon').map((it) => ({ o, ...it })))
      .sort((a, b) => a.date.localeCompare(b.date));
    const activeSites = store.sites.filter((s) => s.active && s.approved);
    el.innerHTML = `
    ${expiring.length ? `<div class="card"><div class="card-head"><h2>${icon('warn', 16, '#D98A1A')} Expired or expiring within 30 days (${expiring.length})</h2></div>
      ${expiring.slice(0, 12).map((x) => `<a class="list-item" style="color:inherit" href="#/${x.o.type === 'worker' ? 'workers' : 'employees'}/${x.o.id}">
        ${avatar(x.o.name, 28)}<div class="grow"><b>${esc(x.o.name)}</b> <span class="muted small">${esc(x.label)}</span></div>
        ${x.state === 'expired' ? pill(`Expired ${fmtDate(parseKey(x.date))}`, 'red') : pill(`Expires ${fmtDate(parseKey(x.date))}`, 'amber')}</a>`).join('')}
      ${expiring.length > 12 ? `<div class="list-item small muted">…and ${expiring.length - 12} more — use the “Expiring” filter</div>` : ''}</div>` : ''}
    <div class="row ${expiring.length ? 'mt' : ''}" style="margin-bottom:12px">
      <input id="d-q" placeholder="Search name, passport / EID / SIRA no, company…" value="${esc(q)}" style="max-width:320px">
      <select id="d-site" style="max-width:200px"><option value="">On any site / all</option>${activeSites.map((s) => `<option value="${s.id}" ${site === s.id ? 'selected' : ''}>On site now: ${esc(s.name)}</option>`).join('')}</select>
      <div class="chips">${[['all', 'Everyone'], ['staff', 'Staff'], ['worker', 'External workers'], ['expiry', 'Expiring / expired'], ['missing', 'Missing PP/EID'], ['inactive', 'Inactive']]
        .map(([k, l]) => `<span class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l}</span>`).join('')}</div>
      <span class="spacer"></span><span class="small"><b>${sel.size}</b> selected${sel.size ? ' · <a href="javascript:void 0" id="d-clear">clear</a>' : ''}</span>
    </div>
    <div class="card"><div class="table-wrap"><table class="t">
      <tr><th style="width:34px"><input type="checkbox" id="d-all" ${rows.length && rows.every((o) => sel.has(o.id)) ? 'checked' : ''}></th>
        <th>Name</th><th>Type</th><th>Company / designation</th><th>Passport</th><th>Emirates ID</th><th>SIRA</th><th>Copies</th></tr>
      ${rows.length ? rows.map((o) => {
        const i = store.info(o.id) || {};
        const cell = (no, exp) => `${esc(no || '—')}${exp ? `<div class="small ${{ expired: 'red-t', soon: 'amber-t' }[ownerExpiryState(exp)] || 'muted'}">exp ${esc(exp)}</div>` : ''}`;
        return `<tr class="click" data-id="${o.id}" data-type="${o.type}">
          <td><input type="checkbox" data-sel="${o.id}" ${sel.has(o.id) ? 'checked' : ''}></td>
          <td><div class="person">${avatar(o.name, 28)}<div><div class="nm">${esc(o.name)}</div><div class="small muted">${esc(o.phone || '')}</div></div></div></td>
          <td>${o.type === 'worker' ? pill('External', 'blue') : pill('Staff', 'teal')}</td>
          <td>${esc([o.org, o.trade].filter(Boolean).join(' · '))}</td>
          <td class="mono small">${cell(i.passportNo, i.passportExpiry)}</td><td class="mono small">${cell(i.eidNo, i.eidExpiry)}</td>
          <td class="mono small">${cell(i.siraNo, i.siraExpiry)}</td><td>${docsSummaryHtml(o.id)}</td></tr>`;
      }).join('') : '<tr><td colspan="8"><div class="empty">Nobody matches</div></td></tr>'}
    </table></div></div>`;

    const qi = el.querySelector('#d-q');
    qi.oninput = (e) => { q = e.target.value; draw(); const n = el.querySelector('#d-q'); n.focus(); n.setSelectionRange(q.length, q.length); };
    el.querySelector('#d-site').onchange = (e) => { site = e.target.value; draw(); };
    el.querySelectorAll('[data-f]').forEach((c) => { c.onclick = () => { filter = c.dataset.f; draw(); }; });
    el.querySelectorAll('[data-sel]').forEach((c) => { c.onchange = () => { if (c.checked) sel.add(c.dataset.sel); else sel.delete(c.dataset.sel); draw(); }; });
    el.querySelector('#d-all').onchange = (e) => { rows.forEach((o) => (e.target.checked ? sel.add(o.id) : sel.delete(o.id))); draw(); };
    el.querySelector('#d-clear')?.addEventListener('click', () => { sel.clear(); draw(); });
    el.querySelectorAll('tr[data-id]').forEach((r) => {
      r.onclick = (e) => {
        if (e.target.closest('input')) return;
        location.hash = `#/${r.dataset.type === 'worker' ? 'workers' : 'employees'}/${r.dataset.id}`;
      };
    });
  }
  draw();
  return store.on(() => { if (!el.querySelector('#d-q:focus')) draw(); });
}

