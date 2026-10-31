import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/auth_service.dart';
import '../../services/db.dart';
import '../../services/tracking_service.dart';
import '../../services/trip_service.dart';
import '../../widgets/common.dart';
import '../../widgets/profile_prompt.dart';
import '../../widgets/service_alerts.dart';
import '../admin/accounts_tab.dart';
import '../admin/company_documents_screen.dart';
import '../admin/id_documents_screen.dart';
import '../reports/reports_screen.dart';
import 'history_tab.dart';
import 'home_tab.dart';
import 'my_documents_screen.dart';
import 'petty_tab.dart';
import 'site_update_tab.dart';

class EmployeeShell extends StatefulWidget {
  final AppUser me;
  const EmployeeShell({super.key, required this.me});

  @override
  State<EmployeeShell> createState() => _EmployeeShellState();
}

class _EmployeeShellState extends State<EmployeeShell> {
  int _index = 0;
  StreamSubscription<AttendanceSession?>? _openSub;
  AttendanceSession? _open;

  static const _titles = ['Today', 'My Attendance', 'Site Updates', 'Petty Cash'];

  @override
  void initState() {
    super.initState();
    // Missing mobile / email / passport / Emirates ID? Ask once when the app opens.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ProfilePrompt.maybeAsk(context, widget.me);
    });
    // Single source of truth for live tracking: run it whenever a session is open.
    _openSub = Db.openSession(widget.me.id).listen((s) {
      if (!mounted) return;
      setState(() => _open = s);
      if (s != null) {
        TrackingService.instance.start(uid: widget.me.id, name: widget.me.name, session: s);
      } else if (TrackingService.instance.isRunning) {
        TrackingService.instance.stop();
      }
    });
  }

  @override
  void dispose() {
    _openSub?.cancel();
    super.dispose();
  }

  Future<void> _signOut() async {
    final msg = _open != null
        ? 'You are still checked in at ${_open!.siteName}. Location sharing will stop '
            'until you sign in again. Sign out anyway?'
        : 'Sign out of this device?';
    if (!await confirm(context, 'Sign out', msg, ok: 'Sign out')) return;
    await TrackingService.instance.stop(markStopped: true);
    await TripService.instance.detach();
    await AuthService.signOut();
  }

  void _profile() {
    final me = widget.me;
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Avatar(me.name, size: 64),
            const SizedBox(height: 10),
            Text(me.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            if (me.designation.isNotEmpty)
              Text(me.designation, style: const TextStyle(color: AppColors.muted)),
            const SizedBox(height: 14),
            InfoRow(Icons.badge_outlined, 'Login ID', me.loginId),
            if (me.phone.isNotEmpty) InfoRow(Icons.phone_outlined, 'Phone', me.phone),
            InfoRow(Icons.event_busy_outlined, 'Off days', me.offDayLabel),
            InfoRow(Icons.calendar_month_outlined, 'Monthly quota', '${me.monthlyOffQuota} days'),
            const SizedBox(height: 16),
            const SizedBox(height: 12),
            if (me.contactEmail.isNotEmpty) InfoRow(Icons.mail_outline, 'Email', me.contactEmail),
            OutlinedButton.icon(
              onPressed: () {
                Navigator.pop(c);
                ProfilePrompt.editContact(context, widget.me);
              },
              icon: const Icon(Icons.edit_outlined),
              label: Text(me.phone.isEmpty || me.contactEmail.isEmpty ? 'Add mobile number & email' : 'Edit mobile number & email'),
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              style: FilledButton.styleFrom(
                  backgroundColor: AppColors.accent, foregroundColor: AppColors.primaryDark),
              onPressed: () {
                Navigator.pop(c);
                Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => MyDocumentsScreen(me: widget.me)));
              },
              icon: const Icon(Icons.badge_outlined),
              label: const Text('My ID documents'),
            ),
            if (me.seesAccounts) ...[
              const SizedBox(height: 8),
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
                onPressed: () {
                  Navigator.pop(c);
                  Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => Scaffold(
                            appBar: AppBar(title: Text(me.canEditAccounts ? 'Accounts' : 'Accounts · view only')),
                            body: AccountsTab(me: me),
                          )));
                },
                icon: const Icon(Icons.menu_book_outlined),
                label: Text(me.canEditAccounts ? 'Accounts' : 'Accounts (view)'),
              ),
            ],
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () {
                Navigator.pop(c);
                Navigator.of(context).push(MaterialPageRoute(builder: (_) => ReportsScreen(me: me, session: _open)));
              },
              icon: const Icon(Icons.description_outlined),
              label: const Text('Service & delivery reports'),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () {
                Navigator.pop(c);
                Navigator.of(context).push(MaterialPageRoute(builder: (_) => CompanyDocumentsScreen(me: me)));
              },
              icon: const Icon(Icons.business_center_outlined),
              label: const Text('Company documents'),
            ),
            if (me.canViewIds) ...[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () {
                  Navigator.pop(c);
                  Navigator.of(context).push(MaterialPageRoute(builder: (_) => IdDocumentsScreen(me: me)));
                },
                icon: const Icon(Icons.folder_shared_outlined),
                label: const Text('Staff ID documents'),
              ),
            ],
            const SizedBox(height: 8),
            const Text('LLCT Attendance v$kAppVersion',
                style: TextStyle(color: AppColors.muted, fontSize: 12)),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () {
                Navigator.pop(c);
                _signOut();
              },
              icon: const Icon(Icons.logout),
              label: const Text('Sign out'),
            ),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final me = widget.me;
    return ServiceAlerts(me: me, child: Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: Row(children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(9),
            child: Image.asset('assets/icon.png', width: 34, height: 34),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_titles[_index], maxLines: 1, overflow: TextOverflow.ellipsis),
              Text(fmtDate(DateTime.now()),
                  style: const TextStyle(fontSize: 12, color: AppColors.muted, fontWeight: FontWeight.w500)),
            ]),
          ),
        ]),
        actions: [
          if (_open != null)
            const Padding(
              padding: EdgeInsets.only(right: 4),
              child: Pill('ON DUTY', color: AppColors.success, icon: Icons.circle),
            ),
          ServiceJobsButton(me: me),
          IconButton(
            onPressed: _profile,
            icon: Avatar(me.name, size: 32),
          ),
          const SizedBox(width: 6),
        ],
      ),
      body: IndexedStack(
        index: _index,
        children: [
          HomeTab(me: me, open: _open, onNavigate: (i) => setState(() => _index = i)),
          HistoryTab(me: me),
          SiteUpdateTab(me: me, open: _open),
          PettyTab(me: me),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.fingerprint), selectedIcon: Icon(Icons.fingerprint), label: 'Today'),
          NavigationDestination(
              icon: Icon(Icons.calendar_month_outlined),
              selectedIcon: Icon(Icons.calendar_month),
              label: 'History'),
          NavigationDestination(
              icon: Icon(Icons.construction_outlined),
              selectedIcon: Icon(Icons.construction),
              label: 'Updates'),
          NavigationDestination(
              icon: Icon(Icons.account_balance_wallet_outlined),
              selectedIcon: Icon(Icons.account_balance_wallet),
              label: 'Petty'),
        ],
      ),
    ));
  }
}
