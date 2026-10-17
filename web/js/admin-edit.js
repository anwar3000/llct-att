// Admin corrections: edit check-in / check-out times, delete a whole day.
import { editSessionTimes, deleteWorkDay, editWorkerEntryTimes, closeSession, forceLogout, store, isAdmin } from './fb.js';
import { esc, modal, toast, confirmBox, friendlyError, dateKey, fmtDay, tzLabel, parseKey, fmtTime, fromTz } from './util.js';

const hhmm = (d) => (d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '');
const wall = (date, time) => {
  if (!date || !time) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi);
};

/** Edit times of a staff check-in (or, with `worker: true`, an external worker entry). Times are site-local. */
export function editTimesDialog(s, onDone, { worker = false } = {}) {
  const inL = s.inLocal, outL = s.outLocal;
  modal({
    title: worker ? `Edit time — ${s.workerName}` : `Edit times — ${s.employeeName}`,
    body: `<div class="small muted" style="margin-bottom:10px">${esc(s.siteName)}${s.tz != null ? ` · times are local at the site (${tzLabel(s.tz)})` : ''}</div>
      <div class="fields">
        <label class="f"><span>Check-in date</span><input type="date" id="et-d" value="${dateKey(inL)}"></label>
        <label class="f"><span>Check-in time</span><input type="time" id="et-i" value="${hhmm(inL)}"></label>
        <label class="f"><span>Check-out date</span><input type="date" id="et-od" value="${dateKey(outL || inL)}"></label>
        <label class="f"><span>Check-out time ${s.checkOut ? '' : '(blank = still on site)'}</span><input type="time" id="et-o" value="${hhmm(outL)}"></label>
        ${worker ? '' : `<label class="f full"><span>Reason (shown in the record)</span><input id="et-r" placeholder="e.g. forgot to check out, phone off"></label>
        <label class="f full row" style="gap:8px"><input type="checkbox" id="et-w" checked> Also adjust external workers on this check-in</label>`}
      </div>
      <div class="error" id="et-err"></div>`,
    foot: '<button class="btn ghost" data-x2>Cancel</button><button class="btn" data-ok>Save times</button>',
    onMount: (m, close) => {
      m.querySelector('[data-x2]').onclick = close;
      m.querySelector('[data-ok]').onclick = async (ev) => {
        const err = m.querySelector('#et-err');
        const inW = wall(m.querySelector('#et-d').value, m.querySelector('#et-i').value);
        const outT = m.querySelector('#et-o').value;
        const outW = outT ? wall(m.querySelector('#et-od').value, outT) : null;
        if (!inW) { err.textContent = 'Enter the check-in date and time.'; return; }
        if (s.checkOut && !outW) { err.textContent = 'Enter the check-out time.'; return; }
        if (outW && outW <= inW) { err.textContent = 'Check-out must be after check-in.'; return; }
        if (outW && outW - inW > 24 * 3600000 && !confirm('That is more than 24 hours. Save anyway?')) return;
        ev.currentTarget.disabled = true;
        try {
          if (worker) await editWorkerEntryTimes(s, inW, outW);
          else await editSessionTimes(s, inW, outW, { applyWorkers: m.querySelector('#et-w').checked, reason: m.querySelector('#et-r').value.trim() });
          toast('Times updated'); close(); onDone?.();
        } catch (e) { err.textContent = friendlyError(e); ev.currentTarget.disabled = false; }
      };
    },
  });
}

/** Delete all check-ins of an employee on a day. */
export async function deleteDayDialog(employeeId, name, date, count, onDone) {
  if (!await confirmBox('Delete working day?',
    `Delete all ${count} check-in${count === 1 ? '' : 's'} of ${name} on ${fmtDay(parseKey(date))}, including the external worker time logged with them? This cannot be undone.`,
    { ok: 'Delete day', danger: true })) return;
  try { const n = await deleteWorkDay(employeeId, date); toast(`Deleted ${n} check-in${n === 1 ? '' : 's'}`); onDone?.(); } catch (e) { toast(friendlyError(e), true); }
}

/**
 * Log out an online employee: check them out (now or at a chosen time, closing their external
 * workers too) and/or sign them out of the app on their phone.
 */
export function logoutDialog(userId, onDone) {
  const u = store.user(userId);
  const name = u?.name || 'employee';
  const open = store.open.find((s) => s.employeeId === userId) || null;
  const workers = open ? store.extOnSite.filter((l) => l.sessionId === open.id).length : 0;
  modal({
    title: `Log out ${name}`,
    body: `${open ? `<p style="margin-top:0">On duty at <b>${esc(open.siteName)}</b> since ${fmtTime(open.inLocal)}${workers ? ` with <b>${workers}</b> external worker${workers === 1 ? '' : 's'}` : ''}.</p>` : '<p style="margin-top:0">Not checked in right now.</p>'}
      ${open ? `<label class="f row" style="gap:8px"><input type="checkbox" id="lo-co" checked> <b>Check out</b>${workers ? ' (their external workers are checked out too)' : ''}</label>
      <label class="f" style="margin-left:26px"><span>Check-out time (site local time) — blank = now</span><input type="time" id="lo-t"></label>` : ''}
      ${isAdmin() ? `<label class="f row" style="gap:8px"><input type="checkbox" id="lo-so" ${open ? '' : 'checked'}> <b>Sign out of the app</b> on their phone (Android & iPhone)</label>` : ''}
      <div class="small muted">They can sign in again with their login ID. To block them completely, deactivate the account in Employees → Edit.</div>
      <div class="error" id="lo-e"></div>`,
    foot: '<button class="btn ghost" data-x2>Cancel</button><button class="btn danger" data-ok>Log out</button>',
    onMount: (m, close) => {
      m.querySelector('[data-x2]').onclick = close;
      m.querySelector('[data-ok]').onclick = async (ev) => {
        const co = open && m.querySelector('#lo-co').checked;
        const so = !!m.querySelector('#lo-so')?.checked;
        if (!co && !so) { m.querySelector('#lo-e').textContent = 'Choose at least one option.'; return; }
        let at = new Date();
        if (co) {
          const t = m.querySelector('#lo-t').value;
          if (t) {
            const [h, mi] = t.split(':').map(Number);
            at = fromTz(new Date(open.inLocal.getFullYear(), open.inLocal.getMonth(), open.inLocal.getDate(), h, mi), open.tz);
            if (at <= open.checkIn) { m.querySelector('#lo-e').textContent = 'Check-out must be after check-in.'; return; }
          }
        }
        ev.currentTarget.disabled = true;
        try {
          if (co) await closeSession(open, at);
          if (so) await forceLogout(userId);
          toast(`${name}: ${[co ? 'checked out' : '', so ? 'signed out of the app' : ''].filter(Boolean).join(' & ')}`);
          close(); onDone?.();
        } catch (e) { m.querySelector('#lo-e').textContent = friendlyError(e); ev.currentTarget.disabled = false; }
      };
    },
  });
}
