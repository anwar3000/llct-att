import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme.dart';
import '../../services/auth_service.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _login = TextEditingController();
  final _pass = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool _busy = false;
  bool _hide = true;
  bool _remember = true;
  String? _error;
  List<({String login, String password})> _saved = [];

  @override
  void initState() {
    super.initState();
    SavedLogins.all().then((l) {
      if (mounted) setState(() => _saved = l);
    });
  }

  /// One tap: sign in with a login remembered on this phone.
  Future<void> _quick(({String login, String password}) s) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AuthService.signIn(s.login, s.password);
    } catch (e) {
      // Password changed since it was saved: let them type it again.
      if (mounted) {
        setState(() {
          _login.text = s.login;
          _pass.clear();
          _error = '${AuthService.friendlyError(e)} — enter the password again.';
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _login.dispose();
    _pass.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AuthService.signIn(_login.text, _pass.text, remember: _remember);
      TextInput.finishAutofillContext();
    } catch (e) {
      if (mounted) setState(() => _error = AuthService.friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [AppColors.accent, Color(0xFFF39A1E)],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(18),
                    child: Image.asset('assets/logo.png', width: 220),
                  ),
                  const SizedBox(height: 18),
                  const Text('Attendance',
                      style: TextStyle(
                          color: AppColors.primaryDark, fontSize: 26, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 4),
                  Text('Check in. Get work done. Go home.',
                      style: TextStyle(color: AppColors.primaryDark.withValues(alpha: 0.75))),
                  const SizedBox(height: 28),
                  if (_saved.isNotEmpty) ...[
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Column(children: [
                          for (final s in _saved)
                            ListTile(
                              leading: CircleAvatar(
                                backgroundColor: AppColors.accent.withValues(alpha: 0.2),
                                child: Text(s.login.isEmpty ? '?' : s.login[0].toUpperCase(),
                                    style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.primaryDark)),
                              ),
                              title: Text('Continue as ${s.login}', style: const TextStyle(fontWeight: FontWeight.w700)),
                              subtitle: const Text('Saved on this phone · one tap'),
                              onTap: _busy ? null : () => _quick(s),
                              trailing: IconButton(
                                tooltip: 'Forget this login',
                                icon: const Icon(Icons.close, size: 20),
                                onPressed: () async {
                                  await SavedLogins.forget(s.login);
                                  final l = await SavedLogins.all();
                                  if (mounted) setState(() => _saved = l);
                                },
                              ),
                            ),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text('or sign in with another login', style: TextStyle(color: AppColors.primaryDark.withValues(alpha: 0.75))),
                    const SizedBox(height: 10),
                  ],
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Form(
                        key: _form,
                        child: AutofillGroup(
                          child: Column(children: [
                          TextFormField(
                            controller: _login,
                            autofillHints: const [AutofillHints.username],
                            textInputAction: TextInputAction.next,
                            autocorrect: false,
                            decoration: const InputDecoration(
                              labelText: 'Employee ID or email',
                              prefixIcon: Icon(Icons.badge_outlined),
                            ),
                            validator: (v) =>
                                (v == null || v.trim().isEmpty) ? 'Enter your login ID' : null,
                          ),
                          const SizedBox(height: 14),
                          TextFormField(
                            controller: _pass,
                            autofillHints: const [AutofillHints.password],
                            obscureText: _hide,
                            onFieldSubmitted: (_) => _submit(),
                            decoration: InputDecoration(
                              labelText: 'Password',
                              prefixIcon: const Icon(Icons.lock_outline),
                              suffixIcon: IconButton(
                                icon: Icon(_hide ? Icons.visibility : Icons.visibility_off),
                                onPressed: () => setState(() => _hide = !_hide),
                              ),
                            ),
                            validator: (v) =>
                                (v == null || v.isEmpty) ? 'Enter your password' : null,
                          ),
                          CheckboxListTile(
                            value: _remember,
                            onChanged: (v) => setState(() => _remember = v ?? true),
                            contentPadding: EdgeInsets.zero,
                            dense: true,
                            controlAffinity: ListTileControlAffinity.leading,
                            title: const Text('Remember me on this phone'),
                          ),
                          if (_error != null) ...[
                            const SizedBox(height: 12),
                            Text(_error!, style: const TextStyle(color: AppColors.danger)),
                          ],
                          const SizedBox(height: 20),
                          FilledButton(
                            onPressed: _busy ? null : _submit,
                            child: _busy
                                ? const SizedBox(
                                    height: 22,
                                    width: 22,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2.5, color: Colors.white))
                                : const Text('Sign in'),
                          ),
                        ]),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text('Accounts are created by management.',
                      style: TextStyle(
                          color: AppColors.primaryDark.withValues(alpha: 0.7), fontSize: 12.5)),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
