# Dragon Hood relay — deploy

`server/index.js` is a tiny Node WebSocket relay: players connected to it see
each other move, and nearby players' copies of an enemy take each other's
hits (the client is `src/multiplayer.js`; the wire protocol is the comment at
the top of `server/index.js`). The package, systemd
unit, user and install path keep the old `terracart` name on purpose
(`terracart-relay`, `/opt/terracart`). It holds no player state. One process,
one port (`PORT`, default 8787): `GET /` answers `{"ok":true,"online":N}` and WebSocket upgrades share the port.

The same process serves satellite-derived tree geometry over HTTP. Successful
tile results, including empty tiles, are written permanently to disk. These are
estimated individual crowns and broad visual types, not surveyed trunk positions
or verified species.

The game is served from https://countable.github.io/terracart/ (HTTPS), so the
browser will only open `wss://` — the relay needs TLS. That is what Caddy and
sslip.io are for: Caddy sits in front, gets a free Let's Encrypt cert for
`<ip-with-dashes>.sslip.io` (a public DNS service that resolves that name to
the IP, so there is nothing to configure), and proxies to the relay on
localhost.

## Run locally

    cd server && npm install && npm start     # ws://localhost:8787
    npm test

Node 22 or newer is recommended (`sharp` requires Node >=20.9).

## Tree geometry

Set `OPENROUTER_API_KEY` on the server. The browser never receives the key.
The service uses `google/gemini-4-argon` through OpenRouter and Esri World Imagery.

```sh
curl 'http://localhost:8787/geometry/trees?lat=49.8546&lon=-119.4800'
curl 'http://localhost:8787/geometry/trees/18/44069/89069'
```

Both forms address the same canonical zoom-18 tile. Only z18 is accepted;
the service fetches z20 imagery, falling back to z19 or z18 when Esri reports
no imagery. Context around the tile helps separate border crowns. Each crown
belongs to the tile containing its estimated center.

The response is a schema-versioned GeoJSON FeatureCollection with `tile`,
`coverage.bbox`, `imagery`, `model`, and `generatedAt`. Point features include
`tree_type` (`conifer`, `broadleaf`, `unknown`), `confidence`, crown bounding
coordinates and diameter, and a stable ID. `species` maps conifer to the game's
pine and broadleaf to maple; `species_basis: game_type_mapping` makes that
distinction explicit. It is not a claim that every broadleaf is a maple.

| Environment | Default | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | unset | Required for uncached generation only |
| `GEOMETRY_CACHE_DIR` | `server/data/geometry` | Permanent atomic JSON tile files |
| `GEOMETRY_COLD_REQUESTS_PER_HOUR` | `100` | Maximum uncached attempts per process per hour |

Cache hits do not consume the generation budget or require an API key.
Simultaneous requests for a tile share one generation. Two generations can run
at once, with up to sixteen queued; excess work returns HTTP 429. Failed,
truncated, malformed or unavailable-imagery responses never become cached empty
tiles. The model's confidence is descriptive, not a calibrated probability.

The systemd unit stores files in `/var/lib/terracart/geometry` and optionally
reads `/etc/terracart/geometry.env`. Create that environment file as root with
mode 0600 and an `OPENROUTER_API_KEY=...` entry, then restart the relay. The
`StateDirectory` remains writable under service hardening and survives upgrades
and restarts. Back it up: losing it causes regeneration and may change crowns.
There is no automatic expiry or public purge endpoint. An intentional re-extract
requires removing the relevant server file and clients' corresponding local
geometry caches.

The game requests only the player's current z18 tile in the background as they
move, rather than generating all 256 z18 children of a z14 game tile. It reuses
the relay host (`window.MP_SERVER_URL` overrides both services), keeps local
IndexedDB copies, and refreshes the surface tile when geometry arrives. Use
`?geometry=off` to retain the existing tree sources; sandbox/test modes never
request paid geometry.

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
