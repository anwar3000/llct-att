# One-time project setup for Windows. In PowerShell, from this folder run:
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = "Stop"

Write-Host "==> 1/4  Generating Android platform files (existing files are kept)"
flutter create --org com.attendancepro --platforms android --project-name attendance_pro .

Write-Host "==> 2/4  Setting minSdk to 24 (required by Firebase)"
foreach ($f in @("android\app\build.gradle.kts", "android\app\build.gradle")) {
  if (Test-Path $f) {
    $c = Get-Content $f -Raw
    $c = $c -replace 'minSdk = flutter\.minSdkVersion', 'minSdk = 24'
    $c = $c -replace 'minSdkVersion flutter\.minSdkVersion', 'minSdkVersion 24'
    Set-Content -Path $f -Value $c -NoNewline
    Select-String -Path $f -Pattern "minSdk"
  }
}

Write-Host "==> 3/4  Installing packages"
flutter pub get

Write-Host "==> 4/4  Connecting Firebase (log in when the browser opens)"
dart pub global activate flutterfire_cli
$env:Path += ";$env:LOCALAPPDATA\Pub\Cache\bin"
flutterfire configure --platforms=android --android-package-name=com.attendancepro.attendance_pro

Write-Host ""
Write-Host "Done. Now finish the Firebase console steps in README.md (Auth, Firestore, rules, first admin),"
Write-Host "then run:  flutter run   or   flutter build apk --release"
