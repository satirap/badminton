#!/usr/bin/env python3
"""Stamp version + build time into payment.html (no build step on this static site).

Usage:  python3 tools/stamp_version.py <version>     e.g. 5.3.0
Writes VERSION and updates in payment.html:
  - const APP_VERSION / APP_BUILD
  - the footer version badge text
Run before every commit that goes to production.
"""
import re, sys, datetime, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
ver = sys.argv[1] if len(sys.argv) > 1 else (root / 'VERSION').read_text().strip()
if not re.fullmatch(r'\d+\.\d+\.\d+', ver):
    sys.exit(f'bad version: {ver}')
build = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')

html = root / 'payment.html'
s = html.read_text(encoding='utf-8')
s, n1 = re.subn(r"const APP_VERSION = '[^']*';", f"const APP_VERSION = '{ver}';", s)
s, n2 = re.subn(r"const APP_BUILD = '[^']*';", f"const APP_BUILD = '{build}';", s)
s, n3 = re.subn(r'(id="version-badge"[^>]*>)[^<]*(</div>)', rf'\g<1>v{ver} · build {build} · แตะเพื่อ refresh\g<2>', s)
if (n1, n2, n3) != (1, 1, 1):
    sys.exit(f'markers not found: APP_VERSION={n1} APP_BUILD={n2} badge={n3}')
html.write_text(s, encoding='utf-8')
(root / 'VERSION').write_text(ver + '\n')
print(f'v{ver} · build {build}')
