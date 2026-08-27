#!/bin/bash
# Run on the server (as root) to pull the latest main and restart the relay.
set -euo pipefail

cd /opt/terracart
git pull --ff-only
cd server
npm install --omit=dev
systemctl restart terracart-relay
systemctl status --no-pager terracart-relay
