#!/usr/bin/env python3
"""Compute SRI hashes for CDN scripts."""
import urllib.request
import hashlib
import base64

urls = [
    ("xterm@5.3.0/lib/xterm.js", "https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"),
    ("xterm-addon-fit@0.8.0", "https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"),
    ("lightning-fs@4.6.0", "https://unpkg.com/@isomorphic-git/lightning-fs@4.6.0"),
    ("isomorphic-git@1.36.3", "https://unpkg.com/isomorphic-git@1.36.3"),
    ("diff@5.1.0", "https://cdn.jsdelivr.net/npm/diff@5.1.0/dist/diff.min.js"),
    ("buffer@6.0.3 (jsdelivr)", "https://cdn.jsdelivr.net/npm/buffer@6.0.3/index.min.js"),
    ("buffer@6.0.3 (bundle.run)", "https://bundle.run/buffer@6.0.3"),
]

for name, url in urls:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, timeout=20).read()
        digest = hashlib.sha384(data).digest()
        b64 = base64.b64encode(digest).decode()
        print(f"{name}:")
        print(f"  URL: {url}")
        print(f"  Size: {len(data)} bytes")
        print(f"  SRI: sha384-{b64}")
        print()
    except Exception as e:
        print(f"{name}: ERROR - {e}")
        print()
