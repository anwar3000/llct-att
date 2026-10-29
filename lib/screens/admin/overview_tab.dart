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
import 'company_documents_screen.dart';
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
  late final Stream<List<CompanyDoc>> _companyDocs = Db.companyDocsStream();

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

  /// Team today: people working now grouped by site (staff with their external workers),
  /// then who has finished for the day, then staff not working today.
  List<Widget> _teamBySite(List<StaffStatus> st, AdminLive live) {
    final onDuty = st.where((s) => s.state == StaffState.onDuty && s.open != null).toList();
    final today = dateKey(DateTime.now());
    final vio = <String, int>{};
    for (final a in live.alerts) {
      if (a.isGpsViolation && a.at != null && dateKey(a.at!) == today) vio[a.employeeId] = (vio[a.employeeId] ?? 0) + 1;
    }
    final extOn = live.externalOnSite;
    final groups = <String, ({String name, List<StaffStatus> staff, List<WorkerEntry> ext})>{};
    ({String name, List<StaffStatus> staff, List<WorkerEntry> ext}) g(String id, String name) =>
        groups.putIfAbsent(id, () => (name: live.siteById(id)?.name ?? name, staff: <StaffStatus>[], ext: <WorkerEntry>[]));
    for (final s in onDuty) {
      g(s.open!.siteId, s.open!.siteName).staff.add(s);
    }
    for (final e in extOn) {
      g(e.siteId, e.siteName).ext.add(e);
    }
    final sites = groups.values.toList()
      ..sort((a, b) => (b.staff.length + b.ext.length).compareTo(a.staff.length + a.ext.length));
    final done = st.where((s) => s.state == StaffState.done).toList();
    final extDone = live.externalToday.where((x) => !x.onSite).toList();
    final notWorking = st.where((s) => s.state == StaffState.notIn || s.state == StaffState.off).toList();

    Widget head(String text, Color color, {Widget? trailing}) => Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
          color: color.withValues(alpha: 0.08),
          child: Row(children: [
            Expanded(child: Text(text, style: TextStyle(color: color, fontWeight: FontWeight.w800))),
            if (trailing != null) trailing,
          ]),
        );
    Widget extTile(WorkerEntry e, {bool nested = true, Duration? time, bool onSite = true}) => Padding(
          padding: EdgeInsets.only(left: nested ? 40 : 0),
          child: ListTile(
            dense: true,
            leading: Avatar(e.workerName, size: nested ? 28 : 40, ring: kExtColor),
            title: Text(e.workerName, style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text(
                nested ? 'External · since ${fmtTime(e.inLocal)}' : '${e.siteName} · with ${e.employeeName}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis),
            trailing: Text(fmtDuration(time ?? e.worked()), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
          ),
        );

    return [
      if (sites.isEmpty)
        const Card(child: EmptyState(icon: Icons.location_off_outlined, title: 'Nobody working right now'))
      else
        for (final site in sites)
          Card(
            margin: const EdgeInsets.only(bottom: 10),
            clipBehavior: Clip.antiAlias,
            child: Column(children: [
              head(site.name, AppColors.success,
                  trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                    Pill('${site.staff.length} staff', color: kStaffColor),
                    const SizedBox(width: 6),
                    Pill('${site.ext.length} ext', color: kExtColor),
                  ])),
              for (final s in site.staff) ...[
                _StaffRow(s, onTap: () => _openEmployee(s.user), violations: vio[s.user.id] ?? 0),
                for (final e in site.ext.where((e) => e.sessionId == s.open!.id)) extTile(e),
              ],
              // External workers whose employee isn't on duty here (e.g. kept on site after check-out).
              for (final e in site.ext.where((e) => !site.staff.any((s) => s.open!.id == e.sessionId)))
                extTile(e, nested: false),
            ]),
          ),
      if (done.isNotEmpty || extDone.isNotEmpty)
        Card(
          margin: const EdgeInsets.only(bottom: 10),
          clipBehavior: Clip.antiAlias,
          child: Column(children: [
            head('Finished today · ${done.length + extDone.length}', AppColors.primary),
            for (final s in done) _StaffRow(s, onTap: () => _openEmployee(s.user), violations: vio[s.user.id] ?? 0),
            for (final x in extDone) extTile(x.e, nested: false, time: x.time, onSite: false),
          ]),
        ),
      if (notWorking.isNotEmpty)
        Card(
          clipBehavior: Clip.antiAlias,
          child: Column(children: [
            head('Not working today · ${notWorking.length}', AppColors.muted),
            for (final s in notWorking) _StaffRow(s, onTap: () => _openEmployee(s.user), violations: vio[s.user.id] ?? 0),
          ]),
        ),
    ];
  }

  /// Company documents expired or expiring within 15 days.
  Widget _companyReminder() => StreamBuilder<List<CompanyDoc>>(
        stream: _companyDocs,
        builder: (context, snap) {
          final due = companyDocsDue(snap.data ?? const []);
          if (due.isEmpty) return const SizedBox.shrink();
          return Card(
            color: const Color(0xFFFFF1E0),
            margin: const EdgeInsets.only(bottom: 10),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16), side: BorderSide(color: AppColors.warning.withValues(alpha: 0.5))),
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: () => Navigator.of(context)
                  .push(MaterialPageRoute(builder: (_) => CompanyDocumentsScreen(me: widget.me))),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    const Icon(Icons.notifications_active_outlined, color: AppColors.warning),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text('Company documents to renew (${due.length})',
                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)),
                    ),
                    const Icon(Icons.chevron_right, color: AppColors.muted),
                  ]),
                  const SizedBox(height: 6),
                  for (final d in due.take(6))
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Row(children: [
                        Expanded(
                          child: Text('${d.title}${d.number.isEmpty ? '' : ' · ${d.number}'}',
                              maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
                        ),
                        Builder(builder: (_) {
                          final n = daysUntilKey(d.expiry)!;
                          return Text(
                              n < 0 ? 'Expired ${-n} d ago' : (n == 0 ? 'Expires today' : 'in $n day${n == 1 ? '' : 's'}'),
                              style: TextStyle(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w700,
                                  color: n < 0 ? AppColors.danger : AppColors.warning));
                        }),
                      ]),
                    ),
                ]),
              ),
            ),
          );
        },
      );

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
        final kids = <Widget>[
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
              _companyReminder(),
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
                  onTap: widget.me.isAdmin ? () => widget.onNavigate(5) : null,
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
                SectionTitle('Trips & rides today',
                    trailing: TextButton(onPressed: () => widget.onNavigate(4), child: const Text('All details'))),
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
                          leading: Icon(a.type == 'left_site' ? Icons.wrong_location : Icons.flag,
                              color: a.type == 'left_site' ? AppColors.accentDark : AppColors.danger),
                          title: Text('${a.employeeName}: ${a.label}'),
                          subtitle: Text(fmtDateTime(a.at == null ? null : atZone(a.at!, a.tz)) +
                              (a.lat == null ? '' : ' · GPS ${a.lat!.toStringAsFixed(5)}, ${a.lng!.toStringAsFixed(5)}')),
                          onTap: () {
                            final u = live.userById(a.employeeId);
                            if (u != null) _openEmployee(u);
                          },
                          trailing: a.type == 'checkin_blocked' && widget.me.isAdmin
                              ? TextButton(
                                  onPressed: () async {
                                    if (!await confirm(context, 'Allow check-in',
                                        'Clear ${a.employeeName}\'s GPS violations so they can check in again?', ok: 'Allow')) {
                                      return;
                                    }
                                    await Db.clearViolations(a.employeeId, widget.me.name);
                                    await Db.resolveAlert(a.id, widget.me.name);
                                    if (mounted) showSnack(context, '${a.employeeName} can check in again');
                                  },
                                  child: const Text('Allow check-in'),
                                )
                              : TextButton(
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
                            onPressed: () => widget.onNavigate(5), child: const Text('All petty'))),
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

              // ----------------------------------------------- petty cash (admin)
              if (widget.me.isAdmin && live.allPettyLoaded && live.allPetty.isNotEmpty) ...[
                SectionTitle('Petty cash',
                    trailing: TextButton(onPressed: () => widget.onNavigate(5), child: const Text('All petty'))),
                _PettyCard(live, onOpen: () => widget.onNavigate(5)),
              ],

              // ----------------------------------------------- team today
              SectionTitle('Team today · ${st.length} staff${ext.isEmpty ? '' : ' + ${ext.length} external'}',
                  trailing: TextButton(
                      onPressed: () => widget.onNavigate(2), child: const Text('Manage team'))),
              if (st.isEmpty && ext.isEmpty)
                const Card(
                  child: EmptyState(
                    icon: Icons.group_add_outlined,
                    title: 'No employees yet',
                    message: 'Go to Team → Add employee to create staff logins.',
                  ),
                )
              else
                ..._teamBySite(st, live),

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
        ];
        if (!wide) {
          return RefreshIndicator(
            onRefresh: () async {},
            child: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 32), children: kids),
          );
        }
        // Big screen: one scroll for the whole page, dashboard on the left, live column on the right.
        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(flex: 11, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: kids)),
            const SizedBox(width: 16),
            Expanded(flex: 9, child: _LivePanel(me: widget.me, live: live, onNavigate: widget.onNavigate)),
          ]),
        );
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
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
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
        SectionTitle('Trips & rides today',
            trailing: TextButton(onPressed: () => onNavigate(4), child: const Text('All details'))),
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
            title: Text('${t.employeeName} · ${t.kindLabel}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
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
  /// GPS violations today (no location for an hour or more) — shown as a red flag.
  final int violations;
  const _StaffRow(this.s, {required this.onTap, this.violations = 0});

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
      title: Row(children: [
        Flexible(child: Text(s.user.name, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700))),
        if (violations > 0) ...[
          const SizedBox(width: 6),
          Pill('⚑ $violations', color: violations > 5 ? AppColors.danger : AppColors.warning),
        ],
        if (s.open?.violationMark == true) ...[
          const SizedBox(width: 6),
          const Pill('Marked', color: AppColors.danger, icon: Icons.flag),
        ],
      ]),
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

/// Overall petty cash: given, spent, with staff, waiting for approval — and each person's balance.
class _PettyCard extends StatelessWidget {
  final AdminLive live;
  final VoidCallback onOpen;
  const _PettyCard(this.live, {required this.onOpen});

  @override
  Widget build(BuildContext context) {
    final all = live.allPetty;
    final total = PettySummary.of(all);
    final byEmp = <String, List<PettyTxn>>{};
    for (final t in all) {
      byEmp.putIfAbsent(t.employeeId, () => []).add(t);
    }
    final rows = byEmp.entries
        .map((e) => (name: live.userById(e.key)?.name ?? e.value.first.employeeName, s: PettySummary.of(e.value)))
        .where((r) => r.s.balance.abs() >= 0.01 || r.s.pendingCount > 0)
        .toList()
      ..sort((a, b) => b.s.balance.compareTo(a.s.balance));
    Widget fig(String label, double v, Color c, [String? sub]) => Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label, style: const TextStyle(fontSize: 11, color: Colors.black54, fontWeight: FontWeight.w600)),
              const SizedBox(height: 2),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(fmtMoney(v), style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: c)),
              ),
              if (sub != null) Text(sub, style: const TextStyle(fontSize: 10.5, color: Colors.black45)),
            ]),
          ),
        );
    return Card(
      child: InkWell(
        onTap: onOpen,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 6),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              fig('Given', total.credited, AppColors.success),
              fig('Spent', total.spent, AppColors.danger),
              fig('With staff', total.balance, AppColors.accentDark, 'given − spent'),
              fig('Pending', total.pending, AppColors.warning, '${total.pendingCount} to approve'),
            ]),
            if (rows.isNotEmpty) ...[
              const Divider(height: 18),
              for (final r in rows.take(8))
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(children: [
                    Expanded(
                      child: Text.rich(
                        TextSpan(children: [
                          TextSpan(text: r.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                          if (r.s.pendingCount > 0)
                            TextSpan(
                                text: '  · ${r.s.pendingCount} pending ${fmtMoney(r.s.pending)}',
                                style: const TextStyle(fontSize: 12, color: AppColors.warning)),
                        ]),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Text(fmtMoney(r.s.balance),
                        style: TextStyle(fontWeight: FontWeight.w800, color: r.s.balance < 0 ? AppColors.danger : null)),
                  ]),
                ),
              if (rows.length > 8)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text('+ ${rows.length - 8} more', style: const TextStyle(fontSize: 12, color: Colors.black54)),
                ),
            ],
          ]),
        ),
      ),
    );
  }
}
