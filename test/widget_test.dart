import 'package:attendance_pro/core/utils.dart';
import 'package:attendance_pro/models/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('login IDs become emails', () {
    expect(loginToEmail('EMP001'), 'emp001@$kLoginDomain');
    expect(loginToEmail('a@b.com'), 'a@b.com');
  });

  test('duration formatting', () {
    expect(fmtDuration(const Duration(hours: 7, minutes: 5)), '7h 05m');
    expect(fmtDuration(const Duration(minutes: 42)), '42m');
    expect(fmtClock(const Duration(hours: 1, minutes: 2, seconds: 3)), '01:02:03');
  });

  test('petty balance', () {
    PettyTxn t(String type, double amt, String status) => PettyTxn(
        id: '', employeeId: 'e', employeeName: 'E', type: type, amount: amt, status: status);
    final s = PettySummary.of([
      t('credit', 5000, 'approved'),
      t('expense', 1200, 'approved'),
      t('expense', 300, 'pending'),
      t('expense', 999, 'rejected'),
    ]);
    expect(s.credited, 5000);
    expect(s.spent, 1200);
    expect(s.balance, 3800);
    expect(s.pending, 300);
    expect(s.pendingCount, 1);
  });

  test('weekly off days count as off in month summary', () {
    final user = AppUser(
      id: 'u',
      name: 'Test',
      loginId: 't',
      email: 't@x',
      weeklyOffDays: const [7],
      createdAt: DateTime(2020),
    );
    final m = MonthSummary.build(
      month: DateTime(2025, 6, 1), // June 2025 has 5 Sundays
      user: user,
      sessions: const [],
      offDays: const [],
    );
    expect(m.offDays, 5);
    expect(m.workedDays, 0);
  });
}
