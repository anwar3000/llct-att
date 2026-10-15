import 'dart:async';

import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../core/utils.dart';
import '../models/models.dart';
import '../services/db.dart';
import 'common.dart';
import 'tiles.dart';

/// Monthly attendance for one employee: KPIs, colour calendar and day-by-day log.
/// Used by the employee History tab and the manager's employee detail screen.
class MonthAttendanceView extends StatefulWidget {
  final AppUser user;
  final DateTime month;
  final Widget Function(MonthSummary summary, List<OffDay> offDays)? header;
  final void Function(AttendanceSession s)? onSessionTap;

  const MonthAttendanceView({
    super.key,
    required this.user,
    required this.month,
    this.header,
    this.onSessionTap,
  });

  @override
  State<MonthAttendanceView> createState() => _MonthAttendanceViewState();
}

class _MonthAttendanceViewState extends State<MonthAttendanceView> {
  final List<StreamSubscription> _subs = [];
  List<AttendanceSession>? _sessions;
  List<OffDay> _offDays = [];
  Object? _error;

  @override
  void initState() {
    super.initState();
    final m = monthKey(widget.month);
    _subs.add(Db.sessionsForEmployeeMonth(widget.user.id, m).listen(
      (l) {
        if (mounted) setState(() => _sessions = l);
      },
      onError: (Object e) {
        if (mounted) setState(() => _error = e);
      },
    ));
    _subs.add(Db.offDaysForEmployeeMonth(widget.user.id, m).listen((l) {
      if (mounted) setState(() => _offDays = l);
    }));
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
    if (_error != null) {
      return Text('Error: $_error', style: const TextStyle(color: AppColors.danger));
    }
    final sessions = _sessions;
    if (sessions == null) {
      return const Padding(
        padding: EdgeInsets.all(32),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    final summary = MonthSummary.build(
      month: widget.month,
      user: widget.user,
      sessions: sessions,
      offDays: _offDays,
    );
    final workedDays = summary.days.where((d) => d.sessions.isNotEmpty).toList().reversed.toList();
    final flagged = sessions.where((s) => s.flagged).length;

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      StatGrid(children: [
        StatTile(
            label: 'Total work time',
            value: fmtDuration(summary.totalTime),
            icon: Icons.timer_outlined,
            sub: 'Avg ${fmtDuration(summary.avgPerDay)} / day'),
        StatTile(
            label: 'Days worked',
            value: '${summary.workedDays}',
            icon: Icons.event_available,
            color: AppColors.success,
            sub: '${sessions.length} check-ins'),
        StatTile(
            label: 'Off days',
            value: '${summary.offDays}',
            icon: Icons.beach_access_outlined,
            color: AppColors.warning,
            sub: 'Quota ${summary.quota}'),
        StatTile(
            label: 'Absent',
            value: '${summary.absentDays}',
            icon: Icons.event_busy_outlined,
            color: AppColors.danger,
            sub: flagged > 0 ? '$flagged flagged check-ins' : 'No flags'),
      ]),
      if (widget.header != null) ...[
        const SizedBox(height: 12),
        widget.header!(summary, _offDays),
      ],
      const SizedBox(height: 12),
      _Calendar(summary: summary, onDayTap: (d) => _showDay(context, d)),
      const SectionTitle('Daily log'),
      if (workedDays.isEmpty)
        const Card(
          child: EmptyState(
              icon: Icons.history, title: 'No attendance recorded this month'),
        )
      else
        ...workedDays.map((d) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _DayCard(day: d, onSessionTap: widget.onSessionTap),
            )),
    ]);
  }

  void _showDay(BuildContext context, DaySummary d) {
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(fmtDate(d.day),
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            _kindPill(d.kind),
            const SizedBox(height: 10),
            if (d.sessions.isEmpty)
              const EmptyState(icon: Icons.fingerprint, title: 'No check-ins on this day')
            else ...[
              ...d.sessions.map((s) => SessionTile(s,
                  onTap: widget.onSessionTap == null
                      ? null
                      : () {
                          Navigator.pop(c);
                          widget.onSessionTap!(s);
                        })),
              const Divider(),
              Row(children: [
                const Text('Total', style: TextStyle(fontWeight: FontWeight.w700)),
                const Spacer(),
                Text(fmtDuration(d.total),
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              ]),
            ],
          ]),
        ),
      ),
    );
  }
}

Widget _kindPill(DayKind k) {
  switch (k) {
    case DayKind.worked:
      return const Pill('Present', color: AppColors.success);
    case DayKind.today:
      return const Pill('Today', color: AppColors.info);
    case DayKind.off:
      return const Pill('Off day', color: AppColors.warning);
    case DayKind.absent:
      return const Pill('Absent', color: AppColors.danger);
    case DayKind.upcoming:
      return const Pill('Upcoming', color: AppColors.muted);
    case DayKind.beforeJoin:
      return const Pill('Before joining', color: AppColors.muted);
  }
}

class _DayCard extends StatelessWidget {
  final DaySummary day;
  final void Function(AttendanceSession s)? onSessionTap;
  const _DayCard({required this.day, this.onSessionTap});

  @override
  Widget build(BuildContext context) {
    final first = day.sessions.first.checkIn;
    final last = day.sessions.last.checkOut;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 14),
          leading: Container(
            width: 44,
            padding: const EdgeInsets.symmetric(vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text('${day.day.day}',
                  style: const TextStyle(
                      fontWeight: FontWeight.w800, fontSize: 16, color: AppColors.primary)),
              Text(weekdayShort[day.day.weekday]!,
                  style: const TextStyle(fontSize: 10.5, color: AppColors.primary)),
            ]),
          ),
          title: Text(fmtDuration(day.total),
              style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text(
            '${fmtTime(first)} – ${last == null ? 'now' : fmtTime(last)} · '
            '${day.sessions.length} site${day.sessions.length == 1 ? '' : 's'}'
            '${day.sessions.any((s) => s.flagged) ? ' · ⚠ flagged' : ''}',
            style: const TextStyle(fontSize: 12.5),
          ),
          childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
          children: day.sessions
              .map((s) => SessionTile(s,
                  onTap: onSessionTap == null ? null : () => onSessionTap!(s)))
              .toList(),
        ),
      ),
    );
  }
}

class _Calendar extends StatelessWidget {
  final MonthSummary summary;
  final void Function(DaySummary) onDayTap;
  const _Calendar({required this.summary, required this.onDayTap});

  Color _bg(DayKind k) {
    switch (k) {
      case DayKind.worked:
        return AppColors.success;
      case DayKind.off:
        return AppColors.warning;
      case DayKind.absent:
        return AppColors.danger;
      case DayKind.today:
        return AppColors.info;
      case DayKind.upcoming:
      case DayKind.beforeJoin:
        return const Color(0xFFE3E8EB);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lead = summary.days.first.day.weekday - 1; // Monday-first grid
    final cells = <Widget>[
      for (final w in [1, 2, 3, 4, 5, 6, 7])
        Center(
          child: Text(weekdayShort[w]!.substring(0, 1),
              style: const TextStyle(
                  fontSize: 12, color: AppColors.muted, fontWeight: FontWeight.w600)),
        ),
      for (var i = 0; i < lead; i++) const SizedBox.shrink(),
      for (final d in summary.days)
        GestureDetector(
          onTap: () => onDayTap(d),
          child: Container(
            margin: const EdgeInsets.all(2.5),
            decoration: BoxDecoration(
              color: _bg(d.kind).withValues(
                  alpha: d.kind == DayKind.upcoming || d.kind == DayKind.beforeJoin ? 0.5 : 0.18),
              borderRadius: BorderRadius.circular(9),
              border: d.kind == DayKind.today
                  ? Border.all(color: AppColors.info, width: 2)
                  : null,
            ),
            alignment: Alignment.center,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text('${d.day.day}',
                  style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                      color: d.kind == DayKind.upcoming || d.kind == DayKind.beforeJoin
                          ? AppColors.muted
                          : _bg(d.kind))),
              if (d.sessions.isNotEmpty)
                Text('${(d.total.inMinutes / 60).toStringAsFixed(1)}h',
                    style: TextStyle(fontSize: 9.5, color: _bg(d.kind))),
            ]),
          ),
        ),
    ];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(children: [
          GridView.count(
            crossAxisCount: 7,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            childAspectRatio: 1,
            children: cells,
          ),
          const SizedBox(height: 8),
          Wrap(spacing: 12, runSpacing: 4, children: [
            _legend('Present', AppColors.success),
            _legend('Off', AppColors.warning),
            _legend('Absent', AppColors.danger),
            _legend('Today', AppColors.info),
          ]),
        ]),
      ),
    );
  }

  Widget _legend(String t, Color c) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(
                color: c.withValues(alpha: 0.35), borderRadius: BorderRadius.circular(3))),
        const SizedBox(width: 4),
        Text(t, style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
      ]);
}
