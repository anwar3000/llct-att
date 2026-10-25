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
int? _tz(dynamic v) => v is num ? v.toInt() : null;

/// Wall-clock time at the place where something happened, using the UTC offset
/// (minutes) the phone had at that moment. Falls back to this phone's local time.
DateTime atZone(DateTime t, int? tz) => tz == null ? t : t.toUtc().add(Duration(minutes: tz));

/// The signed-in user (set once their profile loads) — used by shared widgets
/// to decide what the viewer may edit.
class CurrentUser {
  CurrentUser._();
  static AppUser? me;
}

/// "UTC+04:00" style label.
String tzLabel(int? tz) {
  if (tz == null) return '';
  final a = tz.abs();
  return 'UTC${tz < 0 ? '-' : '+'}${(a ~/ 60).toString().padLeft(2, '0')}:${(a % 60).toString().padLeft(2, '0')}';
}

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
  /// Contact email (the login email is internal, e.g. EMP001@staff…).
  final String contactEmail;
  final String designation;
  final String role; // 'employee' | 'manager' | 'admin'
  final bool active;

  /// DateTime.weekday values (1 = Mon ... 7 = Sun). Empty = flexible off days.
  final List<int> weeklyOffDays;
  final int monthlyOffQuota;
  final DateTime? createdAt;
  /// Set by management to sign this person out of every device.
  final DateTime? forceLogoutAt;
  /// Admin "allow check-in": GPS violations before this time no longer count.
  final DateTime? violationsClearedAt;
  /// Admin gave this person access to everyone's ID documents in the app.
  final bool canViewIds;
  /// Drivers get the Trips feature; their own rate per km overrides the company rate.
  final bool isDriver;
  final double? tripRatePerKm;
  final String vehicle;
  final LiveLocation? lastLocation;

  AppUser({
    required this.id,
    required this.name,
    required this.loginId,
    required this.email,
    this.phone = '',
    this.contactEmail = '',
    this.designation = '',
    this.role = 'employee',
    this.active = true,
    this.weeklyOffDays = const [],
    this.monthlyOffQuota = kDefaultMonthlyOffQuota,
    this.createdAt,
    this.forceLogoutAt,
    this.violationsClearedAt,
    this.canViewIds = false,
    this.isDriver = false,
    this.tripRatePerKm,
    this.vehicle = '',
    this.lastLocation,
  });

  /// Full access including accounts (petty cash) and staff logins.
  bool get isAdmin => role == 'admin';

  /// Managers see everything except accounts.
  bool get isManager => role == 'manager';

  /// Admins and managers use the management dashboard.
  bool get isManagement => role == 'admin' || role == 'manager';

  bool get isEmployee => role == 'employee';

  factory AppUser.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return AppUser(
      id: d.id,
      name: _str(m['name'], 'Unnamed'),
      loginId: _str(m['loginId']),
      email: _str(m['email']),
      phone: _str(m['phone']),
      contactEmail: _str(m['contactEmail']),
      designation: _str(m['designation']),
      role: _str(m['role'], 'employee'),
      active: m['active'] != false,
      weeklyOffDays: (m['weeklyOffDays'] is List)
          ? (m['weeklyOffDays'] as List).whereType<num>().map((e) => e.toInt()).toList()
          : const [],
      monthlyOffQuota: _int(m['monthlyOffQuota'], kDefaultMonthlyOffQuota),
      createdAt: _ts(m['createdAt']),
      forceLogoutAt: _ts(m['forceLogoutAt']),
      violationsClearedAt: _ts(m['violationsClearedAt']),
      canViewIds: m['canViewIds'] == true,
      isDriver: m['isDriver'] == true,
      tripRatePerKm: _dbl(m['tripRatePerKm']),
      vehicle: _str(m['vehicle']),
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
  /// Checked in although the previous working day had too many GPS violations.
  final bool violationMark;
  final String violationNote;
  final String note;
  final int? tz;
  final int? outTz;

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
    this.violationMark = false,
    this.violationNote = '',
    this.note = '',
    this.tz,
    this.outTz,
  });

  bool get isOpen => checkOut == null;

  /// Check-in / check-out as local time at the site.
  DateTime get inLocal => atZone(checkIn, tz);
  DateTime? get outLocal => checkOut == null ? null : atZone(checkOut!, outTz ?? tz);
  bool get flagged => inOutside || outOutside || mocked || violationMark;

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
      violationMark: m['violationMark'] == true,
      violationNote: _str(m['violationNote']),
      note: _str(m['note']),
      tz: _tz(m['tz']),
      outTz: _tz(m['outTz']),
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
  final int? tz;
  final DateTime? editedAt;
  final String editedBy;

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
    this.tz,
    this.editedAt,
    this.editedBy = '',
  });

  DateTime? get createdLocal => createdAt == null ? null : atZone(createdAt!, tz);

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
      tz: _tz(m['tz']),
      editedAt: _ts(m['editedAt']),
      editedBy: _str(m['editedBy']),
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
  final String type; // left_site | gps_off | no_activity | checkin_blocked
  final int minutes; // no_activity: minutes without a GPS update
  final DateTime? fromAt;
  final double? lat;
  final double? lng;
  final double? distance;
  final DateTime? at;
  final int? tz;
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
    this.tz,
    this.resolved = false,
    this.resolvedBy = '',
    this.minutes = 0,
    this.fromAt,
  });

  /// GPS violations count towards the daily limit (no location for an hour or more).
  bool get isGpsViolation => type == 'no_activity' || type == 'gps_off';

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
      tz: _tz(m['tz']),
      resolved: m['resolved'] == true,
      resolvedBy: _str(m['resolvedBy']),
      minutes: _int(m['minutes']),
      fromAt: _ts(m['fromAt']),
    );
  }

  String get label => type == 'no_activity'
      ? 'No activity — no GPS location for ${minutes >= 60 ? '${(minutes / 60).floor()} h' : '$minutes min'}'
      : type == 'checkin_blocked'
      ? 'Check-in blocked — repeated GPS violations'
      : type == 'gps_off'
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
  final int? tz;
  final String date;
  final String company;
  final String trade;
  final String employeeName;
  final String siteId;

  WorkerEntry({
    required this.id,
    required this.workerId,
    required this.workerName,
    required this.sessionId,
    required this.siteName,
    required this.checkIn,
    this.checkOut,
    this.open = false,
    this.tz,
    this.date = '',
    this.company = '',
    this.trade = '',
    this.employeeName = '',
    this.siteId = '',
  });

  DateTime get inLocal => atZone(checkIn, tz);

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
      tz: _tz(m['tz']),
      date: _str(m['date']),
      company: _str(m['company']),
      trade: _str(m['trade']),
      employeeName: _str(m['employeeName']),
      siteId: _str(m['siteId']),
    );
  }
}

/// A scanned ID copy (passport, Emirates ID, SIRA…) stored in chunks.
class IdFileMeta {
  final String id;
  final String ownerId;
  final String kind;
  final String name;
  final String mime;
  final int size;
  final int chunks;
  final DateTime? uploadedAt;
  /// front | back — set by the guided scanner.
  final String side;
  /// Waiting for approval (uploaded through the Documents Portal).
  final bool pending;
  /// Heading of an additional document (kind 'other').
  final String title;

  IdFileMeta({
    this.pending = false,
    this.title = '',
    this.side = '',
    required this.id,
    required this.ownerId,
    required this.kind,
    required this.name,
    required this.mime,
    required this.size,
    required this.chunks,
    this.uploadedAt,
  });

  bool get isImage => mime.startsWith('image/');

  factory IdFileMeta.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return IdFileMeta(
      id: d.id,
      ownerId: _str(m['ownerId']),
      kind: _str(m['kind'], 'other'),
      name: _str(m['name'], 'file'),
      mime: _str(m['mime'], 'application/octet-stream'),
      side: _str(m['side']),
      pending: m['pending'] == true,
      title: _str(m['title']),
      size: _int(m['size']),
      chunks: _int(m['chunks'], 1),
      uploadedAt: _ts(m['uploadedAt']),
    );
  }
}

/// The ID documents an employee can keep up to date themselves.
class IdKind {
  final String key;
  final String label;
  final String? numField;
  final String? expField;
  const IdKind(this.key, this.label, [this.numField, this.expField]);
}

const idKinds = [
  IdKind('passport', 'Passport', 'passportNo', 'passportExpiry'),
  IdKind('eid', 'Emirates ID', 'eidNo', 'eidExpiry'),
  IdKind('sira', 'SIRA card', 'siraNo', 'siraExpiry'),
  IdKind('visa', 'Visa', 'visaNo', 'visaExpiry'),
  IdKind('mcc', 'Abu Dhabi MCC certificate', 'mccNo', 'mccExpiry'),
  IdKind('labour', 'Labour card / work permit', 'labourCardNo', 'labourCardExpiry'),
  IdKind('photo', 'Photo'),
  IdKind('other', 'Other documents'),
];

/// One place for one copy: EID front, EID back, visa, passport front, passport address page…
class IdSlot {
  final String kind, side, label, short;
  const IdSlot(this.kind, this.side, this.label, this.short);
  String get key => '$kind/$side';
  bool get twoSided => kind == 'eid' || kind == 'passport';
  IdKind get idKind => idKinds.firstWhere((k) => k.key == kind);
}

const idSlots = [
  IdSlot('eid', 'front', 'Emirates ID - front', 'EID FRONT'),
  IdSlot('eid', 'back', 'Emirates ID - back', 'EID BACK'),
  IdSlot('visa', 'front', 'Visa', 'VISA'),
  IdSlot('passport', 'front', 'Passport - front (photo page)', 'PASSPORT FRONT'),
  IdSlot('passport', 'back', 'Passport - address page', 'PASSPORT ADDRESS'),
  IdSlot('sira', 'front', 'SIRA card', 'SIRA'),
  IdSlot('mcc', 'front', 'Abu Dhabi MCC certificate', 'ABU DHABI MCC'),
  IdSlot('photo', 'front', 'Passport-size photo', 'PHOTO'),
  IdSlot('labour', 'front', 'Labour card / work permit', 'LABOUR CARD'),
];

/// Puts each copy into its slot (newest wins). Copies without a side (older uploads) fill the empty
/// slot of their kind; anything left over — and 'other' documents — is returned in [extra].
({Map<String, IdFileMeta> slot, List<IdFileMeta> extra}) assignIdSlots(List<IdFileMeta> files) {
  final slot = <String, IdFileMeta>{};
  final extra = <IdFileMeta>[];
  final sorted = [...files]..sort((a, b) => (b.uploadedAt ?? DateTime(2100)).compareTo(a.uploadedAt ?? DateTime(2100)));
  final loose = <IdFileMeta>[];
  for (final f in sorted) {
    final s = idSlots.where((s) => s.kind == f.kind).toList();
    if (s.isEmpty) {
      extra.add(f);
      continue;
    }
    final side = f.side.isEmpty ? (s.length == 1 ? s.first.side : '') : f.side;
    final key = '${f.kind}/$side';
    if (side.isNotEmpty && s.any((x) => x.key == key) && !slot.containsKey(key)) {
      slot[key] = f;
    } else {
      loose.add(f);
    }
  }
  // Older copies without a side: oldest first → front, then back.
  for (final f in loose.reversed) {
    final free = idSlots.where((s) => s.kind == f.kind && !slot.containsKey(s.key)).firstOrNull;
    if (f.side.isEmpty && free != null) {
      slot[free.key] = f;
    } else {
      extra.add(f);
    }
  }
  extra.sort((a, b) => (a.uploadedAt ?? DateTime(2000)).compareTo(b.uploadedAt ?? DateTime(2000)));
  return (slot: slot, extra: extra);
}

/// Heading shown for an additional document.
String idFileHeading(IdFileMeta f) {
  if (f.title.isNotEmpty) return f.title;
  final k = idKinds.where((k) => k.key == f.kind).firstOrNull;
  if (f.kind == 'other' || k == null) return f.name;
  return '${k.label} (extra copy)';
}

// ------------------------------------------------------------------ company documents
class CompanyDocType {
  final String key, label;
  const CompanyDocType(this.key, this.label);
}

/// Standard company documents; anything else is added as an additional document with its own heading.
const companyDocTypes = [
  CompanyDocType('tradeLicense', 'LLCT trade license (Dubai)'),
  CompanyDocType('adTradeLicense', 'Abu Dhabi LLCT trade license'),
  CompanyDocType('chamber', 'Chamber of Commerce certificate'),
  CompanyDocType('wcInsurance', "WC insurance (workmen's compensation)"),
  CompanyDocType('vat', 'VAT / TRN certificate'),
  CompanyDocType('estCard', 'Establishment card (immigration)'),
  CompanyDocType('mohre', 'MOHRE / labour establishment card'),
  CompanyDocType('tenancy', 'Office tenancy contract / Ejari'),
  CompanyDocType('tplInsurance', 'Third-party liability insurance'),
  CompanyDocType('medical', 'Staff medical insurance'),
  CompanyDocType('moa', 'Memorandum of association (MOA)'),
];

class CompanyDoc {
  final String id, key, title, number, issueDate, expiry, notes;
  final bool custom;
  final DateTime? updatedAt;
  const CompanyDoc({required this.id, this.key = '', required this.title, this.number = '', this.issueDate = '', this.expiry = '', this.notes = '', this.custom = false, this.updatedAt});

  factory CompanyDoc.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return CompanyDoc(
      id: d.id,
      key: _str(m['key']),
      title: _str(m['title'], 'Document'),
      number: _str(m['number']),
      issueDate: _str(m['issueDate']),
      expiry: _str(m['expiry']),
      notes: _str(m['notes']),
      custom: m['custom'] == true,
      updatedAt: _ts(m['updatedAt']),
    );
  }
}

class CompanyFile {
  final String id, docId, name, mime;
  final int size, chunks;
  final DateTime? uploadedAt;
  final String uploadedBy;
  const CompanyFile({required this.id, required this.docId, required this.name, required this.mime, this.size = 0, this.chunks = 1, this.uploadedAt, this.uploadedBy = ''});
  bool get isImage => mime.startsWith('image/');

  factory CompanyFile.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return CompanyFile(
      id: d.id,
      docId: _str(m['docId']),
      name: _str(m['name'], 'file'),
      mime: _str(m['mime'], 'application/octet-stream'),
      size: _int(m['size']),
      chunks: _int(m['chunks'], 1),
      uploadedAt: _ts(m['uploadedAt']),
      uploadedBy: _str(m['uploadedBy']),
    );
  }
}

/// Max size of one uploaded document copy.
const kMaxDocBytes = 2 * 1024 * 1024;


/// A driver's car trip: start → stop with GPS route, distance and cost.
class Trip {
  final String id;
  final String employeeId;
  final String employeeName;
  final String vehicle;
  final String purpose;
  final String status; // active | done
  final DateTime startAt;
  final DateTime? endAt;
  final int? tz;
  final double? startLat, startLng, endLat, endLng, lastLat, lastLng;
  final String startSiteId, startSiteName, endSiteId, endSiteName, siteId, siteName;
  final double distanceM;
  final double? ratePerKm;
  final double? cost;
  final int pointsCount;
  /// driver = a driver's own trip (paid km × rate) · taxi = employee's taxi ride (fare entered)
  /// · withDriver = employee riding with a company driver (paid through the driver's trip).
  final String kind;
  final String driverId, driverName;
  /// Driver typed the cost themselves (instead of km × rate).
  final bool costEntered;
  final String note, editedBy;

  Trip({
    this.note = '',
    this.editedBy = '',
    this.costEntered = false,
    this.kind = 'driver',
    this.driverId = '',
    this.driverName = '',
    required this.id,
    required this.employeeId,
    required this.employeeName,
    this.vehicle = '',
    this.purpose = '',
    this.status = 'active',
    required this.startAt,
    this.endAt,
    this.tz,
    this.startLat,
    this.startLng,
    this.endLat,
    this.endLng,
    this.lastLat,
    this.lastLng,
    this.startSiteId = '',
    this.startSiteName = '',
    this.endSiteId = '',
    this.endSiteName = '',
    this.siteId = '',
    this.siteName = '',
    this.distanceM = 0,
    this.ratePerKm,
    this.cost,
    this.pointsCount = 0,
  });

  bool get isActive => status == 'active';
  bool get isTaxi => kind == 'taxi';
  bool get isWithDriver => kind == 'withDriver';
  bool get isRide => isTaxi || isWithDriver;
  String get kindLabel => isTaxi ? 'Taxi' : (isWithDriver ? 'Company driver${driverName.isEmpty ? '' : ' · $driverName'}' : 'Driver trip');
  double get km => distanceM / 1000;
  Duration get duration => (endAt ?? DateTime.now()).difference(startAt);
  DateTime get startLocal => atZone(startAt, tz);
  DateTime? get endLocal => endAt == null ? null : atZone(endAt!, tz);

  factory Trip.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return Trip(
      id: d.id,
      employeeId: _str(m['employeeId']),
      employeeName: _str(m['employeeName']),
      vehicle: _str(m['vehicle']),
      purpose: _str(m['purpose']),
      status: _str(m['status'], 'active'),
      startAt: _ts(m['startAt']) ?? DateTime.now(),
      endAt: _ts(m['endAt']),
      tz: _tz(m['tz']),
      startLat: _dbl(m['startLat']),
      startLng: _dbl(m['startLng']),
      endLat: _dbl(m['endLat']),
      endLng: _dbl(m['endLng']),
      lastLat: _dbl(m['lastLat']),
      lastLng: _dbl(m['lastLng']),
      startSiteId: _str(m['startSiteId']),
      startSiteName: _str(m['startSiteName']),
      endSiteId: _str(m['endSiteId']),
      endSiteName: _str(m['endSiteName']),
      siteId: _str(m['siteId']),
      siteName: _str(m['siteName']),
      distanceM: _dbl(m['distanceM']) ?? 0,
      ratePerKm: _dbl(m['ratePerKm']),
      cost: _dbl(m['cost']),
      pointsCount: _int(m['pointsCount']),
      kind: _str(m['kind'], 'driver'),
      driverId: _str(m['driverId']),
      driverName: _str(m['driverName']),
      costEntered: m['costEntered'] == true,
      note: _str(m['note']),
      editedBy: _str(m['editedBy']),
    );
  }
}

/// Money paid to a driver by admin. Balance = trip costs − payments.
class DriverPayment {
  final String id;
  final String employeeId;
  final double amount;
  final String date; // yyyy-MM-dd
  final String method;
  final String note;
  final String createdBy;
  DriverPayment({
    required this.id,
    required this.employeeId,
    required this.amount,
    required this.date,
    this.method = '',
    this.note = '',
    this.createdBy = '',
  });
  factory DriverPayment.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return DriverPayment(
      id: d.id,
      employeeId: _str(m['employeeId']),
      amount: _dbl(m['amount']) ?? 0,
      date: _str(m['date']),
      method: _str(m['method']),
      note: _str(m['note']),
      createdBy: _str(m['createdBy']),
    );
  }
}


// ---------------------------------------------------------------------------
// Accounts (admin only) — same data as the web dashboard's Accounts page.
// ---------------------------------------------------------------------------

const kAcctIncome = ['Cheque deposit', 'Cash deposit', 'Bank transfer received', 'Client payment', 'Owner capital', 'Loan received', 'Refund received', 'Other income'];
const kAcctExpense = ['Purchase', 'Supplier payment', 'Salaries & wages', 'Labour supply', 'Rent', 'Utilities', 'Fuel', 'Vehicle & maintenance', 'Transport', 'Tools & equipment', 'Materials', 'Visa & PRO', 'Office expenses', 'Bank charges', 'Other expense'];
const kAcctMethods = ['Cash', 'Cheque', 'Bank transfer', 'Card', 'Online / app'];

/// Income or expense line. [source]: manual entry, or automatic from petty cash given / driver payments.
class AcctEntry {
  final String id;
  final String source; // manual | petty | driver
  final String type; // income | expense
  final String date;
  final double amount;
  final String category, method, reference, bank, chequeDate, party, note, siteId, siteName;
  final bool hasFile;
  final DateTime? createdAt;
  AcctEntry({
    required this.id,
    this.source = 'manual',
    required this.type,
    required this.date,
    required this.amount,
    this.category = '',
    this.method = 'Cash',
    this.reference = '',
    this.bank = '',
    this.chequeDate = '',
    this.party = '',
    this.note = '',
    this.siteId = '',
    this.siteName = '',
    this.hasFile = false,
    this.createdAt,
  });
  bool get isIncome => type == 'income';
  bool get isBank => method != 'Cash';
  double get signed => isIncome ? amount : -amount;

  factory AcctEntry.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return AcctEntry(
      id: d.id,
      type: m['type'] == 'income' ? 'income' : 'expense',
      date: _str(m['date']),
      amount: _dbl(m['amount']) ?? 0,
      category: _str(m['category']),
      method: _str(m['method'], 'Cash'),
      reference: _str(m['reference']),
      bank: _str(m['bank']),
      chequeDate: _str(m['chequeDate']),
      party: _str(m['party']),
      note: _str(m['note']),
      siteId: _str(m['siteId']),
      siteName: _str(m['siteName']),
      hasFile: m['hasFile'] == true,
      createdAt: _ts(m['createdAt']),
    );
  }
}


/// A person whose ID documents are kept: staff (users) or an external worker.
class IdOwner {
  final String id, type, name, org, phone, code;
  const IdOwner({required this.id, required this.type, required this.name, this.org = '', this.phone = '', this.code = ''});
  bool get isWorker => type == 'worker';

  factory IdOwner.fromUser(AppUser u) =>
      IdOwner(id: u.id, type: 'staff', name: u.name, org: u.designation, phone: u.phone, code: u.loginId);
}
