"""Turn on core library desugaring in the generated android/app build file.
Needed by flutter_local_notifications (service visit reminders). Safe to run more than once."""
import os
import re

for path in ('android/app/build.gradle.kts', 'android/app/build.gradle'):
    if not os.path.exists(path):
        continue
    s = open(path, encoding='utf-8').read()
    if 'desugar_jdk_libs' in s:
        print(path, 'already patched')
        continue
    kts = path.endswith('.kts')
    flag = 'isCoreLibraryDesugaringEnabled = true' if kts else 'coreLibraryDesugaringEnabled true'
    if re.search(r'compileOptions\s*\{', s):
        s = re.sub(r'(compileOptions\s*\{)', r'\1\n        ' + flag, s, count=1)
    else:
        s = re.sub(r'(android\s*\{)', r'\1\n    compileOptions {\n        ' + flag + '\n    }', s, count=1)
    dep = ('coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")' if kts
           else "coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.4'")
    s += '\ndependencies {\n    ' + dep + '\n}\n'
    open(path, 'w', encoding='utf-8').write(s)
    print(path, 'patched for desugaring')
