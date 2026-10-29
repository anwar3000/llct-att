import 'dart:io';
import 'dart:typed_data';

import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';
import 'package:path_provider/path_provider.dart';
import 'package:printing/printing.dart';

import 'doc_info.dart';

/// Reads text from an uploaded copy on the phone (Google ML Kit, works offline):
/// photos directly, PDFs by drawing their first page. Then picks out number / expiry / issue date.
class DocReader {
  static Future<String> text(Uint8List bytes, String mime) async {
    Uint8List img = bytes;
    var ext = mime == 'image/png' ? 'png' : 'jpg';
    if (mime == 'application/pdf') {
      Uint8List? png;
      await for (final page in Printing.raster(bytes, pages: const [0], dpi: 200)) {
        png = await page.toPng();
        break;
      }
      if (png == null) return '';
      img = png;
      ext = 'png';
    }
    final dir = await getTemporaryDirectory();
    final f = File('${dir.path}/ocr_${DateTime.now().microsecondsSinceEpoch}.$ext');
    await f.writeAsBytes(img, flush: true);
    final recognizer = TextRecognizer(script: TextRecognitionScript.latin);
    try {
      final r = await recognizer.processImage(InputImage.fromFilePath(f.path));
      return r.text;
    } finally {
      await recognizer.close();
      try {
        await f.delete();
      } catch (_) {}
    }
  }

  /// Never throws: returns an empty result when the copy can't be read.
  static Future<DocInfo> read(Uint8List bytes, String mime, String kind) async {
    try {
      return extractDocInfo(await text(bytes, mime), kind);
    } catch (_) {
      return const DocInfo();
    }
  }
}
