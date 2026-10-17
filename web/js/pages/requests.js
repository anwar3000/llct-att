// Admin approval of changes sent from the Documents Portal.
import { store, isAdmin, approveRequest, rejectRequest, mapRequest, db } from '../fb.js';
import { esc, icon, avatar, pill, toast, modal, friendlyError, fmtDateTime, STAFF_COLOR, EXT_COLOR } from '../util.js';
import { DOC_KINDS, viewFile } from '../iddocs.js';
import { collection, getDocs, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const FIELD_LABEL = Object.fromEntries([['name', 'Name'], ['phone', 'Phone'], ['company', 'Company / agency'], ['trade', 'Trade'], ['code', 'Worker code'],
  ['designation', 'Designation'], ['nationality', 'Nationality'], ['idNotes', 'Notes'],
  ...DOC_KINDS.filter((k) => k.num).flatMap((k) => [[k.num, `${k.label} number`], [k.exp, `${k.label} expiry`]])]);
const KIND_LABEL = Object.fromEntries(DOC_KINDS.map((k) => [k.k, k.label]));

export function mount(el, _p, { setHeader }) {
  setHeader('Change requests', 'New people and document changes sent from the Documents Portal — approve to make them official',
    `<a class="btn ghost" href="portal.html" target="_blank" rel="noopener">${icon('idcard', 16)} Open Documents Portal</a>`);
  let history = null;
  getDocs(query(collection(db, 'changeRequests'), orderBy('submittedAt', 'desc'), limit(40)))
    .then((s) => { history = s.docs.map(mapRequest).filter((r) => r.status !== 'pending'); draw(); })
    .catch(() => { history = []; draw(); });

  function current(r) {
    if (r.type === 'new') return {};
    const base = r.targetType === 'worker' ? store.worker(r.targetId) : store.user(r.targetId);
    return { ...(base || {}), ...(store.info(r.targetId) || {}) };
  }

  function card(r) {
    const cur = current(r);
    const rows = [...Object.entries(r.fields), ...Object.entries(r.info)];
    const newFiles = r.newFileIds.map((id) => store.idFiles.find((f) => f.id === id)).filter(Boolean);
    const delFiles = r.deleteFileIds.map((id) => store.idFiles.find((f) => f.id === id)).filter(Boolean);
    const ext = r.targetType === 'worker';
    return `<div class="card mt req-card" data-id="${r.id}">
      <div class="card-head">${avatar(r.targetName, 32, ext ? EXT_COLOR : STAFF_COLOR)}
        <div class="grow"><h2 style="margin:0">${r.type === 'new' ? 'New' : 'Update'} · ${esc(r.targetName)}</h2>
          <div class="small muted">Sent by ${esc(r.submittedBy)} · ${fmtDateTime(r.submittedAt)}${r.note ? ` · “${esc(r.note)}”` : ''}</div></div>
        <span class="wf-chip ${ext ? 'ext' : 'staff'}">${ext ? 'External worker' : 'LLCT staff'}</span></div>
      ${rows.length ? `<div class="table-wrap"><table class="t"><tr><th>Field</th><th>Current</th><th>Proposed</th></tr>
        ${rows.map(([k, v]) => `<tr><td>${esc(FIELD_LABEL[k] || k)}</td><td class="muted">${esc(cur[k] || '—')}</td><td><b class="${v ? '' : 'red-t'}">${esc(v || '(cleared)')}</b></td></tr>`).join('')}
      </table></div>` : ''}
      ${newFiles.length || delFiles.length ? `<div class="card-pad">
        ${newFiles.length ? `<div class="small" style="margin-bottom:6px"><b>New copies</b> — click to view</div><div class="row" style="gap:6px">${newFiles.map((f) => `<span class="pchip new"><a href="javascript:void 0" data-view="${f.id}">${esc(KIND_LABEL[f.kind] || f.kind)} · ${esc(f.name.slice(0, 22))}</a></span>`).join('')}</div>` : ''}
        ${delFiles.length ? `<div class="small" style="margin:8px 0 6px"><b>Copies to remove</b></div><div class="row" style="gap:6px">${delFiles.map((f) => `<span class="pchip rm"><a href="javascript:void 0" data-view="${f.id}">${esc(KIND_LABEL[f.kind] || f.kind)} · ${esc(f.name.slice(0, 22))}</a></span>`).join('')}</div>` : ''}
      </div>` : ''}
      ${isAdmin() ? `<div class="card-pad row" style="border-top:1px solid var(--line)"><span class="spacer"></span>
        <button class="btn ghost" data-reject="${r.id}">${icon('close', 16)} Reject</button>
        <button class="btn success" data-approve="${r.id}">${icon('check', 16)} Approve${r.type === 'new' ? ' & create' : ''}</button></div>`
        : '<div class="card-pad small muted">Only an admin can approve.</div>'}
    </div>`;
  }

  function draw() {
    const list = store.requests;
    el.innerHTML = `
      <div class="card card-pad small">Share the Documents Portal link with your document clerks:
        <b class="mono">${esc(new URL('portal.html', location.href).href)}</b> — they sign in with a <b>Document clerk</b> login (Employees → Add person → Role).</div>
      ${list.length ? list.map(card).join('') : '<div class="card mt empty"><b>No pending requests</b>Everything is up to date.</div>'}
      ${history && history.length ? `<h2 class="mt2" style="margin-bottom:8px">Recently reviewed</h2><div class="card">
        ${history.map((r) => `<div class="list-item"><div class="grow"><b>${r.type === 'new' ? 'New' : 'Update'} · ${esc(r.targetName)}</b>
          <div class="small muted">by ${esc(r.submittedBy)} · ${fmtDateTime(r.submittedAt)} · reviewed by ${esc(r.reviewedBy)}${r.reviewNote ? ` — ${esc(r.reviewNote)}` : ''}</div></div>
          ${r.status === 'approved' ? pill('Approved', 'green') : pill('Rejected', 'red')}</div>`).join('')}</div>` : ''}`;
    el.querySelectorAll('[data-view]').forEach((a) => { a.onclick = () => viewFile(store.idFiles.find((f) => f.id === a.dataset.view)); });
    el.querySelectorAll('[data-approve]').forEach((b) => { b.onclick = () => approve(list.find((r) => r.id === b.dataset.approve)); });
    el.querySelectorAll('[data-reject]').forEach((b) => { b.onclick = () => reject(list.find((r) => r.id === b.dataset.reject)); });
  }

  function approve(r) {
    const needLogin = r.type === 'new' && r.targetType === 'staff';
    modal({
      title: `Approve — ${r.targetName}`,
      body: needLogin ? `<p style="margin-top:0">Create the app login for this new LLCT employee:</p><div class="fields">
          <label class="f"><span>Login ID *</span><input id="ap-id" placeholder="EMP010"></label>
          <label class="f"><span>Password * (min 6)</span><input id="ap-pw"></label></div>
          <div class="small muted">Set their weekly off days later in Employees → Edit.</div><div class="error" id="ap-e"></div>`
        : `<p style="margin-top:0">Apply these changes to <b>${esc(r.targetName)}</b> now?</p><div class="error" id="ap-e"></div>`,
      foot: '<button class="btn ghost" data-x2>Cancel</button><button class="btn success" data-ok>Approve</button>',
      onMount: (m, close) => {
        m.querySelector('[data-x2]').onclick = close;
        m.querySelector('[data-ok]').onclick = async (ev) => {
          ev.currentTarget.disabled = true;
          try {
            const login = needLogin ? { loginId: m.querySelector('#ap-id').value.trim(), password: m.querySelector('#ap-pw').value } : null;
            if (needLogin && (login.password || '').length < 6) throw new Error('Password must be at least 6 characters.');
            await approveRequest(r, login);
            toast('Approved and applied'); close();
          } catch (e) { m.querySelector('#ap-e').textContent = friendlyError(e); ev.currentTarget.disabled = false; }
        };
      },
    });
  }

  function reject(r) {
    modal({
      title: `Reject — ${r.targetName}`,
      body: '<label class="f"><span>Reason (shown to the person who sent it)</span><input id="rj-n"></label>',
      foot: '<button class="btn ghost" data-x2>Cancel</button><button class="btn danger" data-ok>Reject</button>',
      onMount: (m, close) => {
        m.querySelector('[data-x2]').onclick = close;
        m.querySelector('[data-ok]').onclick = async () => {
          try { await rejectRequest(r, m.querySelector('#rj-n').value.trim()); toast('Rejected'); close(); } catch (e) { toast(friendlyError(e), true); }
        };
      },
    });
  }

  draw();
  return store.on(draw);
}

