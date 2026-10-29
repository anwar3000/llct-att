/// Reads the document number, expiry date and issue date out of the text of a document
/// (OCR of a photo, or a PDF page). Pure Dart — kept in step with web/js/docinfo.js.
class DocInfo {
  final String number, expiry, issue; // expiry / issue: yyyy-MM-dd or ''
  const DocInfo({this.number = '', this.expiry = '', this.issue = ''});
  bool get isEmpty => number.isEmpty && expiry.isEmpty && issue.isEmpty;
  @override
  String toString() => 'DocInfo($number, exp $expiry, iss $issue)';
}

class _Date {
  final String key;
  final int i;
  _Date(this.key, this.i);
}

const _months = {
  'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAY': 5, 'JUN': 6, 'JUL': 7, 'AUG': 8,
  'SEP': 9, 'SEPT': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12,
};

String _p2(int n) => n.toString().padLeft(2, '0');
String _key(int y, int m, int d) => '$y-${_p2(m)}-${_p2(d)}';
bool _valid(int y, int m, int d) => y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

List<_Date> _findDates(String t) {
  final out = <_Date>[];
  for (final m in RegExp(r'\b(\d{1,2})\s?[/.\-]\s?(\d{1,2})\s?[/.\-]\s?(\d{4})\b').allMatches(t)) {
    final d = int.parse(m[1]!), mo = int.parse(m[2]!), y = int.parse(m[3]!);
    if (_valid(y, mo, d)) out.add(_Date(_key(y, mo, d), m.start));
  }
  for (final m in RegExp(r'\b(\d{4})\s?[/.\-]\s?(\d{1,2})\s?[/.\-]\s?(\d{1,2})\b').allMatches(t)) {
    final y = int.parse(m[1]!), mo = int.parse(m[2]!), d = int.parse(m[3]!);
    if (_valid(y, mo, d)) out.add(_Date(_key(y, mo, d), m.start));
  }
  for (final m in RegExp(r'\b(\d{1,2})[\s\-.]*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT|SEP|OCT|NOV|DEC)[A-Z]*[\s\-.,]*(\d{4})\b').allMatches(t)) {
    final d = int.parse(m[1]!), mo = _months[m[2]!]!, y = int.parse(m[3]!);
    if (_valid(y, mo, d)) out.add(_Date(_key(y, mo, d), m.start));
  }
  for (final m in RegExp(r'\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT|SEP|OCT|NOV|DEC)[A-Z]*[\s\-.]*(\d{1,2}),?[\s\-.]*(\d{4})\b').allMatches(t)) {
    final mo = _months[m[1]!]!, d = int.parse(m[2]!), y = int.parse(m[3]!);
    if (_valid(y, mo, d)) out.add(_Date(_key(y, mo, d), m.start));
  }
  out.sort((a, b) => a.i.compareTo(b.i));
  return out;
}

final _expWords = RegExp(
    r'(DATE\s+OF\s+EXPIRY|EXPIRY\s+DATE|EXPIRATION\s+DATE|EXPIRY|EXPIRES?|EXPIRATION|VALID\s+(UNTIL|UPTO|UP\s+TO|TILL|TO|THRU|THROUGH)|VALIDITY|DATE\s+OF\s+EXP|EXP\.?\s+DATE|END\s+DATE|TO\s+DATE|PERIOD\s+TO|انتهاء)');
final _issWords = RegExp(
    r'(DATE\s+OF\s+ISSUE|ISSUE\s+DATE|ISSUED\s+ON|ISSUING\s+DATE|DATE\s+ISSUED|ISSUE|ISSUED|START\s+DATE|FROM\s+DATE|PERIOD\s+FROM|إصدار|\bFROM\b)');

String _dateAfter(String t, List<_Date> dates, RegExp words) {
  String best = '';
  int bestGap = 1 << 30;
  for (final m in words.allMatches(t)) {
    final end = m.end;
    for (final d in dates) {
      if (d.i >= end && d.i - end <= 80) {
        if (d.i - end < bestGap) {
          bestGap = d.i - end;
          best = d.key;
        }
        break;
      }
    }
  }
  return best;
}

({String number, String expiry})? _passportMrz(String t) {
  final lines = t.replaceAll(' ', '').split('\n').map((l) => l.replaceAll(RegExp('[«‹]'), '<').trim());
  final re = RegExp(r'([A-Z0-9<]{9})[0-9<]([A-Z<]{3})(\d{6})[0-9<]([MF<X])(\d{6})');
  for (final l in lines) {
    final m = re.firstMatch(l);
    if (m == null) continue;
    final no = m[1]!.replaceAll('<', '');
    final e = m[5]!;
    final y = 2000 + int.parse(e.substring(0, 2)), mm = int.parse(e.substring(2, 4)), dd = int.parse(e.substring(4, 6));
    return (
      number: RegExp(r'\d').hasMatch(no) && no.length >= 6 ? no : '',
      expiry: _valid(y, mm, dd) ? _key(y, mm, dd) : '',
    );
  }
  return null;
}

String _tokenAfter(String t, List<String> labels) {
  for (final lab in labels) {
    final re = RegExp('$lab\\s*[:#.\\-]*[ \\t]*(?:\\n[ \\t]*)?([^\\n]{1,48})');
    for (final m in re.allMatches(t)) {
      final rest = m.group(m.groupCount)!.trim();
      var tok = '';
      for (final p in rest.split(RegExp(r'\s+'))) {
        if (RegExp(r'\d').hasMatch(p) || (tok.isNotEmpty && RegExp(r'^[\-/]$').hasMatch(p))) {
          tok += p;
        } else if (tok.isEmpty && RegExp(r'^[A-Z]{1,3}-?$').hasMatch(p)) {
          tok += p;
        } else {
          break;
        }
      }
      tok = tok.replaceAll(RegExp(r'^[:#.\-]+|[\-/.:,]+$'), '');
      if (tok.length >= 3 &&
          tok.length <= 32 &&
          RegExp(r'\d').hasMatch(tok) &&
          RegExp(r'^[A-Z0-9][A-Z0-9/\-.]*$').hasMatch(tok) &&
          !RegExp(r'^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$').hasMatch(tok) &&
          !RegExp(r'^\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}$').hasMatch(tok)) {
        return tok;
      }
    }
  }
  return '';
}

const _numberLabels = <String, List<String>>{
  'eid': [r'ID\s*NUMBER', r'IDENTITY\s*(CARD)?\s*NO', r'ID\s*NO'],
  'passport': [r'PASSPORT\s*NO\.?', r'PASSPORT\s*NUMBER', r'DOCUMENT\s*NO'],
  'visa': [r'FILE\s*(NO|NUMBER)', r'ENTRY\s*PERMIT\s*NO', r'VISA\s*(NO|NUMBER)', r'PERMIT\s*NO', r'U\.?I\.?D\.?\s*NO'],
  'sira': [r'CARD\s*(NO|NUMBER)', r'LICEN[CS]E\s*(NO|NUMBER)', r'PERMIT\s*(NO|NUMBER)', r'REG(ISTRATION)?\s*(NO|NUMBER)', r'SIRA\s*(NO|NUMBER|ID)', r'NO\.'],
  'mcc': [r'CERTIFICATE\s*(NO|NUMBER)', r'REF(ERENCE)?\s*(NO|NUMBER)', r'SERIAL\s*(NO|NUMBER)', r'NO\.'],
  'labour': [r'WORK\s*PERMIT\s*(NO|NUMBER)', r'LABOU?R\s*CARD\s*(NO|NUMBER)', r'PERSONAL\s*(NO|NUMBER)', r'PERMIT\s*(NO|NUMBER)', r'CARD\s*(NO|NUMBER)'],
  'tradeLicense': [r'LICEN[CS]E\s*(NO|NUMBER)', r'LICEN[CS]E\s*#', r'TRADE\s*LICEN[CS]E\s*(NO)?', r'REGISTRATION\s*(NO|NUMBER)', r'COMMERCIAL\s*LICEN[CS]E\s*(NO)?'],
  'adTradeLicense': [r'LICEN[CS]E\s*(NO|NUMBER)', r'LICEN[CS]E\s*#', r'CN\s*[-:]?', r'REGISTRATION\s*(NO|NUMBER)'],
  'chamber': [r'MEMBERSHIP\s*(NO|NUMBER)', r'MEMBER\s*(NO|NUMBER)', r'CERTIFICATE\s*(NO|NUMBER)', r'REGISTRATION\s*(NO|NUMBER)'],
  'wcInsurance': [r'POLICY\s*(NO|NUMBER)', r'POLICY\s*#', r'CERTIFICATE\s*(NO|NUMBER)'],
  'tplInsurance': [r'POLICY\s*(NO|NUMBER)', r'POLICY\s*#', r'CERTIFICATE\s*(NO|NUMBER)'],
  'medical': [r'POLICY\s*(NO|NUMBER)', r'POLICY\s*#', r'CONTRACT\s*(NO|NUMBER)', r'MEMBER\s*(NO|NUMBER)'],
  'vat': [r'TAX\s*REGISTRATION\s*NUMBER', r'TRN\s*(NO|NUMBER)?', r'VAT\s*(NO|NUMBER)'],
  'estCard': [r'ESTABLISHMENT\s*(CARD)?\s*(NO|NUMBER)', r'E[-\s]?CODE', r'CARD\s*(NO|NUMBER)', r'FILE\s*(NO|NUMBER)'],
  'mohre': [r'ESTABLISHMENT\s*(NO|NUMBER)', r'COMPANY\s*(NO|NUMBER|CODE)', r'MOHRE\s*(NO|NUMBER)', r'CARD\s*(NO|NUMBER)'],
  'tenancy': [r'EJARI\s*(NO|NUMBER|CONTRACT\s*NO)?', r'CONTRACT\s*(NO|NUMBER)', r'REGISTRATION\s*(NO|NUMBER)'],
  'moa': [r'REGISTRATION\s*(NO|NUMBER)', r'NOTARY\s*(NO|NUMBER)', r'REF(ERENCE)?\s*(NO|NUMBER)', r'DOCUMENT\s*(NO|NUMBER)'],
};
const _genericLabels = [
  r'LICEN[CS]E\s*(NO|NUMBER)', r'POLICY\s*(NO|NUMBER)', r'CERTIFICATE\s*(NO|NUMBER)', r'REGISTRATION\s*(NO|NUMBER)',
  r'DOCUMENT\s*(NO|NUMBER)', r'REF(ERENCE)?\s*(NO|NUMBER)', r'CARD\s*(NO|NUMBER)', r'(NO|NUMBER)\s*[:.]',
];

/// Number, expiry and issue date read from the text of a document of [kind]
/// (eid, passport, visa, sira, mcc, labour, or a company document key).
DocInfo extractDocInfo(String text, String kind) {
  final t = text.toUpperCase().replaceAll(RegExp('[‐-―]'), '-');
  final dates = _findDates(t);
  var number = '', expiry = '', issue = '';

  if (kind == 'eid') {
    final m = RegExp(r'784-?\d{4}-?\d{7}-?\d').firstMatch(t.replaceAll(' ', '')) ??
        RegExp(r'784[\s\-]*\d{4}[\s\-]*\d{7}[\s\-]*\d').firstMatch(t);
    if (m != null) {
      final d = m[0]!.replaceAll(RegExp(r'\D'), '');
      number = '${d.substring(0, 3)}-${d.substring(3, 7)}-${d.substring(7, 14)}-${d.substring(14, 15)}';
    }
  }
  if (kind == 'passport') {
    final mrz = _passportMrz(t);
    if (mrz != null) {
      number = mrz.number;
      expiry = mrz.expiry;
    }
  }
  if (kind == 'visa') {
    final m = RegExp(r'\b\d{3}\s?/\s?\d{4}\s?/\s?\d{1,2}\s?/?\s?\d{3,8}\b').firstMatch(t) ??
        RegExp(r'\b\d{3}\s?/\s?\d{4}\s?/\s?\d{3,8}\b').firstMatch(t);
    if (m != null) number = m[0]!.replaceAll(RegExp(r'\s'), '');
  }
  if (kind == 'vat') {
    final m = RegExp(r'\b1\d{14}\b').firstMatch(t);
    if (m != null) number = m[0]!;
  }
  if (number.isEmpty) {
    final labels = _numberLabels[kind];
    number = _tokenAfter(t, labels ?? _genericLabels);
    if (number.isEmpty && labels != null) number = _tokenAfter(t, _genericLabels);
  }

  if (expiry.isEmpty) expiry = _dateAfter(t, dates, _expWords);
  issue = _dateAfter(t, dates, _issWords);
  if (issue.isNotEmpty && issue == expiry) issue = '';
  if (expiry.isEmpty && dates.length >= 2) {
    final keys = dates.map((d) => d.key).toList()..sort();
    if (keys.last.compareTo(issue) > 0) expiry = keys.last;
  }
  if (expiry.isEmpty && dates.length == 1) {
    final n = DateTime.now();
    if (dates.first.key.compareTo(_key(n.year, n.month, n.day)) > 0) expiry = dates.first.key;
  }
  if (expiry.isNotEmpty && issue.isNotEmpty && issue.compareTo(expiry) > 0) issue = '';
  return DocInfo(number: number, expiry: expiry, issue: issue);
}
