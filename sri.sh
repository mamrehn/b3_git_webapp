#!/bin/bash
# Compute SRI hashes for CDN scripts

compute_sri() {
    local name="$1"
    local url="$2"
    local hash=$(curl -sL "$url" | openssl dgst -sha384 -binary | openssl base64 -A)
    echo "$name: sha384-$hash"
}

compute_sri "xterm@5.3.0/lib/xterm.js" "https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"
compute_sri "xterm-addon-fit@0.8.0" "https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"
compute_sri "lightning-fs@4.6.0" "https://unpkg.com/@isomorphic-git/lightning-fs@4.6.0"
compute_sri "isomorphic-git@1.36.3" "https://unpkg.com/isomorphic-git@1.36.3"
compute_sri "diff@5.1.0" "https://cdn.jsdelivr.net/npm/diff@5.1.0/dist/diff.min.js"
compute_sri "buffer@6.0.3 (bundle.run)" "https://bundle.run/buffer@6.0.3"
compute_sri "buffer@6.0.3 (jsdelivr)" "https://cdn.jsdelivr.net/npm/buffer@6.0.3/index.min.js"
