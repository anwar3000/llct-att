// LLCT Documents Portal — a separate link for document clerks (and managers):
// view & download ID documents, add new staff / external workers, edit names, numbers and copies.
// Every change is sent to an admin for approval before it becomes official.
import {
  auth, onAuthStateChanged, login, logout, getMe, store, ROLE_LABEL, watch, mapUser, mapWorker, mapIdInfo, mapIdFile,
  mapRequest, newRequestId, submitRequest, withdrawRequest, uploadIdFile,
} from './fb.js';
import { esc, icon, avatar, pill, toast, modal, confirmBox, friendlyError, fmtDateTime, STAFF_COLOR, EXT_COLOR } from './util.js';
import { DOC_KINDS, prepareFile, viewFile, exportMenu, docsSummaryHtml, expiryState, ownerFromUser, ownerFromWorker } from './iddocs.js';

window.__appStarted = true;
const app = document.getElementById('app');
const ALLOWED = ['docs', 'admin', 'manager'];
let subs = [];
let myRequests = [];
let tab = 'people';
let q = '', filter = 'all';
const sel = new Set();

// ------------------------------------------------------------------ login
function renderLogin(error = '') {
  subs.forEach((u) => u()); subs = [];
  app.innerHTML = `
  <div class="login-wrap">
    <form class="login-card" id="lf">
      <img class="logo" src="img/logo.png" alt="LLCT">
      <h1>Documents Portal</h1>
      <p class="muted">Add or update staff and external worker details and ID documents. Changes are approved by an admin.</p>
      <label class="f"><span>Login ID</span><input name="id" autocomplete="username" required></label>
      <label class="f"><span>Password</span><input name="pw" type="password" autocomplete="current-password" required></label>
      <div class="error">${esc(error)}</div>
      <button class="btn block" type="submit">Sign in</button>
    </form>
  </div>`;
  const f = document.getElementById('lf');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const b = f.querySelector('button'); b.disabled = true; b.textContent = 'Signing in…';
    try { await login(f.id.value, f.pw.value); } catch (err) { renderLogin(friendlyError(err)); }
  };
}

let loginError = '';
onAuthStateChanged(auth, async (user) => {
  if (!user) { store.me = null; renderLogin(loginError); loginError = ''; return; }
  try {
    const me = await getMe(user.uid);
    if (!me || !me.active || !ALLOWED.includes(me.role)) {
      loginError = 'This login cannot use the Documents Portal. Ask an admin for a “Document clerk” login.';
      await logout(); return;
    }
    store.me = me;
    start();
  } catch (e) { loginError = friendlyError(e); await logout().catch(() => {}); }
});

// ------------------------------------------------------------------ data
function start() {
  subs.forEach((u) => u()); subs = [];
  const set = (key, sort) => (list, err) => {
    if (err) { toast(friendlyError(err), true); return; }
    store[key] = sort ? list.sort(sort) : list; store.loaded = true; draw();
  };
  const byName = (a, b) => a.name.localeCompare(b.name);
  subs.push(watch('users', mapUser, set('users', byName)));
  subs.push(watch('extWorkers', mapWorker, set('workers', byName)));
  subs.push(watch('idInfo', mapIdInfo, set('idInfo')));
  subs.push(watch('idFiles', mapIdFile, set('idFiles')));
  subs.push(watch('changeRequests', mapRequest, (l, err) => {
    if (err) return;
    myRequests = l.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0)); draw();
  }, [['submittedById', '==', store.me.id]]));
  shell();
}

const people = () => [
  ...store.users.filter((u) => u.role !== 'docs').map(ownerFromUser),
  ...store.workers.map(ownerFromWorker),
];
const pendingFor = (id) => myRequests.find((r) => r.status === 'pending' && r.targetId === id);

// ------------------------------------------------------------------ shell
function shell() {
  app.innerHTML = `
  <div class="portal">
    <header class="ptop">
      <img src="img/icon-192.png" alt="LLCT" class="pmark">
      <div class="grow"><b>LLCT Documents Portal</b><div class="small" style="color:#cfcfd1">Changes are sent to an admin for approval</div></div>
      <div class="pme">${avatar(store.me.name, 30)}<div class="hide-sm"><b>${esc(store.me.name)}</b><div class="small" style="color:#cfcfd1">${esc(ROLE_LABEL[store.me.role] || 'Document clerk')}</div></div>
        <button class="btn sm ghost" id="p-out" title="Sign out">${icon('logout', 16)}</button></div>
    </header>
    <nav class="ptabs"><a data-tab="people">People & documents</a><a data-tab="requests">My requests <span id="p-badge"></span></a></nav>
    <main class="pmain" id="pmain"></main>
  </div>`;
  document.getElementById('p-out').onclick = () => logout();
  app.querySelectorAll('[data-tab]').forEach((a) => { a.onclick = () => { tab = a.dataset.tab; draw(); }; });
  draw();
}

function draw() {
  const main = document.getElementById('pmain');
  if (!main) return;
  app.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  const pend = myRequests.filter((r) => r.status === 'pending').length;
  document.getElementById('p-badge').innerHTML = pend ? `<span class="badge">${pend}</span>` : '';
  if (main.querySelector('#pp-q:focus')) return; // don't redraw under the cursor
  if (tab === 'people') drawPeople(main); else drawRequests(main);
}

// ------------------------------------------------------------------ people
function drawPeople(main) {
  const ql = q.toLowerCase();
  const all = people();
  const rows = all.filter((o) => {
    if (filter === 'staff' && o.type !== 'staff') return false;
    if (filter === 'worker' && o.type !== 'worker') return false;
    if (filter === 'missing' && ['passport', 'eid'].every((k) => store.files(o.id).some((f) => f.kind === k))) return false;
    if (filter === 'expiry') {
      const i = store.info(o.id) || {};
      if (!DOC_KINDS.some((k) => k.exp && ['expired', 'soon'].includes(expiryState(i[k.exp])))) return false;
    }
    if (!ql) return true;
    const i = store.info(o.id) || {};
    return [o.name, o.phone, o.org, o.trade, o.code, i.passportNo, i.eidNo, i.siraNo].join(' ').toLowerCase().includes(ql);
  }).sort((a, b) => a.name.localeCompare(b.name));
  const cell = (no, exp) => `${esc(no || '—')}${exp ? `<div class="small ${{ expired: 'red-t', soon: 'amber-t' }[expiryState(exp)] || 'muted'}">exp ${esc(exp)}</div>` : ''}`;
  main.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <input id="pp-q" placeholder="Search name, phone, passport / EID no…" value="${esc(q)}" style="max-width:320px">
      <div class="chips">${[['all', `Everyone (${all.length})`], ['staff', 'LLCT staff'], ['worker', 'External workers'], ['expiry', 'Expiring / expired'], ['missing', 'Missing PP/EID']]
        .map(([k, l]) => `<span class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l}</span>`).join('')}</div>
      <span class="spacer"></span>
      <button class="btn ghost" id="pp-dl">${icon('download', 16)} Download${sel.size ? ` (${sel.size})` : ''}</button>
      <button class="btn" id="pp-add">${icon('plus', 16)} Add person</button>
    </div>
    <div class="card"><div class="table-wrap"><table class="t">
      <tr><th style="width:34px"><input type="checkbox" id="pp-all" ${rows.length && rows.every((o) => sel.has(o.id)) ? 'checked' : ''}></th>
        <th>Name</th><th>Type</th><th>Company / designation</th><th>Passport</th><th>Emirates ID</th><th>SIRA</th><th>Copies</th><th></th></tr>
      ${rows.length ? rows.map((o) => {
        const i = store.info(o.id) || {};
        const p = pendingFor(o.id);
        return `<tr class="wf-row ${o.type === 'staff' ? 'staff' : 'ext'}">
          <td><input type="checkbox" data-sel="${o.id}" ${sel.has(o.id) ? 'checked' : ''}></td>
          <td><div class="person">${avatar(o.name, 28, o.type === 'staff' ? STAFF_COLOR : EXT_COLOR)}<div><div class="nm">${esc(o.name)}</div>
            <div class="small muted">${esc(o.phone || '')}${p ? ' · <span class="amber-t">change pending approval</span>' : ''}</div></div></div></td>
          <td><span class="wf-chip ${o.type === 'staff' ? 'staff' : 'ext'}">${o.type === 'staff' ? 'LLCT staff' : 'External'}</span></td>
          <td class="small">${esc([o.org, o.trade].filter(Boolean).join(' · '))}</td>
          <td class="mono small">${cell(i.passportNo, i.passportExpiry)}</td><td class="mono small">${cell(i.eidNo, i.eidExpiry)}</td>
          <td class="mono small">${cell(i.siraNo, i.siraExpiry)}</td><td>${docsSummaryHtml(o.id)}</td>
          <td class="right nowrap"><button class="btn sm ghost" data-dl1="${o.id}" title="Download">${icon('download', 14)}</button>
            <button class="btn sm" data-edit="${o.id}">${icon('edit', 14)} Edit</button></td></tr>`;
      }).join('') : `<tr><td colspan="9"><div class="empty">${store.loaded ? 'Nobody matches' : 'Loading…'}</div></td></tr>`}
    </table></div></div>`;
  const qi = main.querySelector('#pp-q');
  qi.oninput = (e) => { q = e.target.value; qi.blur(); drawPeople(main); const n = main.querySelector('#pp-q'); n.focus(); n.setSelectionRange(q.length, q.length); };
  main.querySelectorAll('[data-f]').forEach((c) => { c.onclick = () => { filter = c.dataset.f; drawPeople(main); }; });
  main.querySelectorAll('[data-sel]').forEach((c) => { c.onchange = () => { if (c.checked) sel.add(c.dataset.sel); else sel.delete(c.dataset.sel); drawPeople(main); }; });
  main.querySelector('#pp-all').onchange = (e) => { rows.forEach((o) => (e.target.checked ? sel.add(o.id) : sel.delete(o.id))); drawPeople(main); };
  main.querySelector('#pp-dl').onclick = () => {
    const chosen = sel.size ? all.filter((o) => sel.has(o.id)) : rows;
    exportMenu(chosen, 'LLCT ID documents');
  };
  main.querySelectorAll('[data-dl1]').forEach((b) => { b.onclick = () => { const o = all.find((x) => x.id === b.dataset.dl1); exportMenu([o], `${o.name} IDs`); }; });
  main.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => editPerson(all.find((x) => x.id === b.dataset.edit)); });
  main.querySelector('#pp-add').onclick = () => {
    modal({
      title: 'Add a new person',
      body: `<div class="grid" style="gap:10px">
        <button class="btn block ghost" data-t="worker" style="justify-content:flex-start;padding:14px"><span class="wf-chip ext">External</span>&nbsp; External worker / labour</button>
        <button class="btn block ghost" data-t="staff" style="justify-content:flex-start;padding:14px"><span class="wf-chip staff">LLCT staff</span>&nbsp; LLCT employee (admin creates their app login on approval)</button></div>`,
      onMount: (m, close) => { m.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { close(); editPerson(null, b.dataset.t); }; }); },
    });
  };
}

// ------------------------------------------------------------------ add / edit → request
function editPerson(o, newType = null) {
  const isNew = !o;
  const type = o ? o.type : newType;
  const cur = o ? (type === 'worker' ? store.worker(o.id) : store.user(o.id)) : {};
  const info = (o && store.info(o.id)) || {};
  const files = o ? store.files(o.id) : [];
  const queued = []; // { kind, file }
  const removing = new Set();
  const baseFields = type === 'worker'
    ? [['name', 'Full name (as on passport) *'], ['phone', 'Phone *'], ['company', 'Company / agency'], ['trade', 'Trade'], ['code', 'Worker code']]
    : [['name', 'Full name (as on passport) *'], ['phone', 'Phone *'], ['designation', 'Designation']];
  modal({
    title: isNew ? `New ${type === 'worker' ? 'external worker' : 'LLCT employee'}` : `Edit ${o.name}`,
    wide: true,
    body: `<div class="small" style="background:#fff6e8;border-radius:10px;padding:8px 12px;margin-bottom:12px">Your changes are sent to an admin. They become official only after approval.</div>
      <div class="fields">${baseFields.map(([k, l]) => `<label class="f"><span>${l}</span><input data-b="${k}" value="${esc(cur?.[k] || '')}"></label>`).join('')}
        <label class="f"><span>Nationality</span><input data-i="nationality" value="${esc(info.nationality || '')}"></label></div>
      <h3 style="margin:12px 0 8px">ID documents <span class="small muted" style="font-weight:500">— photo or PDF, max 2 MB each</span></h3>
      <div class="idrows">
        <div class="idrow idrow-head"><span>Document</span><span>Number</span><span>Expiry</span><span></span><span>Copies</span><span></span></div>
        ${DOC_KINDS.map((k) => `<div class="idrow">
          <span class="idlbl">${esc(k.label)}</span>
          ${k.num ? `<input data-i="${k.num}" value="${esc(info[k.num] || '')}" placeholder="Number"><input type="date" data-i="${k.exp}" value="${esc(info[k.exp] || '')}"><span></span>` : '<span></span><span></span><span></span>'}
          <div class="idfiles" data-files="${k.k}"></div>
          <label class="btn sm ghost upl">${icon('plus', 14)} Add<input type="file" multiple accept="image/*,application/pdf" data-up="${k.k}" hidden></label>
        </div>`).join('')}
      </div>
      <label class="f" style="margin-top:12px"><span>Note for the admin (optional)</span><input id="pe-note" placeholder="e.g. passport renewed"></label>
      <div class="error" id="pe-err"></div>`,
    foot: `<span class="small muted" id="pe-prog" style="margin-right:auto"></span><button class="btn ghost" data-x2>Cancel</button><button class="btn" data-ok>Send for approval</button>`,
    onMount: (m, close) => {
      const drawFiles = () => {
        m.querySelectorAll('[data-files]').forEach((box) => {
          const k = box.dataset.files;
          const have = files.filter((f) => f.kind === k);
          const add = queued.filter((x) => x.kind === k);
          box.innerHTML = [
            ...have.map((f) => `<span class="pchip ${removing.has(f.id) ? 'rm' : ''}" title="${esc(f.name)}"><a href="javascript:void 0" data-view="${f.id}">${f.mime === 'application/pdf' ? 'PDF' : 'IMG'} ${esc(f.name.slice(0, 18))}</a>
              <button data-rm="${f.id}" title="${removing.has(f.id) ? 'Keep' : 'Remove'}">${removing.has(f.id) ? '↺' : '×'}</button></span>`),
            ...add.map((x) => `<span class="pchip new" title="New — will be added">+ ${esc(x.file.name.slice(0, 18))}<button data-unq="${queued.indexOf(x)}">×</button></span>`),
          ].join('') || '<span class="small muted">—</span>';
        });
        m.querySelectorAll('[data-view]').forEach((a) => { a.onclick = () => viewFile(files.find((f) => f.id === a.dataset.view)); });
        m.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { const id = b.dataset.rm; if (removing.has(id)) removing.delete(id); else removing.add(id); drawFiles(); }; });
        m.querySelectorAll('[data-unq]').forEach((b) => { b.onclick = () => { queued.splice(Number(b.dataset.unq), 1); drawFiles(); }; });
      };
      drawFiles();
      m.querySelectorAll('[data-up]').forEach((inp) => {
        inp.onchange = () => {
          for (const file of inp.files) {
            if (file.type === 'application/pdf' && file.size > 2 * 1024 * 1024) { toast(`${file.name} is larger than 2 MB`, true); continue; }
            queued.push({ kind: inp.dataset.up, file });
          }
          inp.value = ''; drawFiles();
        };
      });
      m.querySelector('[data-x2]').onclick = close;
      m.querySelector('[data-ok]').onclick = async (ev) => {
        const err = m.querySelector('#pe-err');
        const prog = m.querySelector('#pe-prog');
        const fields = {}, infoCh = {};
        m.querySelectorAll('[data-b]').forEach((i) => { const v = i.value.trim(); if (isNew ? v : v !== (cur?.[i.dataset.b] || '')) fields[i.dataset.b] = v; });
        m.querySelectorAll('[data-i]').forEach((i) => { const v = i.value.trim(); if (v !== (info[i.dataset.i] || '')) infoCh[i.dataset.i] = v; });
        const name = (fields.name ?? cur?.name ?? '').trim();
        const phone = (fields.phone ?? cur?.phone ?? '').trim();
        if (!name) { err.textContent = 'Name is required.'; return; }
        if (!phone) { err.textContent = 'Phone is required.'; return; }
        if (isNew) {
          const n = (s) => String(s || '').replace(/[\s-]/g, '').toLowerCase();
          const dup = people().find((p) => n(p.phone) === n(phone));
          if (dup) { err.textContent = `${dup.name} already has this phone number — edit them instead.`; return; }
        }
        if (!isNew && !Object.keys(fields).length && !Object.keys(infoCh).length && !queued.length && !removing.size) { err.textContent = 'Nothing changed.'; return; }
        ev.currentTarget.disabled = true;
        const reqId = newRequestId();
        const newFileIds = [];
        try {
          for (const [n, x] of queued.entries()) {
            prog.textContent = `Uploading ${n + 1} of ${queued.length}…`;
            const p = await prepareFile(x.file);
            newFileIds.push(await uploadIdFile({ ownerId: o ? o.id : `req:${reqId}`, ownerType: type, ownerName: name, kind: x.kind, ...p, pending: true, requestId: reqId }));
          }
          prog.textContent = 'Sending…';
          await submitRequest(reqId, {
            type: isNew ? 'new' : 'update', targetType: type, targetId: o ? o.id : '', targetName: name,
            fields, info: infoCh, newFileIds, deleteFileIds: [...removing], note: m.querySelector('#pe-note').value.trim(),
          });
          toast('Sent for admin approval'); close(); tab = 'requests'; draw();
        } catch (e) { err.textContent = friendlyError(e); prog.textContent = ''; ev.currentTarget.disabled = false; }
      };
    },
  });
}

// ------------------------------------------------------------------ my requests
const LABEL = { pending: ['Waiting for approval', 'amber'], approved: ['Approved', 'green'], rejected: ['Rejected', 'red'] };
const FIELD_LABEL = Object.fromEntries([['name', 'Name'], ['phone', 'Phone'], ['company', 'Company'], ['trade', 'Trade'], ['code', 'Worker code'],
  ['designation', 'Designation'], ['nationality', 'Nationality'], ['idNotes', 'Notes'],
  ...DOC_KINDS.filter((k) => k.num).flatMap((k) => [[k.num, `${k.label} no`], [k.exp, `${k.label} expiry`]])]);

function drawRequests(main) {
  main.innerHTML = myRequests.length ? myRequests.map((r) => {
    const ch = [...Object.entries(r.fields), ...Object.entries(r.info)];
    return `<div class="card card-pad" style="margin-bottom:10px">
      <div class="row"><b>${r.type === 'new' ? 'New' : 'Update'} · ${esc(r.targetName)}</b>
        <span class="wf-chip ${r.targetType === 'staff' ? 'staff' : 'ext'}">${r.targetType === 'staff' ? 'LLCT staff' : 'External'}</span>
        <span class="spacer"></span>${pill(LABEL[r.status][0], LABEL[r.status][1])}</div>
      <div class="small muted">Sent ${fmtDateTime(r.submittedAt)}${r.reviewedBy ? ` · reviewed by ${esc(r.reviewedBy)}` : ''}</div>
      <div class="small" style="margin-top:6px">${ch.map(([k, v]) => `${esc(FIELD_LABEL[k] || k)}: <b>${esc(v || '(cleared)')}</b>`).join(' · ')}
        ${r.newFileIds.length ? ` · ${r.newFileIds.length} new cop${r.newFileIds.length === 1 ? 'y' : 'ies'}` : ''}${r.deleteFileIds.length ? ` · ${r.deleteFileIds.length} to remove` : ''}</div>
      ${r.note ? `<div class="small muted">Note: ${esc(r.note)}</div>` : ''}
      ${r.reviewNote ? `<div class="small red-t">Admin: ${esc(r.reviewNote)}</div>` : ''}
      ${r.status === 'pending' ? '<div class="right"><button class="btn sm ghost" data-wd="' + r.id + '">Withdraw</button></div>' : ''}
    </div>`;
  }).join('') : '<div class="card empty"><b>No requests yet</b>Use “Edit” or “Add person” on the People tab.</div>';
  main.querySelectorAll('[data-wd]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmBox('Withdraw request?', 'Remove this request and any copies uploaded with it?', { ok: 'Withdraw', danger: true })) return;
      try { await withdrawRequest(myRequests.find((x) => x.id === b.dataset.wd)); toast('Withdrawn'); } catch (e) { toast(friendlyError(e), true); }
    };
  });
}

