import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/inv_reports.dart';
import '../../widgets/common.dart';
import 'report_editor.dart';
import 'report_view.dart';

/// Service reports, call-out reports and delivery notes — the same list as LLCT Invoicing.
class ReportsScreen extends StatefulWidget {
  final AppUser me;
  final AttendanceSession? session;
  const ReportsScreen({super.key, required this.me, this.session});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  InvAccess? _acc;
  String _q = '';
  bool _mine = false;

  @override
  void initState() {
    super.initState();
    InvAccess.load(widget.me).then((a) {
      if (mounted) setState(() => _acc = a);
    });
  }

  Future<void> _new() async {
    final k = await showModalBottomSheet<ReportKind>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          for (final k in reportKinds)
            ListTile(
              leading: Icon(k == kindDelivery ? Icons.local_shipping_outlined : (k == kindService ? Icons.build_circle_outlined : Icons.support_agent)),
              title: Text(k.title, style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text(k == kindDelivery
                  ? 'Goods delivered, serials, receiver signature'
                  : (k == kindService ? 'Technician visit, work done, customer sign-off' : 'Call-out attended, customer sign-off')),
              onTap: () => Navigator.pop(c, k),
            ),
          const SizedBox(height: 8),
        ]),
      ),
    );
    if (k == null || !mounted) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => ReportEditor(me: widget.me, kind: k, session: widget.session)));
  }

  @override
  Widget build(BuildContext context) {
    final acc = _acc;
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Service & delivery reports'),
          bottom: const TabBar(
            labelColor: AppColors.primaryDark,
            indicatorColor: AppColors.accent,
            tabs: [Tab(text: 'Service'), Tab(text: 'Call-out'), Tab(text: 'Delivery')],
          ),
        ),
        floatingActionButton: acc != null && acc.makes
            ? FloatingActionButton.extended(
                backgroundColor: AppColors.accent,
                foregroundColor: AppColors.primaryDark,
                onPressed: _new,
                icon: const Icon(Icons.add),
                label: const Text('New report'))
            : null,
        body: acc == null
            ? const Center(child: CircularProgressIndicator())
            : !acc.any
                ? const EmptyState(
                    icon: Icons.lock_outline,
                    title: 'No access to reports',
                    message: 'Ask the admin to turn on your access in LLCT Invoicing → Staff & access (delivery notes).')
                : Column(children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
                      child: Row(children: [
                        Expanded(
                          child: TextField(
                            decoration: const InputDecoration(isDense: true, prefixIcon: Icon(Icons.search), hintText: 'Search number, client, site, serial'),
                            onChanged: (v) => setState(() => _q = v.trim().toLowerCase()),
                          ),
                        ),
                        if (acc.seesAll) ...[
                          const SizedBox(width: 8),
                          FilterChip(label: const Text('Mine'), selected: _mine, onSelected: (v) => setState(() => _mine = v)),
                        ],
                      ]),
                    ),
                    Expanded(
                      child: StreamBuilder<List<InvReport>>(
                        stream: InvReports.list(widget.me, acc),
                        builder: (c, snap) {
                          if (snap.hasError) {
                            return Padding(padding: const EdgeInsets.all(16), child: Text('Could not load reports: ${snap.error}', style: const TextStyle(color: AppColors.danger)));
                          }
                          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
                          var all = snap.data!;
                          if (_mine) all = all.where((r) => r.s('createdBy') == widget.me.id).toList();
                          if (_q.isNotEmpty) {
                            all = all.where((r) {
                              final serials = r.items.expand((i) => i['serials'] is List ? (i['serials'] as List).map((e) => '$e') : const <String>[]).join(' ');
                              return '${r.number} ${r.clientName} ${r.place} ${r.s('subject')} ${r.s('ref')} ${r.s('createdByName')} $serials'.toLowerCase().contains(_q);
                            }).toList();
                          }
                          return TabBarView(children: [
                            for (final k in [kindService, kindCallout, kindDelivery]) _list(all.where((r) => r.kind == k).toList(), k),
                          ]);
                        },
                      ),
                    ),
                  ]),
      ),
    );
  }

  Widget _list(List<InvReport> l, ReportKind k) {
    if (l.isEmpty) return EmptyState(icon: Icons.description_outlined, title: 'No ${k.title.toLowerCase()}s yet');
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 90),
      itemCount: l.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (c, i) {
        final r = l[i];
        final d = DateTime.tryParse(r.date);
        return Material(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          child: ListTile(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ReportView(me: widget.me, id: r.id))),
            title: Text(r.clientName.isEmpty ? '(no client)' : r.clientName, style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text(
                '${r.number} · ${d == null ? r.date : fmtDateShort(d)}${r.place.isNotEmpty ? '\n${r.place.split('\n').first}' : ''}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12.5)),
            isThreeLine: r.place.isNotEmpty,
            trailing: r.signed
                ? const Icon(Icons.check_circle, color: AppColors.success)
                : const Icon(Icons.draw_outlined, color: AppColors.warning),
          ),
        );
      },
    );
  }
}
