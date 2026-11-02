import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/boq.dart';
import '../../services/inv_reports.dart';
import '../../widgets/common.dart';
import 'report_editor.dart';

/// BOQs pushed by admin to projects / sites: the ones for the current site first, then all.
class BoqListScreen extends StatefulWidget {
  final AppUser me;
  final AttendanceSession? session;
  const BoqListScreen({super.key, required this.me, this.session});
  @override
  State<BoqListScreen> createState() => _BoqListScreenState();
}

class _BoqListScreenState extends State<BoqListScreen> {
  String _projectId = '';
  String _q = '';

  @override
  void initState() {
    super.initState();
    final s = widget.session;
    if (s != null) {
      Boqs.projectOfSite(s.siteId).then((p) {
        if (mounted) setState(() => _projectId = p);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.session;
    return Scaffold(
      appBar: AppBar(title: const Text('Project BOQ')),
      body: StreamBuilder<List<Boq>>(
        stream: Boqs.stream(),
        builder: (c, snap) {
          if (snap.hasError) {
            return EmptyState(icon: Icons.error_outline, title: 'Could not load BOQs', message: '${snap.error}');
          }
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          var all = snap.data!;
          if (_q.isNotEmpty) {
            all = all
                .where((b) => '${b.title} ${b.ref} ${b.client} ${b.target} ${b.items.map((i) => i.name).join(' ')}'.toLowerCase().contains(_q))
                .toList();
          }
          final mine = s == null ? <Boq>[] : all.where((b) => b.appliesTo(s.siteId, _projectId)).toList();
          final rest = all.where((b) => !mine.contains(b)).toList();
          return ListView(padding: const EdgeInsets.fromLTRB(12, 10, 12, 30), children: [
            TextField(
              decoration: const InputDecoration(isDense: true, prefixIcon: Icon(Icons.search), hintText: 'Search BOQ, project, client, item…'),
              onChanged: (v) => setState(() => _q = v.trim().toLowerCase()),
            ),
            const SizedBox(height: 10),
            if (snap.data!.isEmpty)
              const EmptyState(
                  icon: Icons.checklist_rtl, title: 'No BOQ yet', message: 'Admin pushes the BOQ for a project or site from the web dashboard (BOQ page).'),
            if (mine.isNotEmpty) ...[
              _head('For ${s!.siteName}'),
              for (final b in mine) BoqTile(b: b, highlight: true, onTap: () => _open(b)),
              const SizedBox(height: 8),
            ],
            if (rest.isNotEmpty) ...[
              if (mine.isNotEmpty) _head('Other projects & sites'),
              for (final b in rest) BoqTile(b: b, onTap: () => _open(b)),
            ],
          ]);
        },
      ),
    );
  }

  Widget _head(String t) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 6, 4, 6),
        child: Text(t.toUpperCase(), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: AppColors.muted, letterSpacing: .4)),
      );

  void _open(Boq b) =>
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => BoqViewScreen(me: widget.me, boq: b, session: widget.session)));
}

class BoqTile extends StatelessWidget {
  final Boq b;
  final bool highlight;
  final VoidCallback onTap;
  final IconData trailing;
  const BoqTile({super.key, required this.b, required this.onTap, this.highlight = false, this.trailing = Icons.chevron_right});
  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: highlight ? const Color(0xFFFFF4E2) : null,
      child: ListTile(
        onTap: onTap,
        leading: CircleAvatar(
          backgroundColor: AppColors.primary.withValues(alpha: 0.15),
          child: const Icon(Icons.checklist_rtl, color: AppColors.primary, size: 20),
        ),
        title: Text(b.title, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text(
          [b.target, '${b.lines.length} items', if (b.client.isNotEmpty) b.client, if (b.ref.isNotEmpty) 'Ref ${b.ref}'].join(' · '),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 12.5),
        ),
        trailing: Icon(trailing),
      ),
    );
  }
}

/// One BOQ: its lines, print / share, and "make a report from it".
class BoqViewScreen extends StatefulWidget {
  final AppUser me;
  final Boq boq;
  final AttendanceSession? session;
  const BoqViewScreen({super.key, required this.me, required this.boq, this.session});
  @override
  State<BoqViewScreen> createState() => _BoqViewScreenState();
}

class _BoqViewScreenState extends State<BoqViewScreen> {
  bool _busy = false;

  String get _siteName => widget.session?.siteName ?? '';

  Future<void> _run(Future<void> Function() f) async {
    setState(() => _busy = true);
    try {
      await f();
    } catch (e) {
      if (mounted) showSnack(context, 'Could not make the PDF: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.boq;
    // running item numbers (headings are not counted)
    final nos = <int>[];
    var c = 0;
    for (final i in b.items) {
      nos.add(i.isHeading ? 0 : ++c);
    }
    return Scaffold(
      appBar: AppBar(
        title: Text(b.title),
        actions: [
          IconButton(
            tooltip: 'Print',
            onPressed: _busy ? null : () => _run(() => BoqPdf.printIt(b, siteName: _siteName)),
            icon: const Icon(Icons.print_outlined),
          ),
          IconButton(
            tooltip: 'Share PDF',
            onPressed: _busy ? null : () => _run(() => BoqPdf.share(b, siteName: _siteName)),
            icon: const Icon(Icons.share_outlined),
          ),
        ],
      ),
      body: ListView(padding: const EdgeInsets.fromLTRB(12, 10, 12, 100), children: [
        if (_busy) const LinearProgressIndicator(),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _kv(Icons.place_outlined, b.target),
              if (b.client.isNotEmpty) _kv(Icons.business_outlined, b.client),
              if (b.ref.isNotEmpty) _kv(Icons.tag, 'Ref ${b.ref}'),
              _kv(Icons.update, 'Updated ${b.updatedAt == null ? '—' : fmtDateTime(b.updatedAt!)}${b.updatedBy.isNotEmpty ? ' by ${b.updatedBy}' : ''}'),
              if (b.notes.isNotEmpty) ...[
                const Divider(height: 18),
                Text(b.notes, style: const TextStyle(fontSize: 13.5)),
              ],
            ]),
          ),
        ),
        const SizedBox(height: 6),
        Card(
          clipBehavior: Clip.antiAlias,
          child: Column(children: [
            for (var k = 0; k < b.items.length; k++)
              if (b.items[k].isHeading)
                Container(
                  width: double.infinity,
                  color: const Color(0xFFFFF4E2),
                  padding: const EdgeInsets.fromLTRB(14, 8, 14, 8),
                  child: Text(b.items[k].section.toUpperCase(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5, letterSpacing: .3)),
                )
              else
                Builder(builder: (_) {
                  final i = b.items[k];
                  return Container(
                    decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0xFFEDEBE6)))),
                    padding: const EdgeInsets.fromLTRB(10, 8, 14, 8),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      SizedBox(width: 26, child: Text('${nos[k]}', style: const TextStyle(color: AppColors.muted, fontSize: 12.5))),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(i.name.isNotEmpty ? i.name : i.desc, style: const TextStyle(fontWeight: FontWeight.w700)),
                          if (i.name.isNotEmpty && i.desc.isNotEmpty) Text(i.desc, style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                          if (i.section.isNotEmpty) Text(i.section, style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
                        ]),
                      ),
                      const SizedBox(width: 8),
                      Text('${i.qtyText} ${i.unit}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    ]),
                  );
                }),
            if (b.items.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('No lines')),
          ]),
        ),
      ]),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
          child: FilledButton.icon(
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => ReportEditor(me: widget.me, kind: kindService, session: widget.session, boq: b))),
            icon: const Icon(Icons.note_add_outlined),
            label: const Text('Make report from this BOQ'),
          ),
        ),
      ),
    );
  }

  Widget _kv(IconData i, String t) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(i, size: 16, color: AppColors.muted),
          const SizedBox(width: 8),
          Expanded(child: Text(t, style: const TextStyle(fontSize: 13.5))),
        ]),
      );
}

/// Bottom sheet to choose a BOQ (the ones for [siteId]'s site / project first).
Future<Boq?> pickBoq(BuildContext context, {String siteId = '', String siteName = ''}) async {
  final projectId = await Boqs.projectOfSite(siteId);
  if (!context.mounted) return null;
  return showModalBottomSheet<Boq>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (c) => _BoqPicker(siteId: siteId, siteName: siteName, projectId: projectId),
  );
}

class _BoqPicker extends StatefulWidget {
  final String siteId, siteName, projectId;
  const _BoqPicker({required this.siteId, required this.siteName, required this.projectId});
  @override
  State<_BoqPicker> createState() => _BoqPickerState();
}

class _BoqPickerState extends State<_BoqPicker> {
  String _q = '';
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.8,
      child: Column(children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Text('Load lines from a project BOQ', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: TextField(
            decoration: const InputDecoration(isDense: true, prefixIcon: Icon(Icons.search), hintText: 'BOQ, project, client…'),
            onChanged: (v) => setState(() => _q = v.trim().toLowerCase()),
          ),
        ),
        Expanded(
          child: StreamBuilder<List<Boq>>(
            stream: Boqs.stream(),
            builder: (c, snap) {
              if (snap.hasError) return Padding(padding: const EdgeInsets.all(16), child: Text('Could not load: ${snap.error}'));
              if (!snap.hasData) return const Center(child: CircularProgressIndicator());
              var l = snap.data!;
              if (_q.isNotEmpty) l = l.where((b) => '${b.title} ${b.ref} ${b.client} ${b.target}'.toLowerCase().contains(_q)).toList();
              final mine = l.where((b) => b.appliesTo(widget.siteId, widget.projectId)).toList();
              final rest = l.where((b) => !mine.contains(b)).toList();
              if (l.isEmpty) {
                return const EmptyState(icon: Icons.checklist_rtl, title: 'No BOQ found', message: 'Admin pushes BOQs from the web dashboard.');
              }
              return ListView(padding: const EdgeInsets.fromLTRB(12, 0, 12, 20), children: [
                if (mine.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 0, 4, 6),
                    child: Text('FOR ${widget.siteName.toUpperCase()}',
                        style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: AppColors.muted)),
                  ),
                for (final b in mine) BoqTile(b: b, highlight: true, trailing: Icons.download_outlined, onTap: () => Navigator.pop(context, b)),
                for (final b in rest) BoqTile(b: b, trailing: Icons.download_outlined, onTap: () => Navigator.pop(context, b)),
              ]);
            },
          ),
        ),
      ]),
    );
  }
}
