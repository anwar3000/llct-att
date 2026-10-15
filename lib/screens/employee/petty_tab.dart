import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../widgets/common.dart';
import '../../widgets/petty_form.dart';
import '../../widgets/tiles.dart';

class PettyTab extends StatefulWidget {
  final AppUser me;
  const PettyTab({super.key, required this.me});

  @override
  State<PettyTab> createState() => _PettyTabState();
}

class _PettyTabState extends State<PettyTab> {
  late final Stream<List<PettyTxn>> _stream = Db.pettyForEmployee(widget.me.id);
  String _filter = 'All';

  static const _filters = ['All', 'Received', 'Spent', 'Pending'];

  Future<void> _add(String type) async {
    await showPettyForm(context, me: widget.me, employee: widget.me, type: type, asManager: false);
  }

  @override
  Widget build(BuildContext context) {
    return StreamView<List<PettyTxn>>(
      stream: _stream,
      builder: (context, txns) {
        final summary = PettySummary.of(txns);
        final filtered = txns.where((t) {
          switch (_filter) {
            case 'Received':
              return t.isCredit;
            case 'Spent':
              return !t.isCredit;
            case 'Pending':
              return t.isPending;
            default:
              return true;
          }
        }).toList();

        // Group by month for readability.
        final groups = <String, List<PettyTxn>>{};
        for (final t in filtered) {
          final d = t.createdAt ?? DateTime.now();
          groups.putIfAbsent(fmtMonth(d), () => []).add(t);
        }

        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
          children: [
            PettyBalanceCard(summary, title: 'My petty cash balance'),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
                  onPressed: () => _add('expense'),
                  icon: const Icon(Icons.remove_circle_outline),
                  label: const Text('Add expense'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: AppColors.success),
                  onPressed: () => _add('credit'),
                  icon: const Icon(Icons.add_circle_outline),
                  label: const Text('Cash received'),
                ),
              ),
            ]),
            const SizedBox(height: 6),
            const Text(
              'Expenses and cash you record stay "Pending" until management approves them. '
              'Only approved entries change your balance.',
              style: TextStyle(fontSize: 12, color: AppColors.muted),
            ),
            const SizedBox(height: 14),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: _filters
                    .map((f) => Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text(f),
                            selected: _filter == f,
                            onSelected: (_) => setState(() => _filter = f),
                          ),
                        ))
                    .toList(),
              ),
            ),
            if (filtered.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 12),
                child: Card(
                  child: EmptyState(
                      icon: Icons.account_balance_wallet_outlined,
                      title: 'No transactions',
                      message: 'Your petty cash history will appear here.'),
                ),
              ),
            for (final e in groups.entries) ...[
              SectionTitle(e.key,
                  trailing: Text(
                    '−${fmtMoney(e.value.where((t) => !t.isCredit && t.isApproved).fold<double>(0, (a, t) => a + t.amount))}',
                    style: const TextStyle(color: AppColors.muted, fontSize: 13),
                  )),
              ...e.value.map((t) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: PettyTile(
                      t,
                      actions: t.isPending
                          ? Align(
                              alignment: Alignment.centerRight,
                              child: TextButton.icon(
                                onPressed: () async {
                                  if (await confirm(context, 'Delete entry?',
                                      'Delete this pending ${t.isCredit ? 'cash entry' : 'expense'} of ${fmtMoney(t.amount)}?',
                                      danger: true, ok: 'Delete')) {
                                    await Db.deletePetty(t.id);
                                  }
                                },
                                icon: const Icon(Icons.delete_outline, size: 18),
                                label: const Text('Delete'),
                              ),
                            )
                          : null,
                    ),
                  )),
            ],
          ],
        );
      },
    );
  }
}
