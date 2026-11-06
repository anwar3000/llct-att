#!/usr/bin/env python3
"""Stamps every relative JS / CSS reference in web/ with ?v=<build> at deploy time.

Browsers cache each file separately; without this a new main.js can load next to an old fb.js from
cache and the page stays blank until a hard refresh. Every reference to a file gets the same stamp,
so each module still loads only once.
"""
import pathlib, re, sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'web')
ver = (sys.argv[2] if len(sys.argv) > 2 else 'dev')[:12]

js_import = re.compile(r"""((?:\bfrom|\bimport)\s*\(?\s*)(['"])(\.{1,2}/[^'"?#]+\.(?:js|mjs))(?:\?[^'"]*)?\2""")
html_ref = re.compile(r"""((?:src|href)\s*=\s*)(["'])((?!https?:|//|data:|#|mailto:)[^"'?#]+\.(?:js|css))(?:\?[^"']*)?\2""")

n = 0
for p in root.rglob('*.js'):
    s = p.read_text(encoding='utf-8')
    t = js_import.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}?v={ver}{m.group(2)}", s)
    if t != s:
        p.write_text(t, encoding='utf-8'); n += 1
for p in root.glob('*.html'):
    s = p.read_text(encoding='utf-8')
    t = html_ref.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}?v={ver}{m.group(2)}", s)
    if t != s:
        p.write_text(t, encoding='utf-8'); n += 1
print(f'Stamped {n} files with v={ver}')
