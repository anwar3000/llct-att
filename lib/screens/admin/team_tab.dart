import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../widgets/common.dart';
import '../../widgets/site_workforce.dart' show kExtColor;
import 'admin_live.dart';
import 'employee_detail_screen.dart';
import 'employee_form.dart';
import 'staff_status.dart';

class TeamTab extends StatefulWidget {
  final AppUser me;
  final AdminLive live;
  const TeamTab({super.key, required this.me, required this.live});

  @override
  State<TeamTab> createState() => _TeamTabState();
}

class _TeamTabState extends State<TeamTab> {
  String _q = '';
  StaffState? _filter;
  bool _extOnly = false;

  List<Widget> _extCards({bool onlyOnSite = false}) {
    final ext = widget.live.externalToday.where((x) => !onlyOnSite || x.onSite).toList();
    if (ext.isEmpty) return const [];
    return [
      Padding(
        padding: const EdgeInsets.fromLTRB(4, 8, 4, 8),
        child: Text('External workers ${onlyOnSite ? 'on site' : 'today'} · ${ext.length}',
            style: const TextStyle(color: kExtColor, fontWeight: FontWeight.w800)),
      ),
      for (final x in ext)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Card(
            color: const Color(0xFFFFFAF2),
            child: ListTile(
              leading: Avatar(x.e.workerName, ring: kExtColor),
              title: Text(x.e.workerName, style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text(
                [if (x.e.company.isNotEmpty) x.e.company, x.e.siteName, 'with ${x.e.employeeName}'].join(' · '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Pill(x.onSite ? 'On site' : 'Done', color: x.onSite ? AppColors.success : kExtColor),
                  const SizedBox(height: 4),
                  Text(fmtDuration(x.time), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                ],
              ),
            ),
          ),
        ),
    ];
  }

  void _open(AppUser u) => Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => EmployeeDetailScreen(me: widget.me, userId: u.id, live: widget.live),
      ));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: !widget.me.isAdmin
          ? null
          : FloatingActionButton.extended(
              heroTag: 'addEmp',
              onPressed: () => Navigator.of(context)
                  .push(MaterialPageRoute(builder: (_) => const EmployeeFormScreen())),
              icon: const Icon(Icons.person_add_alt_1),
              label: const Text('Add person'),
            ),
      body: ListenableBuilder(
        listenable: widget.live,
        builder: (context, _) {
          final live = widget.live;
          final all = live.statuses;
          final q = _q.toLowerCase();
          final list = all.where((s) {
            if (_filter != null && s.state != _filter) return false;
            if (q.isEmpty) return true;
            return s.user.name.toLowerCase().contains(q) ||
                s.user.loginId.toLowerCase().contains(q) ||
                s.user.phone.contains(q) ||
                s.user.designation.toLowerCase().contains(q);
          }).toList();
          final inactive = live.employees.where((u) => !u.active).toList();
          final admins = live.users.where((u) => u.isManagement).toList();
          int count(StaffState st) => all.where((s) => s.state == st).length;

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
            children: [
              TextField(
                onChanged: (v) => setState(() => _q = v),
                decoration: const InputDecoration(
                  hintText: 'Search name, ID, phone…',
                  prefixIcon: Icon(Icons.search),
                ),
              ),
              const SizedBox(height: 10),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(children: [
                  _f('All (${all.length})', null),
                  _f('On duty (${count(StaffState.onDuty)})', StaffState.onDuty),
                  _f('Checked out (${count(StaffState.done)})', StaffState.done),
                  _f('Not in (${count(StaffState.notIn)})', StaffState.notIn),
                  _f('Off (${count(StaffState.off)})', StaffState.off),
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: FilterChip(
                      label: Text('External today (${widget.live.externalToday.length})'),
                      selected: _extOnly,
                      selectedColor: kExtColor.withValues(alpha: 0.2),
                      onSelected: (v) => setState(() => _extOnly = v),
                    ),
                  ),
                ]),
              ),
              const SizedBox(height: 10),
              if (_extOnly)
                ..._extCards()
              else if (list.isEmpty)
                const Card(
                  child: EmptyState(icon: Icons.person_search_outlined, title: 'No matching staff'),
                )
              else
                ...list.map((s) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Card(
                        child: ListTile(
                          onTap: () => _open(s.user),
                          leading: Avatar(s.user.name, ring: s.color),
                          title: Text(s.user.name,
                              style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text(
                            [
                              if (s.user.designation.isNotEmpty) s.user.designation,
                              'ID ${s.user.loginId}',
                              'Off: ${s.user.weeklyOffDays.isEmpty ? 'flexible' : s.user.weeklyOffDays.map((w) => weekdayShort[w]).join('/')}',
                            ].join(' · '),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              s.pill,
                              if (s.worked > Duration.zero) ...[
                                const SizedBox(height: 4),
                                Text(fmtDuration(s.worked),
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w700, fontSize: 12.5)),
                              ],
                            ],
                          ),
                        ),
                      ),
                    )),
              if (!_extOnly && (_filter == null || _filter == StaffState.onDuty))
                ..._extCards(onlyOnSite: _filter == StaffState.onDuty),
              if (admins.isNotEmpty) ...[
                const SectionTitle('Admins & managers'),
                ...admins.map((u) => Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        leading: Avatar(u.name),
                        title: Text(u.name),
                        subtitle: Text('ID ${u.loginId}'),
                        trailing: Pill(u.isAdmin ? 'Admin' : 'Manager',
                            color: u.isAdmin ? const Color(0xFF8E5CC4) : AppColors.info),
                        onTap: u.id == widget.me.id || !widget.me.isAdmin
                            ? null
                            : () => Navigator.of(context).push(MaterialPageRoute(
                                builder: (_) => EmployeeFormScreen(existing: u))),
                      ),
                    )),
              ],
              if (inactive.isNotEmpty) ...[
                const SectionTitle('Deactivated'),
                ...inactive.map((u) => Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        leading: Avatar(u.name),
                        title: Text(u.name, style: const TextStyle(color: AppColors.muted)),
                        subtitle: Text('ID ${u.loginId}'),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => _open(u),
                      ),
                    )),
              ],
            ],
          );
        },
      ),
    );
  }

  Widget _f(String label, StaffState? v) => Padding(
        padding: const EdgeInsets.only(right: 8),
        child: ChoiceChip(
          label: Text(label),
          selected: !_extOnly && _filter == v,
          onSelected: (_) => setState(() {
            _filter = v;
            _extOnly = false;
          }),
        ),
      );
}
