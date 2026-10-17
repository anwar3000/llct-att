import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../services/geocode_service.dart';
import '../../services/location_service.dart';
import '../../widgets/common.dart';
import '../../widgets/map_widgets.dart';
import '../../widgets/site_workforce.dart';
import '../../widgets/tiles.dart';

const siteStatuses = ['planned', 'active', 'on hold', 'completed'];

class SiteEditor extends StatefulWidget {
  final Site? existing;
  const SiteEditor({super.key, this.existing});

  @override
  State<SiteEditor> createState() => _SiteEditorState();
}

class _SiteEditorState extends State<SiteEditor> {
  final _form = GlobalKey<FormState>();
  final _picker = GlobalKey<LocationPickerState>();
  late final _name = TextEditingController(text: widget.existing?.name);
  late final _address = TextEditingController(text: widget.existing?.address);
  late final _notes = TextEditingController(text: widget.existing?.notes);
  late double? _lat = widget.existing?.lat;
  late double? _lng = widget.existing?.lng;
  late double _radius =
      (widget.existing?.radius ?? kDefaultSiteRadius).clamp(50.0, 1000.0).toDouble();
  late double _progress = (widget.existing?.progress ?? 0).toDouble();
  late String _status = siteStatuses.contains(widget.existing?.status)
      ? widget.existing!.status
      : 'active';
  late bool _active = widget.existing?.active ?? true;
  bool _locating = false;
  bool _saving = false;
  late final Stream<List<SiteUpdate>>? _updates =
      widget.existing == null ? null : Db.updatesForSite(widget.existing!.id);

  bool get _editing => widget.existing != null;

  @override
  void dispose() {
    _name.dispose();
    _address.dispose();
    _notes.dispose();
    _search.dispose();
    super.dispose();
  }

  final _search = TextEditingController();
  bool _searching = false;

  Future<void> _searchAddress() async {
    final q = _search.text.trim();
    if (q.isEmpty) return;
    FocusScope.of(context).unfocus();
    setState(() => _searching = true);
    List<PlaceResult> results = [];
    try {
      results = await GeocodeService.search(q, nearLat: _lat, nearLng: _lng);
    } catch (e) {
      if (mounted) showSnack(context, 'Search failed — check internet connection', error: true);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
    if (!mounted) return;
    if (results.isEmpty) {
      showSnack(context, 'No places found for "$q"', error: true);
      return;
    }
    final picked = results.length == 1
        ? results.first
        : await showModalBottomSheet<PlaceResult>(
            context: context,
            showDragHandle: true,
            builder: (c) => SafeArea(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final r in results)
                    ListTile(
                      leading: const Icon(Icons.place_outlined, color: AppColors.accentDark),
                      title: Text(r.title, style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text(r.subtitle),
                      onTap: () => Navigator.pop(c, r),
                    ),
                ],
              ),
            ),
          );
    if (picked == null || !mounted) return;
    setState(() {
      _lat = picked.lat;
      _lng = picked.lng;
      if (_address.text.trim().isEmpty) _address.text = picked.label;
    });
    _picker.currentState?.moveTo(LatLng(picked.lat, picked.lng));
  }

  Future<void> _useMyLocation() async {
    setState(() => _locating = true);
    try {
      final p = await LocationService.current();
      if (!mounted) return;
      setState(() {
        _lat = p.latitude;
        _lng = p.longitude;
      });
      _picker.currentState?.moveTo(LatLng(p.latitude, p.longitude));
      if (mounted) showSnack(context, 'Location set (±${p.accuracy.round()} m)');
    } catch (e) {
      if (mounted) showSnack(context, '$e', error: true);
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    if (_lat == null || _lng == null) {
      showSnack(context, 'Set the site location (GPS button or tap the map).', error: true);
      return;
    }
    setState(() => _saving = true);
    try {
      await Db.saveSite(Site(
        id: widget.existing?.id ?? '',
        name: _name.text.trim(),
        address: _address.text.trim(),
        lat: _lat!,
        lng: _lng!,
        radius: _radius,
        active: _active,
        progress: _progress.round(),
        status: _status,
        notes: _notes.text.trim(),
      ));
      if (mounted) {
        Navigator.pop(context);
        showSnack(context, _editing ? 'Site updated' : 'Site added');
      }
    } catch (e) {
      if (mounted) showSnack(context, 'Failed: $e', error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _delete() async {
    if (!await confirm(context, 'Delete site?',
        'Delete ${widget.existing!.name}? Past attendance records are kept. '
            'Tip: mark it inactive instead to hide it from staff.',
        danger: true, ok: 'Delete')) {
      return;
    }
    await Db.deleteSite(widget.existing!.id);
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_editing ? 'Edit site' : 'New site'),
        actions: [
          if (_editing)
            IconButton(
                tooltip: 'Delete',
                onPressed: _delete,
                icon: const Icon(Icons.delete_outline, color: AppColors.danger)),
        ],
      ),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            if (_editing) ...[
              SiteWorkforceCard(siteId: widget.existing!.id),
              const SizedBox(height: 16),
            ],
            TextFormField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                  labelText: 'Site name *', prefixIcon: Icon(Icons.location_city_outlined)),
              validator: (v) => (v ?? '').trim().isEmpty ? 'Required' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _address,
              decoration: const InputDecoration(
                  labelText: 'Address / landmark', prefixIcon: Icon(Icons.map_outlined)),
            ),
            const SizedBox(height: 16),
            Row(children: [
              const Expanded(
                child: Text('Location & geofence',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
              ),
              TextButton.icon(
                onPressed: _locating ? null : _useMyLocation,
                icon: _locating
                    ? const SizedBox(
                        width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.my_location),
                label: const Text('Use my current location'),
              ),
            ]),
            TextField(
              controller: _search,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _searchAddress(),
              decoration: InputDecoration(
                hintText: 'Search address / place, or paste a Google Maps link',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searching
                    ? const Padding(
                        padding: EdgeInsets.all(12),
                        child: SizedBox(
                            width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)))
                    : IconButton(icon: const Icon(Icons.arrow_forward), onPressed: _searchAddress),
              ),
            ),
            const SizedBox(height: 6),
            const Text('…or tap on the map to place the site.',
                style: TextStyle(color: AppColors.muted, fontSize: 12.5)),
            const SizedBox(height: 8),
            LocationPicker(
              key: _picker,
              initial: _lat == null ? null : LatLng(_lat!, _lng!),
              radius: _radius,
              onPicked: (p) => setState(() {
                _lat = p.latitude;
                _lng = p.longitude;
              }),
            ),
            const SizedBox(height: 6),
            Text(_lat == null ? 'No location set' : latLngLabel(_lat!, _lng!),
                style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
            const SizedBox(height: 10),
            Row(children: [
              const Icon(Icons.radar, color: AppColors.muted),
              const SizedBox(width: 8),
              const Text('Check-in radius'),
              Expanded(
                child: Slider(
                  value: _radius,
                  min: 50,
                  max: 1000,
                  divisions: 19,
                  label: '${_radius.round()} m',
                  onChanged: (v) => setState(() => _radius = v),
                ),
              ),
              SizedBox(
                  width: 56,
                  child: Text('${_radius.round()} m',
                      textAlign: TextAlign.end,
                      style: const TextStyle(fontWeight: FontWeight.w700))),
            ]),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              value: _status,
              decoration: const InputDecoration(
                  labelText: 'Status', prefixIcon: Icon(Icons.flag_outlined)),
              items: siteStatuses
                  .map((s) => DropdownMenuItem(
                      value: s, child: Text(s[0].toUpperCase() + s.substring(1))))
                  .toList(),
              onChanged: (v) => setState(() => _status = v ?? 'active'),
            ),
            const SizedBox(height: 12),
            Row(children: [
              const Icon(Icons.trending_up, color: AppColors.muted),
              const SizedBox(width: 8),
              const Text('Progress'),
              Expanded(
                child: Slider(
                  value: _progress,
                  min: 0,
                  max: 100,
                  divisions: 20,
                  label: '${_progress.round()}%',
                  onChanged: (v) => setState(() => _progress = v),
                ),
              ),
              SizedBox(
                  width: 48,
                  child: Text('${_progress.round()}%',
                      textAlign: TextAlign.end,
                      style: const TextStyle(fontWeight: FontWeight.w700))),
            ]),
            TextFormField(
              controller: _notes,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Notes for staff'),
            ),
            const SizedBox(height: 8),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Active'),
              subtitle: const Text('Inactive sites are hidden from staff check-in'),
              value: _active,
              onChanged: (v) => setState(() => _active = v),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: const Icon(Icons.check),
              label: Text(_saving ? 'Saving…' : (_editing ? 'Save changes' : 'Add site')),
            ),
            if (_updates != null) ...[
              const SectionTitle('Recent updates from this site'),
              StreamView<List<SiteUpdate>>(
                stream: _updates!,
                builder: (context, list) => list.isEmpty
                    ? const Card(
                        child: EmptyState(
                            icon: Icons.construction_outlined, title: 'No updates yet'))
                    : Column(
                        children: list
                            .take(10)
                            .map((u) => Padding(
                                  padding: const EdgeInsets.only(bottom: 10),
                                  child: UpdateCard(u, showSite: false),
                                ))
                            .toList(),
                      ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
