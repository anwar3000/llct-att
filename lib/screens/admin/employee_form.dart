import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/auth_service.dart';
import '../../services/db.dart';

/// Create a staff login, or edit an existing staff profile.
class EmployeeFormScreen extends StatefulWidget {
  final AppUser? existing;
  const EmployeeFormScreen({super.key, this.existing});

  @override
  State<EmployeeFormScreen> createState() => _EmployeeFormScreenState();
}

class _EmployeeFormScreenState extends State<EmployeeFormScreen> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.existing?.name);
  late final _login = TextEditingController(text: widget.existing?.loginId);
  final _pass = TextEditingController();
  late final _phone = TextEditingController(text: widget.existing?.phone);
  late final _designation = TextEditingController(text: widget.existing?.designation);
  late String _role = widget.existing?.role ?? 'employee';
  late Set<int> _weeklyOff = {...(widget.existing?.weeklyOffDays ?? const [7])};
  late int _quota = widget.existing?.monthlyOffQuota ?? kDefaultMonthlyOffQuota;
  late bool _active = widget.existing?.active ?? true;
  bool _saving = false;

  bool get _editing => widget.existing != null;

  @override
  void dispose() {
    for (final c in [_name, _login, _pass, _phone, _designation]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _saving = true);
    final weekly = _weeklyOff.toList()..sort();
    try {
      if (_editing) {
        await Db.updateUser(widget.existing!.id, {
          'name': _name.text.trim(),
          'phone': _phone.text.trim(),
          'designation': _designation.text.trim(),
          'role': _role,
          'weeklyOffDays': weekly,
          'monthlyOffQuota': _quota,
          'active': _active,
        });
      } else {
        await AuthService.createStaffAccount(
          loginId: _login.text.trim(),
          password: _pass.text,
          name: _name.text.trim(),
          phone: _phone.text.trim(),
          designation: _designation.text.trim(),
          role: _role,
          weeklyOffDays: weekly,
          monthlyOffQuota: _quota,
        );
      }
      if (!mounted) return;
      Navigator.pop(context);
      showSnack(
        context,
        _editing
            ? 'Saved'
            : 'Account created. Login ID: ${_login.text.trim()}  ·  share the password with the employee.',
      );
    } catch (e) {
      if (mounted) showSnack(context, AuthService.friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_editing ? 'Edit ${widget.existing!.name}' : 'Add employee')),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            _section('Profile'),
            TextFormField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                  labelText: 'Full name *', prefixIcon: Icon(Icons.person_outline)),
              validator: (v) => (v ?? '').trim().isEmpty ? 'Required' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                  labelText: 'Phone', prefixIcon: Icon(Icons.phone_outlined)),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _designation,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                  labelText: 'Designation (e.g. Technician, Supervisor)',
                  prefixIcon: Icon(Icons.work_outline)),
            ),
            _section('Login'),
            TextFormField(
              controller: _login,
              enabled: !_editing,
              autocorrect: false,
              decoration: InputDecoration(
                labelText: 'Employee ID / login *',
                helperText: _editing
                    ? 'Login ID cannot be changed'
                    : 'Short ID like EMP001 (or an email address)',
                prefixIcon: const Icon(Icons.badge_outlined),
              ),
              validator: (v) {
                final s = (v ?? '').trim();
                if (s.isEmpty) return 'Required';
                if (!s.contains('@') && !RegExp(r'^[A-Za-z0-9._-]+$').hasMatch(s)) {
                  return 'Use letters, numbers, dot, dash or underscore only';
                }
                return null;
              },
            ),
            if (!_editing) ...[
              const SizedBox(height: 12),
              TextFormField(
                controller: _pass,
                decoration: const InputDecoration(
                  labelText: 'Password *',
                  helperText: 'At least 6 characters',
                  prefixIcon: Icon(Icons.lock_outline),
                ),
                validator: (v) => (v ?? '').length < 6 ? 'Min 6 characters' : null,
              ),
            ],
            const SizedBox(height: 12),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(
                    value: 'employee', label: Text('Employee'), icon: Icon(Icons.engineering)),
                ButtonSegment(
                    value: 'manager',
                    label: Text('Manager'),
                    icon: Icon(Icons.manage_accounts_outlined)),
                ButtonSegment(
                    value: 'admin',
                    label: Text('Admin'),
                    icon: Icon(Icons.admin_panel_settings_outlined)),
              ],
              selected: {_role},
              onSelectionChanged: (s) => setState(() => _role = s.first),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                _role == 'employee'
                    ? 'Uses the mobile app to check in, post site updates and petty cash.'
                    : _role == 'manager'
                        ? 'Sees and manages everything except accounts (petty cash, budgets) and staff logins.'
                        : 'Full access, including accounts and creating staff logins.',
                style: const TextStyle(color: AppColors.muted, fontSize: 12.5),
              ),
            ),
            if (_role == 'employee') ...[
              _section('Off days'),
              const Text(
                'Pick the weekly off day(s) — e.g. Sunday or Friday. '
                'Leave none selected for flexible off days the employee requests themselves.',
                style: TextStyle(color: AppColors.muted, fontSize: 13),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [1, 2, 3, 4, 5, 6, 7]
                    .map((w) => FilterChip(
                          label: Text(weekdayShort[w]!),
                          selected: _weeklyOff.contains(w),
                          onSelected: (on) => setState(() {
                            on ? _weeklyOff.add(w) : _weeklyOff.remove(w);
                          }),
                        ))
                    .toList(),
              ),
              const SizedBox(height: 12),
              Card(
                child: ListTile(
                  title: const Text('Off days per month'),
                  subtitle: Text(_weeklyOff.isEmpty
                      ? 'Employee can request up to $_quota days'
                      : 'Used by weekly off days; extra requests allowed up to this limit'),
                  trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                    IconButton(
                        onPressed: _quota > 0 ? () => setState(() => _quota--) : null,
                        icon: const Icon(Icons.remove_circle_outline)),
                    Text('$_quota',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                    IconButton(
                        onPressed: _quota < 15 ? () => setState(() => _quota++) : null,
                        icon: const Icon(Icons.add_circle_outline)),
                  ]),
                ),
              ),
            ],
            if (_editing) ...[
              _section('Status'),
              Card(
                child: SwitchListTile(
                  title: const Text('Account active'),
                  subtitle: const Text('Deactivated staff cannot use the app'),
                  value: _active,
                  onChanged: (v) => setState(() => _active = v),
                ),
              ),
            ],
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.check),
              label: Text(_editing ? 'Save changes' : 'Create account'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _section(String t) => Padding(
        padding: const EdgeInsets.only(top: 20, bottom: 10),
        child: Text(t.toUpperCase(),
            style: const TextStyle(
                fontSize: 12,
                letterSpacing: 1,
                fontWeight: FontWeight.w700,
                color: AppColors.primary)),
      );
}
