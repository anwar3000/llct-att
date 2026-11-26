import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/attendance_sheet.dart';
import '../../services/db.dart';
import '../../widgets/common.dart';
import '../../widgets/site_workforce.dart' show kExtColor;
import 'admin_live.dart';

/// Every registered external worker (not only today's), with today's status. Tap → details, history and driver setting.
class ExternalWorkersList extends StatefulWidget {
  final AppUser me;
  final AdminLive live;
  final String query;
  const ExternalWorkersList({super.key, required this.me, required this.live, this.query = ''});
  @override
  State<ExternalWorkersList> createState() => _ExternalWorkersListState();
}

class _ExternalWorkersListState extends State<ExternalWorkersList> {
  StreamSubscription? _sub;
  List<ExtWorker>? _all;
  Object? _err;
  bool _inactive = false;

  @override
  void initState() {
    super.initState();
    _sub = Db.allWorkersStream().listen((l) {
      if (mounted) setState(() => _all = l);
    }, onError: (e) {
      if (mounted) setState(() => _err = e);
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_err != null) {
      return Card(child: Padding(padding: const EdgeInsets.all(16), child: Text('Could not load workers: $_err', style: const TextStyle(color: AppColors.danger))));
    }
    final all = _all;
    if (all == null) return const Padding(padding: EdgeInsets.all(30), child: Center(child: CircularProgressIndicator()));
    final today = {for (final x in widget.live.externalToday) x.e.workerId: x};
    final q = widget.query.toLowerCase();
    final list = all.where((w) => (_inactive || w.active) &&
        (q.isEmpty || '${w.name} ${w.phone} ${w.company} ${w.trade}'.toLowerCase().contains(q))).toList()
      ..sort((a, b) {
        // On site first, then worked today, then by name.
        int rank(ExtWorker w) => today[w.id]?.onSite == true ? 0 : today.containsKey(w.id) ? 1 : 2;
        final r = rank(a).compareTo(rank(b));
        return r != 0 ? r : a.name.toLowerCase().compareTo(b.name.toLowerCase());
      });
    final inactiveCount = all.where((w) => !w.active).length;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(4, 4, 4, 8),
        child: Row(children: [
          Expanded(
            child: Text('External workers · ${list.length} · ${today.values.where((x) => x.onSite).length} on site now',
                style: const TextStyle(color: kExtColor, fontWeight: FontWeight.w800)),
          ),
          if (inactiveCount > 0)
            FilterChip(
              label: Text('Show inactive ($inactiveCount)'),
              selected: _inactive,
              onSelected: (v) => setState(() => _inactive = v),
            ),
        ]),
      ),
      if (list.isEmpty) const Card(child: EmptyState(icon: Icons.engineering_outlined, title: 'No external workers')),
      for (final w in list)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Card(
            color: today.containsKey(w.id) ? const Color(0xFFFFFAF2) : null,
            child: ListTile(
              onTap: () => showWorkerSheet(context, w, widget.me, widget.live),
              leading: Avatar(w.name, ring: w.active ? kExtColor : AppColors.muted),
              title: Row(children: [
                Flexible(child: Text(w.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700))),
                if (w.isDriver) ...[const SizedBox(width: 6), const Pill('Driver', color: Color(0xFF7B4FC9))],
              ]),
              subtitle: Text(
                [
                  if (w.subtitle.isNotEmpty) w.subtitle,
                  if (today[w.id] != null) '${today[w.id]!.e.siteName} · with ${today[w.id]!.e.employeeName}',
                  if (!w.active) 'Inactive',
                ].join(' · '),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              trailing: today[w.id] == null
                  ? const Icon(Icons.chevron_right)
                  : Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                      Pill(today[w.id]!.onSite ? 'On site' : 'Done', color: today[w.id]!.onSite ? AppColors.success : kExtColor),
                      const SizedBox(height: 4),
                      Text(fmtDuration(today[w.id]!.time), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                    ]),
            ),
          ),
        ),
    ]);
  }
}

/// Worker details: contact, this month's days / hours, recent attendance and (admin) active / driver settings.
void showWorkerSheet(BuildContext context, ExtWorker w, AppUser me, AdminLive live) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (c) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.75,
      maxChildSize: 0.95,
      builder: (c, scroll) => StreamBuilder<List<WorkerEntry>>(
        stream: Db.workerHistory(w.id),
        builder: (c, s) {
          final h = s.data ?? const <WorkerEntry>[];
          final month = monthKey(DateTime.now());
          final m = h.where((e) => e.date.startsWith(month)).toList();
          final days = m.map((e) => e.date).toSet().length;
          final mins = m.fold<Duration>(Duration.zero, (a, e) => a + e.worked());
          return ListView(controller: scroll, padding: const EdgeInsets.fromLTRB(20, 0, 20, 28), children: [
            Row(children: [
              Avatar(w.name, size: 48, ring: kExtColor),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(w.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                  if (w.subtitle.isNotEmpty) Text(w.subtitle, style: const TextStyle(color: AppColors.muted)),
                ]),
              ),
              if (w.phone.isNotEmpty)
                IconButton.filledTonal(
                  tooltip: 'Call ${w.phone}',
                  onPressed: () => launchUrl(Uri.parse('tel:${w.phone.replaceAll(' ', '')}')),
                  icon: const Icon(Icons.call),
                ),
            ]),
            const SizedBox(height: 14),
            Row(children: [
              _stat('Days this month', '$days'),
              const SizedBox(width: 8),
              _stat('Hours this month', fmtDuration(mins)),
              const SizedBox(width: 8),
              _stat('All records', '${h.length}'),
            ]),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46)),
              onPressed: () => _workerCard(c, w),
              icon: const Icon(Icons.picture_as_pdf_outlined),
              label: const Text('Report card (PDF)'),
            ),
            if (me.isManagement) ...[
              const SizedBox(height: 10),
              Card(
                child: Column(children: [
                  SwitchListTile(
                    title: const Text('Active', style: TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: const Text('Staff can choose him at check-in'),
                    value: w.active,
                    onChanged: (v) async {
                      await Db.updateWorker(w.id, {'active': v});
                      if (c.mounted) Navigator.pop(c);
                    },
                  ),
                  SwitchListTile(
                    title: const Text('Driver / transport provider', style: TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: const Text('Staff can choose him for rides; his charges go to his own account'),
                    value: w.isDriver,
                    onChanged: (v) async {
                      var vehicle = w.vehicle;
                      if (v) {
                        final t = TextEditingController(text: w.vehicle);
                        final ok = await showDialog<bool>(
                          context: c,
                          builder: (d) => AlertDialog(
                            title: const Text('Vehicle'),
                            content: TextField(controller: t, textCapitalization: TextCapitalization.characters,
                                decoration: const InputDecoration(labelText: 'Vehicle / plate no. (optional)')),
                            actions: [
                              TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
                              FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('SAVE')),
                            ],
                          ),
                        );
                        if (ok != true) return;
                        vehicle = t.text.trim();
                      }
                      await Db.updateWorker(w.id, {'isDriver': v, 'vehicle': vehicle});
                      if (c.mounted) Navigator.pop(c);
                    },
                  ),
                ]),
              ),
            ],
            const SizedBox(height: 10),
            const Text('Attendance', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 6),
            if (s.connectionState == ConnectionState.waiting && h.isEmpty)
              const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator())),
            if (s.hasError) Text('Could not load: ${s.error}', style: const TextStyle(color: AppColors.danger)),
            if (s.hasData && h.isEmpty) const Text('No attendance yet', style: TextStyle(color: AppColors.muted)),
            for (final e in h.take(60))
              Card(
                margin: const EdgeInsets.only(bottom: 6),
                child: ListTile(
                  dense: true,
                  title: Text('${fmtDate(e.checkIn)} · ${e.siteName}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${fmtTime(e.checkIn)} – ${e.checkOut == null ? (e.open ? 'on site' : '—') : fmtTime(e.checkOut!)} · with ${e.employeeName}'),
                  trailing: Text(fmtDuration(e.worked()), style: const TextStyle(fontWeight: FontWeight.w800)),
                ),
              ),
          ]);
        },
      ),
    ),
  );
}

Widget _stat(String l, String v) => Expanded(
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: kExtColor.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(l, style: const TextStyle(fontSize: 11, color: AppColors.muted)),
          FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(v, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
        ]),
      ),
    );

/// One worker's report card: pick this month, last month or dates.
Future<void> _workerCard(BuildContext context, ExtWorker w) async {
  final n = DateTime.now();
  final choice = await showModalBottomSheet<DateTimeRange>(
    context: context,
    showDragHandle: true,
    builder: (c) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(
            leading: const Icon(Icons.calendar_month),
            title: const Text('This month'),
            onTap: () => Navigator.pop(c, DateTimeRange(start: DateTime(n.year, n.month, 1), end: n))),
        ListTile(
            leading: const Icon(Icons.calendar_month_outlined),
            title: const Text('Last month'),
            onTap: () => Navigator.pop(c, DateTimeRange(start: DateTime(n.year, n.month - 1, 1), end: DateTime(n.year, n.month, 0)))),
        ListTile(
            leading: const Icon(Icons.date_range),
            title: const Text('Pick dates…'),
            onTap: () async {
              final r = await showDateRangePicker(
                  context: c, firstDate: DateTime(2023), lastDate: n, initialDateRange: DateTimeRange(start: DateTime(n.year, n.month, 1), end: n));
              if (c.mounted) Navigator.pop(c, r);
            }),
      ]),
    ),
  );
  if (choice == null) return;
  String k(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  String lbl(DateTime d) => '${d.day} ${const ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.month - 1]} ${d.year}';
  try {
    await AttendanceSheet.shareCards([SheetPerson(id: w.id, name: w.name, kind: 'external', sub: w.subtitle)],
        from: k(choice.start), to: k(choice.end), period: '${lbl(choice.start)} - ${lbl(choice.end)}');
  } catch (e) {
    if (context.mounted) showSnack(context, 'Could not make the report card: $e', error: true);
  }
}
