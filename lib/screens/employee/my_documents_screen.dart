import 'dart:async';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../widgets/common.dart';
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
  String? _uploadingKind;
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
  Future<void> _upload(IdKind k) async {
    final src = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Text('Add ${k.label} copy · max 2 MB',
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          ),
          ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take a photo'),
              onTap: () => Navigator.pop(c, 'camera')),
          ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose from gallery'),
              onTap: () => Navigator.pop(c, 'gallery')),
          ListTile(
              leading: const Icon(Icons.picture_as_pdf_outlined),
              title: const Text('Choose a PDF or file'),
              onTap: () => Navigator.pop(c, 'file')),
          const SizedBox(height: 8),
        ]),
      ),
    );
    if (src == null || !mounted) return;
    try {
      String name, mime;
      List<int>? bytes;
      if (src == 'file') {
        final r = await FilePicker.platform.pickFiles(
          type: FileType.custom,
          allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png'],
          withData: true,
        );
        final f = r?.files.single;
        if (f == null) return;
        if (f.size > kMaxDocBytes) throw Exception('${f.name} is larger than 2 MB. Please choose a smaller file.');
        bytes = f.bytes;
        name = f.name;
        final ext = (f.extension ?? '').toLowerCase();
        mime = ext == 'pdf' ? 'application/pdf' : (ext == 'png' ? 'image/png' : 'image/jpeg');
      } else {
        final x = await ImagePicker().pickImage(
          source: src == 'camera' ? ImageSource.camera : ImageSource.gallery,
          maxWidth: 2000,
          maxHeight: 2000,
          imageQuality: 80,
        );
        if (x == null) return;
        bytes = await x.readAsBytes();
        name = '${k.label}.jpg';
        mime = 'image/jpeg';
      }
      if (bytes == null) throw Exception('Could not read the file.');
      if (bytes.length > kMaxDocBytes) {
        throw Exception('File is ${(bytes.length / 1048576).toStringAsFixed(1)} MB — the limit is 2 MB.');
      }
      setState(() => _uploadingKind = k.key);
      await Db.uploadMyIdFile(
          me: widget.me, owner: _owner, kind: k.key, name: name, mime: mime, bytes: Uint8List.fromList(bytes));
      if (mounted) showSnack(context, '${k.label} copy uploaded');
    } catch (e) {
      if (mounted) showSnack(context, '$e'.replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _uploadingKind = null);
    }
  }

  Future<void> _open(IdFileMeta f) async {
    if (!f.isImage) {
      showSnack(context, '${f.name} is saved. PDFs can be viewed by management on the dashboard.');
      return;
    }
    try {
      final bytes = await Db.readIdFile(f);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (c) => Dialog(
          clipBehavior: Clip.antiAlias,
          child: InteractiveViewer(child: Image.memory(bytes, fit: BoxFit.contain)),
        ),
      );
    } catch (e) {
      if (mounted) showSnack(context, 'Could not open: $e', error: true);
    }
  }

  Future<void> _delete(IdFileMeta f) async {
    if (!await confirm(context, 'Delete copy?', 'Delete ${f.name}?', danger: true, ok: 'Delete')) return;
    try {
      await Db.deleteIdFile(f);
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
        appBar: AppBar(title: Text(widget.owner == null ? 'My ID documents' : 'ID documents · ${_owner.name}')),
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
                          label: const Text('SCAN MY DOCUMENTS', style: TextStyle(fontWeight: FontWeight.w800)),
                        ),
                      ),
                      const Padding(
                        padding: EdgeInsets.fromLTRB(4, 6, 4, 12),
                        child: Text('Step by step: Emirates ID front & back, passport front & back, visa, SIRA card, MCC certificate, photo.',
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
                      for (final k in idKinds) ...[_docCard(k), const SizedBox(height: 10)],
                      TextField(
                        controller: _c('nationality'),
                        onChanged: (_) => _dirty = true,
                        decoration: const InputDecoration(
                            labelText: 'Nationality', prefixIcon: Icon(Icons.flag_outlined)),
                      ),
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

  Widget _docCard(IdKind k) {
    final files = _files.where((f) => f.kind == k.key).toList();
    final exp = k.expField == null ? '' : (_dates[k.expField!] ?? '');
    final uploading = _uploadingKind == k.key;
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
                child: Text(k.label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
            if (k.expField != null) _expiryPill(exp),
            const SizedBox(width: 4),
            uploading
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)))
                : IconButton(
                    tooltip: 'Upload copy',
                    onPressed: () => _upload(k),
                    icon: const Icon(Icons.add_circle_outline, color: AppColors.accentDark)),
          ]),
          if (k.numField != null) ...[
            const SizedBox(height: 6),
            Row(children: [
              Expanded(
                flex: 3,
                child: TextField(
                  controller: _c(k.numField!),
                  onChanged: (_) => _dirty = true,
                  decoration: const InputDecoration(labelText: 'Number', isDense: true),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 2,
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: () => _pickDate(k.expField!),
                  child: InputDecorator(
                    decoration: const InputDecoration(labelText: 'Expiry', isDense: true),
                    child: Text(exp.isEmpty ? 'Select' : fmtDate(_parse(exp)!),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: exp.isEmpty ? AppColors.muted : null, fontSize: 13)),
                  ),
                ),
              ),
            ]),
          ],
          const SizedBox(height: 8),
          files.isEmpty
              ? const Text('No copy uploaded', style: TextStyle(color: AppColors.muted, fontSize: 12.5))
              : Wrap(spacing: 6, runSpacing: 6, children: [
                  for (final f in files)
                    InputChip(
                      avatar: Icon(f.isImage ? Icons.image_outlined : Icons.picture_as_pdf_outlined, size: 18),
                      label: Text(f.name, overflow: TextOverflow.ellipsis),
                      onPressed: () => _open(f),
                      onDeleted: () => _delete(f),
                    ),
                ]),
        ]),
      ),
    );
  }
}
