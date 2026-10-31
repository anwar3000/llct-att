import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

/// Finger signature box. Export as a PNG data URL (same format invoicing stores).
class SignaturePadController extends ChangeNotifier {
  final List<List<Offset>> _strokes = [];
  Size _size = Size.zero;
  bool get isEmpty => _strokes.every((s) => s.isEmpty);
  void clear() {
    _strokes.clear();
    notifyListeners();
  }

  /// White-background-free PNG, about 600 px wide.
  Future<String?> toDataUrl() async {
    if (isEmpty || _size.width <= 0) return null;
    final k = 600 / _size.width;
    final w = 600, h = (_size.height * k).round();
    final rec = ui.PictureRecorder();
    final canvas = Canvas(rec);
    canvas.scale(k);
    _SigPainter(_strokes).paint(canvas, _size);
    final img = await rec.endRecording().toImage(w, h);
    final bd = await img.toByteData(format: ui.ImageByteFormat.png);
    if (bd == null) return null;
    return 'data:image/png;base64,${base64Encode(bd.buffer.asUint8List())}';
  }
}

class SignaturePad extends StatefulWidget {
  final SignaturePadController controller;
  final double height;
  /// Called with true while the finger is on the pad (lock the page's scrolling meanwhile).
  final ValueChanged<bool>? onDrawing;
  const SignaturePad({super.key, required this.controller, this.height = 190, this.onDrawing});

  @override
  State<SignaturePad> createState() => _SignaturePadState();
}

class _SignaturePadState extends State<SignaturePad> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_redraw);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_redraw);
    super.dispose();
  }

  void _redraw() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    return LayoutBuilder(builder: (context, box) {
      c._size = Size(box.maxWidth, widget.height);
      return Container(
        height: widget.height,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFDCD8D1)),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Stack(children: [
            Positioned(
              left: 18,
              right: 18,
              bottom: 38,
              child: Container(height: 1, color: const Color(0xFFCFCAC2)),
            ),
            if (c.isEmpty)
              const Positioned(
                left: 0,
                right: 0,
                bottom: 14,
                child: Text('Sign above the line', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFF9A968F), fontSize: 12)),
              ),
            // Raw pointer events: drawing works even inside a scrolling page.
            Listener(
              behavior: HitTestBehavior.opaque,
              onPointerDown: (d) {
                c._strokes.add([d.localPosition]);
                widget.onDrawing?.call(true);
                setState(() {});
              },
              onPointerMove: (d) {
                if (c._strokes.isEmpty) c._strokes.add([]);
                c._strokes.last.add(d.localPosition);
                setState(() {});
              },
              onPointerUp: (_) => widget.onDrawing?.call(false),
              onPointerCancel: (_) => widget.onDrawing?.call(false),
              child: CustomPaint(painter: _SigPainter(c._strokes), size: Size(box.maxWidth, widget.height)),
            ),
          ]),
        ),
      );
    });
  }
}

class _SigPainter extends CustomPainter {
  final List<List<Offset>> strokes;
  _SigPainter(this.strokes);

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = const Color(0xFF14213D)
      ..strokeWidth = 2.4
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    for (final s in strokes) {
      if (s.isEmpty) continue;
      if (s.length == 1) {
        canvas.drawCircle(s.first, 1.4, Paint()..color = p.color);
        continue;
      }
      final path = Path()..moveTo(s.first.dx, s.first.dy);
      for (var i = 1; i < s.length; i++) {
        path.lineTo(s[i].dx, s[i].dy);
      }
      canvas.drawPath(path, p);
    }
  }

  @override
  bool shouldRepaint(covariant _SigPainter old) => true;
}
