import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import 'db.dart';
import 'id_sheet.dart';
import 'inv_reports.dart';

/// One line of a BOQ. A line with only [section] is a heading ("CCTV SYSTEM").
class BoqItem {
  final String section, name, desc, unit;
  final double qty;
  const BoqItem({this.section = '', this.name = '', this.desc = '', this.qty = 0, this.unit = ''});
  bool get isHeading => section.isNotEmpty && name.isEmpty && desc.isEmpty;
  factory BoqItem.fromMap(Map m) => BoqItem(
        section: '${m['section'] ?? ''}',
        name: '${m['name'] ?? ''}',
        desc: '${m['desc'] ?? ''}',
        qty: (m['qty'] is num) ? (m['qty'] as num).toDouble() : double.tryParse('${m['qty']}') ?? 0,
        unit: '${m['unit'] ?? ''}',
      );
  String get qtyText => qty == qty.roundToDouble() ? qty.toInt().toString() : qty.toString();
}

/// A bill of quantities pushed by admin (or someone with the BOQ permission) to a project or to particular sites.
/// No siteIds = every site of the project.
class Boq {
  final String id, title, ref, projectId, projectName, client, clientId, notes, updatedBy;
  final Map<String, dynamic>? clientSnap;
  final List<String> siteIds, siteNames;
  final List<BoqItem> items;
  final DateTime? updatedAt;
  Boq({
    required this.id,
    required this.title,
    this.ref = '',
    this.projectId = '',
    this.projectName = '',
    this.client = '',
    this.clientId = '',
    this.clientSnap,
    this.siteIds = const [],
    this.siteNames = const [],
    this.items = const [],
    this.notes = '',
    this.updatedAt,
    this.updatedBy = '',
  });

  factory Boq.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? const {};
    List<String> strs(dynamic v) => v is List ? v.map((e) => '$e').toList() : const [];
    final ts = m['updatedAt'];
    return Boq(
      id: d.id,
      title: '${m['title'] ?? 'BOQ'}',
      ref: '${m['ref'] ?? ''}',
      projectId: '${m['projectId'] ?? ''}',
      projectName: '${m['projectName'] ?? ''}',
      client: '${m['client'] ?? ''}',
      clientId: '${m['clientId'] ?? ''}',
      clientSnap: m['clientSnap'] is Map ? Map<String, dynamic>.from(m['clientSnap'] as Map) : null,
      siteIds: strs(m['siteIds']),
      siteNames: strs(m['siteNames']),
      items: m['items'] is List ? (m['items'] as List).whereType<Map>().map(BoqItem.fromMap).toList() : const [],
      notes: '${m['notes'] ?? ''}',
      updatedAt: ts is Timestamp ? ts.toDate() : null,
      updatedBy: '${m['updatedBy'] ?? ''}',
    );
  }

  List<BoqItem> get lines => items.where((i) => !i.isHeading).toList();

  /// Where it applies, as text.
  String get target {
    final sites = siteNames.where((s) => s.isNotEmpty).join(', ');
    if (projectName.isNotEmpty) return '$projectName · ${sites.isEmpty ? 'all sites' : sites}';
    return sites.isEmpty ? 'Not linked to a site' : sites;
  }

  /// Does this BOQ belong to the site (directly, or through the site's project)?
  bool appliesTo(String siteId, String projectId) {
    if (siteId.isNotEmpty && siteIds.contains(siteId)) return true;
    return projectId.isNotEmpty && this.projectId == projectId && siteIds.isEmpty;
  }
}

class Boqs {
  Boqs._();
  static final _fs = FirebaseFirestore.instance;

  static Stream<List<Boq>> stream() => _fs.collection('boqs').snapshots().map((s) {
        final l = s.docs.map(Boq.fromDoc).toList();
        l.sort((a, b) => (b.updatedAt ?? DateTime(2000)).compareTo(a.updatedAt ?? DateTime(2000)));
        return l;
      });

  static Future<List<Boq>> list() async {
    final s = await _fs.collection('boqs').get();
    final l = s.docs.map(Boq.fromDoc).toList();
    l.sort((a, b) => (b.updatedAt ?? DateTime(2000)).compareTo(a.updatedAt ?? DateTime(2000)));
    return l;
  }

  /// The project a site belongs to ('' if none / unknown).
  static Future<String> projectOfSite(String siteId) async {
    if (siteId.isEmpty) return '';
    try {
      return (await Db.getSite(siteId))?.projectId ?? '';
    } catch (_) {
      return '';
    }
  }

  /// Puts the BOQ lines into a report draft (service report, call-out report or delivery note).
  /// Empty placeholder lines are dropped; existing lines are kept unless [replace].
  static void applyToDraft(Map<String, dynamic> d, Boq b, ReportKind k, {bool replace = false}) {
    final current = ((d['items'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    final kept = replace ? <Map<String, dynamic>>[] : current.where((i) => '${i['name']}'.trim().isNotEmpty || '${i['desc']}'.trim().isNotEmpty).toList();
    var section = '';
    final add = <Map<String, dynamic>>[];
    for (final i in b.items) {
      if (i.isHeading) {
        section = i.section;
        continue;
      }
      final sec = i.section.isNotEmpty ? i.section : section;
      add.add({
        'name': i.name.isNotEmpty ? i.name : i.desc,
        'desc': [if (sec.isNotEmpty) sec, if (i.name.isNotEmpty && i.desc.isNotEmpty) i.desc].join(' · '),
        'qty': i.qty == i.qty.roundToDouble() ? i.qty.toInt() : i.qty,
        'unit': i.unit.isEmpty ? 'pcs' : i.unit,
        'price': 0,
        'photo': '',
        'status': k.statuses.first,
        'serials': <String>[],
      });
    }
    d['items'] = [...kept, ...add];
    if ('${d['ref'] ?? ''}'.trim().isEmpty && b.ref.isNotEmpty) d['ref'] = b.ref;
    if ('${d['subject'] ?? ''}'.trim().isEmpty) d['subject'] = b.title;
    if ('${d['clientId'] ?? ''}'.isEmpty && b.clientId.isNotEmpty && b.clientSnap != null) {
      d['clientId'] = b.clientId;
      d['client'] = b.clientSnap;
    }
    d['boqId'] = b.id;
    d['boqTitle'] = b.title;
    if (b.projectId.isNotEmpty) {
      d['projectId'] = b.projectId;
      d['projectName'] = b.projectName;
    }
  }
}

/// Printable BOQ in the same letterhead as the reports.
class BoqPdf {
  BoqPdf._();

  static String _c(String s) => s
      .replaceAll(RegExp(r'[–—]'), '-')
      .replaceAll(RegExp(r'[‘’]'), "'")
      .replaceAll(RegExp(r'[“”]'), '"')
      .replaceAll('…', '...')
      .replaceAll(RegExp(r'[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]'), '');

  static PdfColor _hex(String h, PdfColor fb) {
    final s = h.replaceAll('#', '');
    final v = s.length == 6 ? int.tryParse(s, radix: 16) : null;
    return v == null ? fb : PdfColor.fromInt(0xFF000000 | v);
  }

  static const _ink = PdfColor.fromInt(0xFF1F2226);
  static const _muted = PdfColor.fromInt(0xFF5D6168);
  static const _line = PdfColor.fromInt(0xFFE3E1DC);
  static const _soft = PdfColor.fromInt(0xFFF7F6F3);
  static const _sec = PdfColor.fromInt(0xFFFFF4E2);

  static Future<Uint8List> build(Boq b, InvConfig cfg, {String siteName = ''}) async {
    final brand = _hex(cfg.s('brand'), const PdfColor.fromInt(0xFFB8285E));
    final charcoal = _hex(cfg.s('charcoal'), const PdfColor.fromInt(0xFF17375F));
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

    final det = <(String, String)>[
      if (b.projectName.isNotEmpty) ('Project', b.projectName),
      ('Site(s)', siteName.isNotEmpty ? siteName : (b.siteNames.where((s) => s.isNotEmpty).join(', ').isEmpty ? 'All sites' : b.siteNames.join(', '))),
      if (b.client.isNotEmpty) ('Client', b.client),
      if (b.ref.isNotEmpty) ('Reference', b.ref),
      ('Printed', DateFormat('dd MMM yyyy').format(DateTime.now())),
    ];

    final rows = <pw.TableRow>[];
    var n = 0;
    pw.Widget cell(String s, {bool bold = false, pw.TextAlign align = pw.TextAlign.left, PdfColor color = _ink, double size = 8.8}) =>
        pw.Padding(padding: const pw.EdgeInsets.symmetric(horizontal: 5, vertical: 4), child: pw.Text(_c(s), textAlign: align, style: t(size, bold: bold, color: color)));
    rows.add(pw.TableRow(decoration: pw.BoxDecoration(color: charcoal), children: [
      for (final h in ['#', 'Item', 'Description', 'Qty', 'Unit', 'Done']) cell(h, bold: true, color: PdfColors.white, size: 8),
    ]));
    for (final i in b.items) {
      if (i.isHeading) {
        rows.add(pw.TableRow(decoration: const pw.BoxDecoration(color: _sec), children: [
          cell(''),
          cell(i.section.toUpperCase(), bold: true),
          cell(''),
          cell(''),
          cell(''),
          cell(''),
        ]));
        continue;
      }
      n++;
      rows.add(pw.TableRow(decoration: pw.BoxDecoration(color: n.isEven ? _soft : PdfColors.white), children: [
        cell('$n', color: _muted),
        cell(i.name.isNotEmpty ? i.name : i.desc, bold: true),
        cell([if (i.section.isNotEmpty) '[${i.section}]', if (i.name.isNotEmpty) i.desc].where((x) => x.isNotEmpty).join(' ')),
        cell(i.qtyText, align: pw.TextAlign.right),
        cell(i.unit),
        pw.Container(
            margin: const pw.EdgeInsets.all(4),
            width: 11,
            height: 11,
            decoration: pw.BoxDecoration(border: pw.Border.all(color: _muted, width: 0.6))),
      ]));
    }

    final doc = pw.Document(title: 'BOQ ${b.title}', author: cfg.s('name'));
    doc.addPage(pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.fromLTRB(30, 26, 30, 26),
      header: (ctx) => ctx.pageNumber == 1
          ? pw.SizedBox()
          : pw.Padding(
              padding: const pw.EdgeInsets.only(bottom: 8),
              child: pw.Text(_c('BOQ - ${b.title}'), style: t(8, color: _muted))),
      footer: (ctx) => pw.Column(children: [
        pw.Divider(color: _line, thickness: 0.6),
        pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [
          pw.Text(_c(cfg.s('name')), style: t(7, color: _muted)),
          pw.Text(_c('BOQ - ${b.title}   ${ctx.pageNumber}/${ctx.pagesCount}'), style: t(7, color: _muted)),
        ]),
      ]),
      build: (ctx) => [
        pw.Row(children: [
          pw.Expanded(flex: 28, child: pw.Container(height: 5, color: brand)),
          pw.Expanded(flex: 72, child: pw.Container(height: 5, color: charcoal)),
        ]),
        pw.SizedBox(height: 12),
        pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.center, children: [
          if (logo != null) ...[pw.Image(logo, height: 50), pw.SizedBox(width: 12)],
          pw.Expanded(child: pw.Text(_c(cfg.s('name')), style: t(14, color: charcoal, bold: true))),
          pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
            pw.Text(_c(cfg.s('address')), textAlign: pw.TextAlign.right, style: t(8, color: _muted)),
            if (cfg.s('phone').isNotEmpty) pw.Text(_c('T ${cfg.s('phone')}'), style: t(8, color: _muted)),
          ]),
        ]),
        pw.SizedBox(height: 12),
        pw.Container(
          padding: const pw.EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: pw.BoxDecoration(color: _soft, border: pw.Border(left: pw.BorderSide(color: brand, width: 3))),
          child: pw.Row(children: [
            pw.Expanded(
              child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
                pw.Text('BILL OF QUANTITIES', style: t(15, color: charcoal, bold: true)),
                pw.Text(_c(b.title), style: t(10, color: _muted)),
              ]),
            ),
            pw.Text('${b.lines.length} items', style: t(9, color: _muted)),
          ]),
        ),
        pw.SizedBox(height: 10),
        pw.Wrap(spacing: 18, runSpacing: 4, children: [
          for (final (k, v) in det)
            pw.RichText(
                text: pw.TextSpan(children: [
              pw.TextSpan(text: '$k: ', style: t(8.5, color: _muted)),
              pw.TextSpan(text: _c(v), style: t(8.5, bold: true)),
            ])),
        ]),
        if (b.notes.isNotEmpty) ...[
          pw.SizedBox(height: 8),
          pw.Text(_c(b.notes), style: t(8.5)),
        ],
        pw.SizedBox(height: 10),
        pw.Table(
          border: pw.TableBorder(horizontalInside: const pw.BorderSide(color: _line, width: 0.5), bottom: const pw.BorderSide(color: _line, width: 0.5)),
          columnWidths: const {
            0: pw.FixedColumnWidth(22),
            1: pw.FlexColumnWidth(3),
            2: pw.FlexColumnWidth(4),
            3: pw.FixedColumnWidth(38),
            4: pw.FixedColumnWidth(36),
            5: pw.FixedColumnWidth(34),
          },
          children: rows,
        ),
        pw.SizedBox(height: 24),
        pw.Row(children: [
          pw.Expanded(child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.Container(height: 0.6, color: _muted, margin: const pw.EdgeInsets.only(right: 30, top: 24)),
            pw.Text('Checked by (LLCT)', style: t(8, color: _muted)),
          ])),
          pw.Expanded(child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.Container(height: 0.6, color: _muted, margin: const pw.EdgeInsets.only(right: 30, top: 24)),
            pw.Text('Customer', style: t(8, color: _muted)),
          ])),
        ]),
      ],
    ));
    return doc.save();
  }

  static String fileName(Boq b) => 'BOQ_${b.title.replaceAll(RegExp(r'[^\w-]+'), '_')}.pdf';

  /// Opens the phone's print dialog (printer or "Save as PDF").
  static Future<void> printIt(Boq b, {String siteName = ''}) async {
    final cfg = await InvConfig.load();
    final data = await build(b, cfg, siteName: siteName);
    await Printing.layoutPdf(name: fileName(b), onLayout: (_) async => data);
  }

  static Future<void> share(Boq b, {String siteName = ''}) async {
    final cfg = await InvConfig.load();
    final data = await build(b, cfg, siteName: siteName);
    await IdSheet.shareFiles([(name: fileName(b), data: data, mime: 'application/pdf')], subject: 'BOQ ${b.title}');
  }
}
