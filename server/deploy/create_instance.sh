#!/bin/bash
# Create the one Vultr VPS that runs the terracart relay, and bootstrap it via
# cloud-init user_data (= setup.sh). Needs curl + jq and VULTR_API_KEY
# (env, or ~/.env). Plan vc2-1c-1gb in Toronto is ~$5-6/month.
#
#   ./server/deploy/create_instance.sh [--dry-run] [--os-id N] [--help]
#
#   --dry-run   print the JSON body that would be POSTed and exit (no API key needed)
#   --os-id N   override the Vultr os_id (default: Ubuntu 24.04 LTS x64)
#   SSH_KEY_ID  env override for the ssh key attached to the instance
set -euo pipefail

API=https://api.vultr.com/v2
REGION=yto
PLAN=vc2-1c-1gb
OS_ID=2284           # Ubuntu 24.04 LTS x64 — from GET /v2/os on 2026-08-27
LABEL=terracart-relay
SSH_KEY_ID="${SSH_KEY_ID:-1b1c00ec-4273-4bb9-8927-0bbbc21a5c99}"   # clark-workstation
DRY_RUN=0

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --os-id)   OS_ID="$2"; shift ;;
    --os-id=*) OS_ID="${1#--os-id=}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

for tool in curl jq; do
  command -v "$tool" >/dev/null || { echo "error: '$tool' is required (brew install $tool)" >&2; exit 1; }
done

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP="$DIR/setup.sh"
[ -f "$SETUP" ] || { echo "error: $SETUP not found" >&2; exit 1; }

# Vultr runs user_data as a script at first boot; it must be base64 (no wrapping).
USER_DATA="$(base64 < "$SETUP" | tr -d '\n')"

BODY="$(jq -n \
  --arg region "$REGION" --arg plan "$PLAN" --argjson os_id "$OS_ID" \
  --arg label "$LABEL" --arg key "$SSH_KEY_ID" --arg user_data "$USER_DATA" \
  '{region: $region, plan: $plan, os_id: $os_id, label: $label, hostname: $label,
    sshkey_id: [$key], user_data: $user_data, backups: "disabled",
    enable_ipv6: false, tags: ["terracart"]}')"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "DRY RUN — would POST $API/instances with:"
  # user_data is ~ a few KB of base64; show its size instead of the blob.
  echo "$BODY" | jq --arg n "${#USER_DATA}" '.user_data = "<base64 setup.sh, \($n) chars>"'
  exit 0
fi

# --- auth --------------------------------------------------------------------
if [ -z "${VULTR_API_KEY:-}" ] && [ -f "$HOME/.env" ]; then
  set +u; set -a; . "$HOME/.env"; set +a; set -u
fi
[ -n "${VULTR_API_KEY:-}" ] || { echo "error: VULTR_API_KEY not set (env or ~/.env)" >&2; exit 1; }
AUTH=(-H "Authorization: Bearer $VULTR_API_KEY" -H "Content-Type: application/json")

api() { curl -fsS "${AUTH[@]}" "$@"; }

# Refuse to make a second relay by accident.
existing="$(api "$API/instances?label=$LABEL" | jq -r '.instances[]? | "\(.id) \(.main_ip) \(.status)"')"
if [ -n "$existing" ]; then
  echo "error: an instance labelled '$LABEL' already exists:" >&2
  echo "  $existing" >&2
  echo "Delete it in the Vultr console first, or run update.sh on it instead." >&2
  exit 1
fi

# --- create -------------------------------------------------------------------
echo "Creating $PLAN in $REGION (os_id $OS_ID) ..."
resp="$(curl -sS "${AUTH[@]}" -X POST "$API/instances" -d "$BODY")"
ID="$(echo "$resp" | jq -r '.instance.id // empty')"
if [ -z "$ID" ]; then
  echo "error: create failed:" >&2; echo "$resp" | jq . >&2 2>/dev/null || echo "$resp" >&2
  exit 1
fi
echo "instance id: $ID"

# --- wait for active + IP (usually 1-2 min) -----------------------------------
IP=""
for _ in $(seq 1 60); do
  inst="$(api "$API/instances/$ID" | jq -r '.instance | "\(.status) \(.main_ip)"')"
  status="${inst% *}"; ip="${inst#* }"
  printf '\r  status=%s ip=%s      ' "$status" "$ip"
  if [ "$status" = "active" ] && [ -n "$ip" ] && [ "$ip" != "0.0.0.0" ] && [ "$ip" != "null" ]; then
    IP="$ip"; break
  fi
  sleep 10
done
echo
[ -n "$IP" ] || { echo "error: timed out waiting for the instance; check https://my.vultr.com" >&2; exit 1; }

HOST="${IP//./-}.sslip.io"
cat <<NEXT

instance id : $ID
ip          : $IP
host        : $HOST
wss url     : wss://$HOST

Next steps
  1. Wait 2-4 min for cloud-init to run setup.sh (Caddy, Node, relay, TLS cert).
     Follow along:  ssh root@$IP tail -f /var/log/cloud-init-output.log
  2. Check health: curl https://$HOST/        ->  {"ok":true,"online":0}
  3. Paste the URL into src/multiplayer.js:  const DEFAULT_URL = 'wss://$HOST';
  4. Later updates: ssh root@$IP /opt/terracart/server/deploy/update.sh
NEXT
