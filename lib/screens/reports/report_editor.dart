import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/inv_reports.dart';
import '../../services/location_service.dart';
import '../../services/service_desk.dart';
import '../../widgets/barcode_scanner.dart';
import '../../widgets/common.dart';
import 'report_view.dart';
import 'report_widgets.dart';

/// New / edit service report, call-out report or delivery note (saved to LLCT Invoicing's inv_docs).
class ReportEditor extends StatefulWidget {
  final AppUser me;
  final ReportKind kind;
  final InvReport? existing;
  final AttendanceSession? session;
  final ServiceTicket? ticket;
  const ReportEditor({super.key, required this.me, required this.kind, this.existing, this.session, this.ticket});

  @override
  State<ReportEditor> createState() => _ReportEditorState();
}

class _ReportEditorState extends State<ReportEditor> {
  InvConfig? _cfg;
  Map<String, dynamic>? _d;
  List<InvClient> _clients = const [];
  StreamSubscription? _sub;
  List<NearMatch> _near = const [];
  bool _gpsBusy = false;
  String? _gpsErr;
  bool _saving = false;
  bool _more = false;
  bool _ticketApplied = false;
  bool _sessionApplied = false;
  int _gen = 0; // bump to refresh text fields after a programmatic change

  bool get _isNew => widget.existing == null;
  ReportKind get _kind => kindOf('${_d?['reportType'] ?? ''}');

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final cfg = await InvConfig.load();
    final d = widget.existing != null ? Map<String, dynamic>.from(widget.existing!.m) : InvReports.newDraft(widget.kind, cfg, widget.me);
    d['items'] = ((d['items'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    d['attachments'] = ((d['attachments'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    final s = widget.session;
    if (_isNew && s != null) {
      d['attSiteId'] = s.siteId;
      d['attSessionId'] = s.id;
      d['attSiteName'] = s.siteName;
    }
    final t = widget.ticket;
    if (_isNew && t != null) {
      d['ticketId'] = t.id;
      d['ticketNo'] = t.number;
      d['ref'] = t.number;
      d['subject'] = t.typeLabel;
      d['complaint'] = [t.description, if (t.contactName.isNotEmpty) 'Reported by ${t.contactName}${t.contactPhone.isNotEmpty ? ' (${t.contactPhone})' : ''}']
          .where((x) => x.isNotEmpty)
          .join('\n');
      d['deliveryAddress'] = [t.siteName, t.siteAddress].where((x) => x.isNotEmpty).join(', ');
    }
    if (!mounted) return;
    setState(() {
      _cfg = cfg;
      _d = d;
    });
    _sub = InvReports.clients().listen((l) {
      if (!mounted) return;
      setState(() => _clients = l);
      _applyTicketClient();
      _applySessionClient();
    }, onError: (e) {
      if (mounted) showSnack(context, 'Could not load clients: $e', error: true);
    });
    if (_isNew) _getGps();
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  InvClient? get _client {
    final id = '${_d?['clientId'] ?? ''}';
    for (final c in _clients) {
      if (c.id == id) return c;
    }
    return null;
  }

  void _pickClient(InvClient c, {InvSite? site}) {
    final d = _d!;
    setState(() {
      d['clientId'] = c.id;
      d['client'] = c.snap();
      if (site != null) {
        _pickSite(site, rebuild: false);
      } else {
        d.remove('siteId');
        d.remove('siteName');
        d.remove('siteAddress');
      }
      _gen++;
    });
  }

  void _pickSite(InvSite s, {bool rebuild = true}) {
    final d = _d!;
    void apply() {
      d['siteId'] = s.id;
      d['siteName'] = s.name;
      d['siteAddress'] = s.address;
      d['deliveryAddress'] = s.text;
      if (s.contact.isNotEmpty && '${d['contactName'] ?? ''}' == widget.me.name && !_kind.isService) d['contactName'] = s.contact;
    }

    if (rebuild) {
      setState(() {
        apply();
        _gen++;
      });
    } else {
      apply();
    }
  }

  void _applyTicketClient() {
    final t = widget.ticket;
    if (!_isNew || t == null || _ticketApplied || _clients.isEmpty) return;
    _ticketApplied = true;
    final c = _clients.where((x) => x.id == t.clientId).firstOrNull;
    if (c == null) return;
    final site = c.sites.where((s) => s.name == t.siteName).firstOrNull;
    _pickClient(c, site: site);
  }

  void _applySessionClient() {
    final s = widget.session;
    if (!_isNew || s == null || _sessionApplied || _clients.isEmpty || widget.ticket != null) return;
    if (s.inLat == null || s.inLng == null) return;
    _sessionApplied = true;
    final m = InvReports.nearby(_clients, s.inLat!, s.inLng!, s.inAccuracy ?? 50);
    if (m.isNotEmpty && '${_d!['clientId'] ?? ''}'.isEmpty) {
      _pickClient(m.first.client, site: m.first.site);
      if (mounted) showSnack(context, 'Client and site from your check-in: ${m.first.client.name} – ${m.first.site.name}');
    } else if ('${_d!['deliveryAddress'] ?? ''}'.isEmpty) {
      setState(() {
        _d!['deliveryAddress'] = s.siteName;
        _gen++;
      });
    }
  }

  Future<void> _getGps() async {
    setState(() {
      _gpsBusy = true;
      _gpsErr = null;
    });
    try {
      final p = await LocationService.current();
      if (!mounted) return;
      final g = {'lat': double.parse(p.latitude.toStringAsFixed(6)), 'lng': double.parse(p.longitude.toStringAsFixed(6)), 'acc': p.accuracy.round(), 'at': isoNow()};
      setState(() {
        _d!['gps'] = g;
        _near = InvReports.nearby(_clients, p.latitude, p.longitude, p.accuracy);
        _gpsBusy = false;
      });
      if (_isNew && _near.isNotEmpty && '${_d!['clientId'] ?? ''}'.isEmpty) _pickClient(_near.first.client, site: _near.first.site);
    } catch (e) {
      if (mounted) {
        setState(() {
          _gpsBusy = false;
          _gpsErr = '$e';
        });
      }
    }
  }

  void _changeKind(ReportKind k) {
    final d = _d!;
    setState(() {
      if (k.isService) {
        d['reportType'] = k.key;
        d['technician'] ??= widget.me.name;
      } else {
        d.remove('reportType');
      }
      d['number'] = InvReports.suggestNumber(k, _cfg!, '${d['date']}');
      final items = d['items'] as List<Map<String, dynamic>>;
      for (final i in items) {
        if (!k.statuses.contains(i['status'])) i['status'] = k.statuses.first;
      }
      if (!k.isService && items.isEmpty) items.add(InvReports.newItem(k));
      _gen++;
    });
  }

  Future<void> _save() async {
    final d = _d!;
    if ('${d['clientId'] ?? ''}'.isEmpty) {
      showSnack(context, 'Choose a client first.', error: true);
      return;
    }
    final items = (d['items'] as List<Map<String, dynamic>>).where((i) => '${i['name']}'.trim().isNotEmpty || '${i['desc']}'.trim().isNotEmpty);
    if (items.isEmpty && !_kind.isService) {
      showSnack(context, 'Add at least one item.', error: true);
      return;
    }
    final c = _client;
    if (c != null) d['client'] = c.snap();
    setState(() => _saving = true);
    try {
      final r = await InvReports.save(widget.existing?.id, Map<String, dynamic>.from(d), widget.me, _cfg!, isNew: _isNew);
      if (!mounted) return;
      showSnack(context, 'Saved ${r.number}');
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => ReportView(me: widget.me, id: r.id)));
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        showSnack(context, '$e'.contains('permission') ? 'You don\'t have permission to save this. Ask the admin (LLCT Invoicing → Staff & access).' : 'Save failed: $e', error: true);
      }
    }
  }

  /// Scan a product barcode: adds that product from the invoicing product list (or a new line with the code).
  Future<void> _scanProduct() async {
    final codes = await scanCodes(context, title: 'Scan product');
    if (codes.isEmpty || !mounted) return;
    final code = codes.first;
    final p = await InvReports.findProduct(code);
    if (!mounted) return;
    final items = _d!['items'] as List<Map<String, dynamic>>;
    final it = InvReports.newItem(_kind)
      ..['name'] = p == null ? code : '${p['name'] ?? code}'
      ..['desc'] = p == null ? '' : '${p['desc'] ?? ''}'
      ..['unit'] = p == null ? 'pcs' : '${p['unit'] ?? 'pcs'}';
    if (p != null) it['pid'] = p['id'];
    final blank = items.indexWhere((i) => '${i['name'] ?? ''}'.trim().isEmpty && '${i['desc'] ?? ''}'.trim().isEmpty);
    setState(() {
      if (blank >= 0) {
        items[blank] = it;
      } else {
        items.add(it);
      }
      _gen++;
    });
    showSnack(context, p == null ? 'Code $code is not in the product list — added as a new line.' : 'Added ${p['name']}');
  }

  Future<void> _chooseClient() async {
    final c = await pickInvClient(context, _clients);
    if (c != null) _pickClient(c, site: c.sites.length == 1 ? c.sites.first : null);
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final k = _kind;
    final c = _client;
    final items = d['items'] as List<Map<String, dynamic>>;
    final atts = d['attachments'] as List<Map<String, dynamic>>;
    final g = d['gps'];
    Widget field(String key, String label, {int lines = 1, String? hint, TextInputType? type}) => Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: TextFormField(
            key: ValueKey('$key-$_gen'),
            initialValue: '${d[key] ?? ''}',
            minLines: lines,
            maxLines: lines == 1 ? 1 : lines + 6,
            keyboardType: type,
            decoration: InputDecoration(labelText: label, hintText: hint, alignLabelWithHint: lines > 1),
            onChanged: (v) => d[key] = v,
          ),
        );
    Widget timeField(String key, String label) => Expanded(
          child: Row(children: [
            Expanded(
              child: TextFormField(
                key: ValueKey('$key-$_gen'),
                initialValue: '${d[key] ?? ''}',
                readOnly: true,
                decoration: InputDecoration(labelText: label),
                onTap: () async {
                  final now = TimeOfDay.now();
                  final v = '${d[key] ?? ''}';
                  final parts = v.split(':');
                  final init = parts.length == 2 ? TimeOfDay(hour: int.tryParse(parts[0]) ?? now.hour, minute: int.tryParse(parts[1]) ?? now.minute) : now;
                  final tm = await showTimePicker(context: context, initialTime: init);
                  if (tm == null) return;
                  setState(() {
                    d[key] = '${tm.hour.toString().padLeft(2, '0')}:${tm.minute.toString().padLeft(2, '0')}';
                    _gen++;
                  });
                },
              ),
            ),
            TextButton(
                onPressed: () => setState(() {
                      final n = DateTime.now();
                      d[key] = '${n.hour.toString().padLeft(2, '0')}:${n.minute.toString().padLeft(2, '0')}';
                      _gen++;
                    }),
                child: const Text('Now')),
          ]),
        );

    return Scaffold(
      appBar: AppBar(
        title: Text('${_isNew ? 'New' : 'Edit'} ${k.title.toLowerCase()}'),
        actions: [
          TextButton(onPressed: _saving ? null : _save, child: Text(_saving ? 'Saving…' : 'Save')),
          const SizedBox(width: 6),
        ],
      ),
      body: ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 40), children: [
        if (_isNew)
          SegmentedButton<String>(
            segments: reportKinds.map((x) => ButtonSegment(value: x.key, label: Text(x.short == 'CO' ? 'Call-out' : x.short == 'SR' ? 'Service' : 'Delivery'))).toList(),
            selected: {k.key},
            onSelectionChanged: (v) => _changeKind(kindOf(v.first)),
          ),
        if (d['ticketNo'] != null && '${d['ticketNo']}'.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Pill('From service ticket ${d['ticketNo']}', color: AppColors.info, icon: Icons.support_agent),
          ),
        const SizedBox(height: 12),
        // ------------------------------------------------ location
        RCard(children: [
          Row(children: [
            const Icon(Icons.my_location, size: 18, color: AppColors.muted),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                _gpsBusy
                    ? 'Getting your location…'
                    : (g is Map && g['lat'] is num)
                        ? 'GPS ${(g['lat'] as num).toStringAsFixed(6)}, ${(g['lng'] as num).toStringAsFixed(6)}  ±${g['acc'] ?? 0} m'
                        : (_gpsErr != null ? 'Location not available' : 'Location not captured'),
                style: const TextStyle(fontSize: 13),
              ),
            ),
            TextButton(onPressed: _gpsBusy ? null : _getGps, child: Text(g is Map ? 'Refresh' : 'Get location')),
          ]),
          if (_near.isNotEmpty) ...[
            const SizedBox(height: 6),
            const Text('Nearby', style: TextStyle(fontSize: 12, color: AppColors.muted, fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final m in _near)
                ChoiceChip(
                  selected: d['clientId'] == m.client.id && d['siteId'] == m.site.id,
                  label: Text('${m.client.name} · ${m.site.name} · ${fmtDistance(m.dist)}', style: const TextStyle(fontSize: 12)),
                  onSelected: (_) => _pickClient(m.client, site: m.site),
                ),
            ]),
          ],
        ]),
        const SizedBox(height: 12),
        // ------------------------------------------------ client & site
        RCard(children: [
          const RTitle('Client & site'),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.business_outlined),
            title: Text(c?.name ?? (d['client'] is Map ? '${(d['client'] as Map)['name']}' : 'Choose a client…'),
                style: TextStyle(fontWeight: FontWeight.w700, color: c == null && d['client'] == null ? AppColors.muted : AppColors.ink)),
            subtitle: _clients.isEmpty ? const Text('Loading clients…') : null,
            trailing: const Icon(Icons.chevron_right),
            onTap: _clients.isEmpty ? null : _chooseClient,
          ),
          if (c != null && c.sites.isNotEmpty)
            DropdownButtonFormField<String>(
              key: ValueKey('site-$_gen'),
              value: c.sites.any((s) => s.id == d['siteId']) ? '${d['siteId']}' : null,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Site'),
              items: [
                for (final s in c.sites)
                  DropdownMenuItem(value: s.id, child: Text('${s.name}${s.address.isNotEmpty ? ' — ${s.address.split('\n').first}' : ''}', overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) {
                final s = c.sites.where((x) => x.id == v).firstOrNull;
                if (s != null) _pickSite(s);
              },
            ),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: field('number', 'Number')),
            const SizedBox(width: 10),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: TextFormField(
                  key: ValueKey('date-$_gen'),
                  initialValue: '${d['date']}',
                  readOnly: true,
                  decoration: const InputDecoration(labelText: 'Date'),
                  onTap: () async {
                    final cur = DateTime.tryParse('${d['date']}') ?? DateTime.now();
                    final p = await showDatePicker(context: context, initialDate: cur, firstDate: DateTime(2023), lastDate: DateTime.now().add(const Duration(days: 60)));
                    if (p == null) return;
                    setState(() {
                      d['date'] = dateKey(p);
                      if (_isNew) d['number'] = InvReports.suggestNumber(k, _cfg!, d['date'] as String);
                      _gen++;
                    });
                  },
                ),
              ),
            ),
          ]),
          field('subject', 'Subject', hint: k.isService ? 'e.g. CCTV not recording – NVR check' : 'e.g. Supply of CCTV equipment'),
          field('deliveryAddress', 'Site / address'),
        ]),
        if (k.isService) ...[
          const SizedBox(height: 12),
          RCard(children: [
            const RTitle('Visit'),
            Row(children: [timeField('timeIn', 'Time in'), const SizedBox(width: 8), timeField('timeOut', 'Time out')]),
            const SizedBox(height: 10),
            field('complaint', 'Complaint / request', lines: 3, hint: 'What the customer reported or asked for'),
            field('workDone', 'Work carried out', lines: 5, hint: 'What was checked, repaired, replaced or configured'),
          ]),
        ],
        const SizedBox(height: 12),
        // ------------------------------------------------ items
        RCard(children: [
          RTitle(k.isService ? 'Parts / items used (optional)' : 'Items',
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                IconButton(tooltip: 'Scan product barcode', onPressed: _scanProduct, icon: const Icon(Icons.qr_code_scanner)),
                TextButton.icon(
                    onPressed: () => setState(() {
                          items.add(InvReports.newItem(k));
                          _gen++;
                        }),
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('Add item')),
              ])),
          if (items.isEmpty) const Text('No items.', style: TextStyle(color: AppColors.muted)),
          for (var i = 0; i < items.length; i++)
            ItemEditor(
              key: ValueKey('item-$i-$_gen'),
              index: i,
              item: items[i],
              kind: k,
              onRemove: () => setState(() {
                items.removeAt(i);
                _gen++;
              }),
              onChanged: () => setState(() {}),
            ),
        ]),
        const SizedBox(height: 12),
        PhotosCard(
          me: widget.me,
          title: k.photos,
          beforeAfter: k.isService,
          photos: atts,
          onChanged: () => setState(() {}),
        ),
        const SizedBox(height: 12),
        RCard(children: [
          InkWell(
            onTap: () => setState(() => _more = !_more),
            child: Row(children: [
              Expanded(child: Text('More details — reference, ${k.isService ? 'technician, ' : 'delivery person, '}contact', style: const TextStyle(fontWeight: FontWeight.w700))),
              Icon(_more ? Icons.expand_less : Icons.expand_more),
            ]),
          ),
          if (_more) ...[
            const SizedBox(height: 10),
            field('ref', 'LPO / reference'),
            field('salesperson', 'Salesperson'),
            if (k.isService) field('technician', 'Technician'),
            field('contactName', k.isService ? 'Contact person' : 'Delivery person'),
            field('contactMobile', 'Contact mobile', type: TextInputType.phone),
            field('contactEmail', 'Contact email', type: TextInputType.emailAddress),
            field('notes', 'Notes', lines: 2),
          ],
        ]),
        const SizedBox(height: 18),
        FilledButton.icon(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50), backgroundColor: AppColors.primary),
          onPressed: _saving ? null : _save,
          icon: const Icon(Icons.save_outlined),
          label: Text(_saving ? 'Saving…' : 'Save ${k.title.toLowerCase()}'),
        ),
      ]),
    );
  }
}
