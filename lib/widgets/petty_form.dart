import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/theme.dart';
import '../core/utils.dart';
import '../models/models.dart';
import '../services/db.dart';
import '../services/photo_service.dart';
import 'common.dart';

const expenseCategories = ['Fuel', 'Food', 'Travel', 'Materials', 'Tools', 'Other'];

/// Opens the add-transaction sheet.
///
/// * Employee: records an expense or cash received → status "pending".
/// * Manager ([asManager] = true): gives cash / records expense for any employee
///   → status "approved" immediately.
Future<void> showPettyForm(
  BuildContext context, {
  required AppUser me,
  AppUser? employee,
  List<AppUser> employees = const [],
  required String type,
  required bool asManager,
}) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (c) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
      child: _PettyForm(
        me: me,
        employee: employee,
        employees: employees,
        type: type,
        asManager: asManager,
      ),
    ),
  );
}

class _PettyForm extends StatefulWidget {
  final AppUser me;
  final AppUser? employee;
  final List<AppUser> employees;
  final String type;
  final bool asManager;
  const _PettyForm({
    required this.me,
    required this.employee,
    required this.employees,
    required this.type,
    required this.asManager,
  });

  @override
  State<_PettyForm> createState() => _PettyFormState();
}

class _PettyFormState extends State<_PettyForm> {
  late String _type = widget.type;
  late AppUser? _employee = widget.employee;
  final _amount = TextEditingController();
  final _note = TextEditingController();
  String _category = 'Fuel';
  String? _siteId;
  String? _receipt;
  bool _saving = false;
  late final Stream<List<Site>> _sites = Db.sitesStream(activeOnly: true);

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save(List<Site> sites) async {
    final amt = double.tryParse(_amount.text.trim());
    if (amt == null || amt <= 0) {
      showSnack(context, 'Enter a valid amount.', error: true);
      return;
    }
    final emp = _employee;
    if (emp == null) {
      showSnack(context, 'Choose an employee.', error: true);
      return;
    }
    setState(() => _saving = true);
    try {
      await Db.addPetty(
        employeeId: emp.id,
        employeeName: emp.name,
        type: _type,
        amount: amt,
        category: _type == 'credit' ? 'Cash advance' : _category,
        note: _note.text.trim(),
        status: widget.asManager ? 'approved' : 'pending',
        createdBy: widget.me.id,
        createdByName: widget.me.name,
        site: sites.where((s) => s.id == _siteId).firstOrNull,
        receipt: _receipt,
      );
      if (mounted) {
        Navigator.pop(context);
        showSnack(context, widget.asManager ? 'Saved.' : 'Sent for approval.');
      }
    } catch (e) {
      if (mounted) showSnack(context, 'Failed: $e', error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final credit = _type == 'credit';
    final title = widget.asManager
        ? (credit ? 'Give cash to employee' : 'Record expense')
        : (credit ? 'Record cash received' : 'Add expense');
    return StreamView<List<Site>>(
      stream: _sites,
      builder: (context, sites) => SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(title, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
          const SizedBox(height: 14),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(
                  value: 'expense', label: Text('Expense'), icon: Icon(Icons.north_east)),
              ButtonSegment(
                  value: 'credit', label: Text('Cash given'), icon: Icon(Icons.south_west)),
            ],
            selected: {_type},
            onSelectionChanged: (s) => setState(() => _type = s.first),
          ),
          const SizedBox(height: 14),
          if (widget.asManager && widget.employees.isNotEmpty) ...[
            DropdownButtonFormField<String>(
              value: _employee?.id,
              isExpanded: true,
              decoration: const InputDecoration(
                  labelText: 'Employee', prefixIcon: Icon(Icons.person_outline)),
              items: widget.employees
                  .map((e) => DropdownMenuItem(value: e.id, child: Text(e.name)))
                  .toList(),
              onChanged: (v) => setState(
                  () => _employee = widget.employees.where((e) => e.id == v).firstOrNull),
            ),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: _amount,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
            decoration: const InputDecoration(
              labelText: 'Amount',
              prefixText: '$kCurrency ',
            ),
          ),
          const SizedBox(height: 12),
          if (!credit) ...[
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: expenseCategories
                  .map((c) => ChoiceChip(
                        label: Text(c),
                        selected: _category == c,
                        onSelected: (_) => setState(() => _category = c),
                      ))
                  .toList(),
            ),
            const SizedBox(height: 12),
          ],
          DropdownButtonFormField<String?>(
            value: _siteId,
            isExpanded: true,
            decoration: const InputDecoration(
                labelText: 'Site (optional)', prefixIcon: Icon(Icons.location_city_outlined)),
            items: [
              const DropdownMenuItem<String?>(value: null, child: Text('— None —')),
              ...sites.map((s) => DropdownMenuItem<String?>(value: s.id, child: Text(s.name))),
            ],
            onChanged: (v) => setState(() => _siteId = v),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Note / description'),
            maxLines: 2,
          ),
          const SizedBox(height: 12),
          if (!credit)
            Row(children: [
              if (_receipt != null) ...[
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Base64Image(_receipt!, width: 56, height: 56),
                ),
                const SizedBox(width: 10),
              ],
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () async {
                    try {
                      final p = await PhotoService.pick(camera: true);
                      if (p != null && mounted) setState(() => _receipt = p);
                    } catch (e) {
                      if (context.mounted) showSnack(context, '$e', error: true);
                    }
                  },
                  icon: const Icon(Icons.receipt_long_outlined),
                  label: Text(_receipt == null ? 'Add bill / receipt photo' : 'Retake receipt'),
                ),
              ),
            ]),
          const SizedBox(height: 18),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: credit ? AppColors.success : AppColors.primary),
            onPressed: _saving ? null : () => _save(sites),
            child: Text(_saving ? 'Saving…' : 'Save'),
          ),
        ]),
      ),
    );
  }
}
