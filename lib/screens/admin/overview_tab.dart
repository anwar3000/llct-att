import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../widgets/common.dart';
import '../../widgets/tiles.dart';
import 'admin_live.dart';
import 'approvals.dart';
import 'employee_detail_screen.dart';
import 'staff_status.dart';

class OverviewTab extends StatefulWidget {
  final AppUser me;
  final AdminLive live;
  final void Function(int tab) onNavigate;
  const OverviewTab({super.key, required this.me, required this.live, required this.onNavigate});

  @override
  State<OverviewTab> createState() => _OverviewTabState();
}

class _OverviewTabState extends State<OverviewTab> {
  late final Stream<List<SiteUpdate>> _updates = Db.recentUpdates(limit: 6);

  void _openEmployee(AppUser u) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => EmployeeDetailScreen(me: widget.me, userId: u.id, live: widget.live),
    ));
  }

  Future<void> _closeForgotten(AttendanceSession s) async {
    final d = s.checkIn;
    final picked = await showTimePicker(
      context: context,
      helpText: 'Check-out time on ${fmtDateShort(d)}',
      initialTime: const TimeOfDay(hour: 18, minute: 0),
    );
    if (picked == null) return;
    final at = DateTime(d.year, d.month, d.day, picked.hour, picked.minute);
    if (!at.isAfter(d)) {
      if (mounted) showSnack(context, 'Check-out must be after ${fmtTime(d)}', error: true);
      return;
    }
    await Db.adminCloseSession(s, at);
    if (mounted) showSnack(context, 'Session closed at ${fmtTime(at)}');
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.live,
      builder: (context, _) {
        final live = widget.live;
        if (live.error != null && !live.loaded) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text('Could not load data:\n${live.error}',
                  textAlign: TextAlign.center, style: const TextStyle(color: AppColors.danger)),
            ),
          );
        }
        if (!live.loaded) return const Center(child: CircularProgressIndicator());

        final st = live.statuses;
        final onDuty = st.where((s) => s.state == StaffState.onDuty).length;
        final present = st.where((s) => s.state == StaffState.onDuty || s.state == StaffState.done).length;
        final notIn = st.where((s) => s.state == StaffState.notIn).length;
        final off = st.where((s) => s.state == StaffState.off).length;
        final hours = st.fold(Duration.zero, (a, s) => a + s.worked);
        final flaggedToday = live.today.where((s) => s.flagged).toList();
        final forgotten = live.open.where((s) => s.date != dateKey(DateTime.now())).toList();
        final activeSiteIds = {
          ...live.today.map((s) => s.siteId),
          ...live.open.map((s) => s.siteId),
        };

        return RefreshIndicator(
          onRefresh: () async {},
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
            children: [
              Text(fmtDate(DateTime.now()),
                  style: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w600)),
              const SizedBox(height: 10),
              StatGrid(children: [
                StatTile(
                  label: 'On duty now',
                  value: '$onDuty / ${st.length}',
                  icon: Icons.radio_button_checked,
                  color: AppColors.success,
                  sub: 'Tap to see on map',
                  onTap: () => widget.onNavigate(1),
                ),
                StatTile(
                  label: 'Present today',
                  value: '$present',
                  icon: Icons.how_to_reg_outlined,
                  color: AppColors.primary,
                  sub: '$notIn not checked in · $off off',
                  onTap: () => widget.onNavigate(2),
                ),
                StatTile(
                  label: 'Work time today',
                  value: fmtDuration(hours),
                  icon: Icons.timer_outlined,
                  color: AppColors.info,
                  sub: present == 0
                      ? '—'
                      : 'Avg ${fmtDuration(Duration(minutes: hours.inMinutes ~/ present))} / person',
                ),
                StatTile(
                  label: 'Sites active',
                  value: '${activeSiteIds.length}',
                  icon: Icons.location_city_outlined,
                  color: const Color(0xFF8E5CC4),
                  sub: '${live.schedules.length} visits scheduled',
                  onTap: () => widget.onNavigate(3),
                ),
                StatTile(
                  label: 'Pending approvals',
                  value: '${live.pendingCount}',
                  icon: Icons.pending_actions_outlined,
                  color: AppColors.warning,
                  sub: '${live.pendingPetty.length} petty · ${live.pendingOff.length} off-day',
                  onTap: () => widget.onNavigate(4),
                ),
                StatTile(
                  label: 'Flagged check-ins',
                  value: '${flaggedToday.length}',
                  icon: Icons.wrong_location_outlined,
                  color: AppColors.danger,
                  sub: 'Outside site / fake GPS',
                ),
              ]),

              // ----------------------------------------------- attention
              if (forgotten.isNotEmpty || flaggedToday.isNotEmpty) ...[
                const SectionTitle('Needs attention'),
                ...forgotten.map((s) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Card(
                        color: const Color(0xFFFFF1F0),
                        child: ListTile(
                          leading: const Icon(Icons.warning_amber, color: AppColors.danger),
                          title: Text('${s.employeeName} never checked out'),
                          subtitle: Text(
                              '${s.siteName} · checked in ${fmtDateTime(s.checkIn)}'),
                          trailing: TextButton(
                              onPressed: () => _closeForgotten(s), child: const Text('Close')),
                        ),
                      ),
                    )),
                if (flaggedToday.isNotEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      child: Column(
                        children: flaggedToday
                            .map((s) => SessionTile(s,
                                showName: true,
                                onTap: () {
                                  final u = live.userById(s.employeeId);
                                  if (u != null) _openEmployee(u);
                                }))
                            .toList(),
                      ),
                    ),
                  ),
              ],

              // ----------------------------------------------- approvals
              if (live.pendingCount > 0) ...[
                SectionTitle('Approvals',
                    trailing: TextButton(
                        onPressed: () => widget.onNavigate(4), child: const Text('All petty'))),
                ...live.pendingOff.map((o) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: OffDayApproval(o),
                    )),
                ...live.pendingPetty.take(5).map((t) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: PettyApproval(t, me: widget.me),
                    )),
              ],

              // ----------------------------------------------- team today
              SectionTitle('Team today',
                  trailing: TextButton(
                      onPressed: () => widget.onNavigate(2), child: const Text('Manage team'))),
              if (st.isEmpty)
                const Card(
                  child: EmptyState(
                    icon: Icons.group_add_outlined,
                    title: 'No employees yet',
                    message: 'Go to Team → Add employee to create staff logins.',
                  ),
                )
              else
                Card(
                  child: Column(
                    children: [
                      for (var i = 0; i < st.length; i++) ...[
                        if (i > 0) const Divider(height: 1, indent: 64),
                        _StaffRow(st[i], onTap: () => _openEmployee(st[i].user)),
                      ]
                    ],
                  ),
                ),

              // ----------------------------------------------- schedule coverage
              if (live.schedules.isNotEmpty) ...[
                const SectionTitle("Today's schedule"),
                Card(
                  child: Column(
                    children: live.schedules.map((s) {
                      final visited = live.today
                          .any((x) => x.employeeId == s.employeeId && x.siteId == s.siteId);
                      final now = live.open
                          .any((x) => x.employeeId == s.employeeId && x.siteId == s.siteId);
                      return ListTile(
                        dense: true,
                        leading: Icon(
                          now
                              ? Icons.timelapse
                              : (visited ? Icons.check_circle : Icons.radio_button_unchecked),
                          color: now
                              ? AppColors.success
                              : (visited ? AppColors.primary : AppColors.muted),
                        ),
                        title: Text('${s.employeeName} → ${s.siteName}',
                            style: const TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Text(s.timeLabel),
                        trailing: now
                            ? const Pill('On site', color: AppColors.success)
                            : (visited
                                ? const Pill('Visited', color: AppColors.primary)
                                : const Pill('Pending', color: AppColors.muted)),
                      );
                    }).toList(),
                  ),
                ),
              ],

              // ----------------------------------------------- site progress
              if (live.sites.where((s) => s.active).isNotEmpty) ...[
                SectionTitle('Site progress',
                    trailing: TextButton(
                        onPressed: () => widget.onNavigate(3), child: const Text('All sites'))),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      children: live.sites.where((s) => s.active).take(8).map((s) {
                        final onSite = live.open.where((x) => x.siteId == s.id).length;
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Expanded(
                                child: Text(s.name,
                                    style: const TextStyle(fontWeight: FontWeight.w600)),
                              ),
                              if (onSite > 0) ...[
                                Pill('$onSite on site',
                                    color: AppColors.success, icon: Icons.person),
                                const SizedBox(width: 8),
                              ],
                              Text('${s.progress}%',
                                  style: const TextStyle(fontWeight: FontWeight.w700)),
                            ]),
                            const SizedBox(height: 6),
                            ClipRRect(
                              borderRadius: BorderRadius.circular(6),
                              child: LinearProgressIndicator(
                                value: s.progress / 100,
                                minHeight: 7,
                                backgroundColor: const Color(0xFFE3E8EB),
                              ),
                            ),
                          ]),
                        );
                      }).toList(),
                    ),
                  ),
                ),
              ],

              // ----------------------------------------------- updates
              SectionTitle('Latest site updates',
                  trailing: TextButton(
                      onPressed: () => widget.onNavigate(3), child: const Text('See all'))),
              StreamView<List<SiteUpdate>>(
                stream: _updates,
                builder: (context, list) => list.isEmpty
                    ? const Card(
                        child: EmptyState(
                            icon: Icons.construction_outlined, title: 'No site updates yet'))
                    : Column(
                        children: list
                            .map((u) => Padding(
                                  padding: const EdgeInsets.only(bottom: 10),
                                  child: UpdateCard(u),
                                ))
                            .toList(),
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _StaffRow extends StatelessWidget {
  final StaffStatus s;
  final VoidCallback onTap;
  const _StaffRow(this.s, {required this.onTap});

  @override
  Widget build(BuildContext context) {
    final loc = s.user.lastLocation;
    String sub;
    switch (s.state) {
      case StaffState.onDuty:
        sub = '${s.open!.siteName} · since ${fmtTime(s.open!.checkIn)}';
        break;
      case StaffState.done:
        sub = '${s.today.length} site${s.today.length == 1 ? '' : 's'} · last out ${fmtTime(s.today.last.checkOut)}';
        break;
      case StaffState.off:
        sub = 'Scheduled off';
        break;
      case StaffState.notIn:
        sub = s.user.designation.isEmpty ? 'No check-in yet' : s.user.designation;
        break;
    }
    if (s.state == StaffState.onDuty && loc != null) {
      sub += ' · GPS ${timeAgo(loc.at)}';
    }
    return ListTile(
      onTap: onTap,
      leading: Avatar(s.user.name, ring: s.color),
      title: Text(s.user.name, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          s.pill,
          if (s.state == StaffState.onDuty || s.state == StaffState.done) ...[
            const SizedBox(height: 4),
            Text(fmtDuration(s.worked),
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
          ],
        ],
      ),
    );
  }
}
