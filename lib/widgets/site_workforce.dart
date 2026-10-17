import 'dart:async';

import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../core/utils.dart';
import '../models/models.dart';
import '../services/db.dart';
import 'common.dart';

const kStaffColor = Color(0xFF3A7BD5);
const kExtColor = AppColors.accentDark;

/// Everyone who worked at a site this month — staff (blue) and external workers (orange),
/// with subtotals and a consolidated total.
class SiteWorkforceCard extends StatefulWidget {
  final String siteId;
  const SiteWorkforceCard({super.key, required this.siteId});

  @override
  State<SiteWorkforceCard> createState() => _SiteWorkforceCardState();
}

class _Person {
  final String name, sub;
  final bool ext;
  final Set<String> days = {};
  Duration time = Duration.zero;
  bool onSite = false;
  _Person(this.name, this.sub, this.ext);
}

class _SiteWorkforceCardState extends State<SiteWorkforceCard> {
  final _subs = <StreamSubscription>[];
  List<AttendanceSession> _sessions = [];
  List<WorkerEntry> _entries = [];
  String _range = 'month'; // today | month | all

  @override
  void initState() {
    super.initState();
    _subs.add(Db.siteSessionsAll(widget.siteId).listen((l) {
      if (mounted) setState(() => _sessions = l);
    }, onError: (_) {}));
    _subs.add(Db.siteWorkersAll(widget.siteId).listen((l) {
      if (mounted) setState(() => _entries = l);
    }, onError: (_) {}));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final today = dateKey(DateTime.now());
    final month = monthKey(DateTime.now());
    bool inRange(String d) => _range == 'all' || (_range == 'today' ? d == today : d.startsWith(month));
    // Total to date (all time), staff + external; open check-ins count up to now.
    final allStaff = _sessions.fold(Duration.zero, (a, s) => a + s.worked());
    final allExt = _entries.fold(Duration.zero, (a, e) => a + e.worked());
    final allDays = {..._sessions.map((s) => s.date), ..._entries.map((e) => e.date)}..remove('');
    final firstDay = allDays.isEmpty ? null : (allDays.toList()..sort()).first;
    final people = <String, _Person>{};
    for (final s in _sessions.where((s) => inRange(s.date))) {
      final p = people.putIfAbsent('s${s.employeeId}', () => _Person(s.employeeName, 'Staff', false));
      p.days.add(s.date);
      p.time += s.worked();
      if (s.isOpen) p.onSite = true;
    }
    for (final e in _entries.where((e) => inRange(e.date))) {
      final p = people.putIfAbsent('w${e.workerId}',
          () => _Person(e.workerName, [e.company, e.trade].where((x) => x.isNotEmpty).join(' · ').ifBlank('External'), true));
      p.days.add(e.date);
      p.time += e.worked();
      if (e.open) p.onSite = true;
    }
    final list = people.values.toList()
      ..sort((a, b) => a.ext == b.ext ? b.time.compareTo(a.time) : (a.ext ? 1 : -1));
    final staff = list.where((p) => !p.ext).toList();
    final ext = list.where((p) => p.ext).toList();
    Duration sum(List<_Person> l) => l.fold(Duration.zero, (a, p) => a + p.time);
    final staffT = sum(staff), extT = sum(ext), total = staffT + extT;

    Widget stat(String label, String value, String sub, Color c) => Expanded(
          child: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: c.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label, style: TextStyle(fontSize: 11.5, color: c, fontWeight: FontWeight.w700)),
              const SizedBox(height: 2),
              Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: c)),
              Text(sub, style: const TextStyle(fontSize: 11, color: AppColors.muted)),
            ]),
          ),
        );

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              gradient: const LinearGradient(colors: [AppColors.primaryDark, AppColors.primary]),
              borderRadius: BorderRadius.circular(14),
              border: const Border(bottom: BorderSide(color: AppColors.accent, width: 3)),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Total working hours to date',
                  style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w600)),
              Text(fmtDuration(allStaff + allExt),
                  style: const TextStyle(color: AppColors.accent, fontSize: 28, fontWeight: FontWeight.w800)),
              Text(
                'Staff ${fmtDuration(allStaff)} · External ${fmtDuration(allExt)}'
                '${firstDay == null ? '' : ' · since $firstDay'} · ${allDays.length} day${allDays.length == 1 ? '' : 's'}',
                style: const TextStyle(color: Colors.white70, fontSize: 12),
              ),
            ]),
          ),
          Row(children: [
            const Expanded(
                child: Text('Workforce', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
            SegmentedButton<String>(
              showSelectedIcon: false,
              style: const ButtonStyle(visualDensity: VisualDensity.compact),
              segments: const [
                ButtonSegment(value: 'today', label: Text('Today')),
                ButtonSegment(value: 'month', label: Text('Month')),
                ButtonSegment(value: 'all', label: Text('All')),
              ],
              selected: {_range},
              onSelectionChanged: (v) => setState(() => _range = v.first),
            ),
          ]),
          const SizedBox(height: 10),
          Row(children: [
            stat('TOTAL', '${list.length}', fmtDuration(total), AppColors.primary),
            const SizedBox(width: 8),
            stat('STAFF', '${staff.length}', fmtDuration(staffT), kStaffColor),
            const SizedBox(width: 8),
            stat('EXTERNAL', '${ext.length}', fmtDuration(extT), kExtColor),
          ]),
          if (total > Duration.zero) ...[
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: Row(children: [
                Expanded(flex: staffT.inMinutes.clamp(1, 1 << 30), child: Container(height: 8, color: kStaffColor)),
                if (extT.inMinutes > 0)
                  Expanded(flex: extT.inMinutes, child: Container(height: 8, color: kExtColor)),
              ]),
            ),
          ],
          const SizedBox(height: 8),
          if (list.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('Nobody has worked here in this period.', style: TextStyle(color: AppColors.muted)),
            )
          else
            for (final p in list)
              Container(
                margin: const EdgeInsets.only(top: 6),
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                decoration: BoxDecoration(
                  color: p.ext ? kExtColor.withValues(alpha: 0.06) : kStaffColor.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(10),
                  border: Border(left: BorderSide(color: p.ext ? kExtColor : kStaffColor, width: 4)),
                ),
                child: Row(children: [
                  Avatar(p.name, size: 32, ring: p.ext ? kExtColor : kStaffColor),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(p.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text('${p.sub} · ${p.days.length} day${p.days.length == 1 ? '' : 's'}',
                          style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                    ]),
                  ),
                  Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text(fmtDuration(p.time), style: const TextStyle(fontWeight: FontWeight.w800)),
                    if (p.onSite) const Pill('On site', color: AppColors.success),
                  ]),
                ]),
              ),
        ]),
      ),
    );
  }
}

extension on String {
  String ifBlank(String other) => isEmpty ? other : this;
}
