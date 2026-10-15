import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../widgets/common.dart';

enum StaffState { onDuty, done, off, notIn }

class StaffStatus {
  final AppUser user;
  final StaffState state;
  final List<AttendanceSession> today;
  final AttendanceSession? open;
  StaffStatus(this.user, this.state, this.today, this.open);

  Duration get worked {
    var d = totalWorked(today.where((s) => !s.isOpen));
    if (open != null) d += DateTime.now().difference(open!.checkIn);
    return d;
  }

  bool get forgotCheckout => open != null && open!.date != dateKey(DateTime.now());

  Pill get pill {
    switch (state) {
      case StaffState.onDuty:
        return forgotCheckout
            ? const Pill('Open since yesterday', color: AppColors.danger, icon: Icons.warning_amber)
            : const Pill('On duty', color: AppColors.success, icon: Icons.circle);
      case StaffState.done:
        return const Pill('Checked out', color: AppColors.primary, icon: Icons.check);
      case StaffState.off:
        return const Pill('Off day', color: AppColors.warning, icon: Icons.beach_access);
      case StaffState.notIn:
        return const Pill('Not checked in', color: AppColors.muted);
    }
  }

  Color get color {
    switch (state) {
      case StaffState.onDuty:
        return AppColors.success;
      case StaffState.done:
        return AppColors.primary;
      case StaffState.off:
        return AppColors.warning;
      case StaffState.notIn:
        return AppColors.muted;
    }
  }
}

/// Works out each employee's status for today.
List<StaffStatus> computeStatuses({
  required List<AppUser> users,
  required List<AttendanceSession> todaySessions,
  required List<AttendanceSession> openSessions,
  required List<OffDay> monthOffDays,
}) {
  final now = DateTime.now();
  final today = dateKey(now);
  final out = <StaffStatus>[];
  for (final u in users.where((u) => !u.isAdmin && u.active)) {
    final mine = todaySessions.where((s) => s.employeeId == u.id).toList();
    final open = openSessions.where((s) => s.employeeId == u.id).firstOrNull;
    final off = u.isWeeklyOff(now) ||
        monthOffDays.any((o) => o.employeeId == u.id && o.date == today && o.status == 'approved');
    StaffState st;
    if (open != null) {
      st = StaffState.onDuty;
    } else if (mine.isNotEmpty) {
      st = StaffState.done;
    } else if (off) {
      st = StaffState.off;
    } else {
      st = StaffState.notIn;
    }
    out.add(StaffStatus(u, st, mine, open));
  }
  out.sort((a, b) {
    final c = a.state.index.compareTo(b.state.index);
    return c != 0 ? c : a.user.name.compareTo(b.user.name);
  });
  return out;
}
