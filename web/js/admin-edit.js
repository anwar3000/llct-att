// Admin corrections: edit check-in / check-out times, delete a whole day.
import { editSessionTimes, deleteWorkDay, editWorkerEntryTimes } from './fb.js';
import { esc, modal, toast, confirmBox, friendlyError, dateKey, fmtDay, tzLabel, parseKey } from './util.js';

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
