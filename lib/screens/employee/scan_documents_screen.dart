import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';

/// One step of the guided scan.
class ScanStep {
  final String kind, side, title, shape; // shape: card | page | photo
  final String? numField, expField, numLabel;
  final bool optional;
  const ScanStep(this.kind, this.side, this.title, this.shape, {this.numField, this.expField, this.numLabel, this.optional = false});
}

const kScanSteps = [
  ScanStep('eid', 'front', 'Emirates ID — front', 'card', numField: 'eidNo', expField: 'eidExpiry', numLabel: 'Emirates ID number'),
  ScanStep('eid', 'back', 'Emirates ID — back', 'card'),
  ScanStep('passport', 'front', 'Passport — photo page', 'page', numField: 'passportNo', expField: 'passportExpiry', numLabel: 'Passport number'),
  ScanStep('passport', 'back', 'Passport — last page (address)', 'page'),
  ScanStep('visa', 'front', 'Visa page', 'page', numField: 'visaNo', expField: 'visaExpiry', numLabel: 'Visa / file number'),
  ScanStep('sira', 'front', 'SIRA card (if you have one)', 'card', numField: 'siraNo', expField: 'siraExpiry', numLabel: 'SIRA number', optional: true),
  ScanStep('mcc', 'front', 'Abu Dhabi MCC certificate (if you have one)', 'page', numField: 'mccNo', expField: 'mccExpiry', numLabel: 'Certificate number', optional: true),
  ScanStep('photo', 'front', 'Passport-size photo', 'photo'),
];

const _ratio = {'card': 85.6 / 54, 'page': 125 / 88, 'photo': 35 / 45};
const _tips = {
  'card': 'Put the card flat on a dark table. Hold the phone straight above it so the card fills the frame. Avoid shadows and light reflections.',
  'page': 'Open the page fully, flat, in good light. All four corners and every line of text must be visible. No fingers on the page.',
  'photo': 'Plain white or light background, face straight to the camera, shoulders visible, good light.',
};

/// Guided scanning of the employee's own documents, one at a time, with a blur / light check.
class ScanDocumentsScreen extends StatefulWidget {
  final AppUser me;
  /// Whose documents (null = my own). Management uses this to upload for staff / external workers.
  final IdOwner? owner;
  const ScanDocumentsScreen({super.key, required this.me, this.owner});
  @override
  State<ScanDocumentsScreen> createState() => _ScanDocumentsScreenState();
}

class _ScanDocumentsScreenState extends State<ScanDocumentsScreen> {
  IdOwner get _owner => widget.owner ?? IdOwner.fromUser(widget.me);
  int _i = 0;
  List<IdFileMeta> _files = [];
  Map<String, dynamic> _info = {};
  final _subs = <StreamSubscription>[];
  Uint8List? _bytes;
  String _mime = 'image/jpeg';
  List<String> _warn = [];
  bool _busy = false;
  final _num = TextEditingController();
  String _exp = '';

  @override
  void initState() {
    super.initState();
    _subs.add(Db.myIdFiles(_owner.id).listen((l) {
      if (mounted) setState(() => _files = l);
    }, onError: (_) {}));
    _subs.add(Db.myIdInfo(_owner.id).listen((m) {
      if (!mounted) return;
      final first = _info.isEmpty;
      setState(() => _info = m);
      if (first) _loadFields();
    }, onError: (_) {}));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _num.dispose();
    super.dispose();
  }

  ScanStep get _step => kScanSteps[_i];

  /// Copies already saved for a step (unsided older uploads count for single-sided documents).
  List<IdFileMeta> _done(ScanStep st) => _files
      .where((f) => f.kind == st.kind && (f.side == st.side || (f.side.isEmpty && st.side == 'front' && st.kind != 'eid' && st.kind != 'passport')))
      .toList();

  void _loadFields() {
    final st = _step;
    _num.text = st.numField == null ? '' : '${_info[st.numField] ?? ''}';
    _exp = st.expField == null ? '' : '${_info[st.expField] ?? ''}';
  }

  void _go(int i) {
    setState(() {
      _i = i;
      _bytes = null;
      _warn = [];
      _loadFields();
    });
  }

  /// Blur / darkness / glare check on a small copy of the photo.
  Future<List<String>> _check(Uint8List bytes) async {
    try {
      final codec = await ui.instantiateImageCodec(bytes, targetWidth: 360);
      final img = (await codec.getNextFrame()).image;
      final data = (await img.toByteData(format: ui.ImageByteFormat.rawRgba))!;
      final w = img.width, h = img.height;
      final g = Float64List(w * h);
      var sum = 0.0, glare = 0;
      for (var i = 0; i < w * h; i++) {
        final v = 0.299 * data.getUint8(i * 4) + 0.587 * data.getUint8(i * 4 + 1) + 0.114 * data.getUint8(i * 4 + 2);
        g[i] = v;
        sum += v;
        if (v >= 254) glare++;
      }
      var ls = 0.0, lv = 0.0, n = 0;
      for (var y = 1; y < h - 1; y++) {
        for (var x = 1; x < w - 1; x++) {
          final i = y * w + x;
          final l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
          ls += l;
          lv += l * l;
          n++;
        }
      }
      final sharp = n == 0 ? 0 : lv / n - (ls / n) * (ls / n);
      final mean = sum / (w * h);
      return [
        if (sharp < 60) 'The photo looks blurry — hold the phone still and tap the screen to focus.',
        if (mean < 70) 'The photo is too dark — move to better light.',
        if (glare / (w * h) > 0.2) 'There is glare / reflection on the document — tilt it slightly away from the light.',
      ];
    } catch (_) {
      return [];
    }
  }

  Future<void> _camera() async {
    try {
      final x = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 2000, maxHeight: 2000, imageQuality: 85);
      if (x == null) return;
      await _use(await x.readAsBytes(), 'image/jpeg');
    } catch (e) {
      if (mounted) showSnack(context, 'Camera: $e', error: true);
    }
  }

  Future<void> _file() async {
    try {
      final r = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['jpg', 'jpeg', 'png', 'pdf'], withData: true);
      final f = r?.files.single;
      if (f == null || f.bytes == null) return;
      final pdf = (f.extension ?? '').toLowerCase() == 'pdf';
      await _use(f.bytes!, pdf ? 'application/pdf' : 'image/jpeg');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not open the file: $e', error: true);
    }
  }

  Future<void> _use(Uint8List bytes, String mime) async {
    if (bytes.length > kMaxDocBytes) {
      showSnack(context, 'This file is larger than 2 MB. Take a photo instead.', error: true);
      return;
    }
    final warn = mime == 'application/pdf' ? <String>[] : await _check(bytes);
    if (!mounted) return;
    setState(() {
      _bytes = bytes;
      _mime = mime;
      _warn = warn;
    });
  }

  Future<void> _saveNumbers() async {
    final st = _step;
    if (st.numField == null) return;
    final num = _num.text.trim();
    if (num == '${_info[st.numField] ?? ''}' && _exp == '${_info[st.expField] ?? ''}') return;
    await Db.saveIdInfo(_owner, {st.numField!: num, st.expField!: _exp});
  }

  void _next() {
    if (_i < kScanSteps.length - 1) {
      _go(_i + 1);
    } else {
      showSnack(context, 'Documents saved — thank you');
      Navigator.pop(context);
    }
  }

  Future<void> _save() async {
    final st = _step;
    final bytes = _bytes;
    if (bytes == null) return;
    setState(() => _busy = true);
    try {
      await _saveNumbers();
      final old = _done(st);
      await Db.uploadMyIdFile(
        me: widget.me, owner: _owner,
        kind: st.kind,
        side: st.side,
        name: '${st.kind}-${st.side}.${_mime == 'application/pdf' ? 'pdf' : 'jpg'}',
        mime: _mime,
        bytes: bytes,
      );
      for (final f in old) {
        try {
          await Db.deleteIdFile(f);
        } catch (_) {}
      }
      if (mounted) _next();
    } catch (e) {
      if (mounted) showSnack(context, 'Could not save: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _skip() async {
    try {
      await _saveNumbers();
    } catch (e) {
      if (mounted) showSnack(context, 'Could not save the number: $e', error: true);
      return;
    }
    if (mounted) _next();
  }

  @override
  Widget build(BuildContext context) {
    final st = _step;
    final done = _done(st);
    final ratio = _ratio[st.shape]!;
    final btn = FilledButton.styleFrom(minimumSize: const Size(0, 46));
    return Scaffold(
      appBar: AppBar(title: Text(widget.owner == null ? 'Scan my documents' : 'Scan documents · ${_owner.name}')),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (var k = 0; k < kScanSteps.length; k++)
            InkWell(
              onTap: _busy ? null : () => _go(k),
              customBorder: const CircleBorder(),
              child: Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: _done(kScanSteps[k]).isNotEmpty ? const Color(0xFFE2F4EA) : const Color(0xFFEEEBE5),
                  border: k == _i ? Border.all(color: AppColors.accent, width: 3) : null,
                ),
                child: Text(_done(kScanSteps[k]).isNotEmpty ? '✓' : '${k + 1}',
                    style: TextStyle(
                        fontWeight: FontWeight.w800,
                        color: _done(kScanSteps[k]).isNotEmpty ? AppColors.success : AppColors.muted)),
              ),
            ),
        ]),
        const SizedBox(height: 12),
        Text('${_i + 1}. ${st.title}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Text(_tips[st.shape]!, style: const TextStyle(color: AppColors.muted, fontSize: 13)),
        const SizedBox(height: 12),
        Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: st.shape == 'photo' ? 220 : 560, maxHeight: MediaQuery.of(context).size.height * 0.38),
            child: AspectRatio(
              aspectRatio: ratio,
              child: Container(
                decoration: BoxDecoration(
                  color: const Color(0xFF2B2B2C),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.accent, width: 3),
                ),
                clipBehavior: Clip.antiAlias,
                alignment: Alignment.center,
                child: _bytes != null
                    ? (_mime == 'application/pdf'
                        ? const Text('PDF selected', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800))
                        : Image.memory(_bytes!, fit: BoxFit.contain))
                    : Padding(
                        padding: const EdgeInsets.all(16),
                        child: Text(done.isNotEmpty ? '✓ Already scanned — take a new photo to replace it' : 'Fit the document inside this frame',
                            textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFFC9C9CC))),
                      ),
              ),
            ),
          ),
        ),
        if (_bytes != null && _warn.isNotEmpty)
          Container(
            margin: const EdgeInsets.only(top: 10),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: AppColors.accentSoft, borderRadius: BorderRadius.circular(10)),
            child: Text('${_warn.map((w) => '⚠ $w').join('\n')}\nRetake for a clearer copy, or use it anyway.',
                style: const TextStyle(fontSize: 13, color: Color(0xFF8A5A10))),
          ),
        if (_bytes != null && _warn.isEmpty && _mime != 'application/pdf')
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Center(child: Text('✓ Looks clear', style: TextStyle(color: AppColors.success, fontWeight: FontWeight.w700))),
          ),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(
            child: FilledButton.icon(
              style: btn,
              onPressed: _busy ? null : _camera,
              icon: const Icon(Icons.photo_camera),
              label: Text(_bytes != null || done.isNotEmpty ? 'Retake' : 'Take photo'),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 46)),
              onPressed: _busy ? null : _file,
              icon: const Icon(Icons.folder_open),
              label: const Text('File / PDF'),
            ),
          ),
        ]),
        if (st.numField != null) ...[
          const SizedBox(height: 12),
          TextField(controller: _num, decoration: InputDecoration(labelText: st.numLabel)),
          const SizedBox(height: 8),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.event),
            title: Text(_exp.isEmpty ? 'Expiry date — tap to set' : 'Expiry ${fmtDate(parseDateKey(_exp))}'),
            onTap: () async {
              final now = DateTime.now();
              final d = await showDatePicker(
                  context: context,
                  initialDate: _exp.isEmpty ? now.add(const Duration(days: 365)) : parseDateKey(_exp),
                  firstDate: DateTime(now.year - 20),
                  lastDate: DateTime(now.year + 20));
              if (d != null) setState(() => _exp = dateKey(d));
            },
          ),
        ],
        const SizedBox(height: 12),
        Row(children: [
          if (_i > 0)
            TextButton(onPressed: _busy ? null : () => _go(_i - 1), child: const Text('Back')),
          const Spacer(),
          TextButton(
            onPressed: _busy ? null : _skip,
            child: Text(done.isNotEmpty && _bytes == null ? 'Next' : (st.optional ? "Don't have it" : 'Skip')),
          ),
          if (_bytes != null) ...[
            const SizedBox(width: 8),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.success, minimumSize: const Size(120, 46)),
              onPressed: _busy ? null : _save,
              child: _busy
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text(_i == kScanSteps.length - 1 ? 'Save & finish' : 'Save & next'),
            ),
          ],
        ]),
      ]),
    );
  }
}
