import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../widgets/common.dart';
import '../../widgets/site_workforce.dart' show kStaffColor, kExtColor;
import '../../widgets/tiles.dart';
import 'admin_live.dart';
import 'approvals.dart';
import 'employee_detail_screen.dart';
import 'live_map_tab.dart';
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
        final ext = live.externalToday;
        final extOn = ext.where((x) => x.onSite).length;
        final extHours = ext.fold(Duration.zero, (a, x) => a + x.time);
        final flaggedToday = live.today.where((s) => s.flagged).toList();
        final forgotten = live.open.where((s) => s.date != dateKey(DateTime.now())).toList();
        final activeSiteIds = {
          ...live.today.map((s) => s.siteId),
          ...live.open.map((s) => s.siteId),
        };

        return LayoutBuilder(builder: (context, c) {
        // Big screens (unfolded Fold, tablets): live map + live lists on the right.
        final wide = c.maxWidth >= 700;
        final list = RefreshIndicator(
          onRefresh: () async {},
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
            children: [
              Text(fmtDate(DateTime.now()),
                  style: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w600)),
              const SizedBox(height: 10),
              if (live.externalError != null)
                Card(
                  color: const Color(0xFFFBE6E6),
                  margin: const EdgeInsets.only(bottom: 10),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(
                      'External workers can\'t be loaded: ${live.externalError}\n'
                      '${live.externalError!.contains('permission') ? 'Publish the latest Firestore rules (Firebase → Firestore → Rules → Publish).' : ''}',
                      style: const TextStyle(color: Color(0xFF8F2A2A), fontSize: 12.5),
                    ),
                  ),
                ),
              StatGrid(children: [
                StatTile(
                  label: 'On duty now',
                  value: '${onDuty + extOn}',
                  icon: Icons.radio_button_checked,
                  color: AppColors.success,
                  sub: '$onDuty staff · $extOn external',
                  onTap: () => widget.onNavigate(1),
                ),
                StatTile(
                  label: 'Workforce today',
                  value: '${present + ext.length}',
                  icon: Icons.how_to_reg_outlined,
                  color: AppColors.primary,
                  sub: '$present staff · ${ext.length} external · $notIn not in',
                  onTap: () => widget.onNavigate(2),
                ),
                StatTile(
                  label: 'Man-hours today',
                  value: fmtDuration(hours + extHours),
                  icon: Icons.timer_outlined,
                  color: AppColors.info,
                  sub: 'staff ${fmtDuration(hours)} · ext ${fmtDuration(extHours)}',
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
                  onTap: widget.me.isAdmin ? () => widget.onNavigate(4) : null,
                ),
                StatTile(
                  label: 'Flagged check-ins',
                  value: '${flaggedToday.length}',
                  icon: Icons.wrong_location_outlined,
                  color: AppColors.danger,
                  sub: 'Outside site / fake GPS',
                ),
              ]),
              if (!wide && live.tripsToday.isNotEmpty) ...[
                const SectionTitle('Driver trips today'),
                _TripsCard(live),
              ],

              // ----------------------------------------------- attention
              if (forgotten.isNotEmpty || flaggedToday.isNotEmpty || live.alerts.isNotEmpty) ...[
                const SectionTitle('Needs attention'),
                ...forgotten.map((s) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Card(
                        color: const Color(0xFFFFF1F0),
                        child: ListTile(
                          leading: const Icon(Icons.warning_amber, color: AppColors.danger),
                          title: Text('${s.employeeName} never checked out'),
                          subtitle: Text(
                              '${s.siteName} · checked in ${fmtDateTime(s.inLocal)} ${tzLabel(s.tz)}'),
                          trailing: TextButton(
                              onPressed: () => _closeForgotten(s), child: const Text('Close')),
                        ),
                      ),
                    )),
                ...live.alerts.map((a) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Card(
                        color: const Color(0xFFFFF4E2),
                        child: ListTile(
                          leading: const Icon(Icons.wrong_location, color: AppColors.accentDark),
                          title: Text('${a.employeeName}: ${a.label}'),
                          subtitle: Text(fmtDateTime(a.at == null ? null : atZone(a.at!, a.tz)) +
                              (a.lat == null ? '' : ' · GPS ${a.lat!.toStringAsFixed(5)}, ${a.lng!.toStringAsFixed(5)}')),
                          onTap: () {
                            final u = live.userById(a.employeeId);
                            if (u != null) _openEmployee(u);
                          },
                          trailing: TextButton(
                            onPressed: () => Db.resolveAlert(a.id, widget.me.name),
                            child: const Text('Resolve'),
                          ),
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
                    trailing: !widget.me.isAdmin
                        ? null
                        : TextButton(
                            onPressed: () => widget.onNavigate(4), child: const Text('All petty'))),
                ...live.pendingSites.map((st) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Card(
                        child: ListTile(
                          leading: const CircleAvatar(
                            backgroundColor: Color(0xFFFFF4E2),
                            child: Icon(Icons.add_location_alt, color: AppColors.accentDark),
                          ),
                          title: Text('New site: ${st.name}'),
                          subtitle: Text('Added by ${st.createdByName}'
                              '${st.address.isEmpty ? '' : ' · ${st.address}'}'),
                          trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                            IconButton(
                              tooltip: 'Reject',
                              icon: const Icon(Icons.close, color: AppColors.danger),
                              onPressed: () => Db.approveSite(st.id, false),
                            ),
                            IconButton.filled(
                              tooltip: 'Approve',
                              style: IconButton.styleFrom(backgroundColor: AppColors.success),
                              icon: const Icon(Icons.check),
                              onPressed: () => Db.approveSite(st.id, true),
                            ),
                          ]),
                        ),
                      ),
                    )),
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
              SectionTitle('Team today · ${st.length} staff${ext.isEmpty ? '' : ' + ${ext.length} external'}',
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
              if (ext.isNotEmpty) ...[
                const SizedBox(height: 10),
                Card(
                  child: Column(children: [
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                      color: kExtColor.withValues(alpha: 0.08),
                      child: Text('External workers today · ${ext.length}  ($extOn on site)',
                          style: const TextStyle(color: kExtColor, fontWeight: FontWeight.w800)),
                    ),
                    for (var i = 0; i < ext.length; i++) ...[
                      if (i > 0) const Divider(height: 1, indent: 64),
                      ListTile(
                        leading: Avatar(ext[i].e.workerName, ring: kExtColor),
                        title: Text(ext[i].e.workerName, style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text('${ext[i].e.siteName} · with ${ext[i].e.employeeName}',
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                        trailing: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Pill(ext[i].onSite ? 'On site' : 'Done',
                                color: ext[i].onSite ? AppColors.success : kExtColor),
                            const SizedBox(height: 4),
                            Text(fmtDuration(ext[i].time),
                                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                          ],
                        ),
                      ),
                    ],
                  ]),
                ),
              ],

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
        if (!wide) return list;
        return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(flex: 11, child: list),
          Expanded(flex: 9, child: _LivePanel(me: widget.me, live: live, onNavigate: widget.onNavigate)),
        ]);
        });
      },
    );
  }
}

/// Right-hand live column on big screens: map with everyone on duty, who is on which site, driver trips.
class _LivePanel extends StatelessWidget {
  final AppUser me;
  final AdminLive live;
  final void Function(int) onNavigate;
  const _LivePanel({required this.me, required this.live, required this.onNavigate});

  @override
  Widget build(BuildContext context) {
    final bySite = <String, ({String name, List<AttendanceSession> staff, List<WorkerEntry> ext})>{};
    ({String name, List<AttendanceSession> staff, List<WorkerEntry> ext}) group(String id, String name) =>
        bySite.putIfAbsent(id, () => (name: live.siteById(id)?.name ?? name, staff: <AttendanceSession>[], ext: <WorkerEntry>[]));
    for (final o in live.open) {
      group(o.siteId, o.siteName).staff.add(o);
    }
    for (final e in live.externalOnSite) {
      group(e.siteId, e.siteName).ext.add(e);
    }
    final groups = bySite.values.toList()
      ..sort((a, b) => (b.staff.length + b.ext.length).compareTo(a.staff.length + a.ext.length));
    return ListView(padding: const EdgeInsets.fromLTRB(4, 4, 16, 32), children: [
      Row(children: [
        Container(width: 9, height: 9, decoration: const BoxDecoration(color: AppColors.success, shape: BoxShape.circle)),
        const SizedBox(width: 6),
        Text('LIVE · ${fmtTime(DateTime.now())}',
            style: const TextStyle(color: AppColors.success, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 0.6)),
        const Spacer(),
        TextButton.icon(onPressed: () => onNavigate(1), icon: const Icon(Icons.open_in_full, size: 16), label: const Text('Full map')),
      ]),
      Card(
        clipBehavior: Clip.antiAlias,
        child: SizedBox(height: 330, child: LiveMapTab(me: me, live: live, embedded: true)),
      ),
      if (live.tripsToday.isNotEmpty) ...[
        const SectionTitle('Driver trips today'),
        _TripsCard(live),
      ],
      SectionTitle('On site now · ${live.open.length + live.externalOnSite.length}'),
      if (groups.isEmpty)
        const Card(child: EmptyState(icon: Icons.location_off_outlined, title: 'Nobody on site right now'))
      else
        for (final g in groups)
          Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text(g.name, style: const TextStyle(fontWeight: FontWeight.w800))),
                  Pill('${g.staff.length} staff', color: kStaffColor),
                  const SizedBox(width: 6),
                  Pill('${g.ext.length} ext', color: kExtColor),
                ]),
                const SizedBox(height: 6),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  for (final o in g.staff)
                    Chip(
                      visualDensity: VisualDensity.compact,
                      avatar: Avatar(o.employeeName, size: 22, ring: kStaffColor),
                      label: Text('${o.employeeName.split(' ').first} · ${fmtDuration(o.worked())}', style: const TextStyle(fontSize: 12)),
                    ),
                  for (final e in g.ext)
                    Chip(
                      visualDensity: VisualDensity.compact,
                      backgroundColor: kExtColor.withValues(alpha: 0.08),
                      avatar: Avatar(e.workerName, size: 22, ring: kExtColor),
                      label: Text('${e.workerName.split(' ').first} · ${fmtDuration(e.worked())}', style: const TextStyle(fontSize: 12)),
                    ),
                ]),
              ]),
            ),
          ),
    ]);
  }
}

/// Driver trips today: who is driving now, km and cost so far.
class _TripsCard extends StatelessWidget {
  final AdminLive live;
  const _TripsCard(this.live);

  @override
  Widget build(BuildContext context) {
    final trips = live.tripsToday;
    final km = trips.fold<double>(0, (a, t) => a + t.km);
    final cost = trips.fold<double>(0, (a, t) => a + (t.cost ?? 0));
    return Card(
      child: Column(children: [
        ListTile(
          leading: const CircleAvatar(backgroundColor: Color(0x1A7B4FC9), child: Icon(Icons.local_shipping_outlined, color: kTripColor)),
          title: Text('${trips.length} trip${trips.length == 1 ? '' : 's'} · ${km.toStringAsFixed(1)} km',
              style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text('${live.activeTrips.length} driving now${live.canSeeAccounts && cost > 0 ? ' · ${fmtMoney(cost)} (finished trips)' : ''}'),
        ),
        for (final t in trips.take(8)) ...[
          const Divider(height: 1, indent: 16),
          ListTile(
            dense: true,
            leading: Icon(t.isActive ? Icons.local_shipping : Icons.route,
                color: t.isActive ? AppColors.success : AppColors.muted),
            title: Text(t.employeeName, style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text(
                '${fmtTime(t.startLocal)} ${t.startSiteName.isEmpty ? 'GPS' : t.startSiteName} → ${t.isActive ? 'driving…' : (t.endSiteName.isEmpty ? 'GPS' : t.endSiteName)}'
                '${t.siteName.isNotEmpty && !t.isActive ? ' · charged to ${t.siteName}' : ''}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis),
            trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text('${t.km.toStringAsFixed(1)} km', style: const TextStyle(fontWeight: FontWeight.w800)),
              if (live.canSeeAccounts && t.cost != null) Text(fmtMoney(t.cost!), style: const TextStyle(fontSize: 11.5)),
            ]),
          ),
        ],
      ]),
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
        sub = '${s.open!.siteName} · since ${fmtTime(s.open!.inLocal)}';
        break;
      case StaffState.done:
        sub = '${s.today.length} site${s.today.length == 1 ? '' : 's'} · last out ${fmtTime(s.today.last.outLocal)}';
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
