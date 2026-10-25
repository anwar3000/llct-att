import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../services/id_sheet.dart';
import '../../widgets/common.dart';
import '../employee/my_documents_screen.dart';
import '../employee/scan_documents_screen.dart';

const _kTagKinds = [('passport', 'PP'), ('eid', 'EID'), ('visa', 'VISA'), ('sira', 'SIRA'), ('mcc', 'MCC')];
const _kMust = ['passport', 'eid', 'visa'];

/// Everyone's ID documents: admin, managers and people admin allowed ("Can view & download IDs").
class IdDocumentsScreen extends StatefulWidget {
  final AppUser me;
  const IdDocumentsScreen({super.key, required this.me});

  @override
  State<IdDocumentsScreen> createState() => _IdDocumentsScreenState();
}

class _IdDocumentsScreenState extends State<IdDocumentsScreen> {
  final _subs = <StreamSubscription>[];
  List<AppUser>? _users;
  List<ExtWorker>? _workers;
  Map<String, Map<String, dynamic>>? _info;
  List<IdFileMeta>? _files;
  Object? _error;
  String _q = '';
  String _filter = 'all';

  @override
  void initState() {
    super.initState();
    void err(Object e) => setState(() => _error = e);
    _subs.add(Db.employeesStream().listen((v) => setState(() => _users = v), onError: err));
    _subs.add(Db.allWorkersStream().listen((v) => setState(() => _workers = v), onError: err));
    _subs.add(Db.allIdInfo().listen((v) => setState(() => _info = v), onError: err));
    _subs.add(Db.allIdFiles().listen((v) => setState(() => _files = v), onError: err));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  List<IdPerson> get _people {
    final byOwner = <String, List<IdFileMeta>>{};
    for (final f in _files!) {
      byOwner.putIfAbsent(f.ownerId, () => []).add(f);
    }
    final out = <IdPerson>[
      for (final u in _users!.where((u) => u.active))
        IdPerson(IdOwner.fromUser(u),
            _info![u.id] ?? const {}, byOwner[u.id] ?? const []),
      for (final w in _workers!.where((w) => w.active))
        IdPerson(IdOwner(id: w.id, type: 'worker', name: w.name, org: w.subtitle, phone: w.phone),
            _info![w.id] ?? const {}, byOwner[w.id] ?? const []),
    ];
    out.sort((a, b) => a.owner.name.toLowerCase().compareTo(b.owner.name.toLowerCase()));
    return out;
  }

  static bool _missing(IdPerson p) => _kMust.any((k) => !p.files.any((f) => f.kind == k));
  static int? _soonest(IdPerson p) {
    int? best;
    for (final k in idKinds.where((k) => k.expField != null)) {
      final d = IdSheet.daysLeft('${p.info[k.expField] ?? ''}');
      if (d != null && (best == null || d < best)) best = d;
    }
    return best;
  }

  bool _match(IdPerson p) {
    switch (_filter) {
      case 'staff':
        if (p.owner.isWorker) return false;
      case 'ext':
        if (!p.owner.isWorker) return false;
      case 'missing':
        if (!_missing(p)) return false;
      case 'expiring':
        final d = _soonest(p);
        if (d == null || d > 30) return false;
    }
    if (_q.isEmpty) return true;
    final q = _q.toLowerCase();
    return [p.owner.name, p.owner.org, p.owner.phone, ...idKinds.where((k) => k.numField != null).map((k) => '${p.info[k.numField] ?? ''}')]
        .any((s) => s.toLowerCase().contains(q));
  }

  Future<void> _downloadAll(List<IdPerson> list) async {
    if (list.isEmpty) return;
    if (list.length > 25) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('Large download'),
          content: Text('${list.length} people — this makes a big PDF and can take a few minutes. Use the search or filters to pick fewer people, or continue.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
            FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(96, 44)), onPressed: () => Navigator.pop(c, true), child: const Text('Continue')),
          ],
        ),
      );
      if (ok != true) return;
    }
    if (!mounted) return;
    await runWithProgress(context, (set) => IdSheet.sharePdf(list, progress: set));
  }

  @override
  Widget build(BuildContext context) {
    final ready = _users != null && _workers != null && _info != null && _files != null;
    final people = ready ? _people : <IdPerson>[];
    final shown = people.where(_match).toList();
    return Scaffold(
      appBar: AppBar(
        title: const Text('ID documents'),
        actions: [
          if (ready)
            IconButton(
              tooltip: 'ID sheets PDF for everyone shown',
              icon: const Icon(Icons.picture_as_pdf_outlined),
              onPressed: shown.isEmpty ? null : () => _downloadAll(shown),
            ),
        ],
      ),
      body: _error != null
          ? EmptyState(icon: Icons.lock_outline, title: 'No access', message: 'Ask admin for the "Can view & download ID documents" permission.\n\n$_error')
          : !ready
              ? const Center(child: CircularProgressIndicator())
              : Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 820),
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 30),
                      children: [
                        TextField(
                          decoration: const InputDecoration(
                              prefixIcon: Icon(Icons.search), hintText: 'Search name, phone or document number', isDense: true),
                          onChanged: (v) => setState(() => _q = v.trim()),
                        ),
                        const SizedBox(height: 10),
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(children: [
                            for (final f in [
                              ('all', 'All', people.length),
                              ('staff', 'Staff', people.where((p) => !p.owner.isWorker).length),
                              ('ext', 'External', people.where((p) => p.owner.isWorker).length),
                              ('missing', 'Missing copies', people.where(_missing).length),
                              ('expiring', 'Expiring / expired', people.where((p) => (_soonest(p) ?? 999) <= 30).length),
                            ])
                              Padding(
                                padding: const EdgeInsets.only(right: 8),
                                child: ChoiceChip(
                                  label: Text('${f.$2} (${f.$3})'),
                                  selected: _filter == f.$1,
                                  onSelected: (_) => setState(() => _filter = f.$1),
                                ),
                              ),
                          ]),
                        ),
                        const SizedBox(height: 10),
                        if (shown.isEmpty)
                          const EmptyState(icon: Icons.badge_outlined, title: 'Nobody here', message: 'Try another filter or search.'),
                        for (final p in shown) _row(p),
                      ],
                    ),
                  ),
                ),
    );
  }

  Widget _row(IdPerson p) {
    final soon = _soonest(p);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => IdPersonScreen(me: widget.me, owner: p.owner))),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(children: [
            Avatar(p.owner.name, ring: p.owner.isWorker ? AppColors.info : null),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(p.owner.name, style: const TextStyle(fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
                Text(p.subtitle, style: const TextStyle(color: AppColors.muted, fontSize: 12.5), maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 6),
                Wrap(spacing: 5, runSpacing: 5, children: [
                  for (final t in _kTagKinds) _tag(t.$2, p.files.any((f) => f.kind == t.$1)),
                  if (soon != null && soon < 0) const Pill('Expired', color: AppColors.danger, icon: Icons.error_outline),
                  if (soon != null && soon >= 0 && soon <= 30) Pill('Expires in $soon d', color: AppColors.warning, icon: Icons.schedule),
                ]),
              ]),
            ),
            const Icon(Icons.chevron_right, color: AppColors.muted),
          ]),
        ),
      ),
    );
  }

  static Widget _tag(String t, bool has) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        decoration: BoxDecoration(
          color: has ? AppColors.success.withValues(alpha: 0.12) : AppColors.surface,
          border: Border.all(color: has ? AppColors.success.withValues(alpha: 0.4) : const Color(0xFFE1DED8)),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(t,
            style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
                color: has ? AppColors.success : AppColors.muted,
                decoration: has ? null : TextDecoration.lineThrough)),
      );
}

/// Shows a small progress dialog while [job] runs; errors are shown in a snackbar.
Future<void> runWithProgress(BuildContext context, Future<void> Function(void Function(String) set) job) async {
  final text = ValueNotifier<String>('Preparing…');
  showDialog(
    context: context,
    barrierDismissible: false,
    builder: (_) => PopScope(
      canPop: false,
      child: AlertDialog(
        content: Row(children: [
          const SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 3)),
          const SizedBox(width: 16),
          Expanded(child: ValueListenableBuilder<String>(valueListenable: text, builder: (_, v, __) => Text(v))),
        ]),
      ),
    ),
  );
  try {
    await job((s) => text.value = s);
    if (context.mounted) Navigator.of(context, rootNavigator: true).pop();
  } catch (e) {
    if (context.mounted) {
      Navigator.of(context, rootNavigator: true).pop();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not prepare the file: $e')));
    }
  }
}

/// One person's ID documents: numbers, expiry dates, copies; share copies or the ID sheet PDF.
class IdPersonScreen extends StatelessWidget {
  final AppUser me;
  final IdOwner owner;
  const IdPersonScreen({super.key, required this.me, required this.owner});

  @override
  Widget build(BuildContext context) {
    return StreamView<Map<String, dynamic>>(
      stream: Db.myIdInfo(owner.id),
      loading: const Scaffold(body: Center(child: CircularProgressIndicator())),
      builder: (context, info) => StreamView<List<IdFileMeta>>(
        stream: Db.myIdFiles(owner.id),
        loading: const Scaffold(body: Center(child: CircularProgressIndicator())),
        builder: (context, all) {
          final files = all.where((f) => !f.pending).toList();
          final p = IdPerson(owner, info, files);
          return _PersonView(me: me, person: p);
        },
      ),
    );
  }
}

class _PersonView extends StatelessWidget {
  final AppUser me;
  final IdPerson person;
  const _PersonView({required this.me, required this.person});

  void _open(BuildContext context, Widget w) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => w));

  Future<void> _shareAll(BuildContext context) async {
    final files = person.files;
    if (files.isEmpty) return;
    await runWithProgress(context, (set) async {
      final items = <({String name, Uint8List data, String mime})>[];
      var n = 0;
      for (final f in files) {
        set('Loading copies ${++n}/${files.length}…');
        items.add((name: _fileName(person, f, n), data: await IdSheet.bytes(f), mime: f.mime));
      }
      await IdSheet.shareFiles(items, subject: '${person.owner.name} - ID documents');
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = person;
    final photo = IdSheet.ofKind(p.files, 'photo').where((f) => f.isImage).firstOrNull;
    return Scaffold(
      appBar: AppBar(title: Text(p.owner.name)),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 820),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 30),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: SizedBox(
                        width: 70,
                        height: 90,
                        child: photo == null
                            ? Container(color: AppColors.surface, alignment: Alignment.center, child: Avatar(p.owner.name, size: 46))
                            : _Thumb(file: photo, fit: BoxFit.cover),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(p.owner.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
                        const SizedBox(height: 2),
                        Text(p.subtitle, style: const TextStyle(color: AppColors.muted, fontSize: 13)),
                        if ('${p.info['nationality'] ?? ''}'.isNotEmpty)
                          Text('Nationality: ${p.info['nationality']}', style: const TextStyle(fontSize: 13)),
                        if (p.owner.phone.isNotEmpty) Text('Tel ${p.owner.phone}', style: const TextStyle(fontSize: 13)),
                        const SizedBox(height: 10),
                        Wrap(spacing: 8, runSpacing: 8, children: [
                          FilledButton.icon(
                            style: FilledButton.styleFrom(
                                minimumSize: const Size(0, 42),
                                backgroundColor: AppColors.accent,
                                foregroundColor: AppColors.primaryDark),
                            onPressed: () => runWithProgress(context, (set) => IdSheet.sharePdf([p], progress: set)),
                            icon: const Icon(Icons.picture_as_pdf_outlined, size: 19),
                            label: const Text('ID sheet PDF'),
                          ),
                          OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 42)),
                            onPressed: p.files.isEmpty ? null : () => _shareAll(context),
                            icon: const Icon(Icons.ios_share, size: 19),
                            label: Text('Share all copies (${p.files.length})'),
                          ),
                        ]),
                      ]),
                    ),
                  ]),
                ),
              ),
              if (me.isManagement) ...[
                const SizedBox(height: 4),
                Row(children: [
                  Expanded(
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
                      onPressed: () => _open(context, ScanDocumentsScreen(me: me, owner: person.owner)),
                      icon: const Icon(Icons.document_scanner_outlined, size: 20),
                      label: const Text('Scan documents'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
                      onPressed: () => _open(context, MyDocumentsScreen(me: me, owner: person.owner)),
                      icon: const Icon(Icons.upload_file, size: 20),
                      label: const Text('Upload / edit'),
                    ),
                  ),
                ]),
              ],
              const SizedBox(height: 6),
              const SectionTitle('Numbers & expiry'),
              Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                  child: Column(children: [
                    for (final k in idKinds.where((k) => k.numField != null))
                      _numRow(k, '${p.info[k.numField] ?? ''}', '${p.info[k.expField] ?? ''}'),
                  ]),
                ),
              ),
              const SectionTitle('Copies'),
              for (final k in idKinds) ..._kindCopies(context, k),
              if (p.files.isEmpty)
                const EmptyState(icon: Icons.photo_library_outlined, title: 'No copies uploaded', message: 'Nothing scanned or uploaded yet.'),
            ],
          ),
        ),
      ),
    );
  }

  Widget _numRow(IdKind k, String no, String exp) {
    final st = IdSheet.statusText(exp);
    final color = st == 'Expired'
        ? AppColors.danger
        : st.startsWith('Expires')
            ? AppColors.warning
            : st == 'Valid'
                ? AppColors.success
                : AppColors.muted;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(children: [
        Expanded(
          flex: 5,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(k.label.replaceAll(' / work permit', ''), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
            SelectableText(no.isEmpty ? '-' : no, style: const TextStyle(color: AppColors.ink, fontSize: 13)),
          ]),
        ),
        Expanded(
          flex: 4,
          child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text(IdSheet.fmtDay(exp), style: const TextStyle(fontSize: 13)),
            if (st != '-') Text(st, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 12)),
          ]),
        ),
      ]),
    );
  }

  List<Widget> _kindCopies(BuildContext context, IdKind k) {
    final list = IdSheet.ofKind(person.files, k.key);
    if (list.isEmpty) return const [];
    return [
      Padding(
        padding: const EdgeInsets.fromLTRB(4, 8, 4, 6),
        child: Text(k.label, style: const TextStyle(fontWeight: FontWeight.w800)),
      ),
      GridView.extent(
        maxCrossAxisExtent: 260,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        childAspectRatio: 1.35,
        children: [
          for (var i = 0; i < list.length; i++)
            InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => IdCopyViewer(person: person, file: list[i], title: '${k.label}${_sideLabel(list[i])}'))),
              child: Container(
                decoration: BoxDecoration(
                  color: AppColors.card,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFE1DED8)),
                ),
                clipBehavior: Clip.antiAlias,
                child: Stack(fit: StackFit.expand, children: [
                  list[i].isImage
                      ? _Thumb(file: list[i], fit: BoxFit.cover)
                      : const Center(child: Icon(Icons.picture_as_pdf, size: 44, color: AppColors.danger)),
                  Positioned(
                    left: 6,
                    top: 6,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                      decoration: BoxDecoration(color: AppColors.primary, borderRadius: BorderRadius.circular(5)),
                      child: Text(
                          list[i].side.isNotEmpty ? list[i].side.toUpperCase() : (list[i].isImage ? 'COPY ${i + 1}' : 'PDF'),
                          style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)),
                    ),
                  ),
                ]),
              ),
            ),
        ],
      ),
    ];
  }
}

String _sideLabel(IdFileMeta f) => f.side.isEmpty ? '' : ' - ${f.side}';

String _fileName(IdPerson p, IdFileMeta f, int n) {
  final kind = idKinds.where((k) => k.key == f.kind).firstOrNull?.label ?? f.kind;
  return '${IdSheet.safeName(p.owner.name)}_${IdSheet.safeName(kind)}${f.side.isEmpty ? '' : '_${f.side}'}_$n${IdSheet.extFor(f)}';
}

class _Thumb extends StatelessWidget {
  final IdFileMeta file;
  final BoxFit fit;
  const _Thumb({required this.file, this.fit = BoxFit.cover});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uint8List>(
      future: IdSheet.bytes(file),
      builder: (_, s) {
        if (s.hasError) return const Center(child: Icon(Icons.broken_image_outlined, color: AppColors.muted));
        if (!s.hasData) return const Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)));
        return Image.memory(s.data!, fit: fit, gaplessPlayback: true, cacheWidth: 600,
            errorBuilder: (_, __, ___) => const Center(child: Icon(Icons.broken_image_outlined, color: AppColors.muted)));
      },
    );
  }
}

/// Full-screen copy with pinch-zoom and share / save.
class IdCopyViewer extends StatelessWidget {
  final IdPerson person;
  final IdFileMeta file;
  final String title;
  const IdCopyViewer({super.key, required this.person, required this.file, required this.title});

  @override
  Widget build(BuildContext context) {
    Future<void> share() => runWithProgress(context, (set) async {
          final b = await IdSheet.bytes(file);
          await IdSheet.shareFiles([(name: _fileName(person, file, 1), data: b, mime: file.mime)],
              subject: '${person.owner.name} - $title');
        });
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [IconButton(tooltip: 'Share / save', icon: const Icon(Icons.ios_share), onPressed: share)],
      ),
      body: file.isImage
          ? FutureBuilder<Uint8List>(
              future: IdSheet.bytes(file),
              builder: (_, s) => !s.hasData
                  ? const Center(child: CircularProgressIndicator())
                  : InteractiveViewer(maxScale: 6, child: Center(child: Image.memory(s.data!, fit: BoxFit.contain))),
            )
          : Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.picture_as_pdf, size: 70, color: Colors.white70),
                const SizedBox(height: 12),
                Text(file.name, style: const TextStyle(color: Colors.white)),
                const SizedBox(height: 16),
                FilledButton.icon(
                  style: FilledButton.styleFrom(minimumSize: const Size(160, 46)),
                  onPressed: share,
                  icon: const Icon(Icons.open_in_new),
                  label: const Text('Open / share PDF'),
                ),
              ]),
            ),
    );
  }
}
