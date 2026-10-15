import 'dart:convert';

import 'package:image_picker/image_picker.dart';

/// Photos are compressed on the phone and stored inside Firestore documents as
/// base64. This keeps the app on Firebase's free (Spark) plan — no Cloud
/// Storage bucket needed. Each photo ends up roughly 50–120 KB.
class PhotoService {
  PhotoService._();
  static final _picker = ImagePicker();

  static Future<String?> pick({bool camera = true}) async {
    final x = await _picker.pickImage(
      source: camera ? ImageSource.camera : ImageSource.gallery,
      maxWidth: 960,
      maxHeight: 960,
      imageQuality: 45,
    );
    if (x == null) return null;
    final bytes = await x.readAsBytes();
    // Firestore documents are capped at 1 MB; keep each photo well below that.
    if (bytes.length > 280 * 1024) {
      throw Exception('Photo is too large. Please retake it.');
    }
    return base64Encode(bytes);
  }
}
