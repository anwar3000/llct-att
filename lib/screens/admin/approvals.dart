import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../widgets/common.dart';
import '../../widgets/tiles.dart';

/// Pending petty-cash entry with Approve / Reject buttons.
class PettyApproval extends StatelessWidget {
  final PettyTxn t;
  final AppUser me;
  const PettyApproval(this.t, {super.key, required this.me});

  Future<void> _review(BuildContext context, bool approve) async {
    String note = '';
    if (!approve) {
      final c = TextEditingController();
      final ok = await showDialog<bool>(
        context: context,
        builder: (d) => AlertDialog(
          title: const Text('Reject entry'),
          content: TextField(
            controller: c,
            decoration: const InputDecoration(labelText: 'Reason (shown to employee)'),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
            FilledButton(
              style: FilledButton.styleFrom(
                  backgroundColor: AppColors.danger, minimumSize: const Size(90, 40)),
              onPressed: () => Navigator.pop(d, true),
              child: const Text('Reject'),
            ),
          ],
        ),
      );
      if (ok != true) return;
      note = c.text.trim();
    }
    try {
      await Db.reviewPetty(t.id, approve, me.name, note: note);
      if (context.mounted) {
        showSnack(context, approve ? 'Approved ${fmtMoney(t.amount)}' : 'Rejected');
      }
    } catch (e) {
      if (context.mounted) showSnack(context, 'Failed: $e', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PettyTile(
      t,
      showName: true,
      actions: Row(children: [
        Expanded(
          child: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.danger, minimumSize: const Size.fromHeight(38)),
            onPressed: () => _review(context, false),
            icon: const Icon(Icons.close, size: 18),
            label: const Text('Reject'),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: FilledButton.icon(
            style: FilledButton.styleFrom(
                backgroundColor: AppColors.success, minimumSize: const Size.fromHeight(38)),
            onPressed: () => _review(context, true),
            icon: const Icon(Icons.check, size: 18),
            label: const Text('Approve'),
          ),
        ),
      ]),
    );
  }
}

/// Pending off-day request with Approve / Reject buttons.
class OffDayApproval extends StatelessWidget {
  final OffDay o;
  const OffDayApproval(this.o, {super.key});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
        child: Row(children: [
          Avatar(o.employeeName, size: 38),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(o.employeeName, style: const TextStyle(fontWeight: FontWeight.w700)),
              Text(
                'Off day · ${fmtDate(parseDateKey(o.date))}${o.reason.isEmpty ? '' : '\n${o.reason}'}',
                style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
              ),
            ]),
          ),
          IconButton.filledTonal(
            tooltip: 'Reject',
            style: IconButton.styleFrom(foregroundColor: AppColors.danger),
            onPressed: () => Db.reviewOffDay(o.id, false),
            icon: const Icon(Icons.close),
          ),
          const SizedBox(width: 4),
          IconButton.filled(
            tooltip: 'Approve',
            style: IconButton.styleFrom(backgroundColor: AppColors.success),
            onPressed: () => Db.reviewOffDay(o.id, true),
            icon: const Icon(Icons.check),
          ),
        ]),
      ),
    );
  }
}
