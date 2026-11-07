import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../core/utils.dart';

/// Missed sign-out: management flagged a check-in that was never signed out. The employee must explain
/// (red message that can't be dismissed); management then accepts the day or keeps it absent.
class MissedSignout {
  MissedSignout._();
  static final _fs = FirebaseFirestore.instance;
  static bool _showing = false;

  static StreamSubscription watch(BuildContext context, String uid) {
    return _fs
        .collection('missedOuts')
        .where('employeeId', isEqualTo: uid)
        .where('status', isEqualTo: 'asked')
        .snapshots()
        .listen((q) {
      if (q.docs.isEmpty || _showing || !context.mounted) return;
      final docs = [...q.docs]..sort((a, b) => '${a.data()['date']}'.compareTo('${b.data()['date']}'));
      _show(context, docs.first.id, docs.first.data());
    }, onError: (_) {});
  }

  static Future<void> _show(BuildContext context, String id, Map<String, dynamic> m) async {
    _showing = true;
    final day = DateTime.tryParse('${m['date']}');
    final dayTxt = day == null ? '${m['date']}' : fmtDate(day);
    final site = '${m['siteName'] ?? ''}';
    final note = '${m['note'] ?? ''}';
    final red = m['flag'] == 'red';
    final ctl = TextEditingController();
    String? err;
    var busy = false;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (c) => PopScope(
        canPop: false,
        child: StatefulBuilder(
          builder: (c, setD) => AlertDialog(
            clipBehavior: Clip.antiAlias,
            titlePadding: EdgeInsets.zero,
            title: Container(
              color: AppColors.danger,
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 14),
              child: const Row(children: [
                Icon(Icons.flag, color: Colors.white),
                SizedBox(width: 10),
                Expanded(child: Text('Attendance not valid', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 18))),
              ]),
            ),
            content: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('You did not sign out properly on $dayTxt${site.isEmpty ? '' : ' ($site)'}, and no GPS activity was recorded.'),
                const SizedBox(height: 10),
                Text('Your attendance for that day is not valid and is marked ABSENT — ${red ? 'red' : 'yellow'} flag from management.',
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                if (note.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: const Color(0xFFFFF3F3), borderRadius: BorderRadius.circular(8)),
                    child: Text('Management: $note', style: const TextStyle(fontSize: 13)),
                  ),
                ],
                const SizedBox(height: 10),
                const Text(
                    'If there was a technical problem (phone, battery, app, network), explain it here. Management will review it — if accepted, the day counts again.',
                    style: TextStyle(fontSize: 13, color: AppColors.muted)),
                const SizedBox(height: 10),
                TextField(
                  controller: ctl,
                  minLines: 3,
                  maxLines: 6,
                  decoration: InputDecoration(hintText: 'Write your explanation…', errorText: err),
                ),
              ]),
            ),
            actions: [
              FilledButton(
                style: FilledButton.styleFrom(minimumSize: const Size(160, 46)),
                onPressed: busy
                    ? null
                    : () async {
                        final t = ctl.text.trim();
                        if (t.length < 5) {
                          setD(() => err = 'Please write what happened.');
                          return;
                        }
                        setD(() => busy = true);
                        try {
                          await _fs.collection('missedOuts').doc(id).update({
                            'status': 'explained',
                            'explanation': t,
                            'explainedAt': FieldValue.serverTimestamp(),
                          });
                          if (c.mounted) Navigator.pop(c);
                        } catch (e) {
                          setD(() {
                            busy = false;
                            err = 'Could not send: $e';
                          });
                        }
                      },
                child: Text(busy ? 'Sending…' : 'Send explanation'),
              ),
            ],
          ),
        ),
      ),
    );
    _showing = false;
    if (context.mounted) showSnack(context, 'Explanation sent to management');
  }
}
