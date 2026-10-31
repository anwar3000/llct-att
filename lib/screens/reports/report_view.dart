import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/inv_reports.dart';
import '../../services/location_service.dart';
import '../../services/report_pdf.dart';
import '../../widgets/common.dart';
import '../../widgets/signature_pad.dart';
import 'report_editor.dart';
import 'report_widgets.dart';

String _fdate(String iso) {
  final d = DateTime.tryParse(iso);
  return d == null ? iso : fmtDate(d);
}

/// One report: details, sign-off, PDF / share, open in LLCT Invoicing.
class ReportView extends StatefulWidget {
  final AppUser me;
  final String id;
  const ReportView({super.key, required this.me, required this.id});

  @override
  State<ReportView> createState() => _ReportViewState();
}

class _ReportViewState extends State<ReportView> {
  InvAccess? _acc;
  bool _pdfBusy = false;

  @override
  void initState() {
    super.initState();
    InvAccess.load(widget.me).then((a) {
      if (mounted) setState(() => _acc = a);
    });
  }

  Future<void> _pdf(InvReport r) async {
    setState(() => _pdfBusy = true);
    try {
      await ReportPdf.share(r);
    } catch (e) {
      if (mounted) showSnack(context, 'Could not make the PDF: $e', error: true);
    } finally {
      if (mounted) setState(() => _pdfBusy = false);
    }
  }

  void _openInvoicing(InvReport r) {
    final url = Uri.parse('https://anwar3000.github.io/llct-invoice/#/view?${Uri.encodeComponent(jsonEncode({'id': r.id}))}');
    launchUrl(url, mode: LaunchMode.inAppBrowserView).catchError((_) => launchUrl(url, mode: LaunchMode.externalApplication));
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<InvReport?>(
      stream: InvReports.watch(widget.id),
      builder: (context, snap) {
        if (snap.hasError) return Scaffold(appBar: AppBar(), body: Center(child: Text('Error: ${snap.error}')));
        if (!snap.hasData) return const Scaffold(body: Center(child: CircularProgressIndicator()));
        final r = snap.data;
        if (r == null) return Scaffold(appBar: AppBar(), body: const EmptyState(icon: Icons.description_outlined, title: 'Report not found'));
        final k = r.kind;
        final acc = _acc;
        final canEdit = acc != null && acc.makes && (acc.can('viewAll') || r.s('createdBy') == widget.me.id);
        final canSign = acc != null && acc.signs && !r.signed;
        final dl = r.delivery;
        final items = r.items;
        final photos = r.attachments.where((a) => a['kind'] == 'image').toList();
        return Scaffold(
          appBar: AppBar(
            title: Text(r.number),
            actions: [
              if (canEdit)
                IconButton(
                  tooltip: 'Edit',
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ReportEditor(me: widget.me, kind: k, existing: r))),
                  icon: const Icon(Icons.edit_outlined),
                ),
              PopupMenuButton<String>(
                onSelected: (v) {
                  if (v == 'inv') _openInvoicing(r);
                },
                itemBuilder: (_) => const [PopupMenuItem(value: 'inv', child: Text('Open in LLCT Invoicing'))],
              ),
            ],
          ),
          body: ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 30), children: [
            Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
              Text(k.title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              r.signed
                  ? Pill(k.isService ? 'Signed off' : 'Delivered', color: AppColors.success, icon: Icons.check_circle)
                  : const Pill('Waiting for signature', color: AppColors.warning, icon: Icons.schedule),
              if (r.s('ticketNo').isNotEmpty) Pill('Ticket ${r.s('ticketNo')}', color: AppColors.info),
            ]),
            const SizedBox(height: 12),
            RCard(children: [
              Text(r.clientName.isEmpty ? '-' : r.clientName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              if (r.place.isNotEmpty) Text(r.place, style: const TextStyle(color: AppColors.muted)),
              const SizedBox(height: 8),
              InfoRow(Icons.event_outlined, 'Date', _fdate(r.date)),
              if (r.s('subject').isNotEmpty) InfoRow(Icons.short_text, 'Subject', r.s('subject')),
              if (r.s('ref').isNotEmpty) InfoRow(Icons.tag, 'Reference', r.s('ref')),
              if (k.isService && r.s('technician').isNotEmpty) InfoRow(Icons.engineering_outlined, 'Technician', r.s('technician')),
              if (k.isService && (r.s('timeIn').isNotEmpty || r.s('timeOut').isNotEmpty))
                InfoRow(Icons.access_time, 'Time in / out', '${r.s('timeIn').isEmpty ? '—' : r.s('timeIn')} – ${r.s('timeOut').isEmpty ? '—' : r.s('timeOut')}'),
              InfoRow(Icons.person_outline, 'Made by', r.s('createdByName')),
            ]),
            if (k.isService && (r.s('complaint').isNotEmpty || r.s('workDone').isNotEmpty)) ...[
              const SizedBox(height: 12),
              RCard(children: [
                if (r.s('complaint').isNotEmpty) ...[
                  const Text('Complaint / request', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.muted, fontSize: 12.5)),
                  Text(r.s('complaint')),
                  const SizedBox(height: 10),
                ],
                if (r.s('workDone').isNotEmpty) ...[
                  const Text('Work carried out', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.muted, fontSize: 12.5)),
                  Text(r.s('workDone')),
                ],
              ]),
            ],
            if (items.isNotEmpty) ...[
              const SizedBox(height: 12),
              RCard(children: [
                const RTitle('Items'),
                for (var i = 0; i < items.length; i++)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      SizedBox(width: 26, child: Text('${i + 1}'.padLeft(2, '0'), style: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w700))),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${items[i]['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                          if ('${items[i]['desc'] ?? ''}'.isNotEmpty) Text('${items[i]['desc']}', style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
                          if (items[i]['serials'] is List && (items[i]['serials'] as List).isNotEmpty)
                            Text('S/N ${(items[i]['serials'] as List).join(', ')}', style: const TextStyle(fontSize: 12, fontFamily: 'monospace')),
                        ]),
                      ),
                      Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Text('${items[i]['qty'] ?? ''} ${items[i]['unit'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        Text('${items[i]['status'] ?? k.statuses.first}', style: const TextStyle(fontSize: 12, color: AppColors.success)),
                      ]),
                    ]),
                  ),
              ]),
            ],
            if (photos.isNotEmpty) ...[
              const SizedBox(height: 12),
              RCard(children: [
                RTitle('${k.photos} photos'),
                SizedBox(
                  height: 92,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: photos.length,
                    separatorBuilder: (_, __) => const SizedBox(width: 8),
                    itemBuilder: (c, i) => GestureDetector(
                      onTap: () => showDialog(
                          context: context,
                          builder: (_) => Dialog(child: InteractiveViewer(child: RefImage('${photos[i]['ref']}', fit: BoxFit.contain)))),
                      child: ClipRRect(borderRadius: BorderRadius.circular(8), child: RefImage('${photos[i]['ref']}', width: 92, height: 92)),
                    ),
                  ),
                ),
              ]),
            ],
            if (r.signed) ...[
              const SizedBox(height: 12),
              RCard(children: [
                RTitle(k.sign),
                if ('${dl['signature'] ?? ''}'.isNotEmpty) SizedBox(height: 90, child: RefImage('${dl['signature']}', fit: BoxFit.contain)),
                Text('${dl['receiver'] ?? ''}${'${dl['receiverPhone'] ?? ''}'.isNotEmpty ? ' · ${dl['receiverPhone']}' : ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                Text(k.ok, style: const TextStyle(color: AppColors.success, fontSize: 12.5)),
                Text(_fdate('${dl['signedAt'] ?? ''}'), style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
              ]),
            ],
            const SizedBox(height: 18),
            if (canSign)
              FilledButton.icon(
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50), backgroundColor: AppColors.success),
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => SignOffScreen(me: widget.me, report: r))),
                icon: const Icon(Icons.draw_outlined),
                label: Text(k.isService ? 'Sign off: customer signature' : 'Deliver: serials & signature'),
              ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              onPressed: _pdfBusy ? null : () => _pdf(r),
              icon: _pdfBusy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.picture_as_pdf_outlined),
              label: Text(_pdfBusy ? 'Making PDF…' : 'PDF · share (WhatsApp, email…)'),
            ),
          ]),
        );
      },
    );
  }
}

/// Customer / receiver sign-off: item status, serials, receiver, signature, photos.
class SignOffScreen extends StatefulWidget {
  final AppUser me;
  final InvReport report;
  const SignOffScreen({super.key, required this.me, required this.report});

  @override
  State<SignOffScreen> createState() => _SignOffScreenState();
}

class _SignOffScreenState extends State<SignOffScreen> {
  late final List<Map<String, dynamic>> _items = widget.report.items.map((i) {
    final m = Map<String, dynamic>.from(i);
    m['serials'] = (i['serials'] is List) ? (i['serials'] as List).map((e) => '$e').toList() : <String>[];
    return m;
  }).toList();
  late final List<Map<String, dynamic>> _photos = widget.report.attachments;
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _sig = SignaturePadController();
  Map<String, dynamic>? _gps;
  bool _busy = false;
  bool _lock = false;

  @override
  void initState() {
    super.initState();
    LocationService.current().then((p) {
      if (mounted) {
        setState(() => _gps = {
              'lat': double.parse(p.latitude.toStringAsFixed(6)),
              'lng': double.parse(p.longitude.toStringAsFixed(6)),
              'acc': p.accuracy.round(),
              'at': isoNow(),
            });
      }
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _sig.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    if (_name.text.trim().isEmpty) {
      showSnack(context, 'Enter the ${widget.report.kind.isService ? 'customer' : 'receiver'}\'s name.', error: true);
      return;
    }
    if (_sig.isEmpty) {
      showSnack(context, 'Ask the ${widget.report.kind.isService ? 'customer' : 'receiver'} to sign in the box.', error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      final sig = await _sig.toDataUrl();
      await InvReports.signOff(widget.report, widget.me,
          items: _items, attachments: _photos, receiver: _name.text.trim(), receiverPhone: _phone.text.trim(), signature: sig ?? '', gps: _gps);
      if (!mounted) return;
      final k = widget.report.kind;
      await showDialog(
        context: context,
        builder: (c) => AlertDialog(
          icon: const Icon(Icons.check_circle, color: AppColors.success, size: 48),
          title: Text('Thank you, ${_name.text.trim()}!'),
          content: Text(k.isService ? 'Thank you for confirming our service visit.' : 'Thank you for accepting the delivery.', textAlign: TextAlign.center),
          actions: [FilledButton(onPressed: () => Navigator.pop(c), child: const Text('Done'))],
        ),
      );
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showSnack(context, '$e'.contains('permission') ? 'You don\'t have permission to sign off reports. Ask the admin.' : 'Could not save: $e', error: true);
      }
    }
  }

  Future<void> _saveOnly() async {
    setState(() => _busy = true);
    try {
      await InvReports.saveWithoutSigning(widget.report, _items, _photos);
      if (mounted) {
        showSnack(context, 'Saved');
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showSnack(context, 'Could not save: $e', error: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.report, k = r.kind;
    return Scaffold(
      appBar: AppBar(title: Text('${k.isService ? 'Sign off' : 'Deliver'} ${r.number}')),
      body: ListView(
        physics: _lock ? const NeverScrollableScrollPhysics() : null,
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 30),
        children: [
          Text(r.clientName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          if (r.place.isNotEmpty) Text(r.place, style: const TextStyle(color: AppColors.muted)),
          Text(_gps == null ? 'Getting location…' : 'Location ${_gps!['lat']}, ${_gps!['lng']} ±${_gps!['acc']} m',
              style: const TextStyle(fontSize: 12, color: AppColors.muted)),
          const SizedBox(height: 12),
          if (_items.isNotEmpty)
            RCard(children: [
              const RTitle('1. Items, status & serial numbers'),
              for (var i = 0; i < _items.length; i++)
                ItemEditor(index: i, item: _items[i], kind: k, compact: true, onRemove: () {}, onChanged: () => setState(() {})),
            ]),
          const SizedBox(height: 12),
          RCard(children: [
            RTitle('${_items.isEmpty ? '1' : '2'}. ${k.sign}'),
            TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: InputDecoration(labelText: k.isService ? 'Customer name' : 'Received by (name)')),
            const SizedBox(height: 8),
            TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Mobile')),
            const SizedBox(height: 12),
            Row(children: [
              const Expanded(child: Text('Signature', style: TextStyle(fontWeight: FontWeight.w700))),
              TextButton(onPressed: _sig.clear, child: const Text('Clear')),
            ]),
            SignaturePad(controller: _sig, onDrawing: (v) => setState(() => _lock = v)),
            const SizedBox(height: 6),
            Text(k.ok, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
          ]),
          const SizedBox(height: 12),
          PhotosCard(me: widget.me, title: k.photos, beforeAfter: k.isService, photos: _photos, onChanged: () => setState(() {})),
          const SizedBox(height: 18),
          FilledButton.icon(
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50), backgroundColor: AppColors.success),
            onPressed: _busy ? null : _confirm,
            icon: const Icon(Icons.check),
            label: Text(_busy ? 'Saving…' : (k.isService ? 'Confirm & sign off' : 'Confirm delivery')),
          ),
          const SizedBox(height: 8),
          TextButton(onPressed: _busy ? null : _saveOnly, child: const Text('Save without signing')),
        ],
      ),
    );
  }
}
