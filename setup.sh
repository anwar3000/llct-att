#!/usr/bin/env bash
# One-time project setup for macOS / Linux. Run from this folder: bash setup.sh
# Put google-services.json (downloaded from Firebase) in this folder first.
set -e

if ! command -v flutter >/dev/null 2>&1; then
  echo "Flutter is not installed. On a Mac run:  brew install --cask flutter   (see README)"
  exit 1
fi

echo "==> 1/4  Generating Android platform files (existing files are kept)"
flutter create --org com.attendancepro --platforms android --project-name attendance_pro .

echo "==> 2/4  Setting minSdk to 24 (required by Firebase)"
for f in android/app/build.gradle.kts android/app/build.gradle; do
  if [ -f "$f" ]; then
    sed -i.bak -E 's/minSdk( = |Version )flutter\.minSdkVersion/minSdk\1 24/' "$f" && rm -f "$f.bak"
    grep -nE "minSdk" "$f" || true
  fi
done

echo "==> 3/4  Connecting Firebase"
if [ -f google-services.json ]; then
  cp google-services.json android/app/google-services.json
  python3 tools/gen_firebase_options.py google-services.json com.attendancepro.attendance_pro
else
  echo "No google-services.json found here — using flutterfire (needs: npm i -g firebase-tools && firebase login)"
  dart pub global activate flutterfire_cli
  export PATH="$PATH:$HOME/.pub-cache/bin"
  flutterfire configure --platforms=android --android-package-name=com.attendancepro.attendance_pro
fi

echo "==> 4/4  Installing packages"
flutter pub get || (flutter pub upgrade --major-versions && flutter pub get)

echo ""
echo "Done. Build the APK with:   flutter build apk --release"
echo "APK will be at:             build/app/outputs/flutter-apk/app-release.apk"
