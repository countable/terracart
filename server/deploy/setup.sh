#!/bin/bash
# First-boot / re-runnable bootstrap for the terracart relay on Ubuntu 24.04.
# Run as root (cloud-init runs it as user_data; or: ssh root@IP 'bash -s' < setup.sh).
#
# Result: relay under systemd on 127.0.0.1:8787, Caddy in front with automatic
# Let's Encrypt TLS for <ip-dashed>.sslip.io, reverse-proxying WebSockets.
# Logs when run by cloud-init: /var/log/cloud-init-output.log
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

REPO="${TERRACART_REPO:-https://github.com/countable/terracart.git}"
BRANCH="${TERRACART_BRANCH:-main}"
APP_DIR=/opt/terracart
APT="apt-get -o DPkg::Lock::Timeout=300 -y -q"   # wait out unattended-upgrades on first boot

log() { echo "==> $*"; }

[ "$(id -u)" -eq 0 ] || { echo "setup.sh must run as root" >&2; exit 1; }

# --- packages: Caddy (official repo) + Node 22 (NodeSource) + git -----------
log "apt: base packages"
$APT update
$APT install debian-keyring debian-archive-keyring apt-transport-https curl gnupg git ca-certificates

log "apt: Caddy repo"
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  > /etc/apt/sources.list.d/caddy-stable.list

log "apt: NodeSource (Node 22)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
fi

$APT update
$APT install caddy nodejs
log "node $(node -v), npm $(npm -v), $(caddy version)"

# --- app user + checkout ------------------------------------------------------
# Repo stays root-owned (git/npm run as root via update.sh); the service user
# only needs read access, and ProtectSystem=strict keeps /opt read-only anyway.
id -u terracart >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin terracart

if [ -d "$APP_DIR/.git" ]; then
  log "git pull $APP_DIR"
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" pull --ff-only --quiet origin "$BRANCH"
else
  log "git clone $REPO ($BRANCH)"
  git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

log "npm install (server)"
cd "$APP_DIR/server"
if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund
else npm install --omit=dev --no-audit --no-fund; fi

# --- systemd unit (keep identical to deploy/terracart-relay.service) --------
log "systemd: terracart-relay"
cat > /etc/systemd/system/terracart-relay.service <<'EOF'
# systemd unit for the terracart WebSocket relay.
# Installed by setup.sh to /etc/systemd/system/terracart-relay.service.
# Caddy terminates TLS and proxies to 127.0.0.1:8787 (see Caddyfile.example).
[Unit]
Description=terracart multiplayer presence relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=terracart
Group=terracart
WorkingDirectory=/opt/terracart/server
Environment=PORT=8787
Environment=NODE_ENV=production
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=2

# Hardening: the relay holds no state and writes no files.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now terracart-relay
systemctl restart terracart-relay

# --- Caddy: TLS for <ip-dashed>.sslip.io, proxy to the relay -----------------
IP="$(curl -4fs --max-time 10 https://api.ipify.org || true)"
[ -n "$IP" ] || IP="$(ip route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')"
[ -n "$IP" ] || { echo "could not determine public IPv4" >&2; exit 1; }
HOST="${IP//./-}.sslip.io"

log "caddy: $HOST -> 127.0.0.1:8787"
cat > /etc/caddy/Caddyfile <<EOF
# Written by terracart setup.sh. Caddy fetches the Let's Encrypt cert itself.
$HOST {
    encode gzip
    reverse_proxy 127.0.0.1:8787
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

# --- firewall (only if ufw is installed) ------------------------------------
if command -v ufw >/dev/null; then
  ufw allow 22,80,443/tcp
  ufw --force enable
fi

# --- health check: cert issuance can take a few seconds --------------------
echo
echo "relay:  http://127.0.0.1:8787/  -> $(curl -s --max-time 5 http://127.0.0.1:8787/ || echo 'not responding')"
echo "public: wss://$HOST"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if out="$(curl -fs --max-time 10 "https://$HOST/")"; then
    echo "https://$HOST/ -> $out"; break
  fi
  [ "$i" -eq 12 ] && echo "https://$HOST/ not ready yet (cert pending?). Check: journalctl -u caddy -n 50" || sleep 5
done
echo
echo "Done. Paste into src/multiplayer.js DEFAULT_URL:  wss://$HOST"
