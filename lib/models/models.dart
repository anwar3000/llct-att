import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/utils.dart';

DateTime? _ts(dynamic v) {
  if (v is Timestamp) return v.toDate();
  if (v is DateTime) return v;
  return null;
}

double? _dbl(dynamic v) => v is num ? v.toDouble() : null;
int _int(dynamic v, [int fallback = 0]) => v is num ? v.toInt() : fallback;
String _str(dynamic v, [String fallback = '']) => v is String ? v : fallback;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

class LiveLocation {
  final double lat;
  final double lng;
  final double? accuracy;
  final DateTime? at;
  final bool checkedIn;
  final String siteName;

  LiveLocation({
    required this.lat,
    required this.lng,
    this.accuracy,
    this.at,
    this.checkedIn = false,
    this.siteName = '',
  });

  static LiveLocation? fromMap(dynamic m) {
    if (m is! Map) return null;
    final lat = _dbl(m['lat']);
    final lng = _dbl(m['lng']);
    if (lat == null || lng == null) return null;
    return LiveLocation(
      lat: lat,
      lng: lng,
      accuracy: _dbl(m['accuracy']),
      at: _ts(m['at']),
      checkedIn: m['checkedIn'] == true,
      siteName: _str(m['siteName']),
    );
  }

  /// Considered "live" if updated within the last 15 minutes.
  bool get isFresh =>
      at != null && DateTime.now().difference(at!).inMinutes < 15;
}

class AppUser {
  final String id;
  final String name;
  final String loginId;
  final String email;
  final String phone;
  final String designation;
  final String role; // 'employee' | 'manager' | 'admin'
  final bool active;

  /// DateTime.weekday values (1 = Mon ... 7 = Sun). Empty = flexible off days.
  final List<int> weeklyOffDays;
  final int monthlyOffQuota;
  final DateTime? createdAt;
  final LiveLocation? lastLocation;

  AppUser({
    required this.id,
    required this.name,
    required this.loginId,
    required this.email,
    this.phone = '',
    this.designation = '',
    this.role = 'employee',
    this.active = true,
    this.weeklyOffDays = const [],
    this.monthlyOffQuota = kDefaultMonthlyOffQuota,
    this.createdAt,
    this.lastLocation,
  });

  /// Full access including accounts (petty cash) and staff logins.
  bool get isAdmin => role == 'admin';

  /// Managers see everything except accounts.
  bool get isManager => role == 'manager';

  /// Admins and managers use the management dashboard.
  bool get isManagement => role == 'admin' || role == 'manager';

  bool get isEmployee => !isManagement;

  factory AppUser.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return AppUser(
      id: d.id,
      name: _str(m['name'], 'Unnamed'),
      loginId: _str(m['loginId']),
      email: _str(m['email']),
      phone: _str(m['phone']),
      designation: _str(m['designation']),
      role: _str(m['role'], 'employee'),
      active: m['active'] != false,
      weeklyOffDays: (m['weeklyOffDays'] is List)
          ? (m['weeklyOffDays'] as List).whereType<num>().map((e) => e.toInt()).toList()
          : const [],
      monthlyOffQuota: _int(m['monthlyOffQuota'], kDefaultMonthlyOffQuota),
      createdAt: _ts(m['createdAt']),
      lastLocation: LiveLocation.fromMap(m['lastLocation']),
    );
  }

  Map<String, dynamic> toMap() => {
        'name': name,
        'loginId': loginId,
        'email': email,
        'phone': phone,
        'designation': designation,
        'role': role,
        'active': active,
        'weeklyOffDays': weeklyOffDays,
        'monthlyOffQuota': monthlyOffQuota,
      };

  bool isWeeklyOff(DateTime d) => weeklyOffDays.contains(d.weekday);

  String get offDayLabel => weeklyOffDays.isEmpty
      ? 'Flexible ($monthlyOffQuota / month)'
      : weeklyOffDays.map((w) => weekdayNames[w]).join(', ');
}

// ---------------------------------------------------------------------------
// Sites & schedules
// ---------------------------------------------------------------------------

class Site {
  final String id;
  final String name;
  final String address;
  final double lat;
  final double lng;
  final double radius;
  final bool active;
  final int progress; // 0-100
  final String status; // planned | active | on hold | completed
  final String notes;
  final String createdByName; // set when an employee added the site from the field
  final String createdBy;
  final String projectId;

  /// Sites added by employees stay unapproved until an admin/manager approves them.
  final bool approved;

  Site({
    required this.id,
    required this.name,
    this.address = '',
    required this.lat,
    required this.lng,
    this.radius = kDefaultSiteRadius,
    this.active = true,
    this.progress = 0,
    this.status = 'active',
    this.notes = '',
    this.createdByName = '',
    this.createdBy = '',
    this.projectId = '',
    this.approved = true,
  });

  bool get addedByEmployee => createdByName.isNotEmpty;

  factory Site.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return Site(
      id: d.id,
      name: _str(m['name'], 'Site'),
      address: _str(m['address']),
      lat: _dbl(m['lat']) ?? 0,
      lng: _dbl(m['lng']) ?? 0,
      radius: _dbl(m['radius']) ?? kDefaultSiteRadius,
      active: m['active'] != false,
      progress: _int(m['progress']),
      status: _str(m['status'], 'active'),
      notes: _str(m['notes']),
      createdByName: m['addedByEmployee'] == true ? _str(m['createdByName']) : '',
      createdBy: _str(m['createdBy']),
      projectId: _str(m['projectId']),
      approved: m['approved'] != false,
    );
  }

  Map<String, dynamic> toMap() => {
        'name': name,
        'address': address,
        'lat': lat,
        'lng': lng,
        'radius': radius,
        'active': active,
        'progress': progress,
        'status': status,
        'notes': notes,
        'approved': approved,
      };
}

class Schedule {
  final String id;
  final String employeeId;
  final String employeeName;
  final String siteId;
  final String siteName;
  final String date; // yyyy-MM-dd
  final String startTime; // HH:mm
  final String endTime;
  final String note;

  Schedule({
    required this.id,
    required this.employeeId,
    required this.employeeName,
    required this.siteId,
    required this.siteName,
    required this.date,
    this.startTime = '',
    this.endTime = '',
    this.note = '',
  });

  factory Schedule.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return Schedule(
      id: d.id,
      employeeId: _str(m['employeeId']),
      employeeName: _str(m['employeeName']),
      siteId: _str(m['siteId']),
      siteName: _str(m['siteName']),
      date: _str(m['date']),
      startTime: _str(m['startTime']),
      endTime: _str(m['endTime']),
      note: _str(m['note']),
    );
  }

  String get timeLabel {
    if (startTime.isEmpty && endTime.isEmpty) return 'Any time';
    if (endTime.isEmpty) return 'From $startTime';
    return '$startTime – $endTime';
  }
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

class AttendanceSession {
  final String id;
  final String employeeId;
  final String employeeName;
  final String siteId;
  final String siteName;
  final String date;
  final DateTime checkIn;
  final double? inLat;
  final double? inLng;
  final double? inAccuracy;
  final double? inDistance;
  final bool inOutside;
  final DateTime? checkOut;
  final double? outLat;
  final double? outLng;
  final double? outDistance;
  final bool outOutside;
  final bool mocked;
  final String note;

  AttendanceSession({
    required this.id,
    required this.employeeId,
    required this.employeeName,
    required this.siteId,
    required this.siteName,
    required this.date,
    required this.checkIn,
    this.inLat,
    this.inLng,
    this.inAccuracy,
    this.inDistance,
    this.inOutside = false,
    this.checkOut,
    this.outLat,
    this.outLng,
    this.outDistance,
    this.outOutside = false,
    this.mocked = false,
    this.note = '',
  });

  bool get isOpen => checkOut == null;
  bool get flagged => inOutside || outOutside || mocked;

  Duration worked([DateTime? now]) =>
      (checkOut ?? now ?? DateTime.now()).difference(checkIn);

  factory AttendanceSession.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return AttendanceSession(
      id: d.id,
      employeeId: _str(m['employeeId']),
      employeeName: _str(m['employeeName']),
      siteId: _str(m['siteId']),
      siteName: _str(m['siteName']),
      date: _str(m['date']),
      checkIn: _ts(m['checkIn']) ?? DateTime.now(),
      inLat: _dbl(m['inLat']),
      inLng: _dbl(m['inLng']),
      inAccuracy: _dbl(m['inAccuracy']),
      inDistance: _dbl(m['inDistance']),
      inOutside: m['inOutside'] == true,
      checkOut: _ts(m['checkOut']),
      outLat: _dbl(m['outLat']),
      outLng: _dbl(m['outLng']),
      outDistance: _dbl(m['outDistance']),
      outOutside: m['outOutside'] == true,
      mocked: m['mocked'] == true,
      note: _str(m['note']),
    );
  }
}

Duration totalWorked(Iterable<AttendanceSession> sessions, [DateTime? now]) =>
    sessions.fold(Duration.zero, (a, s) => a + s.worked(now));

// ---------------------------------------------------------------------------
// Site updates
// ---------------------------------------------------------------------------

class SiteUpdate {
  final String id;
  final String siteId;
  final String siteName;
  final String employeeId;
  final String employeeName;
  final String category; // Progress | Issue | Material | Safety
  final String note;
  final int? progress;
  final List<String> photos; // base64 JPEG
  final double? lat;
  final double? lng;
  final DateTime? createdAt;

  SiteUpdate({
    required this.id,
    required this.siteId,
    required this.siteName,
    required this.employeeId,
    required this.employeeName,
    required this.category,
    required this.note,
    this.progress,
    this.photos = const [],
    this.lat,
    this.lng,
    this.createdAt,
  });

  factory SiteUpdate.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return SiteUpdate(
      id: d.id,
      siteId: _str(m['siteId']),
      siteName: _str(m['siteName']),
      employeeId: _str(m['employeeId']),
      employeeName: _str(m['employeeName']),
      category: _str(m['category'], 'Progress'),
      note: _str(m['note']),
      progress: m['progress'] is num ? (m['progress'] as num).toInt() : null,
      photos: (m['photos'] is List) ? (m['photos'] as List).whereType<String>().toList() : const [],
      lat: _dbl(m['lat']),
      lng: _dbl(m['lng']),
      createdAt: _ts(m['createdAt']),
    );
  }
}

// ---------------------------------------------------------------------------
// Petty cash
// ---------------------------------------------------------------------------

class PettyTxn {
  final String id;
  final String employeeId;
  final String employeeName;
  final String type; // credit (cash given to employee) | expense (employee spent)
  final double amount;
  final String category;
  final String note;
  final String siteId;
  final String siteName;
  final String? receipt; // base64
  final String status; // pending | approved | rejected
  final String reviewNote;
  final String createdByName;
  final DateTime? createdAt;
  final String date;

  PettyTxn({
    required this.id,
    required this.employeeId,
    required this.employeeName,
    required this.type,
    required this.amount,
    this.category = '',
    this.note = '',
    this.siteId = '',
    this.siteName = '',
    this.receipt,
    this.status = 'pending',
    this.reviewNote = '',
    this.createdByName = '',
    this.createdAt,
    this.date = '',
  });

  bool get isCredit => type == 'credit';
  bool get isPending => status == 'pending';
  bool get isApproved => status == 'approved';

  factory PettyTxn.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return PettyTxn(
      id: d.id,
      employeeId: _str(m['employeeId']),
      employeeName: _str(m['employeeName']),
      type: _str(m['type'], 'expense'),
      amount: _dbl(m['amount']) ?? 0,
      category: _str(m['category']),
      note: _str(m['note']),
      siteId: _str(m['siteId']),
      siteName: _str(m['siteName']),
      receipt: m['receipt'] is String && (m['receipt'] as String).isNotEmpty
          ? m['receipt'] as String
          : null,
      status: _str(m['status'], 'pending'),
      reviewNote: _str(m['reviewNote']),
      createdByName: _str(m['createdByName']),
      createdAt: _ts(m['createdAt']),
      date: _str(m['date']),
    );
  }
}

class PettySummary {
  final double credited;
  final double spent;
  final double pending;
  final int pendingCount;

  const PettySummary(this.credited, this.spent, this.pending, this.pendingCount);

  double get balance => credited - spent;

  /// Balance if all pending expenses get approved.
  double get projected => balance - pending;

  static PettySummary of(Iterable<PettyTxn> txns) {
    double c = 0, s = 0, p = 0;
    int pc = 0;
    for (final t in txns) {
      if (t.isCredit && t.isApproved) c += t.amount;
      if (!t.isCredit && t.isApproved) s += t.amount;
      if (!t.isCredit && t.isPending) {
        p += t.amount;
        pc++;
      }
    }
    return PettySummary(c, s, p, pc);
  }
}

// ---------------------------------------------------------------------------
// Off days (leave requests on flexible days)
// ---------------------------------------------------------------------------

class OffDay {
  final String id;
  final String employeeId;
  final String employeeName;
  final String date;
  final String reason;
  final String status; // pending | approved | rejected
  final DateTime? createdAt;

  OffDay({
    required this.id,
    required this.employeeId,
    required this.employeeName,
    required this.date,
    this.reason = '',
    this.status = 'pending',
    this.createdAt,
  });

  factory OffDay.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return OffDay(
      id: d.id,
      employeeId: _str(m['employeeId']),
      employeeName: _str(m['employeeName']),
      date: _str(m['date']),
      reason: _str(m['reason']),
      status: _str(m['status'], 'pending'),
      createdAt: _ts(m['createdAt']),
    );
  }
}

// ---------------------------------------------------------------------------
// Geofence alerts (employee left the site while still checked in)
// ---------------------------------------------------------------------------

class GeoAlert {
  final String id;
  final String employeeId;
  final String employeeName;
  final String siteId;
  final String siteName;
  final String sessionId;
  final String type; // left_site | gps_off
  final double? lat;
  final double? lng;
  final double? distance;
  final DateTime? at;
  final bool resolved;
  final String resolvedBy;

  GeoAlert({
    required this.id,
    required this.employeeId,
    required this.employeeName,
    required this.siteId,
    required this.siteName,
    required this.sessionId,
    required this.type,
    this.lat,
    this.lng,
    this.distance,
    this.at,
    this.resolved = false,
    this.resolvedBy = '',
  });

  factory GeoAlert.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return GeoAlert(
      id: d.id,
      employeeId: _str(m['employeeId']),
      employeeName: _str(m['employeeName']),
      siteId: _str(m['siteId']),
      siteName: _str(m['siteName']),
      sessionId: _str(m['sessionId']),
      type: _str(m['type'], 'left_site'),
      lat: _dbl(m['lat']),
      lng: _dbl(m['lng']),
      distance: _dbl(m['distance']),
      at: _ts(m['at']),
      resolved: m['resolved'] == true,
      resolvedBy: _str(m['resolvedBy']),
    );
  }

  String get label => type == 'gps_off'
      ? 'Location unavailable while checked in'
      : 'Left ${siteName.isEmpty ? 'site' : siteName} without checking out'
          '${distance == null ? '' : ' (${distance!.round()} m away)'}';
}

class TrackPoint {
  final double lat;
  final double lng;
  final DateTime? at;
  TrackPoint(this.lat, this.lng, this.at);

  static TrackPoint? fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    final lat = _dbl(m['lat']);
    final lng = _dbl(m['lng']);
    if (lat == null || lng == null) return null;
    return TrackPoint(lat, lng, _ts(m['at']));
  }
}

// ---------------------------------------------------------------------------
// Monthly attendance summary (computed on device)
// ---------------------------------------------------------------------------

enum DayKind { worked, off, absent, upcoming, today, beforeJoin }

class DaySummary {
  final DateTime day;
  final DayKind kind;
  final List<AttendanceSession> sessions;
  final bool offRequested;
  DaySummary(this.day, this.kind, this.sessions, {this.offRequested = false});
  Duration get total => totalWorked(sessions);
}

class MonthSummary {
  final DateTime month;
  final List<DaySummary> days;
  final int quota;
  MonthSummary(this.month, this.days, this.quota);

  int get workedDays => days.where((d) => d.sessions.isNotEmpty).length;
  int get offDays => days.where((d) => d.kind == DayKind.off).length;
  int get absentDays => days.where((d) => d.kind == DayKind.absent).length;
  Duration get totalTime => days.fold(Duration.zero, (a, d) => a + d.total);
  Duration get avgPerDay =>
      workedDays == 0 ? Duration.zero : Duration(minutes: totalTime.inMinutes ~/ workedDays);

  static MonthSummary build({
    required DateTime month,
    required AppUser user,
    required List<AttendanceSession> sessions,
    required List<OffDay> offDays,
  }) {
    final now = DateTime.now();
    final todayKey = dateKey(now);
    final approvedOff = offDays
        .where((o) => o.status == 'approved')
        .map((o) => o.date)
        .toSet();
    final byDate = <String, List<AttendanceSession>>{};
    for (final s in sessions) {
      byDate.putIfAbsent(s.date, () => []).add(s);
    }
    final joined = user.createdAt == null
        ? null
        : DateTime(user.createdAt!.year, user.createdAt!.month, user.createdAt!.day);
    final list = <DaySummary>[];
    for (var i = 1; i <= daysInMonth(month); i++) {
      final day = DateTime(month.year, month.month, i);
      final k = dateKey(day);
      final s = (byDate[k] ?? [])..sort((a, b) => a.checkIn.compareTo(b.checkIn));
      final isOff = user.isWeeklyOff(day) || approvedOff.contains(k);
      DayKind kind;
      if (s.isNotEmpty) {
        kind = k == todayKey ? DayKind.today : DayKind.worked;
      } else if (isOff) {
        kind = DayKind.off;
      } else if (k == todayKey) {
        kind = DayKind.today;
      } else if (day.isAfter(now)) {
        kind = DayKind.upcoming;
      } else if (joined != null && day.isBefore(joined)) {
        kind = DayKind.beforeJoin;
      } else {
        kind = DayKind.absent;
      }
      list.add(DaySummary(day, kind, s, offRequested: approvedOff.contains(k)));
    }
    return MonthSummary(month, list, user.monthlyOffQuota);
  }
}

/// External worker / labour, registered by management. Does not log in.
class ExtWorker {
  final String id;
  final String name;
  final String phone;
  final String company;
  final String trade;
  final bool active;

  ExtWorker({
    required this.id,
    required this.name,
    this.phone = '',
    this.company = '',
    this.trade = '',
    this.active = true,
  });

  String get subtitle => [company, trade].where((s) => s.isNotEmpty).join(' · ');

  factory ExtWorker.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return ExtWorker(
      id: d.id,
      name: _str(m['name'], 'Worker'),
      phone: _str(m['phone']),
      company: _str(m['company']),
      trade: _str(m['trade']),
      active: m['active'] != false,
    );
  }
}

/// Who currently "holds" a worker (one lock per worker → no duplicates across sites/employees).
class WorkerLock {
  final String workerId;
  final String recordId;
  final String sessionId;
  final String employeeId;
  final String employeeName;
  final String siteName;

  WorkerLock({
    required this.workerId,
    required this.recordId,
    required this.sessionId,
    required this.employeeId,
    required this.employeeName,
    required this.siteName,
  });

  factory WorkerLock.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return WorkerLock(
      workerId: d.id,
      recordId: _str(m['recordId']),
      sessionId: _str(m['sessionId']),
      employeeId: _str(m['employeeId']),
      employeeName: _str(m['employeeName']),
      siteName: _str(m['siteName']),
    );
  }
}

/// One external worker's time on a site, tied to the employee's check-in session.
class WorkerEntry {
  final String id;
  final String workerId;
  final String workerName;
  final String sessionId;
  final String siteName;
  final DateTime checkIn;
  final DateTime? checkOut;
  final bool open;

  WorkerEntry({
    required this.id,
    required this.workerId,
    required this.workerName,
    required this.sessionId,
    required this.siteName,
    required this.checkIn,
    this.checkOut,
    this.open = false,
  });

  Duration worked([DateTime? now]) => (checkOut ?? now ?? DateTime.now()).difference(checkIn);

  factory WorkerEntry.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return WorkerEntry(
      id: d.id,
      workerId: _str(m['workerId']),
      workerName: _str(m['workerName'], 'Worker'),
      sessionId: _str(m['sessionId']),
      siteName: _str(m['siteName']),
      checkIn: _ts(m['checkIn']) ?? DateTime.now(),
      checkOut: _ts(m['checkOut']),
      open: m['open'] == true,
    );
  }
}
