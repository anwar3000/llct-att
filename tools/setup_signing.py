"""Configure release signing for the generated Android project.

Reads the ANDROID_SIGNING_KEY secret (JSON: {"alias", "password", "keystore": base64})
and patches android/app/build.gradle(.kts) so `flutter build apk --release` is signed
with that permanent key. Same key every build → updates install over the old app.
"""
import base64
import json
import os
import re
import sys

app_dir = sys.argv[1] if len(sys.argv) > 1 else "android/app"
raw = os.environ.get("ANDROID_SIGNING_KEY", "").strip()
try:
    key = json.loads(raw)
    ks = base64.b64decode(key["keystore"])
    alias, pw = key["alias"], key["password"]
except Exception as e:  # noqa: BLE001
    sys.exit(f"::error title=Signing key problem::ANDROID_SIGNING_KEY is not valid ({e}). Paste the whole file contents.")

with open(os.path.join(app_dir, "release.jks"), "wb") as f:
    f.write(ks)
with open(os.path.join(os.path.dirname(app_dir.rstrip("/")) or ".", "key.properties"), "w") as f:
    f.write(f"storePassword={pw}\nkeyPassword={pw}\nkeyAlias={alias}\nstoreFile=release.jks\n")

kts = os.path.join(app_dir, "build.gradle.kts")
groovy = os.path.join(app_dir, "build.gradle")
if os.path.exists(kts):
    p, s = kts, open(kts).read()
    block = f'''    signingConfigs {{
        create("release") {{
            storeFile = file("release.jks")
            storePassword = "{pw}"
            keyAlias = "{alias}"
            keyPassword = "{pw}"
        }}
    }}

    buildTypes {{'''
    s = s.replace("    buildTypes {", block, 1)
    s = re.sub(r'signingConfig\s*=\s*signingConfigs\.getByName\("debug"\)', 'signingConfig = signingConfigs.getByName("release")', s)
else:
    p, s = groovy, open(groovy).read()
    block = f'''    signingConfigs {{
        release {{
            storeFile file("release.jks")
            storePassword "{pw}"
            keyAlias "{alias}"
            keyPassword "{pw}"
        }}
    }}

    buildTypes {{'''
    s = s.replace("    buildTypes {", block, 1)
    s = re.sub(r"signingConfig\s*(=\s*)?signingConfigs\.debug", "signingConfig signingConfigs.release", s)
if 'getByName("release")' not in s and "signingConfigs.release" not in s:
    sys.exit("::error title=Signing setup::Could not find the release signingConfig line to patch in " + p)
open(p, "w").write(s)
print(f"Release signing configured in {p} (alias {alias})")
