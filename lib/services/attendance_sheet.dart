import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../models/models.dart';
import 'id_sheet.dart';
import 'inv_reports.dart';

/// One person picked for the sheet: staff (users) or external worker (extWorkers).
class SheetPerson {
  final String id, name, kind, sub; // kind: 'staff' | 'external'
  const SheetPerson({required this.id, required this.name, required this.kind, this.sub = ''});
}

/// One day of one person.
class SheetDay {
  final String date;
  final List<String> sites;
  final DateTime? firstIn, lastOut;
  final Duration worked;
  final bool openNoOut;
  SheetDay(this.date, this.sites, this.firstIn, this.lastOut, this.worked, this.openNoOut);
}

/// One check-in (staff) or one site entry (external worker).
class SheetRow {
  final String date, site, flags, addedBy;
  final DateTime inT;
  final DateTime? outT;
  final Duration worked;
  SheetRow(this.date, this.site, this.inT, this.outT, this.worked, this.flags, this.addedBy);
}

/// Attendance sheet for selected staff and external workers: every day with site(s), in, out and hours; totals.
class AttendanceSheet {
  static final _fs = FirebaseFirestore.instance;
  static const _ink = PdfColor.fromInt(0xFF232324);
  static const _muted = PdfColor.fromInt(0xFF75757A);
  static const _line = PdfColor.fromInt(0xFFDDDDDD);
  static const _navy = PdfColor.fromInt(0xFF17375F);

  static String _c(String s) => s.replaceAll('→', '>').replaceAll('–', '-').replaceAll('—', '-').replaceAll('·', '-');
  static String hm(Duration d) {
    final m = d.inMinutes;
    return '${m ~/ 60}:${(m % 60).toString().padLeft(2, '0')}';
  }

  /// Every check-in of the selected people between [from] and [to] (yyyy-MM-dd, inclusive), by person id.
  static Future<Map<String, List<SheetRow>>> loadRows(List<SheetPerson> people, String from, String to) async {
    final staffIds = people.where((p) => p.kind == 'staff').map((p) => p.id).toSet();
    final extIds = people.where((p) => p.kind == 'external').map((p) => p.id).toSet();
    final now = DateTime.now();
    final rows = <String, List<SheetRow>>{};
    if (staffIds.isNotEmpty) {
      final q = await _fs.collection('attendance').where('date', isGreaterThanOrEqualTo: from).where('date', isLessThanOrEqualTo: to).get();
      for (final d in q.docs) {
        final s = AttendanceSession.fromDoc(d);
        if (!staffIds.contains(s.employeeId) || s.invalid) continue;
        final open = s.checkOut == null;
        final w = open ? (s.date == _key(now) ? s.worked(now) : Duration.zero) : s.worked();
        final flags = [
          if (s.inOutside) 'in ${(s.inDistance ?? 0).round()} m away',
          if (s.outOutside) 'out ${(s.outDistance ?? 0).round()} m away',
          if (s.mocked) 'fake GPS',
          if (s.missedOut) 'missed sign-out',
        ].join(', ');
        rows.putIfAbsent(s.employeeId, () => []).add(SheetRow(s.date, s.siteName, s.inLocal, s.outLocal, w, flags, ''));
      }
    }
    if (extIds.isNotEmpty) {
      final q = await _fs.collection('workerAttendance').where('date', isGreaterThanOrEqualTo: from).where('date', isLessThanOrEqualTo: to).get();
      for (final d in q.docs) {
        final e = WorkerEntry.fromDoc(d);
        if (!extIds.contains(e.workerId)) continue;
        final open = e.checkOut == null;
        final w = open ? (e.date == _key(now) ? e.worked(now) : Duration.zero) : e.worked();
        rows.putIfAbsent(e.workerId, () => [])
            .add(SheetRow(e.date, e.siteName, e.inLocal, e.checkOut == null ? null : atZone(e.checkOut!, e.tz), w, '', e.employeeName));
      }
    }
    for (final l in rows.values) {
      l.sort((a, b) => a.inT.compareTo(b.inT));
    }
    return rows;
  }

  /// Loads the days of each person between [from] and [to] (yyyy-MM-dd, inclusive).
  static Future<Map<String, List<SheetDay>>> load(List<SheetPerson> people, String from, String to) async {
    final rows = await loadRows(people, from, to);
    final out = <String, List<SheetDay>>{};
    for (final p in people) {
      final byDay = <String, List<SheetRow>>{};
      for (final r in rows[p.id] ?? const []) {
        byDay.putIfAbsent(r.date, () => []).add(r);
      }
      final days = byDay.entries.map((e) {
        final l = e.value..sort((a, b) => a.inT.compareTo(b.inT));
        final outs = l.where((x) => x.outT != null).map((x) => x.outT!).toList()..sort();
        return SheetDay(
          e.key,
          [for (final x in l) if (x.site.isNotEmpty) x.site].toSet().toList(),
          l.first.inT,
          outs.isEmpty ? null : outs.last,
          l.fold(Duration.zero, (a, x) => a + x.worked),
          l.any((x) => x.outT == null),
        );
      }).toList()
        ..sort((a, b) => a.date.compareTo(b.date));
      out[p.id] = days;
    }
    return out;
  }

  static String _key(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

  static Future<Uint8List> build(List<SheetPerson> people, Map<String, List<SheetDay>> data, {required String period}) async {
    final cfg = await InvConfig.load();
    pw.MemoryImage? logo;
    try {
      logo = pw.MemoryImage((await rootBundle.load('assets/doc_logo.png')).buffer.asUint8List());
    } catch (_) {
      try {
        logo = pw.MemoryImage((await rootBundle.load('assets/logo.png')).buffer.asUint8List());
      } catch (_) {}
    }
    pw.TextStyle t(double size, {PdfColor color = _ink, bool bold = false}) =>
        pw.TextStyle(fontSize: size, color: color, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal);
    pw.Widget cell(String s, {bool bold = false, pw.TextAlign align = pw.TextAlign.left, PdfColor color = _ink, double size = 8.4}) =>
        pw.Padding(padding: const pw.EdgeInsets.symmetric(horizontal: 4, vertical: 3.2), child: pw.Text(_c(s), textAlign: align, style: t(size, bold: bold, color: color)));
    pw.TableRow head(List<String> h, Set<int> right) => pw.TableRow(
          decoration: const pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(color: _navy, width: 1))),
          children: [for (var i = 0; i < h.length; i++) cell(h[i].toUpperCase(), bold: true, color: _navy, size: 7.3, align: right.contains(i) ? pw.TextAlign.right : pw.TextAlign.left)],
        );
    final tf = DateFormat('hh:mm a');

    pw.Widget header(String title) => pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
          if (logo != null) pw.Container(width: 64, height: 36, margin: const pw.EdgeInsets.only(right: 10), child: pw.Image(logo, fit: pw.BoxFit.contain)),
          pw.Expanded(
            child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
              pw.Text(_c(cfg.s('name')).toUpperCase(), style: t(11, bold: true, color: _navy)),
              pw.Text(_c(title), style: t(14, bold: true)),
              pw.Text(_c(period), style: t(9, color: _muted)),
            ]),
          ),
          pw.Text('Printed ${DateFormat('dd MMM yyyy').format(DateTime.now())}', style: t(7.5, color: _muted)),
        ]);

    final doc = pw.Document(title: 'Attendance sheet', author: cfg.s('name'));
    // Summary page.
    final sum = [
      for (final p in people)
        (p: p, days: (data[p.id] ?? const []).where((d) => d.worked > Duration.zero || d.openNoOut).length, hours: (data[p.id] ?? const []).fold(Duration.zero, (a, d) => a + d.worked))
    ];
    final grand = sum.fold(Duration.zero, (a, s) => a + s.hours);
    doc.addPage(pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.fromLTRB(28, 24, 28, 24),
      footer: (c) => pw.Align(alignment: pw.Alignment.centerRight, child: pw.Text('Page ${c.pageNumber} of ${c.pagesCount}', style: t(7.5, color: _muted))),
      build: (c) => [
        header('Attendance sheet — summary'),
        pw.SizedBox(height: 12),
        pw.Table(columnWidths: const {0: pw.FlexColumnWidth(3), 1: pw.FlexColumnWidth(2.4), 2: pw.FlexColumnWidth(1), 3: pw.FlexColumnWidth(1.3)}, children: [
          head(['Name', 'Type', 'Days', 'Hours'], {2, 3}),
          for (final s in sum)
            pw.TableRow(decoration: const pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(color: _line, width: 0.5))), children: [
              cell(s.p.name, bold: true),
              cell(s.p.kind == 'staff' ? 'Staff${s.p.sub.isEmpty ? '' : ' - ${s.p.sub}'}' : 'External${s.p.sub.isEmpty ? '' : ' - ${s.p.sub}'}', size: 7.8),
              cell('${s.days}', align: pw.TextAlign.right),
              cell(hm(s.hours), align: pw.TextAlign.right, bold: true),
            ]),
          pw.TableRow(decoration: const pw.BoxDecoration(border: pw.Border(top: pw.BorderSide(color: _navy, width: 1))), children: [
            cell('TOTAL (${people.length} people)', bold: true),
            cell(''),
            cell('${sum.fold(0, (a, s) => a + s.days)}', align: pw.TextAlign.right, bold: true),
            cell(hm(grand), align: pw.TextAlign.right, bold: true, size: 9.5),
          ]),
        ]),
        pw.SizedBox(height: 6),
        pw.Text('Hours are h:mm. A check-in without a check-out on an earlier day counts 0 hours (marked "no out").', style: t(7.5, color: _muted)),
      ],
    ));
    // One section per person.
    for (final p in people) {
      final days = data[p.id] ?? const <SheetDay>[];
      final total = days.fold(Duration.zero, (a, d) => a + d.worked);
      doc.addPage(pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.fromLTRB(28, 24, 28, 24),
        footer: (c) => pw.Align(alignment: pw.Alignment.centerRight, child: pw.Text('${_c(p.name)} - page ${c.pageNumber}', style: t(7.5, color: _muted))),
        build: (c) => [
          header('Attendance sheet — ${p.name}'),
          pw.SizedBox(height: 4),
          pw.Text(_c(p.kind == 'staff' ? 'Staff${p.sub.isEmpty ? '' : ' - ${p.sub}'}' : 'External worker${p.sub.isEmpty ? '' : ' - ${p.sub}'}'), style: t(9, color: _muted)),
          pw.SizedBox(height: 10),
          if (days.isEmpty) pw.Text('No attendance in this period.', style: t(9, color: _muted)),
          if (days.isNotEmpty)
            pw.Table(columnWidths: const {
              0: pw.FlexColumnWidth(1.5),
              1: pw.FlexColumnWidth(0.8),
              2: pw.FlexColumnWidth(4),
              3: pw.FlexColumnWidth(1.3),
              4: pw.FlexColumnWidth(1.3),
              5: pw.FlexColumnWidth(1),
            }, children: [
              head(['Date', 'Day', 'Site(s)', 'In', 'Out', 'Hours'], {5}),
              for (final d in days)
                pw.TableRow(decoration: const pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(color: _line, width: 0.4))), children: [
                  cell(DateFormat('dd MMM yyyy').format(DateTime.parse(d.date))),
                  cell(DateFormat('EEE').format(DateTime.parse(d.date)), color: _muted),
                  cell(d.sites.join(', ')),
                  cell(d.firstIn == null ? '' : tf.format(d.firstIn!)),
                  cell(d.lastOut == null ? (d.openNoOut ? 'no out' : '') : tf.format(d.lastOut!), color: d.lastOut == null ? const PdfColor.fromInt(0xFFB23535) : _ink),
                  cell(hm(d.worked), align: pw.TextAlign.right, bold: true),
                ]),
              pw.TableRow(decoration: const pw.BoxDecoration(border: pw.Border(top: pw.BorderSide(color: _navy, width: 1))), children: [
                cell('TOTAL', bold: true),
                cell(''),
                cell('${days.length} day${days.length == 1 ? '' : 's'}', bold: true),
                cell(''),
                cell(''),
                cell(hm(total), align: pw.TextAlign.right, bold: true, size: 9.5),
              ]),
            ]),
        ],
      ));
    }
    return doc.save();
  }

  static Future<pw.MemoryImage?> _logo() async {
    try {
      return pw.MemoryImage((await rootBundle.load('assets/doc_logo.png')).buffer.asUint8List());
    } catch (_) {
      try {
        return pw.MemoryImage((await rootBundle.load('assets/logo.png')).buffer.asUint8List());
      } catch (_) {
        return null;
      }
    }
  }

  /// Report kinds for the admin app: 'sheet' (day by day per person), 'log' (every check-in), 'summary', 'register' (people × days grid).
  static Future<void> shareReport(String kind, List<SheetPerson> people, {required String from, required String to, required String period}) async {
    if (kind == 'sheet') return share(people, from: from, to: to, period: period);
    final cfg = await InvConfig.load();
    final logo = await _logo();
    final rows = await loadRows(people, from, to);
    pw.TextStyle t(double size, {PdfColor color = _ink, bool bold = false}) =>
        pw.TextStyle(fontSize: size, color: color, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal);
    pw.Widget cell(String s, {bool bold = false, pw.TextAlign align = pw.TextAlign.left, PdfColor color = _ink, double size = 7.8}) =>
        pw.Padding(padding: const pw.EdgeInsets.symmetric(horizontal: 3, vertical: 2.6), child: pw.Text(_c(s), textAlign: align, style: t(size, bold: bold, color: color)));
    final tf = DateFormat('hh:mm a');
    final title = {'log': 'Attendance log (detailed)', 'summary': 'Attendance summary', 'register': 'Daily attendance register'}[kind] ?? 'Attendance';
    final landscape = kind == 'register';
    pw.Widget header() => pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
          if (logo != null) pw.Container(width: 60, height: 34, margin: const pw.EdgeInsets.only(right: 10), child: pw.Image(logo, fit: pw.BoxFit.contain)),
          pw.Expanded(
            child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
              pw.Text(_c(cfg.s('name')).toUpperCase(), style: t(10.5, bold: true, color: _navy)),
              pw.Text(title, style: t(13.5, bold: true)),
              pw.Text(_c('$period - ${people.length} ${people.length == 1 ? 'person' : 'people'}'), style: t(8.5, color: _muted)),
            ]),
          ),
          pw.Text('Printed ${DateFormat('dd MMM yyyy').format(DateTime.now())}', style: t(7.5, color: _muted)),
        ]);
    pw.TableRow head(List<String> h, Set<int> right) => pw.TableRow(
          decoration: const pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(color: _navy, width: 1))),
          children: [for (var i = 0; i < h.length; i++) cell(h[i].toUpperCase(), bold: true, color: _navy, size: 6.8, align: right.contains(i) ? pw.TextAlign.right : pw.TextAlign.left)],
        );
    const zebra = pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(color: _line, width: 0.4)));
    final content = <pw.Widget>[header(), pw.SizedBox(height: 10)];

    if (kind == 'log') {
      final all = [
        for (final p in people)
          for (final r in rows[p.id] ?? const <SheetRow>[]) (p: p, r: r)
      ]..sort((a, b) => a.r.inT.compareTo(b.r.inT));
      content.add(pw.Table(columnWidths: const {
        0: pw.FlexColumnWidth(1.3),
        1: pw.FlexColumnWidth(2.2),
        2: pw.FlexColumnWidth(2.6),
        3: pw.FlexColumnWidth(1.2),
        4: pw.FlexColumnWidth(1.2),
        5: pw.FlexColumnWidth(0.9),
        6: pw.FlexColumnWidth(2.2),
      }, children: [
        head(['Date', 'Name', 'Site', 'In', 'Out', 'Hours', 'Notes'], {5}),
        for (final x in all)
          pw.TableRow(decoration: zebra, children: [
            cell(DateFormat('dd MMM yy').format(DateTime.parse(x.r.date))),
            cell(x.p.name, bold: true),
            cell(x.r.site),
            cell(tf.format(x.r.inT)),
            cell(x.r.outT == null ? 'no out' : tf.format(x.r.outT!), color: x.r.outT == null ? const PdfColor.fromInt(0xFFB23535) : _ink),
            cell(hm(x.r.worked), align: pw.TextAlign.right, bold: true),
            cell([if (x.p.kind == 'external') 'external${x.r.addedBy.isEmpty ? '' : ', with ${x.r.addedBy}'}', if (x.r.flags.isNotEmpty) x.r.flags].join(' - '),
                size: 7, color: x.r.flags.isNotEmpty ? const PdfColor.fromInt(0xFFA8640F) : _muted),
          ]),
        pw.TableRow(decoration: const pw.BoxDecoration(border: pw.Border(top: pw.BorderSide(color: _navy, width: 1))), children: [
          cell('TOTAL', bold: true),
          cell('${all.length} check-ins', bold: true),
          cell(''),
          cell(''),
          cell(''),
          cell(hm(all.fold(Duration.zero, (a, x) => a + x.r.worked)), align: pw.TextAlign.right, bold: true, size: 9),
          cell(''),
        ]),
      ]));
    } else if (kind == 'summary') {
      final list = [
        for (final p in people)
          () {
            final l = rows[p.id] ?? const <SheetRow>[];
            final days = l.map((r) => r.date).toSet().length;
            final total = l.fold(Duration.zero, (a, r) => a + r.worked);
            final ins = l.map((r) => r.inT.hour * 60 + r.inT.minute).toList();
            final avgIn = ins.isEmpty ? null : ins.reduce((a, b) => a + b) ~/ ins.length;
            final sites = l.map((r) => r.site).where((x) => x.isNotEmpty).toSet();
            return (p: p, days: days, total: total, avgIn: avgIn, sites: sites.length, flags: l.where((r) => r.flags.isNotEmpty).length, noOut: l.where((r) => r.outT == null).length);
          }()
      ];
      content.add(pw.Table(columnWidths: const {
        0: pw.FlexColumnWidth(2.6),
        1: pw.FlexColumnWidth(1.6),
        2: pw.FlexColumnWidth(0.8),
        3: pw.FlexColumnWidth(1.1),
        4: pw.FlexColumnWidth(1.1),
        5: pw.FlexColumnWidth(1.1),
        6: pw.FlexColumnWidth(0.8),
        7: pw.FlexColumnWidth(0.9),
        8: pw.FlexColumnWidth(0.9),
      }, children: [
        head(['Name', 'Type', 'Days', 'Total hrs', 'Avg / day', 'Avg start', 'Sites', 'Flags', 'No out'], {2, 3, 4, 5, 6, 7, 8}),
        for (final x in list)
          pw.TableRow(decoration: zebra, children: [
            cell(x.p.name, bold: true),
            cell(x.p.kind == 'staff' ? 'Staff' : 'External${x.p.sub.isEmpty ? '' : ' - ${x.p.sub}'}', size: 7),
            cell('${x.days}', align: pw.TextAlign.right),
            cell(hm(x.total), align: pw.TextAlign.right, bold: true),
            cell(x.days == 0 ? '' : hm(Duration(minutes: x.total.inMinutes ~/ x.days)), align: pw.TextAlign.right),
            cell(x.avgIn == null ? '' : '${(x.avgIn! ~/ 60).toString().padLeft(2, '0')}:${(x.avgIn! % 60).toString().padLeft(2, '0')}', align: pw.TextAlign.right),
            cell('${x.sites}', align: pw.TextAlign.right),
            cell(x.flags == 0 ? '' : '${x.flags}', align: pw.TextAlign.right, color: const PdfColor.fromInt(0xFFA8640F)),
            cell(x.noOut == 0 ? '' : '${x.noOut}', align: pw.TextAlign.right, color: const PdfColor.fromInt(0xFFB23535)),
          ]),
        pw.TableRow(decoration: const pw.BoxDecoration(border: pw.Border(top: pw.BorderSide(color: _navy, width: 1))), children: [
          cell('TOTAL', bold: true),
          cell(''),
          cell('${list.fold(0, (a, x) => a + x.days)}', align: pw.TextAlign.right, bold: true),
          cell(hm(list.fold(Duration.zero, (a, x) => a + x.total)), align: pw.TextAlign.right, bold: true),
          for (var i = 0; i < 5; i++) cell(''),
        ]),
      ]));
    } else {
      // Register: people down, days across; each cell = hours that day.
      final f = DateTime.parse(from), l = DateTime.parse(to);
      final dates = [for (var d = f; !d.isAfter(l); d = DateTime(d.year, d.month, d.day + 1)) d];
      final cols = <int, pw.TableColumnWidth>{0: const pw.FixedColumnWidth(92)};
      for (var i = 0; i < dates.length; i++) {
        cols[i + 1] = const pw.FlexColumnWidth(1);
      }
      cols[dates.length + 1] = const pw.FixedColumnWidth(26);
      cols[dates.length + 2] = const pw.FixedColumnWidth(34);
      pw.Widget c2(String s, {bool bold = false, PdfColor color = _ink, PdfColor? bg}) => pw.Container(
          color: bg,
          padding: const pw.EdgeInsets.symmetric(vertical: 2.2),
          alignment: pw.Alignment.center,
          child: pw.Text(s, style: t(dates.length > 20 ? 5.6 : 7, bold: bold, color: color)));
      content.add(pw.Table(columnWidths: cols, border: pw.TableBorder.all(color: _line, width: 0.4), children: [
        pw.TableRow(children: [
          cell('NAME', bold: true, color: _navy, size: 6.5),
          for (final d in dates) c2('${d.day}\n${DateFormat('E').format(d).substring(0, 2)}', bold: true, color: _navy, bg: d.weekday == DateTime.friday ? const PdfColor.fromInt(0xFFF3F0EA) : null),
          c2('DAYS', bold: true, color: _navy),
          c2('HRS', bold: true, color: _navy),
        ]),
        for (final p in people)
          () {
            final byDate = <String, Duration>{};
            for (final r in rows[p.id] ?? const <SheetRow>[]) {
              byDate[r.date] = (byDate[r.date] ?? Duration.zero) + r.worked;
            }
            final total = byDate.values.fold(Duration.zero, (a, x) => a + x);
            return pw.TableRow(children: [
              cell(p.name, bold: true, size: 7),
              for (final d in dates)
                () {
                  final h = byDate[_key(d)];
                  return c2(h == null ? '' : (h.inMinutes / 60).toStringAsFixed(1),
                      bg: h != null ? const PdfColor.fromInt(0xFFE8F5EE) : (d.weekday == DateTime.friday ? const PdfColor.fromInt(0xFFF3F0EA) : null));
                }(),
              c2('${byDate.length}', bold: true),
              c2(hm(total), bold: true),
            ]);
          }(),
      ]));
      content.add(pw.Padding(
          padding: const pw.EdgeInsets.only(top: 4),
          child: pw.Text('Cells show hours worked that day (decimal). Green = present. Shaded columns = Friday.', style: t(7, color: _muted))));
    }
    final doc = pw.Document(title: title, author: cfg.s('name'));
    doc.addPage(pw.MultiPage(
      pageFormat: landscape ? PdfPageFormat.a4.landscape : PdfPageFormat.a4,
      margin: const pw.EdgeInsets.fromLTRB(24, 22, 24, 22),
      footer: (c) => pw.Align(alignment: pw.Alignment.centerRight, child: pw.Text('Page ${c.pageNumber} of ${c.pagesCount}', style: t(7.5, color: _muted))),
      build: (c) => content,
    ));
    final bytes = await doc.save();
    final name = '$title - $period.pdf'.replaceAll(RegExp(r'[\\/:*?"<>|]'), '-');
    await IdSheet.shareFiles([(name: name, data: bytes, mime: 'application/pdf')], subject: title);
  }

  /// Monthly report card of one employee: totals, then every day of the month with status, site(s), in, out and hours.
  static Future<void> shareReportCard(AppUser u, MonthSummary m) async {
    final cfg = await InvConfig.load();
    pw.MemoryImage? logo;
    try {
      logo = pw.MemoryImage((await rootBundle.load('assets/doc_logo.png')).buffer.asUint8List());
    } catch (_) {
      try {
        logo = pw.MemoryImage((await rootBundle.load('assets/logo.png')).buffer.asUint8List());
      } catch (_) {}
    }
    pw.TextStyle t(double size, {PdfColor color = _ink, bool bold = false}) =>
        pw.TextStyle(fontSize: size, color: color, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal);
    pw.Widget cell(String s, {bool bold = false, pw.TextAlign align = pw.TextAlign.left, PdfColor color = _ink, double size = 8.2}) =>
        pw.Padding(padding: const pw.EdgeInsets.symmetric(horizontal: 4, vertical: 2.8), child: pw.Text(_c(s), textAlign: align, style: t(size, bold: bold, color: color)));
    final tf = DateFormat('hh:mm a');
    final monthLabel = DateFormat('MMMM yyyy').format(m.month);
    const green = PdfColor.fromInt(0xFF1F7A50), amber = PdfColor.fromInt(0xFFA8640F), red = PdfColor.fromInt(0xFFB23535);
    pw.Widget box(String l, String v, PdfColor c) => pw.Expanded(
          child: pw.Container(
            margin: const pw.EdgeInsets.only(right: 6),
            padding: const pw.EdgeInsets.all(8),
            decoration: pw.BoxDecoration(border: pw.Border(left: pw.BorderSide(color: c, width: 3)), color: const PdfColor.fromInt(0xFFF7F6F3)),
            child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
              pw.Text(l.toUpperCase(), style: t(6.8, color: _muted, bold: true)),
              pw.SizedBox(height: 2),
              pw.Text(v, style: t(13, bold: true, color: c)),
            ]),
          ),
        );
    String status(DaySummary d) => switch (d.kind) {
          DayKind.worked => 'Worked',
          DayKind.off => d.sessions.isEmpty ? 'Off' : 'Worked (off day)',
          DayKind.absent => 'Absent',
          DayKind.today => d.sessions.isEmpty ? 'Today' : 'Worked',
          DayKind.upcoming => '',
          DayKind.beforeJoin => '-',
        };
    final days = m.days.where((d) => d.kind != DayKind.upcoming).toList();
    final doc = pw.Document(title: 'Report card ${u.name} $monthLabel', author: cfg.s('name'));
    doc.addPage(pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.fromLTRB(28, 24, 28, 24),
      footer: (c) => pw.Align(alignment: pw.Alignment.centerRight, child: pw.Text('Page ${c.pageNumber} of ${c.pagesCount}', style: t(7.5, color: _muted))),
      build: (c) => [
        pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
          if (logo != null) pw.Container(width: 64, height: 36, margin: const pw.EdgeInsets.only(right: 10), child: pw.Image(logo, fit: pw.BoxFit.contain)),
          pw.Expanded(
            child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
              pw.Text(_c(cfg.s('name')).toUpperCase(), style: t(11, bold: true, color: _navy)),
              pw.Text('Attendance report card', style: t(14, bold: true)),
              pw.Text(_c('${u.name}${u.designation.isEmpty ? '' : ' - ${u.designation}'} - ID ${u.loginId}'), style: t(9.5, bold: true)),
              pw.Text(monthLabel, style: t(9, color: _muted)),
            ]),
          ),
          pw.Text('Printed ${DateFormat('dd MMM yyyy').format(DateTime.now())}', style: t(7.5, color: _muted)),
        ]),
        pw.SizedBox(height: 12),
        pw.Row(children: [
          box('Days worked', '${m.workedDays}', green),
          box('Total hours', hm(m.totalTime), _navy),
          box('Average / day', hm(m.avgPerDay), _navy),
          box('Off days', '${m.offDays} / ${m.quota}', amber),
          box('Absent', '${m.absentDays}', red),
        ]),
        pw.SizedBox(height: 12),
        pw.Table(columnWidths: const {
          0: pw.FlexColumnWidth(1.4),
          1: pw.FlexColumnWidth(0.7),
          2: pw.FlexColumnWidth(1.5),
          3: pw.FlexColumnWidth(3.4),
          4: pw.FlexColumnWidth(1.2),
          5: pw.FlexColumnWidth(1.2),
          6: pw.FlexColumnWidth(0.9),
        }, children: [
          pw.TableRow(
            decoration: const pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(color: _navy, width: 1))),
            children: [
              for (final h in ['Date', 'Day', 'Status', 'Site(s)', 'In', 'Out', 'Hours'])
                cell(h.toUpperCase(), bold: true, color: _navy, size: 7.2, align: h == 'Hours' ? pw.TextAlign.right : pw.TextAlign.left),
            ],
          ),
          for (final d in days)
            () {
              final ss = [...d.sessions]..sort((a, b) => a.checkIn.compareTo(b.checkIn));
              final outs = ss.where((x) => x.outLocal != null).map((x) => x.outLocal!).toList()..sort();
              final st = status(d);
              final col = st.startsWith('Worked') ? green : st == 'Absent' ? red : st == 'Off' ? amber : _muted;
              return pw.TableRow(
                decoration: pw.BoxDecoration(
                    color: st == 'Absent' ? const PdfColor.fromInt(0xFFFDF1F1) : st == 'Off' ? const PdfColor.fromInt(0xFFFFF8EC) : null,
                    border: const pw.Border(bottom: pw.BorderSide(color: _line, width: 0.4))),
                children: [
                  cell(DateFormat('dd MMM').format(d.day)),
                  cell(DateFormat('EEE').format(d.day), color: _muted),
                  cell(st, color: col, bold: true, size: 7.8),
                  cell(ss.map((x) => x.siteName).where((x) => x.isNotEmpty).toSet().join(', ')),
                  cell(ss.isEmpty ? '' : tf.format(ss.first.inLocal)),
                  cell(ss.isEmpty ? '' : outs.isEmpty ? 'no out' : tf.format(outs.last), color: ss.isNotEmpty && outs.isEmpty ? red : _ink),
                  cell(ss.isEmpty ? '' : hm(d.total), align: pw.TextAlign.right, bold: true),
                ],
              );
            }(),
          pw.TableRow(decoration: const pw.BoxDecoration(border: pw.Border(top: pw.BorderSide(color: _navy, width: 1))), children: [
            cell('TOTAL', bold: true),
            cell(''),
            cell('${m.workedDays} days', bold: true),
            cell(''),
            cell(''),
            cell(''),
            cell(hm(m.totalTime), align: pw.TextAlign.right, bold: true, size: 9.5),
          ]),
        ]),
        pw.SizedBox(height: 6),
        pw.Text('Hours are h:mm. In = first check-in, Out = last check-out of the day.', style: t(7.5, color: _muted)),
      ],
    ));
    final bytes = await doc.save();
    final name = 'Report card - ${u.name} - $monthLabel.pdf'.replaceAll(RegExp(r'[\\/:*?"<>|]'), '-');
    await IdSheet.shareFiles([(name: name, data: bytes, mime: 'application/pdf')], subject: 'Report card - ${u.name} - $monthLabel');
  }

  static Future<void> share(List<SheetPerson> people, {required String from, required String to, required String period}) async {
    final data = await load(people, from, to);
    final bytes = await build(people, data, period: period);
    final who = people.length == 1 ? people.first.name : '${people.length} people';
    final name = 'Attendance sheet - $who - $period.pdf'.replaceAll(RegExp(r'[\\/:*?"<>|]'), '-');
    await IdSheet.shareFiles([(name: name, data: bytes, mime: 'application/pdf')], subject: 'Attendance sheet - $who');
  }
}
