#!/usr/bin/env sh
# Run the browser harness with Playwright and Chromium from the official image.
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
image=${PLAYWRIGHT_IMAGE:-terracart-playwright-tests:1.62.0}

# Cache the Python package layer while keeping browser and API versions matched.
docker build --quiet -f "$repo_dir/test/Dockerfile.playwright" -t "$image" "$repo_dir" >/dev/null
docker run --rm -v "$repo_dir:/work:ro" -w /work "$image" sh -ec '
  python3 -m http.server 7731 --bind 127.0.0.1 >/tmp/terracart-http.log 2>&1 &
  server_pid=$!
  trap "kill $server_pid 2>/dev/null || true" EXIT
  for _ in $(seq 1 50); do
    python3 -c "from urllib.request import urlopen; urlopen(\"http://127.0.0.1:7731/test/harness.html\")" 2>/dev/null && break
    sleep 0.1
  done
  python3 test/run_tests.py
'
