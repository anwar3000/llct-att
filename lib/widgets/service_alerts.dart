import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/theme.dart';
import '../core/utils.dart';
import '../models/models.dart';
import '../screens/service/service_jobs_screen.dart';
import '../services/service_desk.dart';
import '../services/service_reminders.dart';

/// Wrap a shell with this to get a popup whenever a client raises a new service request,
/// or a job is assigned to the signed-in person (while the app is open).
class ServiceAlerts extends StatefulWidget {
  final AppUser me;
  final Widget child;
  const ServiceAlerts({super.key, required this.me, required this.child});

  @override
  State<ServiceAlerts> createState() => _ServiceAlertsState();
}

class _ServiceAlertsState extends State<ServiceAlerts> {
  Map<String, ServiceTicket>? _known;
  final List<(ServiceTicket, bool)> _queue = []; // (ticket, assignedToMe)
  bool _showing = false;

  @override
  void initState() {
    super.initState();
    ServiceHub.attach();
    ServiceHub.tickets.addListener(_onTickets);
    _onTickets();
  }

  @override
  void dispose() {
    ServiceHub.tickets.removeListener(_onTickets);
    ServiceHub.detach();
    super.dispose();
  }

  void _onTickets() {
    final list = ServiceHub.tickets.value;
    if (list == null) return;
    final now = {for (final t in list) t.id: t};
    final before = _known;
    _known = now;
    ServiceReminders.sync(list.where((t) => t.isMine(widget.me.id)).toList());
    if (before == null) {
      // first load: one summary of what is waiting, instead of a popup per request
      WidgetsBinding.instance.addPostFrameCallback((_) => _summary(list));
      return;
    }
    for (final t in list) {
      final old = before[t.id];
      if (old == null && t.status == 'new') {
        _queue.add((t, false));
      } else if (t.assignedTo == widget.me.id && t.status == 'assigned' && (old == null || old.assignedTo != widget.me.id)) {
        _queue.add((t, true));
        ServiceReminders.now('Service visit assigned to you', '${t.clientName} – ${t.siteName}\n${t.shortText}', t.id);
      }
    }
    _next();
  }

  static bool _summaryShown = false; // once per app session
  Future<void> _summary(List<ServiceTicket> list) async {
    if (_summaryShown || !mounted) return;
    final me = widget.me;
    final waiting = list.where((t) => t.unassigned).toList();
    final today = DateTime.now();
    bool soon(ServiceTicket t) {
      final a = t.scheduledAt;
      if (a == null) return t.status == 'assigned';
      final d = DateTime(a.year, a.month, a.day).difference(DateTime(today.year, today.month, today.day)).inDays;
      return d <= 1;
    }
    final mine = list.where((t) => t.isMine(me.id) && t.status != 'completed' && soon(t)).toList()
      ..sort((a, b) => (a.scheduledAt ?? DateTime(2100)).compareTo(b.scheduledAt ?? DateTime(2100)));
    if (waiting.isEmpty && mine.isEmpty) return;
    _summaryShown = true;
    _showing = true;
    HapticFeedback.mediumImpact();
    final go = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        icon: const Icon(Icons.support_agent, color: AppColors.info, size: 36),
        title: const Text('Service calls'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (mine.isNotEmpty) ...[
              const Text('Your visits — please attend on time', style: TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              for (final t in mine.take(5))
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                      '${t.scheduledAt == null ? 'Time not set' : fmtDateTime(t.scheduledAt)} · ${t.clientName} – ${t.siteName}${t.status == 'assigned' ? '\nNot accepted yet' : ''}',
                      style: TextStyle(fontSize: 13.5, color: t.status == 'assigned' ? AppColors.danger : AppColors.ink)),
                ),
            ],
            if (waiting.isNotEmpty) ...[
              if (mine.isNotEmpty) const SizedBox(height: 8),
              Text('${waiting.length} request${waiting.length == 1 ? '' : 's'} waiting for a technician',
                  style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.danger)),
              const SizedBox(height: 6),
              for (final t in waiting.take(4))
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text('${t.prio.label} · ${t.clientName} – ${t.siteName}', style: const TextStyle(fontSize: 13.5)),
                ),
            ],
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Later')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Open service calls')),
        ],
      ),
    );
    _showing = false;
    if (go == true && mounted) {
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ServiceJobsScreen(me: me)));
    }
    _next();
  }

  Future<void> _next() async {
    if (_showing || _queue.isEmpty || !mounted) return;
    _showing = true;
    final (t, mine) = _queue.removeAt(0);
    HapticFeedback.heavyImpact();
    SystemSound.play(SystemSoundType.alert);
    final p = t.prio;
    final me = widget.me;
    final act = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        icon: Icon(mine ? Icons.engineering : Icons.support_agent, color: p.color, size: 36),
        title: Text(mine ? 'Job assigned to you' : 'New service request'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(color: p.color, borderRadius: BorderRadius.circular(20)),
              child: Text(p.label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 12)),
            ),
            const SizedBox(width: 8),
            Text(t.number, style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5, color: AppColors.muted)),
          ]),
          const SizedBox(height: 10),
          Text(t.clientName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          Text(t.siteName),
          const SizedBox(height: 8),
          Text(t.typeLabel, style: const TextStyle(fontWeight: FontWeight.w600)),
          Text(t.description, maxLines: 4, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.muted)),
          if (t.scheduledAt != null) ...[
            const SizedBox(height: 8),
            Text('Visit: ${fmtDateTime(t.scheduledAt)}', style: const TextStyle(fontWeight: FontWeight.w600)),
          ],
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, 'later'), child: const Text('Later')),
          TextButton(onPressed: () => Navigator.pop(c, 'view'), child: const Text('View')),
          if (!mine && me.assignsService)
            FilledButton(onPressed: () => Navigator.pop(c, 'assign'), child: const Text('Assign'))
          else
            FilledButton(
                style: FilledButton.styleFrom(backgroundColor: AppColors.success),
                onPressed: () => Navigator.pop(c, 'accept'),
                child: const Text('Accept')),
        ],
      ),
    );
    if (mounted) {
      final live = (ServiceHub.tickets.value ?? const <ServiceTicket>[]).where((x) => x.id == t.id).firstOrNull ?? t;
      if (act == 'view') {
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => ServiceJobsScreen(me: me, openTicketId: t.id)));
      } else if (act == 'assign') {
        await showAssignSheet(context, me, live);
      } else if (act == 'accept') {
        if (!mine && !live.unassigned) {
          showSnack(context, 'Already taken by ${live.assignedName}', error: true);
        } else {
          try {
            await ServiceDesk.accept(live, me);
            if (mounted) showSnack(context, 'Job accepted — it is in My jobs');
          } catch (e) {
            if (mounted) showSnack(context, 'Could not accept: $e', error: true);
          }
        }
      }
    }
    _showing = false;
    _next();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// App-bar button with a badge: new requests + my open jobs.
class ServiceJobsButton extends StatelessWidget {
  final AppUser me;
  const ServiceJobsButton({super.key, required this.me});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<List<ServiceTicket>?>(
      valueListenable: ServiceHub.tickets,
      builder: (context, all, _) {
        final l = all ?? const <ServiceTicket>[];
        final newN = l.where((t) => t.unassigned).length;
        final mine = l.where((t) => t.isMine(me.id) && t.status != 'completed').length;
        final n = newN + mine;
        return IconButton(
          tooltip: 'Service requests',
          onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ServiceJobsScreen(me: me))),
          icon: Badge(
            isLabelVisible: n > 0,
            backgroundColor: newN > 0 ? AppColors.danger : AppColors.info,
            label: Text('$n'),
            child: const Icon(Icons.support_agent_outlined),
          ),
        );
      },
    );
  }
}
