import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Currency symbol used across the app (petty cash).
const String kCurrency = 'AED';

/// Default monthly off-day allowance for a new employee.
const int kDefaultMonthlyOffQuota = 4;

/// Default geofence radius (metres) for a new site.
const double kDefaultSiteRadius = 200;

/// Logins without "@" get this domain appended, so staff can sign in with
/// a short Employee ID (e.g. "EMP001") instead of an email address.
const String kLoginDomain = 'staff.attendance.app';

String loginToEmail(String login) {
  final l = login.trim().toLowerCase();
  return l.contains('@') ? l : '$l@$kLoginDomain';
}

String dateKey(DateTime d) => DateFormat('yyyy-MM-dd').format(d);
String monthKey(DateTime d) => DateFormat('yyyy-MM').format(d);
DateTime parseDateKey(String k) => DateFormat('yyyy-MM-dd').parse(k);

String fmtTime(DateTime? d) => d == null ? '--:--' : DateFormat('hh:mm a').format(d);
String fmtDate(DateTime d) => DateFormat('EEE, d MMM yyyy').format(d);
String fmtDateShort(DateTime d) => DateFormat('d MMM').format(d);
String fmtDateTime(DateTime? d) =>
    d == null ? '-' : DateFormat('d MMM, hh:mm a').format(d);
String fmtMonth(DateTime d) => DateFormat('MMMM yyyy').format(d);

String fmtMoney(num v) {
  // AED with fils only when needed: "AED 1,250" / "AED 12.50".
  final whole = v == v.roundToDouble();
  final f = NumberFormat.currency(symbol: '$kCurrency ', decimalDigits: whole ? 0 : 2, locale: 'en_US');
  return f.format(v);
}

/// "7h 45m" style.
String fmtDuration(Duration d) {
  if (d.isNegative) d = Duration.zero;
  final h = d.inHours;
  final m = d.inMinutes.remainder(60);
  if (h == 0) return '${m}m';
  return '${h}h ${m.toString().padLeft(2, '0')}m';
}

/// "07:45:12" style for live timers.
String fmtClock(Duration d) {
  if (d.isNegative) d = Duration.zero;
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.inHours)}:${two(d.inMinutes.remainder(60))}:${two(d.inSeconds.remainder(60))}';
}

String fmtDistance(double? m) {
  if (m == null) return '-';
  if (m < 1000) return '${m.round()} m';
  return '${(m / 1000).toStringAsFixed(1)} km';
}

String timeAgo(DateTime? d) {
  if (d == null) return 'never';
  final diff = DateTime.now().difference(d);
  if (diff.inSeconds < 60) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} h ago';
  return '${diff.inDays} d ago';
}

const weekdayNames = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

const weekdayShort = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

DateTime startOfMonth(DateTime d) => DateTime(d.year, d.month, 1);
int daysInMonth(DateTime d) => DateTime(d.year, d.month + 1, 0).day;

String initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
  return (parts.first.substring(0, 1) + parts.last.substring(0, 1)).toUpperCase();
}

/// Shown in the profile sheet so staff can confirm they have the latest app.
const kAppVersion = '1.4.7';

void showSnack(BuildContext context, String msg, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(msg),
      behavior: SnackBarBehavior.floating,
      backgroundColor: error ? const Color(0xFFD64545) : null,
    ));
}

Future<bool> confirm(BuildContext context, String title, String message,
    {String ok = 'Yes', bool danger = false}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
        FilledButton(
          style: danger
              ? FilledButton.styleFrom(
                  backgroundColor: const Color(0xFFD64545),
                  minimumSize: const Size(80, 40))
              : FilledButton.styleFrom(minimumSize: const Size(80, 40)),
          onPressed: () => Navigator.pop(c, true),
          child: Text(ok),
        ),
      ],
    ),
  );
  return r ?? false;
}
