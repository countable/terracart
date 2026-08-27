# terracart relay — deploy

`server/index.js` is a tiny Node WebSocket relay: players connected to it see
each other move. It holds no game state. One process, one port (8787):
`GET /` answers `{"ok":true,"online":N}` and WebSocket upgrades share the port.

The game is served from https://countable.github.io/terracart/ (HTTPS), so the
browser will only open `wss://` — the relay needs TLS. That is what Caddy and
sslip.io are for: Caddy sits in front, gets a free Let's Encrypt cert for
`<ip-with-dashes>.sslip.io` (a public DNS service that resolves that name to
the IP, so there is nothing to configure), and proxies to the relay on
localhost.

## Run locally

    cd server && npm install && npm start     # ws://localhost:8787
    npm test

## Deploy (once)

    ./server/deploy/create_instance.sh --dry-run   # show what will be created
    ./server/deploy/create_instance.sh             # needs VULTR_API_KEY (env or ~/.env), curl, jq

Creates one Vultr `vc2-1c-1gb` in Toronto (~$5–6/month) running Ubuntu 24.04,
and hands it `setup.sh` as cloud-init user data. Setup installs Caddy, Node 22,
clones this repo to `/opt/terracart`, installs the systemd unit and writes the
Caddyfile. Allow 2–4 minutes after the script prints the IP; then paste the
`wss://…sslip.io` URL it prints into `DEFAULT_URL` in `src/multiplayer.js`.

Files here:

| file | purpose |
|---|---|
| `create_instance.sh` | creates the VPS via the Vultr API, waits for the IP, prints next steps |
| `setup.sh` | on-server bootstrap (idempotent; safe to re-run as root) |
| `terracart-relay.service` | the systemd unit `setup.sh` installs |
| `Caddyfile.example` | the Caddyfile `setup.sh` writes, with a placeholder host |
| `update.sh` | on-server: pull latest `main`, `npm install`, restart |

## Update

    ssh root@<ip> /opt/terracart/server/deploy/update.sh

## Check health

    curl https://<host>/                    # {"ok":true,"online":0}
    ssh root@<ip> systemctl status terracart-relay caddy

## Logs

    ssh root@<ip> journalctl -u terracart-relay -f
    ssh root@<ip> journalctl -u caddy -n 50
    ssh root@<ip> tail -f /var/log/cloud-init-output.log   # first-boot setup.sh output
