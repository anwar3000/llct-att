import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:share_plus/share_plus.dart';

import '../models/models.dart';
import '../widgets/doc_widgets.dart' show DocBytes;
import 'db.dart';

/// Loads ID copies (cached for the session) and builds the ID sheet PDF —
/// the same layout as the web dashboard:
///   page 1 Emirates ID front + back · page 2 visa + numbers table + photo + SIRA
///   page 3 passport front + back · page 4 Abu Dhabi MCC (only when uploaded).
class IdSheet {
  static Future<Uint8List> bytes(IdFileMeta f) => DocBytes.get(f.id, () => Db.readIdFile(f));

  /// Copies of one kind, front first then back, then by upload time.
  static List<IdFileMeta> ofKind(List<IdFileMeta> files, String kind) {
    int rank(IdFileMeta f) => f.side == 'front' ? 0 : (f.side == 'back' ? 1 : 2);
    final l = files.where((f) => f.kind == kind).toList()
      ..sort((a, b) {
        final r = rank(a).compareTo(rank(b));
        if (r != 0) return r;
        return (a.uploadedAt ?? DateTime(2000)).compareTo(b.uploadedAt ?? DateTime(2000));
      });
    return l;
  }

  static DateTime? parseDay(String v) {
    final p = v.split('-');
    if (p.length != 3) return null;
    final y = int.tryParse(p[0]), m = int.tryParse(p[1]), d = int.tryParse(p[2]);
    return (y == null || m == null || d == null) ? null : DateTime(y, m, d);
  }

  /// Days until expiry (negative = expired), or null when no date.
  static int? daysLeft(String v) {
    final d = parseDay(v);
    if (d == null) return null;
    final n = DateTime.now();
    return d.difference(DateTime(n.year, n.month, n.day)).inDays;
  }

  static String statusText(String exp) {
    final d = daysLeft(exp);
    if (d == null) return '-';
    if (d < 0) return 'Expired';
    if (d <= 30) return 'Expires in $d d';
    return 'Valid';
  }

  static String fmtDay(String v) {
    final d = parseDay(v);
    return d == null ? (v.isEmpty ? '-' : v) : DateFormat('dd MMM yyyy').format(d);
  }

  // Built-in PDF fonts are Latin-1 only.
  static String _clean(String s) => s.replaceAll(RegExp(r'[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]'), '').replaceAll('—', '-');

  static const _ink = PdfColor.fromInt(0xFF282828);
  static const _dark = PdfColor.fromInt(0xFF2B2B2C);
  static const _chip = PdfColor.fromInt(0xFF404041);
  static const _orange = PdfColor.fromInt(0xFFFCB040);
  static const _line = PdfColor.fromInt(0xFFE1DED8);
  static const _soft = PdfColor.fromInt(0xFFFAF9F7);
  static const _grey = PdfColor.fromInt(0xFFA5A5A5);
  static const _cream = PdfColor.fromInt(0xFFFFF7E9);
  static const _creamLine = PdfColor.fromInt(0xFFEED6AA);
  static const _rowAlt = PdfColor.fromInt(0xFFFCF9F3);
  static const _mutedText = PdfColor.fromInt(0xFF73706A);
  static const _faintText = PdfColor.fromInt(0xFF969188);

  /// Builds one PDF for one or more people.
  static Future<Uint8List> build(List<IdPerson> people, {void Function(String)? progress}) async {
    final doc = pw.Document(title: 'ID documents', author: 'Leaders Line Trading LLC');
    pw.MemoryImage? logo;
    try {
      logo = pw.MemoryImage((await rootBundle.load('assets/logo.png')).buffer.asUint8List());
    } catch (_) {}

    // Light bar in the logo's colours: cream background, orange rule, charcoal text.
    pw.Widget header(IdPerson p, String section) => pw.Column(children: [
          pw.Container(
            height: 66,
            color: _cream,
            padding: const pw.EdgeInsets.symmetric(horizontal: 30),
            child: pw.Row(children: [
              if (logo != null) ...[
                pw.Image(logo, width: 80, height: 38),
                pw.SizedBox(width: 14),
                pw.Container(width: 0.8, height: 34, color: _creamLine),
                pw.SizedBox(width: 14),
              ],
              pw.Expanded(
                child: pw.Column(mainAxisAlignment: pw.MainAxisAlignment.center, crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
                  pw.Text(_clean(p.owner.name), style: pw.TextStyle(color: _dark, fontSize: 15, fontWeight: pw.FontWeight.bold), maxLines: 1),
                  pw.SizedBox(height: 3),
                  pw.Text(_clean(p.subtitle), style: const pw.TextStyle(color: _mutedText, fontSize: 9), maxLines: 1),
                ]),
              ),
              pw.Column(mainAxisAlignment: pw.MainAxisAlignment.center, crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
                pw.Text('LEADERS LINE TRADING LLC', style: const pw.TextStyle(color: _faintText, fontSize: 7.5)),
                pw.SizedBox(height: 4),
                pw.Text(section.toUpperCase(), style: pw.TextStyle(color: _dark, fontSize: 11.5, fontWeight: pw.FontWeight.bold)),
                pw.SizedBox(height: 3),
                pw.Container(width: 40, height: 2.2, color: _orange),
              ]),
            ]),
          ),
          pw.Container(height: 2.5, color: _orange),
          pw.SizedBox(height: 14),
        ]);

    pw.Widget slot(pw.MemoryImage? img, String label, String missing) => pw.Container(
          decoration: pw.BoxDecoration(
            color: img == null ? _soft : null,
            border: pw.Border.all(color: _line, width: 0.8),
            borderRadius: pw.BorderRadius.circular(8),
          ),
          padding: const pw.EdgeInsets.all(8),
          child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.Container(
              padding: const pw.EdgeInsets.symmetric(horizontal: 7, vertical: 3),
              decoration: pw.BoxDecoration(color: _orange, borderRadius: pw.BorderRadius.circular(4)),
              child: pw.Text(label, style: pw.TextStyle(color: _dark, fontSize: 8, fontWeight: pw.FontWeight.bold)),
            ),
            pw.SizedBox(height: 4),
            pw.Expanded(
              child: pw.Center(
                child: img != null
                    ? pw.Image(img, fit: pw.BoxFit.contain)
                    : pw.Text(missing, style: const pw.TextStyle(color: _grey, fontSize: 10)),
              ),
            ),
          ]),
        );

    pw.Widget twoSides(pw.MemoryImage? front, pw.MemoryImage? back, String name, String backName) => pw.Expanded(
          child: pw.Column(children: [
            pw.Expanded(child: slot(front, '${name.toUpperCase()} - FRONT', '$name front - not uploaded')),
            pw.SizedBox(height: 14),
            pw.Expanded(child: slot(back, '${name.toUpperCase()} - ${backName.toUpperCase()}', '$name $backName - not uploaded')),
          ]),
        );

    pw.Page page(IdPerson p, String section, pw.Widget body) => pw.Page(
          pageFormat: PdfPageFormat.a4,
          margin: pw.EdgeInsets.zero,
          build: (_) => pw.Column(children: [
            header(p, section),
            pw.Expanded(
              child: pw.Padding(
                padding: const pw.EdgeInsets.fromLTRB(30, 0, 30, 34),
                child: pw.Column(children: [body]),
              ),
            ),
          ]),
        );

    for (var n = 0; n < people.length; n++) {
      final p = people[n];
      progress?.call('${p.owner.name} (${n + 1}/${people.length})');
      final sl = assignIdSlots(p.files).slot;
      Future<pw.MemoryImage?> img(String key) async {
        final f = sl[key];
        if (f == null || !f.isImage) return null;
        try {
          final b = await bytes(f);
          return b.isEmpty ? null : pw.MemoryImage(b);
        } catch (_) {
          return null;
        }
      }

      final eidF = await img('eid/front'), eidB = await img('eid/back');
      final passF = await img('passport/front'), passB = await img('passport/back');
      final visaI = await img('visa/front'), siraI = await img('sira/front'), mccI = await img('mcc/front');
      final photo = await img('photo/front');
      final i = p.info;

      // Page 1 — Emirates ID
      doc.addPage(page(p, 'Emirates ID', twoSides(eidF, eidB, 'Emirates ID', 'back')));

      // Page 2 — Visa (top half) · numbers table, SIRA, photo (bottom half)
      // Only documents this person actually has (a number, an expiry date or an uploaded copy).
      final rows = idKinds
          .where((k) =>
              k.numField != null &&
              ('${i[k.numField] ?? ''}'.trim().isNotEmpty || '${i[k.expField] ?? ''}'.isNotEmpty || p.files.any((f) => f.kind == k.key)))
          .map((k) {
        final exp = '${i[k.expField] ?? ''}';
        return [k.label.replaceAll(' / work permit', ''), '${i[k.numField] ?? ''}'.isEmpty ? '-' : '${i[k.numField]}', fmtDay(exp), statusText(exp)];
      }).toList();
      PdfColor stColor(String t) => t == 'Expired'
          ? const PdfColor.fromInt(0xFFD64545)
          : t.startsWith('Expires')
              ? const PdfColor.fromInt(0xFFE08E2B)
              : t == 'Valid'
                  ? const PdfColor.fromInt(0xFF2E9E6A)
                  : _grey;
      pw.Widget cell(String t, {bool bold = false, PdfColor color = _ink, bool head = false}) => pw.Padding(
            padding: const pw.EdgeInsets.all(5),
            child: pw.Text(_clean(t),
                style: pw.TextStyle(fontSize: 9, color: head ? PdfColors.white : color, fontWeight: bold || head ? pw.FontWeight.bold : null)),
          );
      final table = pw.Table(
        border: pw.TableBorder.all(color: _line, width: 0.6),
        columnWidths: const {0: pw.FixedColumnWidth(92), 1: pw.FlexColumnWidth(), 2: pw.FixedColumnWidth(70), 3: pw.FixedColumnWidth(70)},
        children: [
          pw.TableRow(decoration: const pw.BoxDecoration(color: _chip), children: [
            for (final h in ['Document', 'Number', 'Expiry', 'Status']) cell(h, head: true),
          ]),
          if (rows.isEmpty)
            pw.TableRow(children: [cell('No document numbers recorded'), cell('-'), cell('-'), cell('-')]),
          for (var ri = 0; ri < rows.length; ri++)
            pw.TableRow(decoration: ri.isOdd ? const pw.BoxDecoration(color: _rowAlt) : null, children: [
              cell(rows[ri][0], bold: true),
              cell(rows[ri][1]),
              cell(rows[ri][2]),
              cell(rows[ri][3], bold: true, color: stColor(rows[ri][3])),
            ]),
        ],
      );
      final nat = '${i['nationality'] ?? ''}';
      const pwW = 110.0, phH = pwW * 45 / 35;
      doc.addPage(page(
        p,
        'Visa & details',
        pw.Expanded(
          child: pw.Column(children: [
            pw.Expanded(child: slot(visaI, 'VISA', 'Visa page - not uploaded')),
            pw.SizedBox(height: 14),
            pw.Expanded(
              child: pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
                pw.Expanded(
                  child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.stretch, children: [
                    table,
                    if (siraI != null) ...[pw.SizedBox(height: 10), pw.Expanded(child: slot(siraI, 'SIRA CARD', ''))],
                  ]),
                ),
                pw.SizedBox(width: 14),
                pw.SizedBox(
                  width: 150,
                  child: pw.Column(children: [
                    pw.Container(
                      width: pwW + 8,
                      height: phH + 8,
                      padding: const pw.EdgeInsets.all(4),
                      decoration: pw.BoxDecoration(
                          color: photo == null ? _soft : null,
                          border: pw.Border.all(color: _line),
                          borderRadius: pw.BorderRadius.circular(6)),
                      child: photo != null
                          ? pw.Image(photo, fit: pw.BoxFit.cover)
                          : pw.Center(
                              child: pw.Text('Photo not\nuploaded',
                                  textAlign: pw.TextAlign.center, style: const pw.TextStyle(color: _grey, fontSize: 8.5))),
                    ),
                    pw.SizedBox(height: 12),
                    pw.Text(_clean(p.owner.name),
                        textAlign: pw.TextAlign.center, style: pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold, color: _ink)),
                    for (final t in [p.owner.org, nat.isEmpty ? '' : 'Nationality: $nat', p.owner.phone.isEmpty ? '' : 'Tel ${p.owner.phone}'])
                      if (t.isNotEmpty)
                        pw.Padding(
                          padding: const pw.EdgeInsets.only(top: 3),
                          child: pw.Text(_clean(t),
                              textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 8.5, color: PdfColor.fromInt(0xFF646464))),
                        ),
                  ]),
                ),
              ]),
            ),
          ]),
        ),
      ));

      // Page 3 — Passport
      doc.addPage(page(p, 'Passport', twoSides(passF, passB, 'Passport', 'address page')));

      // Page 4 — Abu Dhabi MCC (only when uploaded)
      if (mccI != null) doc.addPage(page(p, 'Abu Dhabi MCC', pw.Expanded(child: slot(mccI, 'ABU DHABI MCC CERTIFICATE', '')))); 
    }
    return doc.save();
  }

  static String safeName(String s) => s.replaceAll(RegExp(r'[^A-Za-z0-9 _.-]'), '').trim().replaceAll(' ', '_');

  static Future<File> _temp(String name, Uint8List data) async {
    final dir = await getTemporaryDirectory();
    final f = File('${dir.path}/$name');
    await f.writeAsBytes(data, flush: true);
    return f;
  }

  static String extFor(IdFileMeta f) {
    final n = f.name.toLowerCase();
    final dot = n.lastIndexOf('.');
    if (dot > 0 && n.length - dot <= 5) return n.substring(dot);
    if (f.mime == 'application/pdf') return '.pdf';
    if (f.mime == 'image/png') return '.png';
    return '.jpg';
  }

  /// Opens the phone's share sheet (WhatsApp, email, Save to Drive / Files…).
  static Future<void> shareFiles(List<({String name, Uint8List data, String mime})> items, {String? subject}) async {
    final x = <XFile>[];
    for (final it in items) {
      final f = await _temp(it.name, it.data);
      x.add(XFile(f.path, mimeType: it.mime, name: it.name));
    }
    await Share.shareXFiles(x, subject: subject);
  }

  static Future<void> sharePdf(List<IdPerson> people, {void Function(String)? progress}) async {
    final data = await build(people, progress: progress);
    final name = people.length == 1 ? 'ID_${safeName(people.first.owner.name)}.pdf' : 'ID_documents_${people.length}_people.pdf';
    await shareFiles([(name: name, data: data, mime: 'application/pdf')], subject: name.replaceAll('_', ' '));
  }
}

/// One person with their ID numbers and copies.
class IdPerson {
  final IdOwner owner;
  final Map<String, dynamic> info;
  final List<IdFileMeta> files;
  IdPerson(this.owner, this.info, this.files);

  String get subtitle => [owner.isWorker ? 'External worker' : 'Staff', owner.org].where((s) => s.isNotEmpty).join('  ·  ');
}
