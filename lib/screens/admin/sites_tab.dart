import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../widgets/common.dart';
import '../../widgets/tiles.dart';
import 'admin_live.dart';
import 'site_editor.dart';

class SitesTab extends StatelessWidget {
  final AppUser me;
  final AdminLive live;
  const SitesTab({super.key, required this.me, required this.live});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Column(children: [
        Container(
          color: AppColors.surface,
          child: const TabBar(tabs: [
            Tab(icon: Icon(Icons.location_city_outlined, size: 20), text: 'Sites'),
            Tab(icon: Icon(Icons.event_note_outlined, size: 20), text: 'Schedule'),
            Tab(icon: Icon(Icons.construction_outlined, size: 20), text: 'Updates'),
          ]),
        ),
        Expanded(
          child: TabBarView(children: [
            _SitesList(live: live),
            _ScheduleView(live: live),
            _UpdatesFeed(live: live),
          ]),
        ),
      ]),
    );
  }
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

class _SitesList extends StatelessWidget {
  final AdminLive live;
  const _SitesList({required this.live});

  static Color statusColor(String s) {
    switch (s) {
      case 'completed':
        return AppColors.primary;
      case 'on hold':
        return AppColors.warning;
      case 'planned':
        return AppColors.info;
      default:
        return AppColors.success;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'addSite',
        onPressed: () =>
            Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SiteEditor())),
        icon: const Icon(Icons.add_location_alt_outlined),
        label: const Text('Add site'),
      ),
      body: ListenableBuilder(
        listenable: live,
        builder: (context, _) {
          final sites = live.sites;
          if (sites.isEmpty) {
            return const EmptyState(
              icon: Icons.location_city_outlined,
              title: 'No sites yet',
              message: 'Add your first work site. Stand at the site and tap '
                  '"Use my current location" for an accurate geofence.',
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
            itemCount: sites.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (context, i) {
              final s = sites[i];
              final onSite = live.open.where((x) => x.siteId == s.id).toList();
              final today = live.today.where((x) => x.siteId == s.id);
              final extOn = live.externalOnSite.where((e) => e.siteId == s.id).toList();
              final extToday = live.workersToday.where((e) => e.siteId == s.id).toList();
              final extIds = extToday.map((e) => e.workerId).toSet();
              final staffIds = {...today.map((x) => x.employeeId), ...onSite.map((x) => x.employeeId)};
              final hoursToday = totalWorked(today) + extToday.fold(Duration.zero, (a, e) => a + e.worked());
              return Card(
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: () => Navigator.of(context)
                      .push(MaterialPageRoute(builder: (_) => SiteEditor(existing: s))),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(
                          child: Text(s.name,
                              style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                  color: s.active ? AppColors.ink : AppColors.muted)),
                        ),
                        if (!s.active)
                          const Pill('Inactive', color: AppColors.muted)
                        else
                          Pill(s.status.isEmpty ? 'Active' : s.status[0].toUpperCase() + s.status.substring(1),
                              color: statusColor(s.status)),
                      ]),
                      if (s.address.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(s.address,
                              style: const TextStyle(color: AppColors.muted, fontSize: 13)),
                        ),
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(6),
                            child: LinearProgressIndicator(
                              value: s.progress / 100,
                              minHeight: 8,
                              backgroundColor: const Color(0xFFE3E8EB),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Text('${s.progress}%',
                            style: const TextStyle(fontWeight: FontWeight.w800)),
                      ]),
                      const SizedBox(height: 10),
                      Wrap(spacing: 8, runSpacing: 6, children: [
                        Pill('${onSite.length + extOn.length} on site now (${onSite.length} staff · ${extOn.length} ext)',
                            color: onSite.isEmpty && extOn.isEmpty ? AppColors.muted : AppColors.success,
                            icon: Icons.person),
                        Pill('Workforce today ${staffIds.length + extIds.length}',
                            color: AppColors.accentDark, icon: Icons.groups),
                        Pill('${fmtDuration(hoursToday)} man-hours today',
                            color: AppColors.info, icon: Icons.timer_outlined),
                        Pill('Geofence ${s.radius.round()} m',
                            color: AppColors.primary, icon: Icons.radar),
                        if (s.addedByEmployee)
                          Pill('Added by ${s.createdByName}',
                              color: AppColors.accentDark, icon: Icons.add_location_alt),
                        if (!s.approved)
                          const Pill('Awaiting approval · tap to review & save',
                              color: AppColors.danger, icon: Icons.pending_actions),
                      ]),
                      if (onSite.isNotEmpty || extOn.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Text([...onSite.map((x) => x.employeeName), ...extOn.map((e) => '${e.workerName} (ext)')].join(', '),
                            style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                      ],
                    ]),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

class _ScheduleView extends StatefulWidget {
  final AdminLive live;
  const _ScheduleView({required this.live});

  @override
  State<_ScheduleView> createState() => _ScheduleViewState();
}

class _ScheduleViewState extends State<_ScheduleView> with AutomaticKeepAliveClientMixin {
  DateTime _day = DateTime.now();
  late Stream<List<Schedule>> _sched;
  late Stream<List<AttendanceSession>> _sessions;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _sched = Db.schedulesForDate(dateKey(_day));
    _sessions = Db.sessionsForDate(dateKey(_day));
  }

  void _setDay(DateTime d) => setState(() {
        _day = d;
        _load();
      });

  Future<void> _add() async {
    final live = widget.live;
    final emps = live.activeEmployees;
    final sites = live.sites.where((s) => s.active).toList();
    if (emps.isEmpty || sites.isEmpty) {
      showSnack(context, 'Add at least one employee and one active site first.', error: true);
      return;
    }
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
        child: _ScheduleForm(employees: emps, sites: sites, initialDay: _day),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final isToday = dateKey(_day) == dateKey(DateTime.now());
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'addSched',
        onPressed: _add,
        icon: const Icon(Icons.add),
        label: const Text('Assign site'),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Card(
            child: Row(children: [
              IconButton(
                  onPressed: () => _setDay(_day.subtract(const Duration(days: 1))),
                  icon: const Icon(Icons.chevron_left)),
              Expanded(
                child: InkWell(
                  onTap: () async {
                    final p = await showDatePicker(
                      context: context,
                      initialDate: _day,
                      firstDate: DateTime(2020),
                      lastDate: DateTime.now().add(const Duration(days: 365)),
                    );
                    if (p != null) _setDay(p);
                  },
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(isToday ? 'Today · ${fmtDateShort(_day)}' : fmtDate(_day),
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ),
              ),
              IconButton(
                  onPressed: () => _setDay(_day.add(const Duration(days: 1))),
                  icon: const Icon(Icons.chevron_right)),
            ]),
          ),
        ),
        Expanded(
          child: StreamView<List<AttendanceSession>>(
            stream: _sessions,
            builder: (context, sessions) => StreamView<List<Schedule>>(
              stream: _sched,
              builder: (context, list) {
                if (list.isEmpty) {
                  return const EmptyState(
                    icon: Icons.event_note_outlined,
                    title: 'Nothing scheduled',
                    message: 'Assign one or more sites to each employee for this day.',
                  );
                }
                final byEmp = <String, List<Schedule>>{};
                for (final s in list) {
                  byEmp.putIfAbsent(s.employeeName, () => []).add(s);
                }
                return ListView(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
                  children: byEmp.entries.map((e) {
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Card(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Column(children: [
                            ListTile(
                              leading: Avatar(e.key, size: 36),
                              title: Text(e.key,
                                  style: const TextStyle(fontWeight: FontWeight.w700)),
                              subtitle: Text(
                                  '${e.value.length} site${e.value.length == 1 ? '' : 's'}'),
                            ),
                            ...e.value.map((s) {
                              final visits = sessions.where(
                                  (x) => x.employeeId == s.employeeId && x.siteId == s.siteId);
                              final visited = visits.isNotEmpty;
                              return ListTile(
                                dense: true,
                                contentPadding: const EdgeInsets.only(left: 72, right: 4),
                                title: Text(s.siteName,
                                    style: const TextStyle(fontWeight: FontWeight.w600)),
                                subtitle: Text([
                                  s.timeLabel,
                                  if (s.note.isNotEmpty) s.note,
                                  if (visited) 'Worked ${fmtDuration(totalWorked(visits))}',
                                ].join(' · ')),
                                trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                                  visited
                                      ? const Pill('Visited', color: AppColors.success)
                                      : const Pill('Pending', color: AppColors.muted),
                                  IconButton(
                                    icon: const Icon(Icons.delete_outline, size: 20),
                                    onPressed: () async {
                                      if (await confirm(context, 'Remove?',
                                          'Remove ${s.siteName} from ${s.employeeName}\'s schedule?')) {
                                        await Db.deleteSchedule(s.id);
                                      }
                                    },
                                  ),
                                ]),
                              );
                            }),
                          ]),
                        ),
                      ),
                    );
                  }).toList(),
                );
              },
            ),
          ),
        ),
      ]),
    );
  }
}

class _ScheduleForm extends StatefulWidget {
  final List<AppUser> employees;
  final List<Site> sites;
  final DateTime initialDay;
  const _ScheduleForm({required this.employees, required this.sites, required this.initialDay});

  @override
  State<_ScheduleForm> createState() => _ScheduleFormState();
}

class _ScheduleFormState extends State<_ScheduleForm> {
  final Set<String> _emps = {};
  final Set<String> _sites = {};
  late DateTime _day = widget.initialDay;
  int _repeat = 1;
  bool _skipOff = true;
  TimeOfDay? _start;
  TimeOfDay? _end;
  final _note = TextEditingController();
  bool _saving = false;

  String _t(TimeOfDay? t) =>
      t == null ? '' : '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_emps.isEmpty || _sites.isEmpty) {
      showSnack(context, 'Choose at least one employee and one site.', error: true);
      return;
    }
    setState(() => _saving = true);
    var n = 0;
    try {
      for (var d = 0; d < _repeat; d++) {
        final day = DateTime(_day.year, _day.month, _day.day + d);
        for (final e in widget.employees.where((e) => _emps.contains(e.id))) {
          if (_skipOff && e.isWeeklyOff(day)) continue;
          for (final s in widget.sites.where((s) => _sites.contains(s.id))) {
            await Db.addSchedule(
              employee: e,
              site: s,
              date: day,
              startTime: _t(_start),
              endTime: _t(_end),
              note: _note.text.trim(),
            );
            n++;
          }
        }
      }
      if (mounted) {
        Navigator.pop(context);
        showSnack(context, 'Added $n schedule entr${n == 1 ? 'y' : 'ies'}.');
      }
    } catch (e) {
      if (mounted) showSnack(context, 'Failed: $e', error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      builder: (context, scroll) => ListView(
        controller: scroll,
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        children: [
          const Text('Assign sites',
              style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          const Text('Select several sites to schedule multiple visits in one day.',
              style: TextStyle(color: AppColors.muted, fontSize: 13)),
          const SizedBox(height: 14),
          const Text('Employees', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: widget.employees
                .map((e) => FilterChip(
                      label: Text(e.name),
                      selected: _emps.contains(e.id),
                      onSelected: (v) =>
                          setState(() => v ? _emps.add(e.id) : _emps.remove(e.id)),
                    ))
                .toList(),
          ),
          const SizedBox(height: 14),
          const Text('Sites', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: widget.sites
                .map((s) => FilterChip(
                      label: Text(s.name),
                      selected: _sites.contains(s.id),
                      onSelected: (v) =>
                          setState(() => v ? _sites.add(s.id) : _sites.remove(s.id)),
                    ))
                .toList(),
          ),
          const SizedBox(height: 14),
          Card(
            child: Column(children: [
              ListTile(
                leading: const Icon(Icons.event),
                title: const Text('Start date'),
                trailing: Text(fmtDate(_day)),
                onTap: () async {
                  final p = await showDatePicker(
                    context: context,
                    initialDate: _day,
                    firstDate: () {
                      final min = DateTime.now().subtract(const Duration(days: 30));
                      return _day.isBefore(min) ? _day : min;
                    }(),
                    lastDate: DateTime.now().add(const Duration(days: 365)),
                  );
                  if (p != null) setState(() => _day = p);
                },
              ),
              ListTile(
                leading: const Icon(Icons.repeat),
                title: const Text('Repeat for'),
                trailing: DropdownButton<int>(
                  value: _repeat,
                  underline: const SizedBox.shrink(),
                  items: const [1, 2, 3, 5, 6, 7, 14, 30]
                      .map((d) => DropdownMenuItem(value: d, child: Text('$d day${d == 1 ? '' : 's'}')))
                      .toList(),
                  onChanged: (v) => setState(() => _repeat = v ?? 1),
                ),
              ),
              if (_repeat > 1)
                SwitchListTile(
                  secondary: const Icon(Icons.beach_access_outlined),
                  title: const Text("Skip each employee's weekly off day"),
                  value: _skipOff,
                  onChanged: (v) => setState(() => _skipOff = v),
                ),
              ListTile(
                leading: const Icon(Icons.schedule),
                title: const Text('Time (optional)'),
                trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                  TextButton(
                    onPressed: () async {
                      final t = await showTimePicker(
                          context: context,
                          initialTime: _start ?? const TimeOfDay(hour: 9, minute: 0));
                      if (t != null) setState(() => _start = t);
                    },
                    child: Text(_start == null ? 'Start' : _t(_start)),
                  ),
                  const Text('–'),
                  TextButton(
                    onPressed: () async {
                      final t = await showTimePicker(
                          context: context,
                          initialTime: _end ?? const TimeOfDay(hour: 17, minute: 0));
                      if (t != null) setState(() => _end = t);
                    },
                    child: Text(_end == null ? 'End' : _t(_end)),
                  ),
                ]),
              ),
            ]),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            decoration: const InputDecoration(labelText: 'Instructions (optional)'),
          ),
          const SizedBox(height: 18),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'Saving…' : 'Assign'),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Updates feed
// ---------------------------------------------------------------------------

class _UpdatesFeed extends StatefulWidget {
  final AdminLive live;
  const _UpdatesFeed({required this.live});

  @override
  State<_UpdatesFeed> createState() => _UpdatesFeedState();
}

class _UpdatesFeedState extends State<_UpdatesFeed> with AutomaticKeepAliveClientMixin {
  String? _siteId;
  late Stream<List<SiteUpdate>> _stream = Db.recentUpdates(limit: 80);
  String _category = 'All';

  @override
  bool get wantKeepAlive => true;

  void _setSite(String? id) => setState(() {
        _siteId = id;
        _stream = id == null ? Db.recentUpdates(limit: 80) : Db.updatesForSite(id);
      });

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final sites = widget.live.sites;
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        child: DropdownButtonFormField<String?>(
          value: sites.any((s) => s.id == _siteId) ? _siteId : null,
          isExpanded: true,
          decoration: const InputDecoration(
              labelText: 'Site', prefixIcon: Icon(Icons.filter_list), isDense: true),
          items: [
            const DropdownMenuItem<String?>(value: null, child: Text('All sites (latest)')),
            ...sites.map((s) => DropdownMenuItem<String?>(value: s.id, child: Text(s.name))),
          ],
          onChanged: _setSite,
        ),
      ),
      SizedBox(
        height: 48,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          children: ['All', 'Progress', 'Issue', 'Material', 'Safety']
              .map((c) => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(c),
                      selected: _category == c,
                      onSelected: (_) => setState(() => _category = c),
                    ),
                  ))
              .toList(),
        ),
      ),
      Expanded(
        child: StreamView<List<SiteUpdate>>(
          stream: _stream,
          builder: (context, all) {
            final list =
                _category == 'All' ? all : all.where((u) => u.category == _category).toList();
            if (list.isEmpty) {
              return const EmptyState(
                  icon: Icons.construction_outlined, title: 'No updates to show');
            }
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
              itemCount: list.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, i) => UpdateCard(
                list[i],
                showSite: _siteId == null,
                onDelete: () async {
                  if (await confirm(context, 'Delete update?', 'This cannot be undone.',
                      danger: true, ok: 'Delete')) {
                    await Db.deleteSiteUpdate(list[i].id);
                  }
                },
              ),
            );
          },
        ),
      ),
    ]);
  }
}
