import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../widgets/common.dart';
import '../../services/doc_reader.dart';
import '../../widgets/doc_widgets.dart';
import 'scan_documents_screen.dart';

/// Employee's own ID documents: numbers, expiry dates and copies (max 2 MB each).
/// Management sees the same data on the web dashboard.
class MyDocumentsScreen extends StatefulWidget {
  final AppUser me;
  /// Whose documents (null = my own). Management uses this to upload for staff / external workers.
  final IdOwner? owner;
  const MyDocumentsScreen({super.key, required this.me, this.owner});

  @override
  State<MyDocumentsScreen> createState() => _MyDocumentsScreenState();
}

class _MyDocumentsScreenState extends State<MyDocumentsScreen> {
  IdOwner get _owner => widget.owner ?? IdOwner.fromUser(widget.me);
  final _subs = <StreamSubscription>[];
  final _ctrl = <String, TextEditingController>{};
  final _dates = <String, String>{};
  List<IdFileMeta> _files = [];
  bool _loaded = false, _dirty = false, _saving = false;
  String? _uploading;
  String? _error;

  TextEditingController _c(String field) => _ctrl.putIfAbsent(field, () => TextEditingController());

  @override
  void initState() {
    super.initState();
    _subs.add(Db.myIdInfo(_owner.id).listen((m) {
      if (!mounted || _dirty) return;
      setState(() {
        for (final k in idKinds) {
          if (k.numField != null) _c(k.numField!).text = (m[k.numField] ?? '').toString();
          if (k.expField != null) _dates[k.expField!] = (m[k.expField] ?? '').toString();
        }
        _c('nationality').text = (m['nationality'] ?? '').toString();
        _loaded = true;
      });
    }, onError: (e) {
      if (mounted) setState(() { _loaded = true; _error = '$e'; });
    }));
    _subs.add(Db.myIdFiles(_owner.id).listen((l) {
      if (mounted) setState(() => _files = l);
    }, onError: (_) {}));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    for (final c in _ctrl.values) {
      c.dispose();
    }
    super.dispose();
  }

  // ------------------------------------------------------------ expiry
  static DateTime? _parse(String v) {
    final p = v.split('-');
    if (p.length != 3) return null;
    final y = int.tryParse(p[0]), m = int.tryParse(p[1]), d = int.tryParse(p[2]);
    return (y == null || m == null || d == null) ? null : DateTime(y, m, d);
  }

  Widget _expiryPill(String v) {
    final d = _parse(v);
    if (d == null) return const SizedBox.shrink();
    final now = DateTime.now();
    final days = d.difference(DateTime(now.year, now.month, now.day)).inDays;
    if (days < 0) return const Pill('Expired', color: AppColors.danger, icon: Icons.error_outline);
    if (days <= 30) return Pill('Expires in $days d', color: AppColors.warning, icon: Icons.schedule);
    return const Pill('Valid', color: AppColors.success, icon: Icons.check_circle);
  }

  Future<void> _pickDate(String field) async {
    final cur = _parse(_dates[field] ?? '') ?? DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: cur,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
      helpText: 'Expiry date',
    );
    if (d == null) return;
    setState(() {
      _dates[field] = dateKey(d);
      _dirty = true;
    });
  }

  // ------------------------------------------------------------ save numbers
  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final fields = <String, String>{'nationality': _c('nationality').text.trim()};
      for (final k in idKinds) {
        if (k.numField != null) fields[k.numField!] = _c(k.numField!).text.trim();
        if (k.expField != null) fields[k.expField!] = _dates[k.expField!] ?? '';
      }
      await Db.saveIdInfo(_owner, fields);
      _dirty = false;
      if (mounted) showSnack(context, 'Document details saved');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not save: $e', error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  // ------------------------------------------------------------ upload
  /// Upload into one slot; the old copy of that slot is removed after the new one is saved.
  Future<void> _uploadSlot(IdSlot sl, IdFileMeta? old) async {
    try {
      final p = await pickDocument(context, sl.label);
      if (p == null || !mounted) return;
      setState(() => _uploading = sl.key);
      await Db.uploadMyIdFile(
          me: widget.me, owner: _owner, kind: sl.kind, side: sl.side, name: _niceName(sl.short, p), mime: p.mime, bytes: p.bytes);
      if (old != null) {
        try {
          await Db.deleteIdFile(old);
          DocBytes.forget(old.id);
        } catch (_) {}
      }
      if (mounted) showSnack(context, '${sl.label} uploaded');
      // Read the number / expiry from the copy into empty boxes.
      if (mounted && sl.idKind.numField != null) {
        final got = await _fillFrom(p.bytes, p.mime, sl.kind);
        if (mounted && got.isNotEmpty) showSnack(context, 'Read from the copy: $got — please check');
      }
    } catch (e) {
      if (mounted) showSnack(context, '$e'.replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _uploading = null);
    }
  }

  /// Reads one copy and fills the number / expiry of [kind] when they're empty (saved straight away).
  /// Returns a short description of what was filled ('' = nothing).
  Future<String> _fillFrom(Uint8List bytes, String mime, String kind) async {
    final k = idKinds.firstWhere((x) => x.key == kind);
    if (k.numField == null) return '';
    final needNum = _c(k.numField!).text.trim().isEmpty, needExp = (_dates[k.expField!] ?? '').isEmpty;
    if (!needNum && !needExp) return '';
    final r = await DocReader.read(bytes, mime, kind);
    final data = <String, String>{};
    if (needNum && r.number.isNotEmpty) data[k.numField!] = r.number;
    if (needExp && r.expiry.isNotEmpty) data[k.expField!] = r.expiry;
    if (data.isEmpty || !mounted) return '';
    setState(() {
      if (data[k.numField!] != null) _c(k.numField!).text = data[k.numField!]!;
      if (data[k.expField!] != null) _dates[k.expField!] = data[k.expField!]!;
      _autoRead.addAll(data.keys);
    });
    await Db.saveIdInfo(_owner, data);
    return [
      if (data[k.numField!] != null) '${k.label.replaceAll(' / work permit', '')} no. ${data[k.numField!]}',
      if (data[k.expField!] != null) 'expiry ${fmtDate(_parse(data[k.expField!]!)!)}',
    ].join(', ');
  }

  bool _reading = false;
  final _autoRead = <String>{};

  /// Fills every empty number / expiry from the copies already uploaded.
  Future<void> _readAll() async {
    if (_reading) return;
    setState(() => _reading = true);
    final found = <String>[];
    try {
      final a = assignIdSlots(_files.where((f) => !f.pending).toList());
      for (final k in idKinds.where((k) => k.numField != null)) {
        final cands = [a.slot['${k.key}/front'], a.slot['${k.key}/back'], ...a.extra.where((f) => f.kind == k.key)].whereType<IdFileMeta>();
        for (final f in cands) {
          if (_c(k.numField!).text.trim().isNotEmpty && (_dates[k.expField!] ?? '').isNotEmpty) break;
          final got = await _fillFrom(await Db.readIdFile(f), f.mime, k.key);
          if (got.isNotEmpty) found.add(got);
        }
      }
      if (mounted) {
        showSnack(
            context,
            found.isEmpty
                ? 'Nothing new found — numbers already filled, or the copies are not clear enough to read.'
                : 'Read: ${found.join(' · ')} — please check');
      }
    } catch (e) {
      if (mounted) showSnack(context, 'Could not read: $e', error: true);
    } finally {
      if (mounted) setState(() => _reading = false);
    }
  }

  Future<void> _addOther() async {
    final heading = await askHeading(context,
        title: 'Additional document',
        hint: 'e.g. Driving licence',
        suggestions: const ['Driving licence', 'Health card', 'Insurance card', 'Degree certificate', 'Experience letter', 'Labour contract']);
    if (heading == null || !mounted) return;
    try {
      final p = await pickDocument(context, heading);
      if (p == null || !mounted) return;
      setState(() => _uploading = 'other');
      await Db.uploadMyIdFile(
          me: widget.me, owner: _owner, kind: 'other', title: heading, name: _niceName(heading, p), mime: p.mime, bytes: p.bytes);
      if (mounted) showSnack(context, '$heading uploaded');
    } catch (e) {
      if (mounted) showSnack(context, '$e'.replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _uploading = null);
    }
  }

  String _niceName(String label, PickedDoc p) {
    final base = label.replaceAll(RegExp(r'[^A-Za-z0-9 _-]'), '').trim().replaceAll(' ', '_');
    return '$base.${p.mime == 'application/pdf' ? 'pdf' : (p.mime == 'image/png' ? 'png' : 'jpg')}';
  }

  void _open(IdFileMeta f, String title) => DocViewer.open(context,
      id: f.id, title: title, fileName: f.name, mime: f.mime, load: () => Db.readIdFile(f));

  Future<void> _delete(IdFileMeta f, String what) async {
    if (!await confirm(context, 'Delete copy?', 'Delete the $what copy?', danger: true, ok: 'Delete')) return;
    try {
      await Db.deleteIdFile(f);
      DocBytes.forget(f.id);
    } catch (e) {
      if (mounted) showSnack(context, 'Could not delete: $e', error: true);
    }
  }

  // ------------------------------------------------------------ UI
  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_dirty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final leave = await confirm(context, 'Unsaved changes', 'Leave without saving the numbers and dates?',
            ok: 'Leave');
        if (leave && context.mounted) {
          _dirty = false;
          Navigator.pop(context);
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.owner == null ? 'My ID documents' : 'ID documents · ${_owner.name}'),
          actions: [
            _reading
                ? const Padding(
                    padding: EdgeInsets.all(16),
                    child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)))
                : IconButton(
                    tooltip: 'Read numbers & expiry from the copies',
                    icon: const Icon(Icons.document_scanner_outlined),
                    onPressed: _files.isEmpty ? null : _readAll),
          ],
        ),
        body: !_loaded
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? EmptyState(
                    icon: Icons.lock_outline,
                    title: 'Could not load your documents',
                    message: _error!.contains('permission')
                        ? 'Ask management to publish the latest Firestore rules.'
                        : _error!)
                : ListView(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 120),
                    children: [
                      SizedBox(
                        height: 56,
                        child: FilledButton.icon(
                          style: FilledButton.styleFrom(backgroundColor: AppColors.accentDark),
                          onPressed: () => Navigator.of(context)
                              .push(MaterialPageRoute(builder: (_) => ScanDocumentsScreen(me: widget.me, owner: widget.owner))),
                          icon: const Icon(Icons.document_scanner_outlined),
                          label: Text(widget.owner == null ? 'SCAN MY DOCUMENTS' : 'SCAN DOCUMENTS', style: const TextStyle(fontWeight: FontWeight.w800)),
                        ),
                      ),
                      const Padding(
                        padding: EdgeInsets.fromLTRB(4, 6, 4, 12),
                        child: Text('Step by step: EID front, EID back, visa, passport front, passport address page, SIRA, Abu Dhabi MCC, photo. Or upload each one below.',
                            style: TextStyle(fontSize: 12, color: AppColors.muted)),
                      ),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                            color: AppColors.accentSoft, borderRadius: BorderRadius.circular(12)),
                        child: const Text(
                          'Keep your documents up to date. Add the number and expiry date, and upload a '
                          'clear photo or PDF of each (max 2 MB per file). Only you and management can see them.',
                          style: TextStyle(fontSize: 12.5, color: AppColors.primary),
                        ),
                      ),
                      const SizedBox(height: 12),
                      ..._slotCards(),
                      TextField(
                        controller: _c('nationality'),
                        onChanged: (_) => _dirty = true,
                        decoration: const InputDecoration(
                            labelText: 'Nationality', prefixIcon: Icon(Icons.flag_outlined)),
                      ),
                      const SizedBox(height: 18),
                      Row(children: [
                        const Expanded(
                            child: Text('ADDITIONAL DOCUMENTS',
                                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, letterSpacing: .6, color: AppColors.muted))),
                        _uploading == 'other'
                            ? const Padding(
                                padding: EdgeInsets.all(10),
                                child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)))
                            : TextButton.icon(
                                onPressed: _addOther,
                                icon: const Icon(Icons.add_circle_outline),
                                label: const Text('Add with heading')),
                      ]),
                      ..._otherCards(),
                    ],
                  ),
        bottomNavigationBar: !_loaded || _error != null
            ? null
            : SafeArea(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                        backgroundColor: AppColors.accent, foregroundColor: AppColors.primaryDark),
                    onPressed: _saving ? null : _save,
                    icon: const Icon(Icons.check),
                    label: Text(_saving ? 'Saving…' : 'Save numbers & dates'),
                  ),
                ),
              ),
      ),
    );
  }

  List<Widget> _slotCards() {
    final a = assignIdSlots(_files.where((f) => !f.pending).toList());
    _extra = a.extra;
    final out = <Widget>[];
    final shownNumbers = <String>{};
    for (final sl in idSlots) {
      final f = a.slot[sl.key];
      final k = sl.idKind;
      final withNumbers = k.numField != null && shownNumbers.add(k.key);
      final exp = k.expField == null ? '' : (_dates[k.expField!] ?? '');
      final busy = _uploading == sl.key;
      out.add(Card(
        margin: const EdgeInsets.only(bottom: 10),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 8, 12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              InkWell(
                borderRadius: BorderRadius.circular(10),
                onTap: busy ? null : (f == null ? () => _uploadSlot(sl, null) : () => _open(f, sl.label)),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: SizedBox(
                    width: 84,
                    height: 58,
                    child: f == null
                        ? DocPlaceholder(icon: sl.kind == 'photo' ? Icons.person_outline : Icons.add_a_photo_outlined)
                        : DocThumb(id: f.id, isImage: f.isImage, load: () => Db.readIdFile(f)),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(sl.short, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, letterSpacing: .3)),
                  const SizedBox(height: 3),
                  f == null
                      ? Text(sl.kind == 'sira' || sl.kind == 'mcc' || sl.kind == 'labour' ? 'Not uploaded (if you have one)' : 'Not uploaded',
                          style: const TextStyle(color: AppColors.danger, fontSize: 12.5))
                      : Text('Uploaded${f.uploadedAt == null ? '' : ' ${fmtDateShort(f.uploadedAt!)}'}${f.isImage ? '' : ' · PDF'}',
                          style: const TextStyle(color: AppColors.success, fontSize: 12.5, fontWeight: FontWeight.w600)),
                  if (withNumbers && exp.isNotEmpty) ...[const SizedBox(height: 4), _expiryPill(exp)],
                ]),
              ),
              if (busy)
                const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)))
              else if (f == null)
                FilledButton.icon(
                  style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 40),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      backgroundColor: AppColors.accent,
                      foregroundColor: AppColors.primaryDark),
                  onPressed: () => _uploadSlot(sl, null),
                  icon: const Icon(Icons.upload, size: 18),
                  label: const Text('Upload'),
                )
              else
                PopupMenuButton<String>(
                  onSelected: (v) {
                    if (v == 'view') _open(f, sl.label);
                    if (v == 'replace') _uploadSlot(sl, f);
                    if (v == 'delete') _delete(f, sl.label);
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'view', child: ListTile(leading: Icon(Icons.visibility_outlined), title: Text('View / share'))),
                    PopupMenuItem(value: 'replace', child: ListTile(leading: Icon(Icons.upload), title: Text('Replace'))),
                    PopupMenuItem(value: 'delete', child: ListTile(leading: Icon(Icons.delete_outline, color: AppColors.danger), title: Text('Delete'))),
                  ],
                ),
            ]),
            if (withNumbers) ...[
              const SizedBox(height: 10),
              Row(children: [
                Expanded(
                  flex: 3,
                  child: TextField(
                    controller: _c(k.numField!),
                    onChanged: (_) => _dirty = true,
                    onTap: () => setState(() => _autoRead.remove(k.numField)),
                    decoration: InputDecoration(
                        labelText: '${k.label.replaceAll(' / work permit', '')} number',
                        isDense: true,
                        filled: _autoRead.contains(k.numField),
                        fillColor: const Color(0xFFFFF4D6),
                        helperText: _autoRead.contains(k.numField) ? 'Read from the copy — check it' : null),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 2,
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: () => _pickDate(k.expField!),
                    child: InputDecorator(
                      decoration: InputDecoration(
                          labelText: 'Expiry',
                          isDense: true,
                          filled: _autoRead.contains(k.expField),
                          fillColor: const Color(0xFFFFF4D6),
                          helperText: _autoRead.contains(k.expField) ? 'Read from copy' : null),
                      child: Text(exp.isEmpty ? 'Select' : fmtDate(_parse(exp)!),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: exp.isEmpty ? AppColors.muted : null, fontSize: 13)),
                    ),
                  ),
                ),
              ]),
            ],
          ]),
        ),
      ));
    }
    return out;
  }

  List<IdFileMeta> _extra = [];

  List<Widget> _otherCards() {
    if (_extra.isEmpty) {
      return const [
        Padding(
          padding: EdgeInsets.fromLTRB(4, 0, 4, 8),
          child: Text('Driving licence, health card, certificates… add each one with its own heading.',
              style: TextStyle(color: AppColors.muted, fontSize: 12.5)),
        ),
      ];
    }
    return [
      for (final f in _extra)
        Card(
          margin: const EdgeInsets.only(bottom: 8),
          child: ListTile(
            contentPadding: const EdgeInsets.fromLTRB(10, 4, 4, 4),
            leading: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(width: 56, height: 42, child: DocThumb(id: f.id, isImage: f.isImage, load: () => Db.readIdFile(f))),
            ),
            title: Text(idFileHeading(f), style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('${f.isImage ? 'Photo' : 'PDF'}${f.uploadedAt == null ? '' : ' · ${fmtDateShort(f.uploadedAt!)}'}'),
            onTap: () => _open(f, idFileHeading(f)),
            trailing: IconButton(
                tooltip: 'Delete',
                icon: const Icon(Icons.delete_outline, color: AppColors.danger),
                onPressed: () => _delete(f, idFileHeading(f))),
          ),
        ),
    ];
  }
}
