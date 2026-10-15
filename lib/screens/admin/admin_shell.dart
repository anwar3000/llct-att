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
import 'sites_tab.dart';
import 'team_tab.dart';

/// Management dashboard. Uses a side rail on tablets/desktop and a bottom bar on phones.
class AdminShell extends StatefulWidget {
  final AppUser me;
  const AdminShell({super.key, required this.me});

  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  int _index = 0;
  final _live = AdminLive();

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

  static const _items = [
    (icon: Icons.dashboard_outlined, active: Icons.dashboard, label: 'Overview'),
    (icon: Icons.map_outlined, active: Icons.map, label: 'Live Map'),
    (icon: Icons.groups_outlined, active: Icons.groups, label: 'Team'),
    (icon: Icons.location_city_outlined, active: Icons.location_city, label: 'Sites'),
    (icon: Icons.account_balance_wallet_outlined, active: Icons.account_balance_wallet, label: 'Petty'),
  ];

  void go(int i) => setState(() => _index = i);

  Future<void> _signOut() async {
    if (await confirm(context, 'Sign out', 'Sign out of the management dashboard?', ok: 'Sign out')) {
      await AuthService.signOut();
    }
  }

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.of(context).size.width >= 840;
    final pages = [
      OverviewTab(me: widget.me, live: _live, onNavigate: go),
      LiveMapTab(me: widget.me, live: _live),
      TeamTab(me: widget.me, live: _live),
      SitesTab(me: widget.me, live: _live),
      PettyAdminTab(me: widget.me, live: _live),
    ];
    final body = IndexedStack(index: _index, children: pages);

    final appBar = AppBar(
      title: Row(children: [
        const Icon(Icons.fingerprint, color: AppColors.primary),
        const SizedBox(width: 8),
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
              child: Text('${widget.me.name}\nManager',
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
            labelType: NavigationRailLabelType.all,
            backgroundColor: Colors.white,
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
        destinations: _items
            .map((e) => NavigationDestination(
                icon: Icon(e.icon), selectedIcon: Icon(e.active), label: e.label))
            .toList(),
      ),
    );
  }
}
