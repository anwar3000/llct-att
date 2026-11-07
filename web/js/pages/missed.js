// Missed sign-outs: check-ins left open past their day.
//  1. Management gives a yellow flag (warning) or a red flag. The session is closed at the last GPS point and
//     made invalid — the day counts as absent.
//  2. The employee sees a red popup in the app and writes an explanation (e.g. a technical problem).
//  3. Management accepts it (valid day again, with the real check-out time) or keeps it absent with a red flag.
import {
  store, watchMissed, flagMissed, acceptMissed, rejectMissed, lastSeenFor, closeSession,
} from '../fb.js';
import { esc, icon, avatar, pill, toast, modal, friendlyError, fmtDateTime, fmtDate, fmtTime, fmtMins, dateKey, parseKey } from '../util.js';

let LIST = null;

export function mount(el, params, { setHeader }) {
  setHeader('Missed sign-outs', 'Check-ins never signed out — flag them, read the explanation, then accept the day or mark it absent');
  const subs = [];
  const draw = () => render(el);
  subs.push(watchMissed((l, e) => {
    if (e) { el.innerHTML = `<div class="card card-pad error">Could not load: ${esc(friendlyError(e))}<br><span class="small">Publish the latest Firestore rules (they add <b>missedOuts</b>).</span></div>`; return; }
    LIST = l; draw();
  }));
  subs.push(store.on(draw));
  draw();
  return () => subs.forEach((u) => { try { u(); } catch { /* */ } });
}

const flagPill = (f) => (f === 'red' ? pill('⚑ Red flag', 'red') : pill('⚑ Yellow flag', 'amber'));
const hoursOpen = (s) => fmtMins(Math.round((Date.now() - s.checkIn) / 60000));
const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function render(el) {
  if (LIST == null) { el.innerHTML = '<div class="card card-pad muted">Loading…</div>'; return; }
  const today = dateKey(new Date());
  const open = store.open.filter((s) => s.date < today && !LIST.some((m) => m.sessionId === s.id))
    .sort((a, b) => a.checkIn - b.checkIn);
  const asked = LIST.filter((m) => m.status === 'asked');
  const explained = LIST.filter((m) => m.status === 'explained');
  const done = LIST.filter((m) => m.status === 'accepted' || m.status === 'absent').slice(0, 60);

  const section = (title, sub, body, n, tone = '') => `<div class="card mt ${tone}"><div class="card-head"><h2>${title}${n != null ? ` <span class="muted" style="font-weight:600">(${n})</span>` : ''}</h2><span class="small muted">${sub}</span></div>${body}</div>`;
  const empty = (t) => `<div class="empty small">${t}</div>`;

  el.innerHTML = `
    <div class="card card-pad ms-intro">
      <b>How it works</b>
      <ol class="small">
        <li>Someone did not sign out and their GPS stopped. Give a <b style="color:#b06d10">yellow flag</b> (warning) or a <b style="color:#b23535">red flag</b>.
          The check-in is closed at the last GPS point and the day counts as <b>absent</b>.</li>
        <li>The employee gets a red message in the app and writes an explanation (e.g. phone or app problem).</li>
        <li>You read it: <b>Accept</b> — the day counts again, with the real check-out time — or <b>Not satisfactory</b> — absent with a red flag (affects salary).</li>
      </ol>
    </div>

    ${section('Not signed out', 'Check-ins still open from an earlier day', open.length ? open.map((s) => {
      const seen = lastSeenFor(s);
      return `<div class="list-item ms-row">${avatar(s.employeeName, 36, '#D64545')}
        <div class="grow"><b>${esc(s.employeeName)}</b> — never signed out
          <div class="small muted">Checked in ${esc(fmtDate(parseKey(s.date)))} at ${fmtTime(s.inLocal)} · ${esc(s.siteName)} · open ${hoursOpen(s)}</div>
          <div class="small ${seen ? '' : 'red-t'}">${seen ? `Last GPS while on duty: ${fmtDateTime(seen)}` : 'No GPS activity recorded after check-in'}</div></div>
        <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <button class="btn sm ms-y" data-flag="yellow" data-s="${s.id}">⚑ Yellow flag</button>
          <button class="btn sm ms-r" data-flag="red" data-s="${s.id}">⚑ Red flag</button>
          <button class="btn sm ghost" data-close="${s.id}" title="Genuine — close it at the right time without a flag">Close normally</button>
        </div></div>`;
    }).join('') : empty('Nobody — every check-in from earlier days is signed out.'), open.length, open.length ? 'ms-hot' : '')}

    ${section('Explanations to review', 'Accept the day, or mark it absent', explained.length ? explained.map((m) => `<div class="list-item ms-row">${avatar(m.employeeName, 36, '#E08E2B')}
        <div class="grow"><div class="row" style="gap:8px"><b>${esc(m.employeeName)}</b>${flagPill(m.flag)}</div>
          <div class="small muted">${esc(fmtDate(parseKey(m.date)))} · ${esc(m.siteName)} · in ${m.checkIn ? fmtTime(m.checkIn) : '—'} · closed at ${m.closedAt ? fmtTime(m.closedAt) : '—'}</div>
          <div class="ms-expl">“${esc(m.explanation)}”<span class="small muted"> — ${m.explainedAt ? fmtDateTime(m.explainedAt) : ''}</span></div></div>
        <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <button class="btn sm" data-accept="${m.id}">${icon('check', 14)} Accept</button>
          <button class="btn sm danger" data-reject="${m.id}">Not satisfactory — absent</button>
        </div></div>`).join('') : empty('No explanations waiting.'), explained.length, explained.length ? 'ms-hot' : '')}

    ${section('Waiting for the employee', 'They see a red message in the app until they explain', asked.length ? asked.map((m) => `<div class="list-item ms-row">${avatar(m.employeeName, 36, '#9a978f')}
        <div class="grow"><div class="row" style="gap:8px"><b>${esc(m.employeeName)}</b>${flagPill(m.flag)}</div>
          <div class="small muted">${esc(fmtDate(parseKey(m.date)))} · ${esc(m.siteName)} · flagged ${m.askedAt ? fmtDateTime(m.askedAt) : ''}${m.askedBy ? ` by ${esc(m.askedBy)}` : ''}</div>
          ${m.note ? `<div class="small">Message: ${esc(m.note)}</div>` : ''}</div>
        <button class="btn sm danger ghost" data-reject="${m.id}" title="No explanation — mark absent now">Mark absent</button></div>`).join('') : empty('Nobody.'), asked.length)}

    ${section('Decided', 'Last 60', done.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Employee</th><th>Day</th><th>Site</th><th>Flag</th><th>Result</th><th>Explanation</th><th>By</th></tr></thead><tbody>
      ${done.map((m) => `<tr><td><b>${esc(m.employeeName)}</b></td><td class="nowrap">${esc(fmtDate(parseKey(m.date)))}</td><td>${esc(m.siteName)}</td><td>${flagPill(m.flag)}</td>
        <td>${m.status === 'accepted' ? pill('Accepted — day counts', 'green') : pill('Absent', 'red')}${m.decisionNote ? `<div class="small muted">${esc(m.decisionNote)}</div>` : ''}</td>
        <td class="small">${esc(m.explanation || '—')}</td><td class="small nowrap">${esc(m.decidedBy)}<div class="muted">${m.decidedAt ? fmtDateTime(m.decidedAt) : ''}</div></td></tr>`).join('')}
      </tbody></table></div>` : empty('Nothing yet.'))}`;

  const sess = (id) => store.open.find((s) => s.id === id);
  const missed = (id) => LIST.find((m) => m.id === id);
  el.querySelectorAll('[data-flag]').forEach((b) => { b.onclick = () => flagDialog(sess(b.dataset.s), b.dataset.flag); });
  el.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => closeDialog(sess(b.dataset.close)); });
  el.querySelectorAll('[data-accept]').forEach((b) => { b.onclick = () => acceptDialog(missed(b.dataset.accept)); });
  el.querySelectorAll('[data-reject]').forEach((b) => { b.onclick = () => rejectDialog(missed(b.dataset.reject)); });
}

function flagDialog(s, flag) {
  if (!s) return;
  const seen = lastSeenFor(s);
  modal({
    title: `${flag === 'red' ? 'Red' : 'Yellow'} flag — ${s.employeeName}`,
    body: `<p style="margin-top:0">${esc(s.employeeName)} checked in on <b>${esc(fmtDate(parseKey(s.date)))}</b> at ${fmtTime(s.inLocal)} (${esc(s.siteName)}) and never signed out.</p>
      <ul class="small" style="padding-left:18px">
        <li>The check-in is closed at <b>${seen ? fmtDateTime(seen) : `the check-in time (${fmtTime(s.inLocal)}) — no GPS after it`}</b>.</li>
        <li>The day counts as <b>absent</b> until you accept an explanation.</li>
        <li>Next time ${esc(s.employeeName.split(' ')[0])} opens the app, a red message asks for an explanation.</li>
      </ul>
      <label class="f"><span>Message to the employee (optional)</span><textarea id="ms-note" rows="2" placeholder="e.g. You left the site without signing out."></textarea></label>`,
    foot: `<button class="btn ghost" data-cancel>Cancel</button><button class="btn ${flag === 'red' ? 'danger' : 'ms-y'}" data-ok>⚑ Give ${flag} flag</button>`,
    onMount(root, close) {
      root.querySelector('[data-cancel]').onclick = close;
      root.querySelector('[data-ok]').onclick = async (e) => {
        e.currentTarget.disabled = true;
        try { await flagMissed(s, flag, root.querySelector('#ms-note').value.trim()); close(); toast(`${flag === 'red' ? 'Red' : 'Yellow'} flag given — ${s.employeeName} will be asked to explain`); } catch (x) { e.currentTarget.disabled = false; toast(friendlyError(x), true); }
      };
    },
  });
}

function closeDialog(s) {
  if (!s) return;
  const seen = lastSeenFor(s);
  modal({
    title: `Close normally — ${s.employeeName}`,
    body: `<p style="margin-top:0">No flag, the day counts as worked. When did ${esc(s.employeeName.split(' ')[0])} actually finish?</p>
      <label class="f"><span>Check-out time</span><input type="datetime-local" id="ms-at" value="${toLocalInput(seen || new Date(s.checkIn.getTime() + 8 * 3600000))}"></label>`,
    foot: '<button class="btn ghost" data-cancel>Cancel</button><button class="btn" data-ok>Close check-in</button>',
    onMount(root, close) {
      root.querySelector('[data-cancel]').onclick = close;
      root.querySelector('[data-ok]').onclick = async () => {
        const at = new Date(root.querySelector('#ms-at').value);
        if (!(at > s.checkIn)) { toast('The check-out must be after the check-in', true); return; }
        try { await closeSession(s, at); close(); toast('Check-in closed'); } catch (x) { toast(friendlyError(x), true); }
      };
    },
  });
}

function acceptDialog(m) {
  if (!m) return;
  modal({
    title: `Accept — ${m.employeeName}`,
    body: `<p style="margin-top:0">The day (${esc(fmtDate(parseKey(m.date)))}) counts as worked again. The ${m.flag} flag stays on record.</p>
      <div class="ms-expl" style="margin-bottom:12px">“${esc(m.explanation)}”</div>
      <label class="f"><span>Check-out time to use</span><input type="datetime-local" id="ms-at" value="${toLocalInput(m.closedAt && m.checkIn && m.closedAt > m.checkIn ? m.closedAt : new Date(m.checkIn.getTime() + 8 * 3600000))}"></label>
      <label class="f"><span>Note (optional)</span><input id="ms-note" placeholder="e.g. Phone battery died — confirmed by supervisor"></label>`,
    foot: `<button class="btn ghost" data-cancel>Cancel</button><button class="btn" data-ok>${icon('check', 16)} Accept</button>`,
    onMount(root, close) {
      root.querySelector('[data-cancel]').onclick = close;
      root.querySelector('[data-ok]').onclick = async () => {
        const at = new Date(root.querySelector('#ms-at').value);
        if (!(at > m.checkIn)) { toast('The check-out must be after the check-in', true); return; }
        try { await acceptMissed(m, at, root.querySelector('#ms-note').value.trim()); close(); toast('Accepted — the day counts'); } catch (x) { toast(friendlyError(x), true); }
      };
    },
  });
}

function rejectDialog(m) {
  if (!m) return;
  modal({
    title: `Mark absent — ${m.employeeName}`,
    body: `<p style="margin-top:0"><b>${esc(fmtDate(parseKey(m.date)))}</b> stays <b style="color:#b23535">absent with a red flag</b>. It counts as an absent day in the attendance reports used for salary.</p>
      ${m.explanation ? `<div class="ms-expl" style="margin-bottom:12px">“${esc(m.explanation)}”</div>` : '<p class="small muted">No explanation was given.</p>'}
      <label class="f"><span>Reason (shown on the record)</span><input id="ms-note" placeholder="e.g. Explanation not acceptable — GPS shows he left at 2 pm"></label>`,
    foot: '<button class="btn ghost" data-cancel>Cancel</button><button class="btn danger" data-ok>Mark absent</button>',
    onMount(root, close) {
      root.querySelector('[data-cancel]').onclick = close;
      root.querySelector('[data-ok]').onclick = async () => {
        try { await rejectMissed(m, root.querySelector('#ms-note').value.trim()); close(); toast('Marked absent with a red flag'); } catch (x) { toast(friendlyError(x), true); }
      };
    },
  });
}
