import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../services/doc_info.dart';
import '../../services/doc_reader.dart';
import '../../services/id_sheet.dart';
import '../../widgets/common.dart';
import '../../widgets/doc_widgets.dart';
import 'id_documents_screen.dart' show runWithProgress;

/// One row on the screen: a standard document (maybe not saved yet) or an additional one.
class _Entry {
  final String id; // Firestore id (standard = key)
  final String key;
  final String title;
  final CompanyDoc? doc;
  final bool custom;
  _Entry(this.id, this.key, this.title, this.doc, this.custom);
}

/// Company documents: LLCT trade license, Abu Dhabi trade license, Chamber of Commerce, WC insurance…
/// plus additional documents with their own heading. Management edits; people allowed to view IDs can view & share.
class CompanyDocumentsScreen extends StatefulWidget {
  final AppUser me;
  const CompanyDocumentsScreen({super.key, required this.me});

  @override
  State<CompanyDocumentsScreen> createState() => _CompanyDocumentsScreenState();
}

class _CompanyDocumentsScreenState extends State<CompanyDocumentsScreen> {
  final _subs = <StreamSubscription>[];
  List<CompanyDoc>? _docs;
  List<CompanyFile>? _files;
  Object? _error;
  String? _busy; // entry id being uploaded

  bool get _canEdit => widget.me.isManagement;

  @override
  void initState() {
    super.initState();
    void err(Object e) => setState(() => _error = e);
    _subs.add(Db.companyDocsStream().listen((v) => setState(() => _docs = v), onError: err));
    _subs.add(Db.companyFilesStream().listen((v) => setState(() => _files = v), onError: err));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  List<_Entry> get _standard => [
        for (final t in companyDocTypes)
          _Entry(t.key, t.key, _docs!.where((d) => d.id == t.key).firstOrNull?.title ?? t.label,
              _docs!.where((d) => d.id == t.key).firstOrNull, false),
      ];

  List<_Entry> get _additional {
    final keys = companyDocTypes.map((t) => t.key).toSet();
    final l = _docs!.where((d) => !keys.contains(d.id)).toList()
      ..sort((a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()));
    return [for (final d in l) _Entry(d.id, d.key, d.title, d, true)];
  }

  List<CompanyFile> _filesOf(String id) => _files!.where((f) => f.docId == id).toList();

  String _fileName(String title, CompanyFile f, int n) =>
      '${IdSheet.safeName(title)}${n > 1 ? '_$n' : ''}${f.mime == 'application/pdf' ? '.pdf' : (f.mime == 'image/png' ? '.png' : '.jpg')}';

  Future<void> _upload(_Entry e) async {
    try {
      final p = await pickDocument(context, e.title);
      if (p == null || !mounted) return;
      setState(() => _busy = e.id);
      if (e.doc == null) {
        await Db.saveCompanyDoc(id: e.id, key: e.key, title: e.title, custom: e.custom, by: widget.me.name);
      }
      await Db.uploadCompanyFile(docId: e.id, name: p.name, mime: p.mime, bytes: p.bytes, by: widget.me.name);
      if (mounted) showSnack(context, '${e.title} uploaded');
      // Ask for the document number and expiry date right away if they're not filled in yet.
      // Read them from the copy first and show what was found to confirm.
      if (mounted && ((e.doc?.number ?? '').isEmpty || (e.doc?.expiry ?? '').isEmpty)) {
        showSnack(context, 'Reading number & expiry from the document…');
        final found = await DocReader.read(p.bytes, p.mime, e.key.isEmpty ? 'company' : e.key);
        if (!mounted) return;
        setState(() => _busy = null);
        await _editDetails(_Entry(e.id, e.key, e.title, e.doc ?? CompanyDoc(id: e.id, key: e.key, title: e.title, custom: e.custom), e.custom),
            found: found);
      }
    } catch (err) {
      if (mounted) showSnack(context, '$err'.replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _addAdditional() async {
    final heading = await askHeading(context,
        title: 'Additional company document',
        hint: 'e.g. ISO certificate',
        suggestions: const ['ISO certificate', 'Bank letter', 'Civil defence certificate', 'Municipality approval', 'Vehicle registration', 'Owner passport']);
    if (heading == null || !mounted) return;
    try {
      final id = await Db.saveCompanyDoc(title: heading, custom: true, by: widget.me.name);
      if (!mounted) return;
      await _upload(_Entry(id, '', heading, CompanyDoc(id: id, title: heading, custom: true), true));
    } catch (err) {
      if (mounted) showSnack(context, 'Could not add: $err', error: true);
    }
  }

  /// Reads the latest copy of [e] and opens its details with what was found.
  Future<void> _readFromCopy(_Entry e) async {
    final fl = _filesOf(e.id);
    if (fl.isEmpty) return;
    setState(() => _busy = e.id);
    DocInfo found = const DocInfo();
    try {
      final f = fl.last;
      found = await DocReader.read(await DocBytes.get(f.id, () => Db.readCompanyFile(f)), f.mime, e.key.isEmpty ? 'company' : e.key);
    } catch (_) {}
    if (!mounted) return;
    setState(() => _busy = null);
    if (found.isEmpty) showSnack(context, 'Could not read a number or date from this copy — type them in.', error: true);
    await _editDetails(e, found: found, preferFound: true);
  }

  /// Fills every empty number / expiry from the uploaded copies.
  Future<void> _readAll() async {
    final todo = [..._standard, ..._additional]
        .where((e) => _filesOf(e.id).isNotEmpty && ((e.doc?.number ?? '').isEmpty || (e.doc?.expiry ?? '').isEmpty))
        .toList();
    if (todo.isEmpty) {
      showSnack(context, 'Every document with a copy already has its number and expiry.');
      return;
    }
    final filled = <String>[];
    await runWithProgress(context, (set) async {
      for (var n = 0; n < todo.length; n++) {
        final e = todo[n];
        set('Reading ${e.title} (${n + 1}/${todo.length})…');
        var num = '', exp = '', iss = '';
        for (final f in _filesOf(e.id).reversed) {
          final r = await DocReader.read(await DocBytes.get(f.id, () => Db.readCompanyFile(f)), f.mime, e.key.isEmpty ? 'company' : e.key);
          if (num.isEmpty) num = r.number;
          if (exp.isEmpty) exp = r.expiry;
          if (iss.isEmpty) iss = r.issue;
          if (num.isNotEmpty && exp.isNotEmpty) break;
        }
        final d = e.doc;
        final newNum = (d?.number ?? '').isEmpty ? num : d!.number;
        final newExp = (d?.expiry ?? '').isEmpty ? exp : d!.expiry;
        final newIss = (d?.issueDate ?? '').isEmpty ? iss : d!.issueDate;
        if (newNum != (d?.number ?? '') || newExp != (d?.expiry ?? '') || newIss != (d?.issueDate ?? '')) {
          await Db.saveCompanyDoc(
              id: e.id, key: e.key, title: e.title, number: newNum, issueDate: newIss, expiry: newExp,
              notes: d?.notes ?? '', custom: e.custom, by: widget.me.name);
          filled.add('${e.title}: ${[
            if (newNum != (d?.number ?? '')) 'no. $newNum',
            if (newExp != (d?.expiry ?? '')) 'expiry ${IdSheet.fmtDay(newExp)}',
          ].join(', ')}');
        }
      }
    });
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Read from copies'),
        content: Text(filled.isEmpty
            ? 'Nothing new found — the copies may not be clear enough to read. Type the numbers in with "Number & dates".'
            : 'Filled in — please check:\n\n${filled.join('\n')}'),
        actions: [FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(96, 44)), onPressed: () => Navigator.pop(c), child: const Text('OK'))],
      ),
    );
  }

  Future<void> _editDetails(_Entry e, {DocInfo? found, bool preferFound = false}) async {
    final d = e.doc;
    String pick(String cur, String got) => (preferFound ? (got.isNotEmpty ? got : cur) : (cur.isNotEmpty ? cur : got));
    final title = TextEditingController(text: e.title);
    final number = TextEditingController(text: found == null ? d?.number ?? '' : pick(d?.number ?? '', found.number));
    final notes = TextEditingController(text: d?.notes ?? '');
    var issue = found == null ? d?.issueDate ?? '' : pick(d?.issueDate ?? '', found.issue);
    var expiry = found == null ? d?.expiry ?? '' : pick(d?.expiry ?? '', found.expiry);
    final readSome = found != null &&
        (number.text != (d?.number ?? '') || issue != (d?.issueDate ?? '') || expiry != (d?.expiry ?? ''));
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) {
          Widget dateField(String label, String v, void Function(String) on) => InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () async {
                  final p = await showDatePicker(
                      context: c,
                      initialDate: IdSheet.parseDay(v) ?? DateTime.now(),
                      firstDate: DateTime(2000),
                      lastDate: DateTime(2100),
                      helpText: label);
                  if (p != null) set(() => on(dateKey(p)));
                },
                child: InputDecorator(
                  decoration: InputDecoration(labelText: label, isDense: true, suffixIcon: const Icon(Icons.event, size: 18)),
                  child: Text(v.isEmpty ? 'Select' : IdSheet.fmtDay(v),
                      style: TextStyle(color: v.isEmpty ? AppColors.muted : null, fontSize: 14)),
                ),
              );
          return AlertDialog(
            title: Text(e.custom ? 'Document details' : e.title),
            content: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                if (readSome)
                  Container(
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: const Color(0xFFFFF4D6), borderRadius: BorderRadius.circular(10)),
                    child: const Text('Read from the document — please check before saving.',
                        style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                  ),
                if (e.custom) ...[
                  TextField(controller: title, decoration: const InputDecoration(labelText: 'Heading', isDense: true)),
                  const SizedBox(height: 10),
                ],
                TextField(controller: number, decoration: const InputDecoration(labelText: 'Number (license / policy / certificate no.)', isDense: true)),
                const SizedBox(height: 10),
                dateField('Issue date', issue, (v) => issue = v),
                const SizedBox(height: 10),
                dateField('Expiry date', expiry, (v) => expiry = v),
                const SizedBox(height: 10),
                TextField(controller: notes, maxLines: 2, decoration: const InputDecoration(labelText: 'Notes', isDense: true)),
              ]),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
              FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(96, 44)), onPressed: () => Navigator.pop(c, true), child: const Text('Save')),
            ],
          );
        },
      ),
    );
    if (ok != true) return;
    try {
      await Db.saveCompanyDoc(
        id: e.id,
        key: e.key,
        title: e.custom && title.text.trim().isNotEmpty ? title.text.trim() : e.title,
        number: number.text.trim(),
        issueDate: issue,
        expiry: expiry,
        notes: notes.text.trim(),
        custom: e.custom,
        by: widget.me.name,
      );
      if (mounted) showSnack(context, 'Saved');
    } catch (err) {
      if (mounted) showSnack(context, 'Could not save: $err', error: true);
    }
  }

  Future<void> _deleteEntry(_Entry e) async {
    if (!await confirm(context, 'Delete ${e.title}?', 'The document and all its files will be deleted.', danger: true, ok: 'Delete')) return;
    try {
      await Db.deleteCompanyDoc(e.id, _files!);
    } catch (err) {
      if (mounted) showSnack(context, 'Could not delete: $err', error: true);
    }
  }

  Future<void> _shareAll() async {
    final all = [..._standard, ..._additional];
    final files = _files!;
    if (files.isEmpty) return;
    await runWithProgress(context, (set) async {
      final items = <({String name, Uint8List data, String mime})>[];
      var n = 0;
      for (final e in all) {
        final fl = _filesOf(e.id);
        for (var i = 0; i < fl.length; i++) {
          set('Loading ${++n}/${files.length}…');
          final f = fl[i];
          items.add((name: _fileName(e.title, f, i + 1), data: await DocBytes.get(f.id, () => Db.readCompanyFile(f)), mime: f.mime));
        }
      }
      await IdSheet.shareFiles(items, subject: 'LLCT company documents');
    });
  }

  @override
  Widget build(BuildContext context) {
    final ready = _docs != null && _files != null;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Company documents'),
        actions: [
          if (ready && _files!.isNotEmpty)
            IconButton(tooltip: 'Share all files', icon: const Icon(Icons.ios_share), onPressed: _shareAll),
          if (ready && _canEdit && _files!.isNotEmpty)
            IconButton(tooltip: 'Read numbers & expiry from copies', icon: const Icon(Icons.document_scanner_outlined), onPressed: _readAll),
        ],
      ),
      body: _error != null
          ? EmptyState(icon: Icons.lock_outline, title: 'No access', message: 'Publish the latest Firestore rules, or ask admin for access.\n\n$_error')
          : !ready
              ? const Center(child: CircularProgressIndicator())
              : Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 820),
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 40),
                      children: [
                        ..._expiringBanner(),
                        for (final e in _standard) _card(e),
                        const SizedBox(height: 10),
                        Row(children: [
                          const Expanded(
                            child: Text('ADDITIONAL DOCUMENTS',
                                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, letterSpacing: .6, color: AppColors.muted)),
                          ),
                          if (_canEdit)
                            TextButton.icon(
                                onPressed: _addAdditional, icon: const Icon(Icons.add_circle_outline), label: const Text('Add with heading')),
                        ]),
                        if (_additional.isEmpty)
                          const Padding(
                            padding: EdgeInsets.fromLTRB(4, 0, 4, 8),
                            child: Text('ISO certificate, bank letter, civil defence… add each one with its own heading.',
                                style: TextStyle(color: AppColors.muted, fontSize: 12.5)),
                          ),
                        for (final e in _additional) _card(e),
                      ],
                    ),
                  ),
                ),
    );
  }

  List<Widget> _expiringBanner() {
    final bad = [..._standard, ..._additional]
        .where((e) => (IdSheet.daysLeft(e.doc?.expiry ?? '') ?? 999) <= kCompanyRenewDays)
        .toList();
    if (bad.isEmpty) return const [];
    return [
      Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: const Color(0xFFFFF1E0), borderRadius: BorderRadius.circular(12)),
        child: Row(children: [
          const Icon(Icons.warning_amber_rounded, color: AppColors.warning),
          const SizedBox(width: 10),
          Expanded(
            child: Text('Renew soon: ${bad.map((e) => '${e.title} (${IdSheet.statusText(e.doc!.expiry).toLowerCase()})').join(', ')}',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
          ),
        ]),
      ),
    ];
  }

  Widget _statusPill(String exp) {
    final d = IdSheet.daysLeft(exp);
    if (d == null) return const SizedBox.shrink();
    if (d < 0) return const Pill('Expired', color: AppColors.danger, icon: Icons.error_outline);
    if (d <= kCompanyRenewDays) return Pill(d == 0 ? 'Expires today' : 'Expires in $d d', color: AppColors.warning, icon: Icons.schedule);
    return const Pill('Valid', color: AppColors.success, icon: Icons.check_circle);
  }

  Widget _card(_Entry e) {
    final files = _filesOf(e.id);
    final d = e.doc;
    final busy = _busy == e.id;
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 6, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(e.title.toUpperCase(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, letterSpacing: .2))),
            _statusPill(d?.expiry ?? ''),
            if (_canEdit)
              PopupMenuButton<String>(
                onSelected: (v) {
                  if (v == 'upload') _upload(e);
                  if (v == 'edit') _editDetails(e);
                  if (v == 'read') _readFromCopy(e);
                  if (v == 'delete') _deleteEntry(e);
                },
                itemBuilder: (_) => [
                  const PopupMenuItem(value: 'upload', child: ListTile(leading: Icon(Icons.upload), title: Text('Upload file'))),
                  const PopupMenuItem(value: 'edit', child: ListTile(leading: Icon(Icons.edit_outlined), title: Text('Number & dates'))),
                  if (files.isNotEmpty)
                    const PopupMenuItem(value: 'read', child: ListTile(leading: Icon(Icons.document_scanner_outlined), title: Text('Read from copy'))),
                  if (e.custom || files.isNotEmpty || d != null)
                    PopupMenuItem(
                        value: 'delete',
                        child: ListTile(
                            leading: const Icon(Icons.delete_outline, color: AppColors.danger),
                            title: Text(e.custom ? 'Delete document' : 'Clear (delete files & details)'))),
                ],
              )
            else
              const SizedBox(height: 40),
          ]),
          // Document number & expiry, always visible (tap to edit).
          InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: _canEdit ? () => _editDetails(e) : null,
            child: Padding(
              padding: const EdgeInsets.only(bottom: 6, top: 2),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('DOC NO.', style: TextStyle(fontSize: 10, color: AppColors.muted, fontWeight: FontWeight.w700)),
                    Text((d?.number ?? '').isEmpty ? '—' : d!.number,
                        style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis),
                  ]),
                ),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('EXPIRY', style: TextStyle(fontSize: 10, color: AppColors.muted, fontWeight: FontWeight.w700)),
                    Text((d?.expiry ?? '').isEmpty ? '—' : IdSheet.fmtDay(d!.expiry),
                        style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
                  ]),
                ),
                if (_canEdit && ((d?.number ?? '').isEmpty || (d?.expiry ?? '').isEmpty))
                  const Text('Add', style: TextStyle(color: AppColors.accentDark, fontWeight: FontWeight.w700, fontSize: 12.5)),
              ]),
            ),
          ),
          if ((d?.issueDate ?? '').isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text('Issued ${IdSheet.fmtDay(d!.issueDate)}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
            ),
          if ((d?.notes ?? '').isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text(d!.notes, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
            ),
          const SizedBox(height: 4),
          SizedBox(
            height: 70,
            child: ListView(scrollDirection: Axis.horizontal, children: [
              for (var i = 0; i < files.length; i++)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(10),
                    onTap: () => DocViewer.open(context,
                        id: files[i].id,
                        title: e.title,
                        fileName: _fileName(e.title, files[i], i + 1),
                        mime: files[i].mime,
                        load: () => Db.readCompanyFile(files[i]),
                        onDelete: _canEdit ? () => Db.deleteCompanyFile(files[i]) : null),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: SizedBox(
                        width: 96,
                        height: 70,
                        child: DocThumb(id: files[i].id, isImage: files[i].isImage, load: () => Db.readCompanyFile(files[i])),
                      ),
                    ),
                  ),
                ),
              if (busy)
                const SizedBox(width: 70, child: Center(child: CircularProgressIndicator(strokeWidth: 2)))
              else if (_canEdit)
                InkWell(
                  borderRadius: BorderRadius.circular(10),
                  onTap: () => _upload(e),
                  child: SizedBox(
                    width: files.isEmpty ? 130 : 70,
                    child: DocPlaceholder(icon: files.isEmpty ? Icons.upload_file : Icons.add),
                  ),
                )
              else if (files.isEmpty)
                const Center(child: Text('Not uploaded', style: TextStyle(color: AppColors.muted, fontSize: 12.5))),
            ]),
          ),
        ]),
      ),
    );
  }
}
