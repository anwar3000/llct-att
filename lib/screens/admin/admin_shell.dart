import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/auth_service.dart';
import '../../widgets/common.dart';
import 'admin_live.dart';
import 'live_map_tab.dart';
import 'overview_tab.dart';
import 'petty_admin_tab.dart';
import 'accounts_tab.dart';
import 'sites_tab.dart';
import 'team_tab.dart';
import 'trips_tab.dart';

/// Management dashboard. Uses a side rail on tablets/desktop and a bottom bar on phones.
class AdminShell extends StatefulWidget {
  final AppUser me;
  const AdminShell({super.key, required this.me});

  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  int _index = 0;
  late final _live = AdminLive(canSeeAccounts: widget.me.isAdmin);

  @override
  void initState() {
    super.initState();
    _live.start();
  }

  @override
  void dispose() {
    _live.dispose();
    super.dispose();
  }

  static const _allItems = [
    (icon: Icons.space_dashboard_outlined, active: Icons.space_dashboard_rounded, label: 'Overview'),
    (icon: Icons.map_outlined, active: Icons.map_rounded, label: 'Map'),
    (icon: Icons.groups_outlined, active: Icons.groups_rounded, label: 'Team'),
    (icon: Icons.apartment_outlined, active: Icons.apartment_rounded, label: 'Sites'),
    (icon: Icons.directions_car_outlined, active: Icons.directions_car_filled_rounded, label: 'Trips'),
    (icon: Icons.account_balance_wallet_outlined, active: Icons.account_balance_wallet_rounded, label: 'Petty cash'),
    (icon: Icons.menu_book_outlined, active: Icons.menu_book_rounded, label: 'Accounts'),
  ];

  /// Managers don't see petty cash and accounts.
  List<({IconData icon, IconData active, String label})> get _items =>
      widget.me.isAdmin ? _allItems : _allItems.sublist(0, 5);

  void go(int i) => setState(() => _index = i.clamp(0, _items.length - 1));

  Future<void> _signOut() async {
    if (await confirm(context, 'Sign out', 'Sign out of the management dashboard?', ok: 'Sign out')) {
      await AuthService.signOut();
    }
  }

  @override
  Widget build(BuildContext context) {
    // Side rail on big screens (unfolded Galaxy Fold, tablets); labels beside icons when there is room.
    final width = MediaQuery.of(context).size.width;
    final wide = width >= 600;
    final extended = width >= 1000;
    final pages = [
      OverviewTab(me: widget.me, live: _live, onNavigate: go),
      LiveMapTab(me: widget.me, live: _live),
      TeamTab(me: widget.me, live: _live),
      SitesTab(me: widget.me, live: _live),
      TripsTab(me: widget.me, live: _live),
      if (widget.me.isAdmin) PettyAdminTab(me: widget.me, live: _live),
      if (widget.me.isAdmin) AccountsTab(me: widget.me, live: _live),
    ];
    final body = IndexedStack(index: _index, children: pages);

    final appBar = AppBar(
      title: Row(children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Image.asset('assets/icon.png', width: 32, height: 32),
        ),
        const SizedBox(width: 10),
        Text(_items[_index].label),
      ]),
      actions: [
        Padding(
          padding: const EdgeInsets.only(right: 4),
          child: Center(
            child: Text(fmtDateShort(DateTime.now()),
                style: const TextStyle(color: AppColors.muted)),
          ),
        ),
        PopupMenuButton<String>(
          icon: Avatar(widget.me.name, size: 32),
          onSelected: (v) {
            if (v == 'out') _signOut();
          },
          itemBuilder: (_) => [
            PopupMenuItem(
              enabled: false,
              child: Text('${widget.me.name}\n${widget.me.isAdmin ? 'Admin' : 'Manager'}',
                  style: const TextStyle(color: AppColors.ink)),
            ),
            const PopupMenuDivider(),
            const PopupMenuItem(
              value: 'out',
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(Icons.logout),
                title: Text('Sign out'),
              ),
            ),
          ],
        ),
        const SizedBox(width: 8),
      ],
    );

    if (wide) {
      return Scaffold(
        appBar: appBar,
        body: Row(children: [
          NavigationRail(
            selectedIndex: _index,
            onDestinationSelected: go,
            extended: extended,
            labelType: extended ? NavigationRailLabelType.none : NavigationRailLabelType.all,
            backgroundColor: Colors.white,
            indicatorColor: AppColors.accent,
            selectedIconTheme: const IconThemeData(color: AppColors.primaryDark),
            unselectedIconTheme: const IconThemeData(color: AppColors.muted),
            selectedLabelTextStyle: const TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w700, fontSize: 12.5),
            unselectedLabelTextStyle: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w500, fontSize: 12.5),
            destinations: _items
                .map((e) => NavigationRailDestination(
                    icon: Icon(e.icon), selectedIcon: Icon(e.active), label: Text(e.label)))
                .toList(),
          ),
          const VerticalDivider(width: 1),
          Expanded(child: body),
        ]),
      );
    }
    return Scaffold(
      appBar: appBar,
      body: body,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: go,
        height: 68,
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        indicatorColor: AppColors.accent,
        // 7 tabs on a phone: show the label of the selected one only, so nothing gets squeezed.
        labelBehavior: _items.length > 5
            ? NavigationDestinationLabelBehavior.onlyShowSelected
            : NavigationDestinationLabelBehavior.alwaysShow,
        destinations: _items
            .map((e) => NavigationDestination(
                icon: Icon(e.icon), selectedIcon: Icon(e.active), label: e.label))
            .toList(),
      ),
    );
  }
}
