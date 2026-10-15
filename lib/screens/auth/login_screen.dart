import 'package:flutter/material.dart';

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
  String? _error;

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
      await AuthService.signIn(_login.text, _pass.text);
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
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Form(
                        key: _form,
                        child: Column(children: [
                          TextFormField(
                            controller: _login,
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
