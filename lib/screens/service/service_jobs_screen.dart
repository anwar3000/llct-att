import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/location_service.dart';
import '../../services/service_desk.dart';
import '../../widgets/common.dart';

/// Service requests from clients: new requests to pick up, my jobs, and (for assigners) everything open.
class ServiceJobsScreen extends StatefulWidget {
  final AppUser me;
  final String? openTicketId;
  const ServiceJobsScreen({super.key, required this.me, this.openTicketId});

  @override
  State<ServiceJobsScreen> createState() => _ServiceJobsScreenState();
}

class _ServiceJobsScreenState extends State<ServiceJobsScreen> {
  ({double lat, double lng})? _here;

  @override
  void initState() {
    super.initState();
    ServiceHub.attach();
    final ll = widget.me.lastLocation;
    if (ll != null) _here = (lat: ll.lat, lng: ll.lng);
    LocationService.current().then((p) {
      if (mounted) setState(() => _here = (lat: p.latitude, lng: p.longitude));
    }).catchError((_) {});
    final id = widget.openTicketId;
    if (id != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final t = (ServiceHub.tickets.value ?? const <ServiceTicket>[]).where((x) => x.id == id).firstOrNull;
        if (t != null && mounted) showTicketSheet(context, widget.me, t);
      });
    }
  }

  @override
  void dispose() {
    ServiceHub.detach();
    super.dispose();
  }

  double? _dist(ServiceTicket t) =>
      (_here == null || !t.hasGps) ? null : LocationService.distance(_here!.lat, _here!.lng, t.lat!, t.lng!);

  List<ServiceTicket> _sorted(Iterable<ServiceTicket> l) {
    const po = {'critical': 0, 'high': 1, 'normal': 2, 'low': 3};
    final out = l.toList()
      ..sort((a, b) {
        final p = (po[a.priority] ?? 2).compareTo(po[b.priority] ?? 2);
        if (p != 0) return p;
        final da = _dist(a), db = _dist(b);
        if (da != null && db != null) return da.compareTo(db);
        return (b.createdAt ?? DateTime(2000)).compareTo(a.createdAt ?? DateTime(2000));
      });
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final me = widget.me;
    final tabs = ['New', 'My jobs', if (me.assignsService) 'All open'];
    return DefaultTabController(
      length: tabs.length,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Service requests'),
          bottom: TabBar(
            labelColor: AppColors.primaryDark,
            indicatorColor: AppColors.accent,
            tabs: tabs.map((t) => Tab(text: t)).toList(),
          ),
        ),
        body: ValueListenableBuilder<List<ServiceTicket>?>(
          valueListenable: ServiceHub.tickets,
          builder: (context, all, _) {
            if (all == null) return const Center(child: CircularProgressIndicator());
            final err = ServiceHub.error.value;
            final lists = [
              _sorted(all.where((t) => t.unassigned)),
              _sorted(all.where((t) => t.isMine(me.id))),
              if (me.assignsService) _sorted(all),
            ];
            return TabBarView(
              children: List.generate(lists.length, (i) {
                final l = lists[i];
                if (err != null && all.isEmpty) {
                  return const EmptyState(
                      icon: Icons.lock_outline,
                      title: 'Service requests are not available',
                      message: 'Ask the admin to publish the latest Firestore rules.');
                }
                if (l.isEmpty) {
                  return EmptyState(
                      icon: Icons.support_agent_outlined,
                      title: i == 0 ? 'No new requests' : i == 1 ? 'No jobs assigned to you' : 'Nothing open',
                      message: i == 0 ? 'New client requests pop up here.' : null);
                }
                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
                  itemCount: l.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (c, k) => _TicketCard(t: l[k], dist: _dist(l[k]), me: me),
                );
              }),
            );
          },
        ),
      ),
    );
  }
}

class _TicketCard extends StatelessWidget {
  final ServiceTicket t;
  final double? dist;
  final AppUser me;
  const _TicketCard({required this.t, required this.dist, required this.me});

  @override
  Widget build(BuildContext context) {
    final p = t.prio, s = t.stat;
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => showTicketSheet(context, me, t),
        child: Container(
          decoration: BoxDecoration(border: Border(left: BorderSide(color: p.color, width: 5))),
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Wrap(spacing: 6, runSpacing: 4, children: [
                  Pill(p.label, color: p.color),
                  Pill(s.label, color: s.color),
                  if (t.overdue) const Pill('Overdue', color: AppColors.danger),
                ]),
              ),
              if (dist != null)
                Text(fmtDistance(dist), style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink)),
            ]),
            const SizedBox(height: 8),
            Text(t.clientName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15.5)),
            Text(t.siteName, style: const TextStyle(color: AppColors.ink)),
            const SizedBox(height: 4),
            Text('${t.typeLabel} — ${t.description}',
                maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.muted, fontSize: 13)),
            const SizedBox(height: 6),
            Row(children: [
              const Icon(Icons.schedule, size: 14, color: AppColors.muted),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                    t.scheduledAt != null
                        ? 'Visit ${fmtDateTime(t.scheduledAt)}'
                        : 'Preferred ${_prefText(t)}',
                    style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
              ),
              Text(t.assignedName.isEmpty ? timeAgo(t.createdAt) : t.assignedName,
                  style: const TextStyle(fontSize: 12.5, color: AppColors.muted, fontWeight: FontWeight.w600)),
            ]),
          ]),
        ),
      ),
    );
  }
}

String _prefText(ServiceTicket t) {
  final d = DateTime.tryParse(t.preferredDate);
  final slot = (svcSlots[t.preferredSlot] ?? '').split(' (').first;
  return [if (d != null) fmtDateShort(d), if (slot.isNotEmpty) slot].join(' · ');
}

/// Ticket details with the actions this person may take.
Future<void> showTicketSheet(BuildContext context, AppUser me, ServiceTicket ticket) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useSafeArea: true,
    builder: (c) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      minChildSize: 0.4,
      maxChildSize: 0.95,
      builder: (c, scroll) => ValueListenableBuilder<List<ServiceTicket>?>(
        valueListenable: ServiceHub.tickets,
        builder: (c, all, _) {
          // live copy (falls back to the one we were given, e.g. after it was closed)
          final t = (all ?? const <ServiceTicket>[]).where((x) => x.id == ticket.id).firstOrNull ?? ticket;
          return _TicketDetail(t: t, me: me, scroll: scroll);
        },
      ),
    ),
  );
}

class _TicketDetail extends StatefulWidget {
  final ServiceTicket t;
  final AppUser me;
  final ScrollController scroll;
  const _TicketDetail({required this.t, required this.me, required this.scroll});

  @override
  State<_TicketDetail> createState() => _TicketDetailState();
}

class _TicketDetailState extends State<_TicketDetail> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() f, String ok) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await f();
      if (mounted) showSnack(context, ok);
    } catch (e) {
      if (mounted) showSnack(context, 'Could not update: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.t, me = widget.me;
    final mine = t.isMine(me.id), canAssign = me.assignsService;
    final p = t.prio, s = t.stat;
    final actions = <Widget>[];
    void add(String label, IconData icon, VoidCallback? onTap, {Color? color, bool filled = false}) {
      actions.add(filled
          ? FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: color ?? AppColors.primary),
              onPressed: _busy ? null : onTap,
              icon: Icon(icon, size: 18),
              label: Text(label))
          : OutlinedButton.icon(
              style: color == null ? null : OutlinedButton.styleFrom(foregroundColor: color),
              onPressed: _busy ? null : onTap,
              icon: Icon(icon, size: 18),
              label: Text(label)));
    }

    if (t.open) {
      if (t.unassigned) {
        add('Take this job', Icons.pan_tool_alt_outlined, () => _run(() => ServiceDesk.accept(t, me), 'Job accepted'),
            color: AppColors.success, filled: true);
      }
      if (mine && t.status == 'assigned') {
        add('Accept job', Icons.check, () => _run(() => ServiceDesk.accept(t, me), 'Job accepted'),
            color: AppColors.success, filled: true);
      }
      if ((mine || canAssign) && t.assignedTo.isNotEmpty && ['assigned', 'accepted'].contains(t.status)) {
        add('On the way', Icons.directions_car_outlined, () => _run(() => ServiceDesk.setStatus(t, me, 'on_way'), 'Marked on the way'));
      }
      if ((mine || canAssign) && t.assignedTo.isNotEmpty && ['assigned', 'accepted', 'on_way'].contains(t.status)) {
        add('Arrived at site', Icons.place_outlined, () => _run(() => ServiceDesk.setStatus(t, me, 'on_site'), 'Marked at site'));
      }
      if ((mine || canAssign) && t.assignedTo.isNotEmpty && t.status != 'new' && t.status != 'completed') {
        add('Work completed', Icons.task_alt, () => _run(() => ServiceDesk.setStatus(t, me, 'completed'), 'Marked completed'),
            color: AppColors.success, filled: true);
      }
      if (canAssign) {
        add(t.assignedTo.isEmpty ? 'Assign technician' : 'Re-assign', Icons.engineering_outlined,
            () => showAssignSheet(context, me, t), color: AppColors.accentDark, filled: true);
      }
      if (mine && !canAssign) {
        add('Hand back', Icons.undo, () async {
          final reason = await _ask(context, 'Hand back this job', 'Reason (optional)');
          if (reason == null) return;
          await _run(() => ServiceDesk.handBack(t, me, reason), 'Job handed back');
        }, color: AppColors.danger);
      }
    }
    if (mine || canAssign) {
      add(t.reportId.isEmpty ? 'Make service report' : 'New service report', Icons.description_outlined,
          () => ServiceDesk.openReport(t));
    }
    if (t.reportId.isNotEmpty) add(t.reportNo.isEmpty ? 'Service report' : t.reportNo, Icons.picture_as_pdf_outlined, () => ServiceDesk.openReportView(t));

    return ListView(controller: widget.scroll, padding: const EdgeInsets.fromLTRB(16, 0, 16, 28), children: [
      Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        Text(t.number, style: const TextStyle(fontWeight: FontWeight.w800, fontFamily: 'monospace')),
        Pill(p.label, color: p.color),
        Pill(s.label, color: s.color),
        if (t.overdue) const Pill('Overdue', color: AppColors.danger),
      ]),
      const SizedBox(height: 12),
      Text(t.clientName, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
      Text(t.siteName, style: const TextStyle(fontSize: 15)),
      if (t.siteAddress.isNotEmpty) Text(t.siteAddress, style: const TextStyle(color: AppColors.muted)),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(
          child: FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: AppColors.accent, foregroundColor: AppColors.primaryDark),
            onPressed: () => ServiceDesk.navigate(t),
            icon: const Icon(Icons.navigation_outlined),
            label: Text(t.hasGps ? 'Navigate to site' : 'Search address'),
          ),
        ),
        if (t.contactPhone.isNotEmpty) ...[
          const SizedBox(width: 8),
          OutlinedButton.icon(
              onPressed: () => ServiceDesk.call(t.contactPhone), icon: const Icon(Icons.call_outlined), label: const Text('Call')),
        ],
      ]),
      const SizedBox(height: 14),
      InfoRow(Icons.build_outlined, 'Service', t.typeLabel),
      InfoRow(Icons.notes, 'Problem', t.description),
      if (t.cameras > 0) InfoRow(Icons.videocam_outlined, 'Devices', '${t.cameras}'),
      InfoRow(Icons.event_outlined, 'Preferred', _prefText(t)),
      if (t.scheduledAt != null) InfoRow(Icons.event_available_outlined, 'Visit', fmtDateTime(t.scheduledAt)),
      if (t.respondBy != null) InfoRow(Icons.timer_outlined, 'Respond by', fmtDateTime(t.respondBy)),
      InfoRow(Icons.person_outline, 'Contact', [t.contactName, t.contactPhone].where((x) => x.isNotEmpty).join(' · ')),
      InfoRow(Icons.engineering_outlined, 'Technician', t.assignedName.isEmpty ? 'Not assigned' : t.assignedName),
      if (t.techNote.isNotEmpty) InfoRow(Icons.sticky_note_2_outlined, 'Note', t.techNote),
      InfoRow(Icons.access_time, 'Raised', '${fmtDateTime(t.createdAt)} · ${t.source == 'staff' ? 'by staff' : 'client link'}'),
      if (t.photos.isNotEmpty) ...[
        const SizedBox(height: 10),
        SizedBox(
          height: 96,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: t.photosBase64.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (c, i) => GestureDetector(
              onTap: () => showDialog(
                  context: context,
                  builder: (_) => Dialog(child: InteractiveViewer(child: Base64Image(t.photosBase64[i], fit: BoxFit.contain)))),
              child: ClipRRect(
                  borderRadius: BorderRadius.circular(10), child: Base64Image(t.photosBase64[i], width: 96, height: 96)),
            ),
          ),
        ),
      ],
      const SizedBox(height: 16),
      Wrap(spacing: 8, runSpacing: 8, children: actions),
      const SectionTitle('Timeline'),
      ...t.log.reversed.map((l) {
        final at = l['at'];
        final DateTime? when = at is Timestamp ? at.toDate() : (at is DateTime ? at : null);
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Padding(padding: EdgeInsets.only(top: 5), child: Icon(Icons.circle, size: 9, color: AppColors.accent)),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${l['t'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w600)),
                Text([fmtDateTime(when), '${l['byName'] ?? ''}'].where((x) => x.isNotEmpty && x != '-').join(' · '),
                    style: const TextStyle(fontSize: 12, color: AppColors.muted)),
              ]),
            ),
          ]),
        );
      }),
      if (mine || canAssign)
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: () async {
              final v = await _ask(context, 'Add a note', 'Note');
              if (v == null || v.isEmpty) return;
              await _run(() => ServiceDesk.addNote(t, me, v), 'Note added');
            },
            icon: const Icon(Icons.add_comment_outlined),
            label: const Text('Add note'),
          ),
        ),
    ]);
  }
}

Future<String?> _ask(BuildContext context, String title, String hint) {
  final c = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (d) => AlertDialog(
      title: Text(title),
      content: TextField(controller: c, autofocus: true, decoration: InputDecoration(hintText: hint), maxLines: 3, minLines: 1),
      actions: [
        TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: const Text('OK')),
      ],
    ),
  );
}

/// Pick the technician (nearest first, using live locations) and the visit time.
Future<void> showAssignSheet(BuildContext context, AppUser me, ServiceTicket t) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useSafeArea: true,
    builder: (c) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      builder: (c, scroll) => _AssignSheet(me: me, t: t, scroll: scroll),
    ),
  );
}

class _AssignSheet extends StatefulWidget {
  final AppUser me;
  final ServiceTicket t;
  final ScrollController scroll;
  const _AssignSheet({required this.me, required this.t, required this.scroll});

  @override
  State<_AssignSheet> createState() => _AssignSheetState();
}

class _AssignSheetState extends State<_AssignSheet> {
  String? _pick;
  DateTime? _when;
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final t = widget.t;
    _pick = t.assignedTo.isEmpty ? null : t.assignedTo;
    if (t.scheduledAt != null) {
      _when = t.scheduledAt;
    } else {
      final d = DateTime.tryParse(t.preferredDate) ?? DateTime.now();
      final h = {'morning': 9, 'afternoon': 13, 'evening': 17}[t.preferredSlot];
      final soon = DateTime.now().add(const Duration(hours: 2));
      final wanted = DateTime(d.year, d.month, d.day, h ?? 9);
      // never in the past
      _when = soon.isAfter(wanted) ? DateTime(soon.year, soon.month, soon.day, soon.hour) : wanted;
    }
  }

  Future<void> _pickWhen() async {
    final now = DateTime.now();
    final d = await showDatePicker(
        context: context, initialDate: _when ?? now, firstDate: now.subtract(const Duration(days: 1)), lastDate: now.add(const Duration(days: 120)));
    if (d == null || !mounted) return;
    final tm = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_when ?? now));
    if (tm == null) return;
    setState(() => _when = DateTime(d.year, d.month, d.day, tm.hour, tm.minute));
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.t;
    final open = ServiceHub.tickets.value ?? const <ServiceTicket>[];
    return StreamBuilder<List<AppUser>>(
      stream: ServiceDesk.staff(),
      builder: (c, snap) {
        if (snap.hasError) return Padding(padding: const EdgeInsets.all(16), child: Text('Error: ${snap.error}'));
        if (!snap.hasData) return const Center(child: CircularProgressIndicator());
        final rows = snap.data!.where((u) => ['employee', 'manager', 'admin'].contains(u.role)).map((u) {
          final ll = u.lastLocation;
          final d = (ll != null && t.hasGps) ? LocationService.distance(ll.lat, ll.lng, t.lat!, t.lng!) : null;
          final jobs = open.where((x) => x.assignedTo == u.id).length;
          return (u: u, d: d, ll: ll, jobs: jobs, onDuty: ll != null && ll.checkedIn && ll.isFresh);
        }).toList()
          ..sort((a, b) {
            if ((a.d == null) != (b.d == null)) return a.d == null ? 1 : -1;
            if (a.d != null && b.d != null) {
              final x = a.d!.compareTo(b.d!);
              if (x != 0) return x;
            }
            return a.jobs.compareTo(b.jobs);
          });
        return ListView(controller: widget.scroll, padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), children: [
          Text('Assign ${t.number}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          Text('${t.clientName} – ${t.siteName}', style: const TextStyle(color: AppColors.muted)),
          Text(t.hasGps ? 'Nearest staff first (live location).' : 'This site has no GPS — sorted by workload.',
              style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
          const SizedBox(height: 10),
          ...rows.map((r) => Card(
                elevation: 0,
                color: _pick == r.u.id ? AppColors.accentSoft : Colors.white,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(color: _pick == r.u.id ? AppColors.accent : const Color(0xFFEBE8E3), width: 1.5)),
                child: ListTile(
                  onTap: () => setState(() => _pick = r.u.id),
                  leading: Avatar(r.u.name, size: 38),
                  title: Text(r.u.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text(
                      '${r.onDuty ? 'On duty${r.ll!.siteName.isNotEmpty ? ' at ${r.ll!.siteName}' : ''}' : r.ll?.at != null ? 'Seen ${timeAgo(r.ll!.at)}' : 'No location'} · ${r.jobs} open job${r.jobs == 1 ? '' : 's'}',
                      style: TextStyle(color: r.onDuty ? AppColors.success : AppColors.muted, fontSize: 12.5)),
                  trailing: Text(r.d == null ? '—' : fmtDistance(r.d), style: const TextStyle(fontWeight: FontWeight.w800)),
                ),
              )),
          const SizedBox(height: 10),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.event_available_outlined),
            title: const Text('Visit date & time'),
            subtitle: Text(_when == null ? 'As per preferred time' : fmtDateTime(_when)),
            trailing: TextButton(onPressed: _pickWhen, child: const Text('Change')),
          ),
          TextField(controller: _note, decoration: const InputDecoration(labelText: 'Note for the technician (optional)')),
          const SizedBox(height: 16),
          FilledButton.icon(
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
            onPressed: _busy || _pick == null
                ? null
                : () async {
                    final tech = snap.data!.firstWhere((u) => u.id == _pick);
                    final nav = Navigator.of(context);
                    final msg = ScaffoldMessenger.of(context);
                    setState(() => _busy = true);
                    try {
                      await ServiceDesk.assign(t, widget.me, tech, _when, note: _note.text.trim());
                      nav.pop();
                      msg.showSnackBar(SnackBar(content: Text('Assigned to ${tech.name}'), behavior: SnackBarBehavior.floating));
                    } catch (e) {
                      msg.showSnackBar(SnackBar(
                          content: Text('Could not assign: $e'),
                          behavior: SnackBarBehavior.floating,
                          backgroundColor: AppColors.danger));
                      if (mounted) setState(() => _busy = false);
                    }
                  },
            icon: const Icon(Icons.engineering_outlined),
            label: const Text('Assign'),
          ),
        ]);
      },
    );
  }
}
