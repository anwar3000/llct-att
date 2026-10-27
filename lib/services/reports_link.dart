import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/utils.dart';
import '../models/models.dart';

/// Link to LLCT Invoicing for service reports and delivery notes made at the check-in site.
/// Only people allowed to create delivery notes in invoicing (Staff & access) see it; admins always.
class ReportsLink {
  static const base = 'https://anwar3000.github.io/llct-invoice/';
  static final _fs = FirebaseFirestore.instance;

  /// True when this person may create delivery notes / service reports in LLCT Invoicing.
  static Future<bool> allowed(AppUser me) async {
    if (me.isAdmin) return true;
    try {
      final d = await _fs.collection('inv_access').doc(me.id).get();
      final m = d.data();
      if (m == null || m['enabled'] == false) return false;
      final perms = (m['perms'] as Map?) ?? const {};
      return perms['delivery'] == true;
    } catch (_) {
      return false;
    }
  }

  /// Service reports / delivery notes this person made today for this check-in (or site).
  static Stream<int> madeToday(AppUser me, AttendanceSession s) => _fs
      .collection('inv_docs')
      .where('createdBy', isEqualTo: me.id)
      .where('date', isEqualTo: dateKey(DateTime.now()))
      .snapshots()
      .map((q) => q.docs.where((d) {
            final m = d.data();
            if (m['type'] != 'delivery') return false;
            return m['attSessionId'] == s.id || m['attSiteId'] == s.siteId;
          }).length)
      .handleError((_) {});

  /// Opens the invoicing form for this check-in: kind is 'service' or 'delivery'.
  static Future<bool> open(AttendanceSession s, String kind) {
    final p = <String, dynamic>{
      'type': 'delivery',
      if (kind == 'service') 'rt': 'service',
      'attSite': s.siteId,
      'attSession': s.id,
      'attSiteName': s.siteName,
    };
    final url = Uri.parse('$base#/edit?${Uri.encodeComponent(jsonEncode(p))}');
    return launchUrl(url, mode: LaunchMode.inAppBrowserView).catchError((_) => launchUrl(url, mode: LaunchMode.externalApplication));
  }
}
