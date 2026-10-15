import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../widgets/common.dart';
import '../../widgets/month_view.dart';

class HistoryTab extends StatefulWidget {
  final AppUser me;
  const HistoryTab({super.key, required this.me});

  @override
  State<HistoryTab> createState() => _HistoryTabState();
}

class _HistoryTabState extends State<HistoryTab> {
  DateTime _month = startOfMonth(DateTime.now());

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
      children: [
        MonthSwitcher(month: _month, onChanged: (m) => setState(() => _month = m)),
        const SizedBox(height: 12),
        MonthAttendanceView(
          key: ValueKey('${widget.me.id}-${monthKey(_month)}'),
          user: widget.me,
          month: _month,
          header: (summary, offDays) => _OffDayPanel(
            me: widget.me,
            month: _month,
            summary: summary,
            offDays: offDays,
          ),
        ),
      ],
    );
  }
}

/// Off-day quota and requests for the selected month.
class _OffDayPanel extends StatelessWidget {
  final AppUser me;
  final DateTime month;
  final MonthSummary summary;
  final List<OffDay> offDays;
  const _OffDayPanel(
      {required this.me, required this.month, required this.summary, required this.offDays});

  int get _weeklyCount =>
      summary.days.where((d) => me.isWeeklyOff(d.day)).length;

  int get _used =>
      _weeklyCount + offDays.where((o) => o.status != 'rejected').length;

  Future<void> _request(BuildContext context) async {
    if (_used >= me.monthlyOffQuota) {
      showSnack(context,
          'You have already used all ${me.monthlyOffQuota} off days for ${fmtMonth(month)}.',
          error: true);
      return;
    }
    final now = DateTime.now();
    final first = DateTime(month.year, month.month, 1);
    final last = DateTime(month.year, month.month, daysInMonth(month));
    final today = DateTime(now.year, now.month, now.day);
    final start = first.isBefore(today) ? today : first;
    if (start.isAfter(last)) {
      showSnack(context, 'This month is over — pick a later month.', error: true);
      return;
    }
    final taken = offDays.where((o) => o.status != 'rejected').map((o) => o.date).toSet();
    bool selectable(DateTime d) => !me.isWeeklyOff(d) && !taken.contains(dateKey(d));
    // showDatePicker asserts that initialDate satisfies selectableDayPredicate.
    var initial = start;
    while (!initial.isAfter(last) && !selectable(initial)) {
      initial = DateTime(initial.year, initial.month, initial.day + 1);
    }
    if (initial.isAfter(last)) {
      showSnack(context, 'No days left to request in ${fmtMonth(month)}.', error: true);
      return;
    }
    final picked = await showDatePicker(
      context: context,
      firstDate: start,
      lastDate: last,
      initialDate: initial,
      helpText: 'Choose your off day',
      selectableDayPredicate: selectable,
    );
    if (picked == null || !context.mounted) return;
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('Off day on ${fmtDate(picked)}'),
        content: TextField(
          controller: reason,
          decoration: const InputDecoration(labelText: 'Reason (optional)'),
          maxLines: 2,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(90, 40)),
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Request'),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await Db.requestOffDay(me, picked, reason.text.trim());
      if (context.mounted) showSnack(context, 'Off-day request sent to management.');
    } catch (e) {
      if (context.mounted) showSnack(context, 'Failed: $e', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final quota = me.monthlyOffQuota;
    final used = _used;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Icon(Icons.beach_access_outlined, color: AppColors.warning),
            const SizedBox(width: 8),
            const Expanded(
              child: Text('Off days',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
            ),
            Text('$used / $quota used',
                style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: used > quota ? AppColors.danger : AppColors.ink)),
          ]),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(
              value: quota == 0 ? 0 : (used / quota).clamp(0, 1).toDouble(),
              minHeight: 8,
              color: AppColors.warning,
              backgroundColor: const Color(0xFFF1E6D4),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            me.weeklyOffDays.isEmpty
                ? 'Flexible: choose any $quota days this month.'
                : 'Weekly off: ${me.offDayLabel} ($_weeklyCount this month).',
            style: const TextStyle(color: AppColors.muted, fontSize: 13),
          ),
          if (offDays.isNotEmpty) ...[
            const SizedBox(height: 8),
            ...offDays.map((o) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(children: [
                    const Icon(Icons.event, size: 16, color: AppColors.muted),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        '${fmtDate(parseDateKey(o.date))}${o.reason.isEmpty ? '' : ' · ${o.reason}'}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 13),
                      ),
                    ),
                    Pill.status(o.status),
                    if (o.status == 'pending')
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        tooltip: 'Cancel request',
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () async {
                          if (await confirm(context, 'Cancel request?',
                              'Cancel off-day request for ${o.date}?')) {
                            await Db.deleteOffDay(o.id);
                          }
                        },
                      ),
                  ]),
                )),
          ],
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => _request(context),
            icon: const Icon(Icons.add),
            label: const Text('Request an off day'),
          ),
        ]),
      ),
    );
  }
}
