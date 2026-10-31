import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../core/theme.dart';

/// Opens the camera to read barcodes / QR codes (serial numbers, product codes).
/// multi: keeps scanning and collects every new code until Done. Returns the codes (empty if cancelled).
Future<List<String>> scanCodes(BuildContext context, {String title = 'Scan', bool multi = false, List<String> existing = const []}) async {
  final r = await Navigator.of(context).push<List<String>>(
    MaterialPageRoute(fullscreenDialog: true, builder: (_) => _ScanScreen(title: title, multi: multi, existing: existing)),
  );
  return r ?? const [];
}

class _ScanScreen extends StatefulWidget {
  final String title;
  final bool multi;
  final List<String> existing;
  const _ScanScreen({required this.title, required this.multi, required this.existing});

  @override
  State<_ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<_ScanScreen> {
  final _ctrl = MobileScannerController(detectionSpeed: DetectionSpeed.normal);
  final List<String> _codes = [];
  String _last = '';
  DateTime _lastAt = DateTime(2000);
  String? _flash; // message shown briefly over the camera
  Timer? _flashT;
  bool _torch = false;
  bool _done = false;

  @override
  void dispose() {
    _flashT?.cancel();
    _ctrl.dispose();
    super.dispose();
  }

  void _show(String m) {
    _flashT?.cancel();
    setState(() => _flash = m);
    _flashT = Timer(const Duration(milliseconds: 1400), () {
      if (mounted) setState(() => _flash = null);
    });
  }

  void _onDetect(BarcodeCapture cap) {
    if (_done) return;
    for (final b in cap.barcodes) {
      final code = (b.rawValue ?? '').trim();
      if (code.isEmpty) continue;
      final now = DateTime.now();
      if (code == _last && now.difference(_lastAt).inMilliseconds < 2500) continue; // same code still in view
      _last = code;
      _lastAt = now;
      if (!widget.multi) {
        _done = true;
        HapticFeedback.mediumImpact();
        SystemSound.play(SystemSoundType.click);
        Navigator.pop(context, [code]);
        return;
      }
      if (_codes.contains(code) || widget.existing.contains(code)) {
        HapticFeedback.lightImpact();
        _show('Already added: $code');
        continue;
      }
      HapticFeedback.mediumImpact();
      SystemSound.play(SystemSoundType.click);
      setState(() => _codes.add(code));
      _show('Added $code');
    }
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    final boxW = size.width * 0.78;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(widget.title, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(
            tooltip: 'Torch',
            onPressed: () async {
              await _ctrl.toggleTorch();
              if (mounted) setState(() => _torch = !_torch);
            },
            icon: Icon(_torch ? Icons.flash_on : Icons.flash_off),
          ),
        ],
      ),
      body: Column(children: [
        Expanded(
          child: Stack(fit: StackFit.expand, children: [
            MobileScanner(controller: _ctrl, onDetect: _onDetect),
            // aiming frame
            Center(
              child: Container(
                width: boxW,
                height: boxW * 0.55,
                decoration: BoxDecoration(
                  border: Border.all(color: AppColors.accent, width: 3),
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 18,
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.65), borderRadius: BorderRadius.circular(20)),
                  child: Text(
                    _flash ?? 'Point the camera at the barcode or QR code',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
            ),
          ]),
        ),
        if (widget.multi)
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
            child: SafeArea(
              top: false,
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
                Text('${_codes.length} scanned', style: const TextStyle(fontWeight: FontWeight.w800)),
                if (_codes.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxHeight: 110),
                    child: SingleChildScrollView(
                      child: Wrap(spacing: 6, runSpacing: 4, children: [
                        for (var i = 0; i < _codes.length; i++)
                          InputChip(
                            label: Text(_codes[i], style: const TextStyle(fontSize: 12, fontFamily: 'monospace')),
                            onDeleted: () => setState(() => _codes.removeAt(i)),
                          ),
                      ]),
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                FilledButton.icon(
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(46), backgroundColor: AppColors.success),
                  onPressed: () {
                    _done = true;
                    Navigator.pop(context, List<String>.from(_codes));
                  },
                  icon: const Icon(Icons.check),
                  label: Text(_codes.isEmpty ? 'Close' : 'Done — add ${_codes.length}'),
                ),
              ]),
            ),
          ),
      ]),
    );
  }
}
