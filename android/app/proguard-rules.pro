# ML Kit text recognition: only the Latin model is bundled; the plugin also references
# the Chinese / Devanagari / Japanese / Korean recognizers, which aren't included.
-dontwarn com.google.mlkit.vision.text.chinese.**
-dontwarn com.google.mlkit.vision.text.devanagari.**
-dontwarn com.google.mlkit.vision.text.japanese.**
-dontwarn com.google.mlkit.vision.text.korean.**
