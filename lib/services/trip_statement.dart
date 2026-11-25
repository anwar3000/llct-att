import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import 'id_sheet.dart';
import 'inv_reports.dart';

/// One line of a trips statement (already costed by the caller).
class StatementLine {
  final DateTime when;
  final String person, head, route, status;
  final double km, cost;
  const StatementLine(
      {required this.when, required this.person, required this.head, required this.route, required this.km, required this.cost, required this.status});
}

/// Trips statement PDF: every trip in the period, totals under each head (driver / provider / Taxi / RTA) and a grand total.
class TripStatement {
  static const _ink = PdfColor.fromInt(0xFF232324);
  static const _muted = PdfColor.fromInt(0xFF75757A);
  static const _line = PdfColor.fromInt(0xFFDDDDDD);

  static String _c(String s) => s.replaceAll('→', '>').replaceAll('–', '-').replaceAll('—', '-').replaceAll('·', '-');
  static String _m(double v) => NumberFormat('#,##0.00').format(v);

  static Future<Uint8List> build(List<StatementLine> lines, {required String title, required String period}) async {
    final cfg = await InvConfig.load();
    final navy = const PdfColor.fromInt(0xFF17375F);
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
        pw.Padding(padding: const pw.EdgeInsets.symmetric(horizontal: 4, vertical: 3.5), child: pw.Text(_c(s), textAlign: align, style: t(size, bold: bold, color: color)));

    // Totals under each head.
    final heads = <String, ({int n, double km, double cost, double ok})>{};
    for (final l in lines) {
      final p = heads[l.head];
      heads[l.head] = (
        n: (p?.n ?? 0) + 1,
        km: (p?.km ?? 0) + l.km,
        cost: (p?.cost ?? 0) + l.cost,
        ok: (p?.ok ?? 0) + (l.status == 'Approved' ? l.cost : 0),
      );
    }
    final headRows = heads.entries.toList()..sort((a, b) => b.value.cost.compareTo(a.value.cost));
    final total = lines.fold<double>(0, (a, l) => a + l.cost);
    final totalOk = lines.where((l) => l.status == 'Approved').fold<double>(0, (a, l) => a + l.cost);
    final totalKm = lines.fold<double>(0, (a, l) => a + l.km);

    final doc = pw.Document(title: title, author: cfg.s('name'));
    doc.addPage(pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.fromLTRB(28, 24, 28, 24),
      footer: (c) => pw.Align(
          alignment: pw.Alignment.centerRight, child: pw.Text('Page ${c.pageNumber} of ${c.pagesCount}', style: t(7.5, color: _muted))),
      build: (c) => [
        pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
          if (logo != null) pw.Container(width: 70, height: 40, margin: const pw.EdgeInsets.only(right: 12), child: pw.Image(logo, fit: pw.BoxFit.contain)),
          pw.Expanded(
            child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
              pw.Text(_c(cfg.s('name')).toUpperCase(), style: t(12, bold: true, color: navy)),
              pw.SizedBox(height: 2),
              pw.Text(_c(title), style: t(15, bold: true)),
              pw.Text(_c(period), style: t(9, color: _muted)),
            ]),
          ),
          pw.Text('Printed ${DateFormat('dd MMM yyyy').format(DateTime.now())}', style: t(8, color: _muted)),
        ]),
        pw.SizedBox(height: 12),
        // Summary by head.
        pw.Table(
          columnWidths: const {0: pw.FlexColumnWidth(3), 1: pw.FlexColumnWidth(1), 2: pw.FlexColumnWidth(1.3), 3: pw.FlexColumnWidth(1.6), 4: pw.FlexColumnWidth(1.6)},
          children: [
            pw.TableRow(decoration: pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(color: navy, width: 1))), children: [
              for (final h in ['Head', 'Trips', 'Km', 'Approved (AED)', 'Total (AED)'])
                cell(h.toUpperCase(), bold: true, color: navy, size: 7.4, align: h == 'Head' ? pw.TextAlign.left : pw.TextAlign.right),
            ]),
            for (final e in headRows)
              pw.TableRow(decoration: const pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(color: _line, width: 0.5))), children: [
                cell(e.key, bold: true),
                cell('${e.value.n}', align: pw.TextAlign.right),
                cell(e.value.km.toStringAsFixed(1), align: pw.TextAlign.right),
                cell(_m(e.value.ok), align: pw.TextAlign.right),
                cell(_m(e.value.cost), align: pw.TextAlign.right, bold: true),
              ]),
            pw.TableRow(decoration: pw.BoxDecoration(border: pw.Border(top: pw.BorderSide(color: navy, width: 1))), children: [
              cell('TOTAL', bold: true),
              cell('${lines.length}', align: pw.TextAlign.right, bold: true),
              cell(totalKm.toStringAsFixed(1), align: pw.TextAlign.right, bold: true),
              cell(_m(totalOk), align: pw.TextAlign.right, bold: true),
              cell(_m(total), align: pw.TextAlign.right, bold: true, size: 9.5),
            ]),
          ],
        ),
        if (total - totalOk > 0.004)
          pw.Padding(
              padding: const pw.EdgeInsets.only(top: 4),
              child: pw.Text('Not yet approved: AED ${_m(total - totalOk)}', style: t(8, color: const PdfColor.fromInt(0xFFA8640F)))),
        pw.SizedBox(height: 14),
        pw.Text('TRIPS', style: t(8, bold: true, color: navy)),
        pw.SizedBox(height: 3),
        pw.Table(
          columnWidths: const {
            0: pw.FlexColumnWidth(1.5),
            1: pw.FlexColumnWidth(2),
            2: pw.FlexColumnWidth(2),
            3: pw.FlexColumnWidth(3.4),
            4: pw.FlexColumnWidth(0.9),
            5: pw.FlexColumnWidth(1.3),
            6: pw.FlexColumnWidth(1.3),
          },
          children: [
            pw.TableRow(decoration: pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(color: navy, width: 1))), children: [
              for (final h in ['Date', 'Person', 'Head', 'Route', 'Km', 'AED', 'Status'])
                cell(h.toUpperCase(), bold: true, color: navy, size: 7.2, align: h == 'Km' || h == 'AED' ? pw.TextAlign.right : pw.TextAlign.left),
            ]),
            for (final l in lines)
              pw.TableRow(decoration: const pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(color: _line, width: 0.4))), children: [
                cell(DateFormat('dd MMM, HH:mm').format(l.when), size: 7.8),
                cell(l.person, size: 7.8),
                cell(l.head, size: 7.8),
                cell(l.route, size: 7.8),
                cell(l.km.toStringAsFixed(1), align: pw.TextAlign.right, size: 7.8),
                cell(_m(l.cost), align: pw.TextAlign.right, size: 7.8, bold: true),
                cell(l.status, size: 7.4, color: l.status == 'Approved' ? const PdfColor.fromInt(0xFF1F7A50) : const PdfColor.fromInt(0xFFA8640F)),
              ]),
          ],
        ),
      ],
    ));
    return doc.save();
  }

  static Future<void> share(List<StatementLine> lines, {required String title, required String period}) async {
    final data = await build(lines, title: title, period: period);
    final name = '${title.replaceAll(RegExp(r'[^A-Za-z0-9 \-]'), '').trim()} - $period.pdf'.replaceAll(RegExp(r'\s+'), ' ');
    await IdSheet.shareFiles([(name: name, data: data, mime: 'application/pdf')], subject: title);
  }
}
