#!/usr/bin/env sh
# Capture the nine deterministic MVT fixtures used by test/harness.html.
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fixture_dir="$repo_dir/test/fixtures"
mkdir -p "$fixture_dir"

python3 - "$fixture_dir" <<'PY'
import gzip
import json
import sys
from pathlib import Path
from urllib.request import Request, urlopen

USER_AGENT = 'terracart-test-fixture-capture/1.0'
def get(url, timeout):
    return urlopen(Request(url, headers={'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip'}), timeout=timeout)

out_dir = Path(sys.argv[1])
tilejson = 'https://tiles.openfreemap.org/planet/tilejson.json'
with urlopen(Request(tilejson, headers={'User-Agent': USER_AGENT}), timeout=30) as response:
    template = json.load(response)['tiles'][0]

for x in range(2753, 2756):
    for y in range(5565, 5568):
        target = out_dir / f'{x}_{y}.pbf'
        if target.exists():
            print(f'skip {target.name}')
            continue
        url = template.replace('{z}', '14').replace('{x}', str(x)).replace('{y}', str(y))
        with get(url, 60) as response:
            data = response.read()
        if not data.startswith(b'\x1f\x8b'):
            raise RuntimeError(f'{url}: expected a gzip-compressed MVT tile')
        try:
            # http.server does not declare Content-Encoding for local .pbf files,
            # so save the unwrapped MVT payload that the browser can parse.
            data = gzip.decompress(data)
        except OSError as error:
            raise RuntimeError(f'{url}: invalid gzip payload') from error
        if len(data) <= 1024 or data.lstrip().startswith(b'<'):
            raise RuntimeError(f'{url}: expected a non-empty MVT, not an HTML error page')
        target.write_bytes(data)
        print(f'captured {target.name} ({len(data)} bytes uncompressed)')
PY
