import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../core/utils.dart';
import '../models/models.dart';
import '../screens/employee/scan_documents_screen.dart';
import '../services/db.dart';
import 'trip_card.dart' show kDialogButton;

/// Asked once each time the app opens: complete mobile number, email and ID documents if missing.
class ProfilePrompt {
  ProfilePrompt._();
  static bool _askedThisLaunch = false;

  /// What's missing from this person's profile (empty list = complete).
  static Future<List<String>> missing(AppUser me) async {
    final out = <String>[];
    if (me.phone.trim().isEmpty) out.add('Mobile number');
    if (me.contactEmail.trim().isEmpty) out.add('Email');
    try {
      final info = await Db.myIdInfo(me.id).first;
      final files = await Db.myIdFiles(me.id).first;
      bool has(String kind, String numField) =>
          (info[numField] is String && (info[numField] as String).trim().isNotEmpty) || files.any((f) => f.kind == kind);
      if (!has('passport', 'passportNo')) out.add('Passport');
      if (!has('eid', 'eidNo')) out.add('Emirates ID');
    } catch (_) {}
    return out;
  }

  static Future<void> maybeAsk(BuildContext context, AppUser me) async {
    if (_askedThisLaunch) return;
    _askedThisLaunch = true;
    final miss = await missing(me);
    if (miss.isEmpty || !context.mounted) return;
    final go = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        icon: const Icon(Icons.assignment_ind_outlined, color: AppColors.accentDark, size: 40),
        title: const Text('Please complete your profile'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('These details are missing:'),
          const SizedBox(height: 8),
          for (final m in miss)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(children: [
                const Icon(Icons.error_outline, color: AppColors.danger, size: 18),
                const SizedBox(width: 8),
                Text(m, style: const TextStyle(fontWeight: FontWeight.w700)),
              ]),
            ),
          const SizedBox(height: 10),
          const Text('The office needs them for site passes, visas and emergencies.',
              style: TextStyle(color: AppColors.muted, fontSize: 12.5)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Later')),
          FilledButton(style: kDialogButton, onPressed: () => Navigator.pop(c, true), child: const Text('UPDATE NOW')),
        ],
      ),
    );
    if (go != true || !context.mounted) return;
    if (miss.contains('Mobile number') || miss.contains('Email')) {
      await editContact(context, me);
      if (!context.mounted) return;
    }
    if (miss.contains('Passport') || miss.contains('Emirates ID')) {
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ScanDocumentsScreen(me: me)));
    }
  }

  /// Mobile number & email — employees edit their own.
  static Future<void> editContact(BuildContext context, AppUser me) async {
    final phone = TextEditingController(text: me.phone);
    final email = TextEditingController(text: me.contactEmail);
    String? err;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: const Text('Mobile number & email'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(
              controller: phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Mobile number', hintText: '+971 50 123 4567', prefixIcon: Icon(Icons.phone_outlined)),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: email,
              keyboardType: TextInputType.emailAddress,
              decoration: InputDecoration(labelText: 'Email', prefixIcon: const Icon(Icons.mail_outline), errorText: err),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
            FilledButton(
              style: kDialogButton,
              onPressed: () {
                final e = email.text.trim();
                if (e.isNotEmpty && !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(e)) {
                  set(() => err = 'Enter a valid email');
                  return;
                }
                Navigator.pop(c, true);
              },
              child: const Text('SAVE'),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      await Db.updateMyContact(me.id, phone: phone.text.trim(), email: email.text.trim());
      if (context.mounted) showSnack(context, 'Saved');
    } catch (e) {
      if (context.mounted) showSnack(context, 'Could not save: $e', error: true);
    }
  }
}
