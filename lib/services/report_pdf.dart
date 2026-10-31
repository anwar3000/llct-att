import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import 'id_sheet.dart';
import 'inv_reports.dart';

/// PDF of a service report / call-out report / delivery note in the LLCT Invoicing layout:
/// coloured band, logo + company, title bar with barcode and number, customer & details boxes,
/// complaint / work carried out, items with status and serials, sign-off, photo pages.
class ReportPdf {
  ReportPdf._();

  static String _c(String s) => s
      .replaceAll(RegExp(r'[–—]'), '-')
      .replaceAll(RegExp(r'[‘’]'), "'")
      .replaceAll(RegExp(r'[“”]'), '"')
      .replaceAll('…', '...')
      .replaceAll(RegExp(r'[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]'), '');

  static PdfColor _hex(String h, PdfColor fb) {
    final s = h.replaceAll('#', '');
    if (s.length != 6) return fb;
    final v = int.tryParse(s, radix: 16);
    return v == null ? fb : PdfColor.fromInt(0xFF000000 | v);
  }

  static String _fdate(String iso) {
    final d = DateTime.tryParse(iso.length <= 10 ? '${iso}T00:00:00' : iso);
    return d == null ? '-' : DateFormat('dd MMM yyyy').format(d.toLocal());
  }

  static String _fdt(String iso) {
    final d = DateTime.tryParse(iso);
    return d == null ? '-' : DateFormat('dd MMM yyyy, HH:mm').format(d.toLocal());
  }

  static const _ink = PdfColor.fromInt(0xFF1F2226);
  static const _muted = PdfColor.fromInt(0xFF5D6168);
  static const _line = PdfColor.fromInt(0xFFE3E1DC);
  static const _soft = PdfColor.fromInt(0xFFF7F6F3);
  static const _good = PdfColor.fromInt(0xFF2F8A57);

  static Future<pw.MemoryImage?> _img(String ref) async {
    final b = await InvReports.imageBytes(ref);
    if (b == null) return null;
    try {
      return pw.MemoryImage(b);
    } catch (_) {
      return null;
    }
  }

  static Future<Uint8List> build(InvReport r, InvConfig cfg) async {
    final k = r.kind;
    final brand = _hex(cfg.s('brand'), const PdfColor.fromInt(0xFFB8285E));
    final charcoal = _hex(cfg.s('charcoal'), const PdfColor.fromInt(0xFF17375F));

    pw.MemoryImage? logo;
    final logoRef = cfg.s('logo');
    if (logoRef.startsWith('img:') || logoRef.startsWith('data:')) logo = await _img(logoRef);
    if (logo == null) {
      try {
        logo = pw.MemoryImage((await rootBundle.load('assets/doc_logo.png')).buffer.asUint8List());
      } catch (_) {}
    }
    final coSig = cfg.s('signature').isEmpty ? null : await _img(cfg.s('signature'));
    final coStamp = cfg.s('stamp').isEmpty ? null : await _img(cfg.s('stamp'));
    final dl = r.delivery;
    final custSig = (dl['signature'] ?? '').toString().isEmpty ? null : await _img(dl['signature'].toString());

    final cl = r.m['client'] is Map ? r.m['client'] as Map : const {};
    String cv(String key) => (cl[key] ?? '').toString();
    final items = r.items;
    final photos = <(pw.MemoryImage, Map<String, dynamic>)>[];
    for (final a in r.attachments) {
      if (a['kind'] != 'image' || a['inPdf'] == false) continue;
      final im = await _img((a['ref'] ?? '').toString());
      if (im != null) photos.add((im, a));
    }

    final det = <(String, String)>[('Date', _fdate(r.date))];
    if (r.s('ref').isNotEmpty) det.add(('LPO / Ref', r.s('ref')));
    if (r.s('contactName').isNotEmpty) det.add(('Contact', r.s('contactName')));
    final mob = r.s('contactMobile'), em = r.s('contactEmail');
    if (mob.isNotEmpty || em.isNotEmpty) {
      det.add((mob.isNotEmpty && em.isNotEmpty ? 'Mobile / Email' : (mob.isNotEmpty ? 'Mobile' : 'Email'), [mob, em].where((x) => x.isNotEmpty).join('  |  ')));
    }
    if (r.s('salesperson').isNotEmpty) det.add(('Salesperson', r.s('salesperson')));
    if (k.isService && r.s('technician').isNotEmpty) det.add(('Technician', r.s('technician')));
    if (k.isService && (r.s('timeIn').isNotEmpty || r.s('timeOut').isNotEmpty)) {
      det.add(('Time in / out', '${r.s('timeIn').isEmpty ? '-' : r.s('timeIn')} - ${r.s('timeOut').isEmpty ? '-' : r.s('timeOut')}'));
    }

    pw.TextStyle t(double size, {PdfColor color = _ink, bool bold = false}) =>
        pw.TextStyle(fontSize: size, color: color, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal);
    pw.Widget hh(String s) => pw.Padding(
        padding: const pw.EdgeInsets.only(bottom: 4), child: pw.Text(s.toUpperCase(), style: t(7.5, color: brand, bold: true)));

    pw.Widget band() => pw.Row(children: [
          pw.Expanded(flex: 28, child: pw.Container(height: 5, color: brand)),
          pw.Expanded(flex: 72, child: pw.Container(height: 5, color: charcoal)),
        ]);

    pw.Widget foot(pw.Context ctx) => pw.Column(children: [
          pw.Divider(color: _line, thickness: 0.6),
          pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [
            pw.Text(_c('${cfg.s('name')}${cfg.s('taxId').isNotEmpty ? ' · ${cfg.s('taxIdLabel')} ${cfg.s('taxId')}' : ''}'), style: t(7, color: _muted)),
            pw.Text('This is a computer-generated document', style: t(7, color: _muted)),
            pw.Text(_c('${cfg.s('website').split('·').first.trim()}   ${ctx.pageNumber}/${ctx.pagesCount}'), style: t(7, color: _muted)),
          ]),
        ]);

    final header = pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.stretch, children: [
      pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.center, children: [
        if (logo != null) ...[pw.Image(logo, height: 58), pw.SizedBox(width: 12)],
        pw.Expanded(
          child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.Text(_c(cfg.s('name')), style: t(15, color: charcoal, bold: true)),
            if (cfg.s('taxId').isNotEmpty) pw.Text(_c('${cfg.s('taxIdLabel')} ${cfg.s('taxId')}'), style: t(8, color: _muted)),
          ]),
        ),
        pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
          pw.Text(_c(cfg.s('address')), textAlign: pw.TextAlign.right, style: t(8, color: _muted)),
          if (cfg.s('phone').isNotEmpty) pw.Text(_c('T ${cfg.s('phone')}'), style: t(8, color: _muted)),
          if (cfg.s('website').isNotEmpty) pw.Text(_c('W ${cfg.s('website')}'), style: t(8, color: _muted)),
        ]),
      ]),
      pw.SizedBox(height: 12),
      pw.Container(
        padding: const pw.EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: pw.BoxDecoration(color: _soft, border: pw.Border(left: pw.BorderSide(color: brand, width: 3))),
        child: pw.Row(children: [
          pw.Expanded(
            child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
              pw.Text(k.title.toUpperCase(), style: t(16, color: charcoal, bold: true)),
            ]),
          ),
          pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
            if (r.number.isNotEmpty)
              pw.BarcodeWidget(barcode: pw.Barcode.code128(), data: r.number, drawText: false, width: 120, height: 26),
            pw.SizedBox(height: 2),
            pw.Text(r.number, style: t(10, color: charcoal, bold: true)),
          ]),
        ]),
      ),
    ]);

    pw.Widget box(pw.Widget child) => pw.Container(
        padding: const pw.EdgeInsets.all(10),
        decoration: pw.BoxDecoration(border: pw.Border.all(color: _line, width: 0.8), borderRadius: pw.BorderRadius.circular(6)),
        child: child);

    final custLines = [
      cv('contact'),
      cv('address'),
      [cv('phone'), cv('email')].where((x) => x.isNotEmpty).join(' · '),
      if (cv('taxId').isNotEmpty) '${cfg.s('taxIdLabel')}: ${cv('taxId')}',
    ].where((x) => x.isNotEmpty).join('\n');
    final g = r.m['gps'];
    final gpsTxt = (g is Map && g['lat'] is num && g['lng'] is num)
        ? '${(g['lat'] as num).toStringAsFixed(6)}, ${(g['lng'] as num).toStringAsFixed(6)}'
        : '';

    final meta = pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
      pw.Expanded(
        child: box(pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
          hh(k.who),
          pw.Text(_c(cv('name').isEmpty ? '-' : cv('name')), style: t(11.5, bold: true)),
          if (custLines.isNotEmpty) pw.Text(_c(custLines), style: t(8.5, color: _muted)),
          if (r.s('deliveryAddress').isNotEmpty || gpsTxt.isNotEmpty) ...[
            pw.SizedBox(height: 7),
            hh('Site / location'),
            if (r.s('deliveryAddress').isNotEmpty) pw.Text(_c(r.s('deliveryAddress')), style: t(9)),
            if (gpsTxt.isNotEmpty) pw.Text('GPS $gpsTxt', style: t(8, color: _muted)),
          ],
        ])),
      ),
      pw.SizedBox(width: 12),
      pw.Expanded(
        child: box(pw.Table(columnWidths: const {0: pw.FlexColumnWidth(1.1), 1: pw.FlexColumnWidth(2)}, children: [
          for (final d in det)
            pw.TableRow(children: [
              pw.Padding(padding: const pw.EdgeInsets.symmetric(vertical: 2), child: pw.Text(_c(d.$1), style: t(8.5, color: _muted))),
              pw.Padding(padding: const pw.EdgeInsets.symmetric(vertical: 2), child: pw.Text(_c(d.$2), style: t(8.5, bold: true))),
            ]),
        ])),
      ),
    ]);

    final body = <pw.Widget>[
      meta,
      if (r.s('subject').isNotEmpty) ...[
        pw.SizedBox(height: 12),
        pw.Container(
            padding: const pw.EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            color: _soft,
            child: pw.Text(_c(r.s('subject')), style: t(10.5, color: charcoal, bold: true))),
      ],
      if (k.isService && (r.s('complaint').isNotEmpty || r.s('workDone').isNotEmpty)) ...[
        pw.SizedBox(height: 12),
        pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
          if (r.s('complaint').isNotEmpty)
            pw.Expanded(child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [hh('Complaint / request'), pw.Text(_c(r.s('complaint')), style: t(9))])),
          if (r.s('complaint').isNotEmpty && r.s('workDone').isNotEmpty) pw.SizedBox(width: 14),
          if (r.s('workDone').isNotEmpty)
            pw.Expanded(child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [hh('Work carried out'), pw.Text(_c(r.s('workDone')), style: t(9))])),
        ]),
      ],
      if (items.isNotEmpty || !k.isService) ...[
        pw.SizedBox(height: 14),
        pw.Table(
          border: const pw.TableBorder(horizontalInside: pw.BorderSide(color: _line, width: 0.6), bottom: pw.BorderSide(color: _line, width: 0.6)),
          columnWidths: const {
            0: pw.FixedColumnWidth(26),
            1: pw.FlexColumnWidth(),
            2: pw.FixedColumnWidth(38),
            3: pw.FixedColumnWidth(38),
            4: pw.FixedColumnWidth(92),
          },
          children: [
            pw.TableRow(
              decoration: pw.BoxDecoration(color: charcoal),
              children: [
                for (final h in ['#', 'Item & description', 'Qty', 'Unit', 'Status'])
                  pw.Padding(
                    padding: const pw.EdgeInsets.symmetric(horizontal: 5, vertical: 5),
                    child: pw.Text(h, style: t(8, color: PdfColors.white, bold: true), textAlign: h == 'Qty' ? pw.TextAlign.right : pw.TextAlign.left),
                  ),
              ],
            ),
            if (items.isEmpty)
              pw.TableRow(children: [
                pw.SizedBox(),
                pw.Padding(padding: const pw.EdgeInsets.all(10), child: pw.Text('No items', style: t(9, color: _muted))),
                pw.SizedBox(),
                pw.SizedBox(),
                pw.SizedBox(),
              ]),
            for (var i = 0; i < items.length; i++)
              pw.TableRow(children: [
                pw.Padding(padding: const pw.EdgeInsets.all(5), child: pw.Text((i + 1).toString().padLeft(2, '0'), style: t(8.5, color: _muted))),
                pw.Padding(
                  padding: const pw.EdgeInsets.all(5),
                  child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
                    pw.Text(_c('${items[i]['name'] ?? ''}'), style: t(9, bold: true)),
                    if ('${items[i]['desc'] ?? ''}'.isNotEmpty) pw.Text(_c('${items[i]['desc']}'), style: t(8, color: _muted)),
                    if (items[i]['serials'] is List && (items[i]['serials'] as List).isNotEmpty)
                      pw.Text(_c('S/N  ${(items[i]['serials'] as List).join('   ')}'), style: t(7.5, color: charcoal)),
                  ]),
                ),
                pw.Padding(padding: const pw.EdgeInsets.all(5), child: pw.Text('${items[i]['qty'] ?? ''}', style: t(9), textAlign: pw.TextAlign.right)),
                pw.Padding(padding: const pw.EdgeInsets.all(5), child: pw.Text(_c('${items[i]['unit'] ?? ''}'), style: t(8.5))),
                pw.Padding(
                    padding: const pw.EdgeInsets.all(5),
                    child: pw.Text(_c('${items[i]['status'] ?? k.statuses.first}'), style: t(8.5, color: _good, bold: true))),
              ]),
          ],
        ),
        if (items.isNotEmpty)
          pw.Align(
            alignment: pw.Alignment.centerRight,
            child: pw.Padding(
              padding: const pw.EdgeInsets.only(top: 6),
              child: pw.Text(
                  'Total items ${items.length}   ·   Total quantity ${items.fold<num>(0, (s, i) => s + (i['qty'] is num ? i['qty'] as num : num.tryParse('${i['qty']}') ?? 0))}   ·   Serials ${items.fold<int>(0, (s, i) => s + (i['serials'] is List ? (i['serials'] as List).length : 0))}',
                  style: t(8, color: _muted)),
            ),
          ),
      ],
      if (r.s('notes').isNotEmpty) ...[pw.SizedBox(height: 12), hh('Notes'), pw.Text(_c(r.s('notes')), style: t(8.5))],
      if (r.signed) ...[
        pw.SizedBox(height: 10),
        pw.Container(
          padding: const pw.EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: pw.BoxDecoration(border: pw.Border.all(color: _good, width: 1.4), borderRadius: pw.BorderRadius.circular(4)),
          child: pw.Text(k.isService ? 'SIGNED OFF' : 'DELIVERED', style: t(11, color: _good, bold: true)),
        ),
      ],
      if (r.s('terms').isNotEmpty) ...[pw.SizedBox(height: 12), hh('Terms & conditions'), pw.Text(_c(r.s('terms')), style: t(7.5, color: _muted))],
      pw.SizedBox(height: 18),
      pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
        pw.Expanded(
          child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.SizedBox(
                height: 58,
                child: pw.Row(children: [
                  if (coStamp != null) pw.Image(coStamp, height: 56),
                  if (coSig != null) pw.Image(coSig, height: 48),
                ])),
            pw.Container(height: 0.8, color: _ink),
            pw.SizedBox(height: 3),
            pw.Text(_c('For ${cfg.s('name')}'), style: t(8.5, bold: true)),
            pw.Text(
                _c('${cfg.s('signName').isEmpty ? 'Authorised signatory' : cfg.s('signName')}${(dl['deliveredByName'] ?? '').toString().isNotEmpty ? ' · ${k.isService ? 'Attended' : 'Delivered'} by ${dl['deliveredByName']}' : ''}'),
                style: t(8, color: _muted)),
          ]),
        ),
        pw.SizedBox(width: 24),
        pw.Expanded(
          child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.SizedBox(height: 58, child: custSig != null ? pw.Image(custSig, height: 56) : pw.SizedBox()),
            pw.Container(height: 0.8, color: _ink),
            pw.SizedBox(height: 3),
            pw.Text(_c('${k.sign}: ${dl['receiver'] ?? ''}'), style: t(8.5, bold: true)),
            if (r.signed) pw.Text(_c(k.ok), style: t(8, color: _good)),
            pw.Text(
                _c(r.signed
                    ? '${(dl['receiverPhone'] ?? '').toString().isNotEmpty ? '${dl['receiverPhone']} · ' : ''}${_fdt('${dl['signedAt']}')}'
                    : 'Name, signature & date'),
                style: t(8, color: _muted)),
          ]),
        ),
      ]),
    ];

    final doc = pw.Document(title: '${k.title} ${r.number}', author: cfg.s('name'));
    final theme = pw.PageTheme(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.fromLTRB(34, 0, 34, 22),
    );
    doc.addPage(pw.MultiPage(
      pageTheme: theme,
      header: (ctx) => pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.stretch, children: [
        band(),
        pw.SizedBox(height: 18),
        if (ctx.pageNumber == 1) ...[header, pw.SizedBox(height: 14)],
      ]),
      footer: foot,
      build: (ctx) => body,
    ));

    // Photos: up to 4 small, 2 medium or 1 large per page (as in invoicing).
    if (photos.isNotEmpty) {
      const units = {'S': 1, 'M': 2, 'L': 4};
      final pages = <List<(pw.MemoryImage, Map<String, dynamic>)>>[];
      var cur = <(pw.MemoryImage, Map<String, dynamic>)>[];
      var used = 0;
      for (final p in photos) {
        final u = units['${p.$2['size'] ?? 'M'}'] ?? 2;
        if (used + u > 4 && cur.isNotEmpty) {
          pages.add(cur);
          cur = [];
          used = 0;
        }
        cur.add(p);
        used += u;
      }
      if (cur.isNotEmpty) pages.add(cur);
      pw.Widget tile((pw.MemoryImage, Map<String, dynamic>) p, int no) {
        final z = '${p.$2['size'] ?? 'M'}';
        final w = z == 'S' ? 257.0 : 527.0;
        final h = z == 'L' ? 620.0 : 300.0;
        final cap = '${p.$2['caption'] ?? ''}';
        return pw.SizedBox(
          width: w,
          child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.Container(
              height: h,
              width: w,
              decoration: pw.BoxDecoration(color: _soft, border: pw.Border.all(color: _line, width: 0.6)),
              child: pw.Center(child: pw.Image(p.$1, fit: pw.BoxFit.contain)),
            ),
            pw.SizedBox(height: 3),
            pw.Text(_c('${no.toString().padLeft(2, '0')}  $cap'), style: t(8.5, bold: true)),
          ]),
        );
      }

      var first = 0;
      for (var pi = 0; pi < pages.length; pi++) {
        final pg = pages[pi];
        final start = first;
        doc.addPage(pw.MultiPage(
          pageTheme: theme,
          header: (ctx) => pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.stretch, children: [
            band(),
            pw.SizedBox(height: 18),
            pw.Row(children: [
              pw.Expanded(
                child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
                  pw.Text(k.photos.toUpperCase(), style: t(14, color: charcoal, bold: true)),
                  pw.Text(_c('${k.title} ${r.number}${cv('name').isNotEmpty ? ' · ${cv('name')}' : ''}'), style: t(8.5, color: _muted)),
                ]),
              ),
              pw.Text('${pi + 1} / ${pages.length}', style: t(9, color: _muted)),
            ]),
            pw.SizedBox(height: 12),
          ]),
          footer: foot,
          build: (ctx) => [
            pw.Wrap(spacing: 12, runSpacing: 12, children: [
              for (var j = 0; j < pg.length; j++) tile(pg[j], start + j + 1),
            ]),
          ],
        ));
        first += pg.length;
      }
    }
    return doc.save();
  }

  static Future<void> share(InvReport r) async {
    final cfg = await InvConfig.load();
    final data = await build(r, cfg);
    final name = '${r.kind.title.replaceAll(' ', '_')}_${r.number}.pdf';
    await IdSheet.shareFiles([(name: name, data: data, mime: 'application/pdf')], subject: '${r.kind.title} ${r.number}');
  }
}
