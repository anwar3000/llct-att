import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../widgets/common.dart';
import '../../widgets/petty_form.dart';
import '../../widgets/tiles.dart';
import 'admin_live.dart';
import 'approvals.dart';

class PettyAdminTab extends StatefulWidget {
  final AppUser me;
  final AdminLive live;
  const PettyAdminTab({super.key, required this.me, required this.live});

  @override
  State<PettyAdminTab> createState() => _PettyAdminTabState();
}

class _PettyAdminTabState extends State<PettyAdminTab> {
  late final Stream<List<PettyTxn>> _all = Db.pettyAll(limit: 2000);
  String? _employeeId;
  String _type = 'All';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'giveCash',
        onPressed: () => showPettyForm(
          context,
          me: widget.me,
          employee: widget.live.activeEmployees.where((u) => u.id == _employeeId).firstOrNull,
          employees: widget.live.activeEmployees,
          type: 'credit',
          asManager: true,
        ),
        icon: const Icon(Icons.payments_outlined),
        label: const Text('Give cash'),
      ),
      body: StreamView<List<PettyTxn>>(
        stream: _all,
        builder: (context, all) {
          final total = PettySummary.of(all);
          final pending = all.where((t) => t.isPending).toList();

          // Per-employee balances
          final byEmp = <String, List<PettyTxn>>{};
          for (final t in all) {
            byEmp.putIfAbsent(t.employeeId, () => []).add(t);
          }
          final balances = byEmp.entries
              .map((e) => (
                    id: e.key,
                    name: widget.live.userById(e.key)?.name ?? e.value.first.employeeName,
                    s: PettySummary.of(e.value),
                  ))
              .toList()
            ..sort((a, b) => b.s.balance.compareTo(a.s.balance));

          final filtered = all.where((t) {
            if (_employeeId != null && t.employeeId != _employeeId) return false;
            if (_type == 'Cash given' && !t.isCredit) return false;
            if (_type == 'Expenses' && t.isCredit) return false;
            if (_type == 'Rejected' && t.status != 'rejected') return false;
            return true;
          }).toList();

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
            children: [
              StatGrid(children: [
                StatTile(
                  label: 'Cash given (approved)',
                  value: fmtMoney(total.credited),
                  icon: Icons.south_west,
                  color: AppColors.success,
                ),
                StatTile(
                  label: 'Spent (approved)',
                  value: fmtMoney(total.spent),
                  icon: Icons.north_east,
                  color: AppColors.danger,
                ),
                StatTile(
                  label: 'Cash with staff',
                  value: fmtMoney(total.balance),
                  icon: Icons.account_balance_wallet_outlined,
                  color: AppColors.primary,
                  sub: 'Given − spent',
                ),
                StatTile(
                  label: 'Pending approval',
                  value: fmtMoney(total.pending),
                  icon: Icons.pending_actions_outlined,
                  color: AppColors.warning,
                  sub: '${pending.length} entr${pending.length == 1 ? 'y' : 'ies'}',
                ),
              ]),
              if (pending.isNotEmpty) ...[
                SectionTitle('Waiting for approval (${pending.length})'),
                ...pending.map((t) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: PettyApproval(t, me: widget.me),
                    )),
              ],
              const SectionTitle('Balance by employee'),
              if (balances.isEmpty)
                const Card(
                  child: EmptyState(
                      icon: Icons.account_balance_wallet_outlined,
                      title: 'No petty cash yet',
                      message: 'Tap "Give cash" to record an advance to an employee.'),
                )
              else
                Card(
                  child: Column(
                    children: [
                      for (var i = 0; i < balances.length; i++) ...[
                        if (i > 0) const Divider(height: 1, indent: 64),
                        ListTile(
                          selected: _employeeId == balances[i].id,
                          selectedTileColor: AppColors.primary.withValues(alpha: 0.06),
                          onTap: () => setState(() => _employeeId =
                              _employeeId == balances[i].id ? null : balances[i].id),
                          leading: Avatar(balances[i].name, size: 38),
                          title: Text(balances[i].name,
                              style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text(
                              'Got ${fmtMoney(balances[i].s.credited)} · spent ${fmtMoney(balances[i].s.spent)}'
                              '${balances[i].s.pendingCount > 0 ? ' · ${balances[i].s.pendingCount} pending' : ''}',
                              style: const TextStyle(fontSize: 12.5)),
                          trailing: Text(
                            fmtMoney(balances[i].s.balance),
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 15,
                              color: balances[i].s.balance < 0 ? AppColors.danger : AppColors.ink,
                            ),
                          ),
                        ),
                      ]
                    ],
                  ),
                ),
              SectionTitle(
                _employeeId == null
                    ? 'All transactions'
                    : 'Transactions · ${widget.live.userById(_employeeId!)?.name ?? ''}',
                trailing: _employeeId == null
                    ? null
                    : TextButton(
                        onPressed: () => setState(() => _employeeId = null),
                        child: const Text('Show all')),
              ),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: ['All', 'Cash given', 'Expenses', 'Rejected']
                      .map((f) => Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ChoiceChip(
                              label: Text(f),
                              selected: _type == f,
                              onSelected: (_) => setState(() => _type = f),
                            ),
                          ))
                      .toList(),
                ),
              ),
              const SizedBox(height: 8),
              if (filtered.isEmpty)
                const Card(child: EmptyState(icon: Icons.receipt_long_outlined, title: 'Nothing here'))
              else
                ...filtered.take(200).map((t) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: PettyTile(
                        t,
                        showName: true,
                        onTap: () => _txnActions(t),
                      ),
                    )),
            ],
          );
        },
      ),
    );
  }

  void _txnActions(PettyTxn t) {
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
            title: Text('${t.employeeName} · ${fmtMoney(t.amount)}',
                style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text(
                '${t.isCredit ? 'Cash given' : t.category} · ${fmtDateTime(t.createdAt)}'
                '${t.createdByName.isEmpty ? '' : '\nEntered by ${t.createdByName}'}'),
          ),
          if (t.status != 'approved')
            ListTile(
              leading: const Icon(Icons.check_circle_outline, color: AppColors.success),
              title: const Text('Mark approved'),
              onTap: () async {
                Navigator.pop(c);
                await Db.reviewPetty(t.id, true, widget.me.name);
              },
            ),
          if (t.status != 'rejected')
            ListTile(
              leading: const Icon(Icons.cancel_outlined, color: AppColors.warning),
              title: const Text('Mark rejected'),
              onTap: () async {
                Navigator.pop(c);
                await Db.reviewPetty(t.id, false, widget.me.name);
              },
            ),
          ListTile(
            leading: const Icon(Icons.delete_outline, color: AppColors.danger),
            title: const Text('Delete entry'),
            onTap: () async {
              Navigator.pop(c);
              if (await confirm(context, 'Delete entry?',
                  'Delete ${fmtMoney(t.amount)} for ${t.employeeName}?',
                  danger: true, ok: 'Delete')) {
                await Db.deletePetty(t.id);
              }
            },
          ),
        ]),
      ),
    );
  }
}
