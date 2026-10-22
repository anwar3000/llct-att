// Calculations shared by pages and reports.
import { sessionMinutes, sessionFlagged, isoWeekday } from './fb.js';
import { dateKey, parseKey, addDays } from './util.js';

export function pettySummary(txns) {
  let credited = 0, spent = 0, pending = 0, pendingCount = 0;
  for (const t of txns) {
    if (t.type === 'credit' && t.status === 'approved') credited += t.amount;
    if (t.type !== 'credit' && t.status === 'approved') spent += t.amount;
    if (t.type !== 'credit' && t.status === 'pending') { pending += t.amount; pendingCount++; }
  }
  return { credited, spent, pending, pendingCount, balance: credited - spent };
}

/**
 * Per-day attendance picture for one employee over [from, to] (date keys).
 * kind: worked | off | absent | upcoming | beforeJoin
 */
export function employeeDays(user, sessions, offDays, from, to) {
  const now = new Date();
  const todayKey = dateKey(now);
  const approved = new Set(offDays.filter((o) => o.employeeId === user.id && o.status === 'approved').map((o) => o.date));
  const mine = sessions.filter((s) => s.employeeId === user.id);
  const byDate = new Map();
  for (const s of mine) { if (!byDate.has(s.date)) byDate.set(s.date, []); byDate.get(s.date).push(s); }
  const joined = user.createdAt ? dateKey(user.createdAt) : null;
  const out = [];
  for (let d = parseKey(from); dateKey(d) <= to; d = addDays(d, 1)) {
    const k = dateKey(d);
    const s = (byDate.get(k) || []).sort((a, b) => a.checkIn - b.checkIn);
    const isOff = user.weeklyOffDays.includes(isoWeekday(d)) || approved.has(k);
    let kind;
    if (s.length) kind = 'worked';
    else if (isOff) kind = 'off';
    else if (k > todayKey) kind = 'upcoming';
    else if (k === todayKey) kind = 'today';
    else if (joined && k < joined) kind = 'beforeJoin';
    else kind = 'absent';
    out.push({
      date: k, day: d, kind, sessions: s,
      minutes: s.reduce((a, x) => a + sessionMinutes(x, now), 0),
      flagged: s.some(sessionFlagged),
      offReason: isOff ? (approved.has(k) ? 'Approved leave' : 'Weekly off') : '',
    });
  }
  return out;
}

export function employeeSummary(user, sessions, offDays, from, to) {
  const days = employeeDays(user, sessions, offDays, from, to);
  const worked = days.filter((d) => d.sessions.length);
  const minutes = days.reduce((a, d) => a + d.minutes, 0);
  const visits = worked.reduce((a, d) => a + d.sessions.length, 0);
  const sitesSet = new Set(worked.flatMap((d) => d.sessions.map((s) => s.siteName)));
  const firstIns = worked.map((d) => d.sessions[0].checkIn);
  const avgStart = firstIns.length
    ? Math.round(firstIns.reduce((a, t) => a + t.getHours() * 60 + t.getMinutes(), 0) / firstIns.length)
    : null;
  return {
    user, days,
    workedDays: worked.length,
    offDays: days.filter((d) => d.kind === 'off').length,
    absentDays: days.filter((d) => d.kind === 'absent').length,
    minutes,
    avgMinutes: worked.length ? Math.round(minutes / worked.length) : 0,
    visits,
    sites: [...sitesSet],
    flagged: worked.reduce((a, d) => a + d.sessions.filter(sessionFlagged).length, 0),
    avgStart: avgStart == null ? '' : `${String(Math.floor(avgStart / 60)).padStart(2, '0')}:${String(avgStart % 60).padStart(2, '0')}`,
  };
}

export const flagText = (s) => [
  s.inOutside ? `In ${Math.round(s.inDistance || 0)}m away` : '',
  s.outOutside ? `Out ${Math.round(s.outDistance || 0)}m away` : '',
  s.mocked ? 'Fake GPS' : '',
  s.violationMark ? `Violation mark${s.violationNote ? ` (${s.violationNote})` : ''}` : '',
].filter(Boolean).join('; ');
