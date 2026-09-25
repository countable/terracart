# Shared restoration — plan (shelved)

Status: **shelved**. Written 2026-09-25 after the multiplayer determinism audit.
Nothing here is built. Pick it up once the generated world is identical for
every player (per-tile cell grid, frame-free ids — see the determinism work
that landed with this doc).

## The idea

When one player restores a ruin (a wrecked house, a fort, a castle), every
player sees it restored: the garrison is gone, the building is whole and its
role (shop, blacksmith, wizard …) is the same for everyone. Today restoration
is per-save — `save.restoredHouses[id]`, `save.unlockedForts`, castle keys via
`isClaimedKey` — so a ruin I rebuilt still has guards for you (`lairs.js`
`garrisonFor` reads `opts.isClaimed`).

## Why it is not a small change

The relay (`server/index.js`) holds **no game state**. It fans out positions
and pings, keeps no history, and forgets a player when the socket closes.
Shared restoration needs the opposite:

1. **Durable world state on the server.** A restoration must survive every
   client going offline. That means storage (SQLite / a JSON file per region /
   a KV), not a fan-out.
2. **A late-joiner catch-up.** A client entering an area must learn every
   restoration inside it — an area query keyed by tile (`tx_ty`), fetched when
   a tile loads (the same moment `spawnInTile` runs), not a broadcast stream.
3. **Authority / anti-cheat.** Today a client can only lie about where it is.
   A shared restore lets one client change everyone's world, so the server
   must at least validate: the id is a real generated structure id
   (`h_tx_ty_ix_iy`, castle `b_…`), rate limits, and ideally that the sender
   was near it (its last reported position).
4. **Conflict rules.** Two players restoring the same house at once; one player
   restoring a house into role A while the generated role is B (roles are
   frozen per save at restore time today — `app.js` `_houseRole`,
   `save.restoredHouses[id]`).
5. **Offline play.** The game must stay fully playable offline. A restore made
   offline has to be queued and replayed, and may lose a race.

## Prerequisite (now done or in flight)

Shared state is keyed by **generated ids**, so ids must be identical on every
device: house `h_${tx}_${ty}_${ix}_${iy}`, castle / tower absolute-cell keys,
lair structure keys `${tx}_${ty}_${ix}_${iy}`, all on the tile's own
cells-per-edge (`WorldGen.cellsPerEdgeForTile(ty)`). Before that work, ids
were built from absolute metres in each save's latitude-scaled frame and no
two players agreed on them.

## Sketch

- **Server**: add `{ t:'restore', id, kind, tile }` (client → server) and
  `{ t:'world', tile, restored:[{id, kind, role, by, at}] }` (server → client).
  Persist per tile. Validate `id` shape and `tile` agreement; rate-limit like
  pings.
- **Client**:
  - On tile load, request that tile's restorations (batched for the 3×3 ring).
  - Merge them into a session-only `sharedRestored` set, kept apart from the
    save. `isClaimedKey` / `_isHouseWreck` / `garrisonFor`'s `isClaimed` read
    `save ∪ shared` — one predicate, per the "one lane" rule; don't add a
    second gate.
  - On restore, send `restore` as well as writing the save.
- **What stays per-player**: the rewards (coins, memories, badges) for doing
  the restoration, and the player's own shop and delivery state.
- **Role**: when restoring an already-shared house, take the shared role.
  Only the first restorer's roll counts.

## Open questions

- Is restoration shared for **everyone**, or only for players who are friends
  or in the same room?
- Does an already-restored ruin still pay a newcomer anything?
- Can a restoration decay or be undone?
- Where does the durable store live? The Vultr box already runs the relay, so
  a SQLite file beside it is the cheapest start.
