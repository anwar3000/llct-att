import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';

import '../core/utils.dart';
import 'db.dart';

class AuthService {
  AuthService._();
  static final _auth = FirebaseAuth.instance;

  static Stream<User?> get authChanges => _auth.authStateChanges();
  static User? get currentUser => _auth.currentUser;

  static Future<void> signIn(String login, String password) async {
    await _auth.signInWithEmailAndPassword(
      email: loginToEmail(login),
      password: password,
    );
  }

  static Future<void> signOut() => _auth.signOut();

  /// Creates a staff login WITHOUT signing the current manager out.
  /// Uses a secondary Firebase app instance for the new account.
  static Future<String> createStaffAccount({
    required String loginId,
    required String password,
    required String name,
    required String phone,
    required String designation,
    required String role,
    required List<int> weeklyOffDays,
    required int monthlyOffQuota,
  }) async {
    FirebaseApp secondary;
    try {
      secondary = Firebase.app('staffCreator');
    } catch (_) {
      secondary = await Firebase.initializeApp(
        name: 'staffCreator',
        options: Firebase.app().options,
      );
    }
    final secondaryAuth = FirebaseAuth.instanceFor(app: secondary);
    final email = loginToEmail(loginId);
    final cred = await secondaryAuth.createUserWithEmailAndPassword(
      email: email,
      password: password,
    );
    final uid = cred.user!.uid;
    await secondaryAuth.signOut();

    // Profile is written by the signed-in manager (primary app).
    await Db.users.doc(uid).set({
      'name': name,
      'loginId': loginId.trim(),
      'email': email,
      'phone': phone,
      'designation': designation,
      'role': role,
      'active': true,
      'weeklyOffDays': weeklyOffDays,
      'monthlyOffQuota': monthlyOffQuota,
      'createdAt': FieldValue.serverTimestamp(),
    });
    return uid;
  }

  static String friendlyError(Object e) {
    if (e is FirebaseAuthException) {
      switch (e.code) {
        case 'invalid-email':
          return 'That login ID / email is not valid.';
        case 'user-disabled':
          return 'This account has been disabled.';
        case 'user-not-found':
        case 'wrong-password':
        case 'invalid-credential':
          return 'Wrong login ID or password.';
        case 'email-already-in-use':
          return 'That login ID is already taken.';
        case 'weak-password':
          return 'Password must be at least 6 characters.';
        case 'network-request-failed':
          return 'No internet connection.';
        case 'too-many-requests':
          return 'Too many attempts. Please wait a minute and try again.';
      }
      return e.message ?? e.code;
    }
    if (e is FirebaseException) {
      if (e.code == 'permission-denied') {
        return 'Permission denied. Check your Firestore security rules / your role.';
      }
      return e.message ?? e.code;
    }
    return e.toString();
  }
}
