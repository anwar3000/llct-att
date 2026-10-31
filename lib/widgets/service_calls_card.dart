import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../core/utils.dart';
import '../models/models.dart';
import '../screens/service/service_jobs_screen.dart';
import '../services/service_desk.dart';

/// Home screen: my service visits (with the visit time) and requests waiting for a technician.
class ServiceCallsCard extends StatefulWidget {
  final AppUser me;
  const ServiceCallsCard({super.key, required this.me});

  @override
  State<ServiceCallsCard> createState() => _ServiceCallsCardState();
}

class _ServiceCallsCardState extends State<ServiceCallsCard> {
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    ServiceHub.attach();
  }

  @override
  void dispose() {
    ServiceHub.detach();
    super.dispose();
  }

  String _when(DateTime? d) {
    if (d == null) return 'Time not set';
    final now = DateTime.now();
    final days = DateTime(d.year, d.month, d.day).difference(DateTime(now.year, now.month, now.day)).inDays;
    final day = days == 0 ? 'Today' : days == 1 ? 'Tomorrow' : days == -1 ? 'Yesterday' : fmtDateShort(d);
    return '$day ${fmtTime(d)}';
  }

  Future<void> _accept(ServiceTicket t) async {
    setState(() => _busy = true);
    try {
      await ServiceDesk.accept(t, widget.me);
      if (mounted) showSnack(context, 'Accepted — you are responsible for this visit');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not accept: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = widget.me;
    return ValueListenableBuilder<List<ServiceTicket>?>(
      valueListenable: ServiceHub.tickets,
      builder: (context, all, _) {
        if (all == null) return const SizedBox.shrink();
        final mine = all.where((t) => t.isMine(me.id) && t.status != 'completed').toList()
          ..sort((a, b) => (a.scheduledAt ?? DateTime(2100)).compareTo(b.scheduledAt ?? DateTime(2100)));
        final waiting = all.where((t) => t.unassigned).toList();
        if (mine.isEmpty && waiting.isEmpty) return const SizedBox.shrink();
        return Card(
          margin: EdgeInsets.zero,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: Color(0xFFE3E1DC))),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                const Icon(Icons.support_agent, size: 20, color: AppColors.info),
                const SizedBox(width: 8),
                const Expanded(child: Text('Service calls', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
                TextButton(
                  style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ServiceJobsScreen(me: me))),
                  child: const Text('See all'),
                ),
              ]),
              for (final t in mine.take(4)) _jobTile(t),
              if (waiting.isNotEmpty) ...[
                if (mine.isNotEmpty) const Divider(height: 18),
                Text('${waiting.length} waiting for a technician',
                    style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.danger, fontSize: 13)),
                const SizedBox(height: 4),
                for (final t in waiting.take(3))
                  InkWell(
                    onTap: () => showTicketSheet(context, me, t),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(children: [
                        Container(width: 4, height: 34, decoration: BoxDecoration(color: t.prio.color, borderRadius: BorderRadius.circular(2))),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${t.clientName} – ${t.siteName}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                            Text(t.shortText, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                          ]),
                        ),
                        TextButton(onPressed: _busy ? null : () => _accept(t), child: const Text('Take')),
                      ]),
                    ),
                  ),
              ],
            ]),
          ),
        );
      },
    );
  }

  Widget _jobTile(ServiceTicket t) {
    final at = t.scheduledAt;
    final now = DateTime.now();
    final days = at == null ? 99 : DateTime(at.year, at.month, at.day).difference(DateTime(now.year, now.month, now.day)).inDays;
    final urgent = days <= 1;
    final notAccepted = t.status == 'assigned';
    return InkWell(
      onTap: () => showTicketSheet(context, widget.me, t),
      borderRadius: BorderRadius.circular(10),
      child: Container(
        margin: const EdgeInsets.only(top: 6),
        padding: const EdgeInsets.fromLTRB(10, 8, 6, 8),
        decoration: BoxDecoration(
          color: urgent ? const Color(0xFFEAF0FB) : const Color(0xFFF7F6F3),
          borderRadius: BorderRadius.circular(10),
          border: Border(left: BorderSide(color: t.prio.color, width: 4)),
        ),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Icon(Icons.event, size: 14, color: urgent ? AppColors.info : AppColors.muted),
                const SizedBox(width: 4),
                Text(_when(at), style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5, color: urgent ? AppColors.info : AppColors.muted)),
                const SizedBox(width: 6),
                Text(t.stat.label, style: TextStyle(fontSize: 12, color: t.stat.color, fontWeight: FontWeight.w700)),
              ]),
              const SizedBox(height: 2),
              Text('${t.clientName} – ${t.siteName}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
              Text(t.shortText, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
            ]),
          ),
          if (notAccepted)
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.success, visualDensity: VisualDensity.compact),
              onPressed: _busy ? null : () => _accept(t),
              child: const Text('Accept'),
            )
          else
            const Icon(Icons.chevron_right, color: AppColors.muted),
        ]),
      ),
    );
  }
}
