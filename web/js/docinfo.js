// Reads the document number, expiry date and issue date out of the text of a document
// (from a PDF's text layer or from OCR of a photo). Pure functions — no browser APIs —
// kept in step with lib/services/doc_info.dart in the Android app.

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };
const pad = (n) => String(n).padStart(2, '0');
const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const valid = (y, m, d) => y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

/** Every date in the text: { key: 'yyyy-mm-dd', i: position }. Day-first (UAE style). */
export function findDates(text) {
  const out = [];
  const t = text.toUpperCase();
  let m;
  const r1 = /\b(\d{1,2})\s?[/.\-]\s?(\d{1,2})\s?[/.\-]\s?(\d{4})\b/g; // dd/mm/yyyy
  while ((m = r1.exec(t))) { const d = +m[1], mo = +m[2], y = +m[3]; if (valid(y, mo, d)) out.push({ key: key(y, mo, d), i: m.index }); }
  const r2 = /\b(\d{4})\s?[/.\-]\s?(\d{1,2})\s?[/.\-]\s?(\d{1,2})\b/g; // yyyy/mm/dd
  while ((m = r2.exec(t))) { const y = +m[1], mo = +m[2], d = +m[3]; if (valid(y, mo, d)) out.push({ key: key(y, mo, d), i: m.index }); }
  const r3 = /\b(\d{1,2})[\s\-.]*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT|SEP|OCT|NOV|DEC)[A-Z]*[\s\-.,]*(\d{4})\b/g; // 12 Mar 2027
  while ((m = r3.exec(t))) { const d = +m[1], mo = MONTHS[m[2]], y = +m[3]; if (valid(y, mo, d)) out.push({ key: key(y, mo, d), i: m.index }); }
  const r4 = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT|SEP|OCT|NOV|DEC)[A-Z]*[\s\-.]*(\d{1,2}),?[\s\-.]*(\d{4})\b/g; // Mar 12, 2027
  while ((m = r4.exec(t))) { const mo = MONTHS[m[1]], d = +m[2], y = +m[3]; if (valid(y, mo, d)) out.push({ key: key(y, mo, d), i: m.index }); }
  return out.sort((a, b) => a.i - b.i);
}

const EXP_WORDS = /(DATE\s+OF\s+EXPIRY|EXPIRY\s+DATE|EXPIRATION\s+DATE|EXPIRY|EXPIRES?|EXPIRATION|VALID\s+(UNTIL|UPTO|UP\s+TO|TILL|TO|THRU|THROUGH)|VALIDITY|DATE\s+OF\s+EXP|EXP\.?\s+DATE|END\s+DATE|TO\s+DATE|PERIOD\s+TO|انتهاء)/g;
const ISS_WORDS = /(DATE\s+OF\s+ISSUE|ISSUE\s+DATE|ISSUED\s+ON|ISSUING\s+DATE|DATE\s+ISSUED|ISSUE|ISSUED|START\s+DATE|FROM\s+DATE|PERIOD\s+FROM|إصدار|\bFROM\b)/g;

/** The first date that follows one of the words (within ~80 characters). */
function dateAfter(text, dates, words) {
  const t = text.toUpperCase();
  let m;
  words.lastIndex = 0;
  let best = null;
  while ((m = words.exec(t))) {
    const end = m.index + m[0].length;
    const d = dates.find((x) => x.i >= end && x.i - end <= 80);
    if (d && (!best || d.i - end < best.gap)) best = { key: d.key, gap: d.i - end };
  }
  return best?.key || '';
}

// ------------------------------------------------------------------ passport MRZ
/** Machine-readable zone of a passport: number and expiry. */
function passportMrz(text) {
  const lines = text.toUpperCase().replace(/ /g, '').split(/\n/).map((l) => l.replace(/[«‹]/g, '<').trim());
  for (const l of lines) {
    // Line 2: number(9) check nat(3) birth(6) check sex expiry(6) check …
    const m = l.match(/([A-Z0-9<]{9})[0-9<]([A-Z<]{3})(\d{6})[0-9<]([MF<X])(\d{6})/);
    if (m) {
      const no = m[1].replace(/</g, '');
      const yy = +m[5].slice(0, 2), mm = +m[5].slice(2, 4), dd = +m[5].slice(4, 6);
      const y = 2000 + yy;
      return { number: /\d/.test(no) && no.length >= 6 ? no : '', expiry: valid(y, mm, dd) ? key(y, mm, dd) : '' };
    }
  }
  return null;
}

// ------------------------------------------------------------------ numbers
/** A number-like token right after one of the labels (same line, or the next line). */
function tokenAfter(text, labels) {
  const t = text.toUpperCase();
  for (const lab of labels) {
    const re = new RegExp(`${lab}\\s*[:#.\\-]*[ \\t]*(?:\\n[ \\t]*)?([^\\n]{1,48})`, 'g');
    let m;
    while ((m = re.exec(t))) {
      let tok = '';
      for (const p of m[m.length - 1].trim().split(/\s+/)) {
        if (/\d/.test(p) || (tok && /^[\-/]$/.test(p))) tok += p;
        else if (!tok && /^[A-Z]{1,3}-?$/.test(p)) tok += p; // short prefix, e.g. "CN 1234"
        else break;
      }
      tok = tok.replace(/^[:#.\-]+|[\-/.:,]+$/g, '');
      if (tok.length >= 3 && tok.length <= 32 && /\d/.test(tok) && /^[A-Z0-9][A-Z0-9/\-.]*$/.test(tok)
        && !/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(tok) && !/^\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}$/.test(tok)) return tok;
    }
  }
  return '';
}

const NUMBER_LABELS = {
  eid: ['ID\\s*NUMBER', 'IDENTITY\\s*(CARD)?\\s*NO', 'ID\\s*NO'],
  passport: ['PASSPORT\\s*NO\\.?', 'PASSPORT\\s*NUMBER', 'DOCUMENT\\s*NO'],
  visa: ['FILE\\s*(NO|NUMBER)', 'ENTRY\\s*PERMIT\\s*NO', 'VISA\\s*(NO|NUMBER)', 'PERMIT\\s*NO', 'U\\.?I\\.?D\\.?\\s*NO'],
  sira: ['CARD\\s*(NO|NUMBER)', 'LICEN[CS]E\\s*(NO|NUMBER)', 'PERMIT\\s*(NO|NUMBER)', 'REG(ISTRATION)?\\s*(NO|NUMBER)', 'SIRA\\s*(NO|NUMBER|ID)', 'NO\\.'],
  mcc: ['CERTIFICATE\\s*(NO|NUMBER)', 'REF(ERENCE)?\\s*(NO|NUMBER)', 'SERIAL\\s*(NO|NUMBER)', 'NO\\.'],
  labour: ['WORK\\s*PERMIT\\s*(NO|NUMBER)', 'LABOU?R\\s*CARD\\s*(NO|NUMBER)', 'PERSONAL\\s*(NO|NUMBER)', 'PERMIT\\s*(NO|NUMBER)', 'CARD\\s*(NO|NUMBER)'],
  tradeLicense: ['LICEN[CS]E\\s*(NO|NUMBER)', 'LICEN[CS]E\\s*#', 'TRADE\\s*LICEN[CS]E\\s*(NO)?', 'REGISTRATION\\s*(NO|NUMBER)', 'COMMERCIAL\\s*LICEN[CS]E\\s*(NO)?'],
  adTradeLicense: ['LICEN[CS]E\\s*(NO|NUMBER)', 'LICEN[CS]E\\s*#', 'CN\\s*[-:]?', 'REGISTRATION\\s*(NO|NUMBER)'],
  chamber: ['MEMBERSHIP\\s*(NO|NUMBER)', 'MEMBER\\s*(NO|NUMBER)', 'CERTIFICATE\\s*(NO|NUMBER)', 'REGISTRATION\\s*(NO|NUMBER)'],
  wcInsurance: ['POLICY\\s*(NO|NUMBER)', 'POLICY\\s*#', 'CERTIFICATE\\s*(NO|NUMBER)'],
  tplInsurance: ['POLICY\\s*(NO|NUMBER)', 'POLICY\\s*#', 'CERTIFICATE\\s*(NO|NUMBER)'],
  medical: ['POLICY\\s*(NO|NUMBER)', 'POLICY\\s*#', 'CONTRACT\\s*(NO|NUMBER)', 'MEMBER\\s*(NO|NUMBER)'],
  vat: ['TAX\\s*REGISTRATION\\s*NUMBER', 'TRN\\s*(NO|NUMBER)?', 'VAT\\s*(NO|NUMBER)'],
  estCard: ['ESTABLISHMENT\\s*(CARD)?\\s*(NO|NUMBER)', 'E[-\\s]?CODE', 'CARD\\s*(NO|NUMBER)', 'FILE\\s*(NO|NUMBER)'],
  mohre: ['ESTABLISHMENT\\s*(NO|NUMBER)', 'COMPANY\\s*(NO|NUMBER|CODE)', 'MOHRE\\s*(NO|NUMBER)', 'CARD\\s*(NO|NUMBER)'],
  tenancy: ['EJARI\\s*(NO|NUMBER|CONTRACT\\s*NO)?', 'CONTRACT\\s*(NO|NUMBER)', 'REGISTRATION\\s*(NO|NUMBER)'],
  moa: ['REGISTRATION\\s*(NO|NUMBER)', 'NOTARY\\s*(NO|NUMBER)', 'REF(ERENCE)?\\s*(NO|NUMBER)', 'DOCUMENT\\s*(NO|NUMBER)'],
};
const GENERIC_LABELS = ['LICEN[CS]E\\s*(NO|NUMBER)', 'POLICY\\s*(NO|NUMBER)', 'CERTIFICATE\\s*(NO|NUMBER)', 'REGISTRATION\\s*(NO|NUMBER)', 'DOCUMENT\\s*(NO|NUMBER)', 'REF(ERENCE)?\\s*(NO|NUMBER)', 'CARD\\s*(NO|NUMBER)', '(NO|NUMBER)\\s*[:.]'];

/**
 * { number, expiry, issue } read from the text of a document of `kind`
 * (eid, passport, visa, sira, mcc, labour, or a company document key). Empty strings when not found.
 */
export function extractDocInfo(text, kind = '') {
  const raw = String(text || '');
  const t = raw.toUpperCase().replace(/[‐-―]/g, '-');
  const dates = findDates(t);
  let number = '', expiry = '', issue = '';

  if (kind === 'eid') {
    const m = t.replace(/[ ]/g, '').match(/784-?\d{4}-?\d{7}-?\d/) || t.match(/784[\s\-]*\d{4}[\s\-]*\d{7}[\s\-]*\d/);
    if (m) { const d = m[0].replace(/\D/g, ''); number = `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 14)}-${d.slice(14, 15)}`; }
  }
  if (kind === 'passport') {
    const mrz = passportMrz(t);
    if (mrz) { number = mrz.number; expiry = mrz.expiry; }
  }
  if (kind === 'visa') {
    const m = t.match(/\b\d{3}\s?\/\s?\d{4}\s?\/\s?\d{1,2}\s?\/?\s?\d{3,8}\b/) || t.match(/\b\d{3}\s?\/\s?\d{4}\s?\/\s?\d{3,8}\b/);
    if (m) number = m[0].replace(/\s/g, '');
  }
  if (kind === 'vat') {
    const m = t.match(/\b1\d{14}\b/);
    if (m) number = m[0];
  }
  if (!number) number = tokenAfter(t, NUMBER_LABELS[kind] || GENERIC_LABELS) || (NUMBER_LABELS[kind] ? tokenAfter(t, GENERIC_LABELS) : '');

  if (!expiry) expiry = dateAfter(t, dates, EXP_WORDS);
  issue = dateAfter(t, dates, ISS_WORDS);
  if (issue && issue === expiry) issue = '';
  if (!expiry && dates.length >= 2) {
    // No label: the latest date is usually the expiry (issue / birth dates come before it).
    const latest = dates.map((d) => d.key).sort().pop();
    if (latest > (issue || '')) expiry = latest;
  }
  if (!expiry && dates.length === 1 && dates[0].key > new Date().toISOString().slice(0, 10)) expiry = dates[0].key;
  if (expiry && issue && issue > expiry) issue = '';
  return { number, expiry, issue };
}
