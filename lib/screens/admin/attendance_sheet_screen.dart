import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/attendance_sheet.dart';
import '../../services/db.dart';
import '../../widgets/common.dart';
import '../../widgets/site_workforce.dart' show kExtColor;
import 'admin_live.dart';

/// Pick staff and / or external workers and a period → attendance sheet PDF (days, site, in / out, daily and total hours).
class AttendanceSheetScreen extends StatefulWidget {
  final AppUser me;
  final AdminLive live;
  const AttendanceSheetScreen({super.key, required this.me, required this.live});
  @override
  State<AttendanceSheetScreen> createState() => _AttendanceSheetScreenState();
}

class _AttendanceSheetScreenState extends State<AttendanceSheetScreen> {
  String _period = 'month';
  String _kind = 'card';
  static const _kinds = [
    ('card', 'Report cards', 'One page per person (staff or external): totals and every date with site, in, out, hours', Icons.badge_outlined),
    ('sheet', 'Day-by-day sheet', 'Per person: date, site(s), first in, last out, daily hours, totals', Icons.view_agenda_outlined),
    ('log', 'Check-in log (detailed)', 'Every check-in / out with site, times, hours, GPS flags, who added the worker', Icons.list_alt),
    ('summary', 'Summary', 'One line per person: days, total and average hours, average start, sites, flags', Icons.summarize_outlined),
    ('register', 'Daily register (grid)', 'People × days with hours each day — payroll / labour supplier style', Icons.grid_on),
  ];
  DateTimeRange? _custom;
  final _picked = <String>{};
  String _q = '';
  List<ExtWorker> _workers = [];
  StreamSubscription? _sub;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _sub = Db.allWorkersStream().listen((l) {
      if (mounted) setState(() => _workers = l.where((w) => w.active).toList());
    }, onError: (_) {});
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  ({DateTime from, DateTime to}) _range() {
    final n = DateTime.now();
    switch (_period) {
      case 'last':
        return (from: DateTime(n.year, n.month - 1, 1), to: DateTime(n.year, n.month, 0));
      case '7':
        return (from: n.subtract(const Duration(days: 6)), to: n);
      case 'pick':
        if (_custom != null) return (from: _custom!.start, to: _custom!.end);
        return (from: DateTime(n.year, n.month, 1), to: n);
      default:
        return (from: DateTime(n.year, n.month, 1), to: n);
    }
  }

  String _label() {
    final r = _range();
    final f = DateFormat('d MMM yyyy');
    return '${f.format(r.from)} - ${f.format(r.to)}';
  }

  List<SheetPerson> get _staff => widget.live.users
      .where((u) => u.isEmployee && u.active && !u.driverOnly)
      .map((u) => SheetPerson(id: u.id, name: u.name, kind: 'staff', sub: u.designation))
      .toList()
    ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));

  List<SheetPerson> get _ext => _workers
      .map((w) => SheetPerson(id: w.id, name: w.name, kind: 'external', sub: w.subtitle))
      .toList();

  Future<void> _make() async {
    final people = [..._staff, ..._ext].where((p) => _picked.contains(p.id)).toList();
    if (people.isEmpty) {
      showSnack(context, 'Tick at least one person', error: true);
      return;
    }
    final r = _range();
    setState(() => _busy = true);
    try {
      await AttendanceSheet.shareReport(_kind, people, from: dateKey(r.from), to: dateKey(r.to), period: _label());
    } catch (e) {
      if (mounted) showSnack(context, 'Could not make the sheet: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _q.toLowerCase();
    bool match(SheetPerson p) => q.isEmpty || '${p.name} ${p.sub}'.toLowerCase().contains(q);
    final staff = _staff.where(match).toList();
    final ext = _ext.where(match).toList();

    Widget group(String title, List<SheetPerson> l, Color color) {
      final all = l.isNotEmpty && l.every((p) => _picked.contains(p.id));
      return Card(
        child: Column(children: [
          CheckboxListTile(
            value: all,
            onChanged: l.isEmpty
                ? null
                : (v) => setState(() {
                      for (final p in l) {
                        v == true ? _picked.add(p.id) : _picked.remove(p.id);
                      }
                    }),
            title: Text('$title (${l.length})', style: TextStyle(fontWeight: FontWeight.w800, color: color)),
            subtitle: const Text('Select all'),
            controlAffinity: ListTileControlAffinity.leading,
          ),
          const Divider(height: 1),
          for (final p in l)
            CheckboxListTile(
              dense: true,
              value: _picked.contains(p.id),
              onChanged: (v) => setState(() => v == true ? _picked.add(p.id) : _picked.remove(p.id)),
              title: Text(p.name, style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: p.sub.isEmpty ? null : Text(p.sub, maxLines: 1, overflow: TextOverflow.ellipsis),
              controlAffinity: ListTileControlAffinity.leading,
            ),
        ]),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Attendance reports')),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: FilledButton.icon(
            onPressed: _busy ? null : _make,
            icon: _busy
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                : const Icon(Icons.picture_as_pdf_outlined),
            label: Text(_picked.isEmpty ? 'Tick people below' : 'Make report · ${_picked.length} ${_picked.length == 1 ? 'person' : 'people'} (PDF)'),
          ),
        ),
      ),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 24), children: [
        const Text('Report', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 6),
        Card(
          child: Column(children: [
            for (final k in _kinds)
              RadioListTile<String>(
                value: k.$1,
                groupValue: _kind,
                onChanged: (v) => setState(() => _kind = v ?? 'sheet'),
                secondary: Icon(k.$4, color: _kind == k.$1 ? AppColors.accentDark : AppColors.muted),
                title: Text(k.$2, style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text(k.$3, style: const TextStyle(fontSize: 12)),
              ),
          ]),
        ),
        const SizedBox(height: 12),
        const Text('Period', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 6),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final p in const [('month', 'This month'), ('last', 'Last month'), ('7', 'Last 7 days')])
            ChoiceChip(label: Text(p.$2), selected: _period == p.$1, onSelected: (_) => setState(() => _period = p.$1)),
          ChoiceChip(
            avatar: const Icon(Icons.date_range, size: 18),
            label: Text(_period == 'pick' ? _label() : 'Pick dates'),
            selected: _period == 'pick',
            onSelected: (_) async {
              final n = DateTime.now();
              final r = await showDateRangePicker(
                  context: context, firstDate: DateTime(2023), lastDate: n, initialDateRange: _custom ?? DateTimeRange(start: DateTime(n.year, n.month, 1), end: n));
              if (r != null) setState(() {
                _custom = r;
                _period = 'pick';
              });
            },
          ),
        ]),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Text('Period: ${_label()}', style: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w600)),
        ),
        TextField(
          decoration: const InputDecoration(hintText: 'Search name, company, trade…', prefixIcon: Icon(Icons.search), isDense: true),
          onChanged: (v) => setState(() => _q = v.trim()),
        ),
        const SizedBox(height: 10),
        group('Staff', staff, AppColors.info),
        const SizedBox(height: 10),
        group('External workers', ext, kExtColor),
        const SizedBox(height: 8),
        const Text('Opens as a PDF you can share on WhatsApp / email or print. The daily register works best for one month.',
            style: TextStyle(fontSize: 12, color: AppColors.muted)),
      ]),
    );
  }
}
