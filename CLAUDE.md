# CLAUDE.md

## Purpose

Working guidance for Dragon Hood, a GPS farming RPG rendered with Phaser 3.
(Mending Lane, the former title, is now the neighbourhood the player starts in.)
This file owns policy, workflow, documentation rules and the invariants that
recur across systems. Mechanism detail lives in the purpose docs it indexes;
implementation rationale lives beside the code.

## Scope and navigation

- Vanilla JavaScript, no build step. `index.html` loads scripts in order into
  shared global scope. Preserve that order when adding modules; keep `sw.js`
  at the repository root for its service-worker scope.
- [README.md](README.md): setup and source map.
- [docs/README.md](docs/README.md): the full documentation index, including
  the data and report files under `docs/data/` and `docs/reports/`.
- [Art direction brief](docs/art/art-direction-brief.md): camera, pixel scale,
  palette, restoration, and visible elevation; follow it when adding or revising art.
- [test/node/README.md](test/node/README.md): test harness and module registration.
- [docs/process/QC_RULES.md](docs/process/QC_RULES.md): checklist for art, sprites and item surfaces;
  read it for asset changes. This file owns mechanic invariants if notes disagree.
- [docs/design/spec.txt](docs/design/spec.txt): game design; code owns current numeric values.
- [docs/design/story.txt](docs/design/story.txt): the story bible (Dragon Hood); it wins over
  story copy in `src/`, and its open [Q#] items are not yet canon.
- [docs/process/SANDBOX.md](docs/process/SANDBOX.md): hand-built world for visual checks.
- Preserve the `terracart.*` storage keys despite the game's name change.

## Documentation rules

- A rule earns a place here by recurring across systems or by having bitten
  more than once. Mechanism detail belongs in the owning purpose doc:
  - [docs/design/generation.md](docs/design/generation.md): world generation,
    saves, tiles, the spawn gate, and placement precedence.
  - [docs/design/rendering.md](docs/design/rendering.md): projection, sprite
    seating, performance, lighting, and street restoration.
  - [docs/design/combat.md](docs/design/combat.md): damage, energy, timed
    effects, pets, and Home.
  - [docs/design/presentation.md](docs/design/presentation.md): dialogs, story
    delivery, feedback, and teaching copy.
  - [docs/art/map-perspective.md](docs/art/map-perspective.md): camera and
    art geometry for the top-down grid.
- Read the owning purpose doc before changing that system's mechanics, and
  update it in the same change that moves the code.
- Historical reports and fixed findings do not get files; fold the standing
  lesson into the owning doc and delete the report.
- Update the relevant section instead of adding a diary entry. Replace
  superseded rules rather than appending exceptions.

## Workflow

- Use subagents to batch large or parallelizable tasks.
- Serve locally with `python3 -m http.server 8000`; use `?sandbox=true` for the
  test world. The game needs HTTP for fetches and the service worker.
- After the last edit to a file loaded by `index.html`, run
  `node tools/cachebust.js --write`, then `node test/node/run.js`.
  Script `?v=` values and `SHELL_VERSION` are derived hashes; never edit them
  by hand. Resolve merge markers before regenerating hashes.
- The headless suite includes sprite, cache and layout audits. For browser
  checks, see the test README; if the browser harness cannot run, say so plainly.
- Work on the designated session branch; create it if needed. Small,
  self-contained changes may go directly to `main`.
- Commit completed work without asking. Once all requested work is finished and
  available tests pass, merge to `main` and push `main`, not the feature branch.
  Unfinished work stays on its branch. Always merge; never rebase.

## Shared design rules

- The viewport and movement use a top-down square grid, north/south along
  screen up/down. Artwork tilts the overhead view toward a south camera;
  [docs/art/map-perspective.md](docs/art/map-perspective.md) owns the geometry.
- Search for an existing predicate, state flag or table before adding one.
  Extend it when the mechanism is the same; similar names alone do not justify
  combining mechanisms. Read its comments and regression tests before changing it.
- Keep numbers shared by rendering, gameplay and copy in one owning table.
  Derive consumers from it; do not add independent tuning factors.
- Add kinds as table rows and repeated kind groups as predicates:
  `SpriteLayout.CREATURE_BEHAVIOUR`, `CREATURE_ART`, `enemy_roster.js` rows
  (`Combat.MONSTERS` is their view),
  `interactables.js` predicates, `RENDER_SPEC`, `Lighting.KINDS`, and what a
  wreck can be restored as (`Houses.BUILD_OPTIONS`: the player's pick, cards
  unlocked by restore count in `STORY_RESTORES`; `restoreAs` is the ledger's
  one writer — never a fixed schedule or the OSM address).
  Creature variants inherit through `baseKind`; hostility uses `Combat.isEnemy`.
  An authored garrison (a horde, a decoy, an elite with minions) is a row of
  `Lairs.GROUPS` — members, placement (`seatPolar`) and what each is told
  (`aggroCells`, `proximityCells`, `elite`) — never a branch in
  `garrisonFor`; `tools/guard_groups_sheet.js` draws the table.
- Read the relevant tests under `test/node/` before changing a mechanic. If a
  supposed mechanic change touches no existing regression assertion, check that
  it actually uses the existing implementation.

## Recurring invariants

One line each; the linked purpose doc owns the detail.

- The generated world is deterministic: derive ids and seeds from tile plus
  local cell or OSM id, never array indices or timestamps; every player with
  the same tile data sees the same world
  ([generation](docs/design/generation.md)).
- Spawn access is per-cell REASON bits behind one gate —
  `WorldGen.isSpawnCell` with `SPAWN_CLASS_BLOCKS` — never a check at a
  spawner ([generation](docs/design/generation.md)).
- The road is never a refuge or a lure: the kerb buffer ends chases and
  excludes fast movers; at night its red MD/LG zone hides interactions and
  drains energy; MD/LG junctions exclude every spawn and non-allied creature,
  while Small-road junctions suppress fast movers and hazards; nothing urgent
  sits across the Major-and-Medium road group
  ([generation](docs/design/generation.md)).
- `Energy.set` is the only runtime energy writer; all incoming damage routes
  through `Combat.playerDamage` and armour ([combat](docs/design/combat.md)).
- A timed effect is a row of `Conditions.DEFINITIONS` or `Buffs.KINDS`, shown
  only as a chip in the status row; a timed consumable is a `CONSUMABLE_SPEC`
  row ([combat](docs/design/combat.md), [presentation](docs/design/presentation.md)).
- `lighting.js` owns the sole lighting pass; add sources as `Lighting.KINDS`
  rows ([rendering](docs/design/rendering.md)).
- Taps resolve the data cell (`sameAbsCell`), never pixel bounds; sprites seat
  through `RENDER_SPEC` and its audit ([rendering](docs/design/rendering.md)).
- A cell-crossing rebuild never reads pixels back — no `getImageData`, no
  per-piece `textures.createCanvas` ([rendering](docs/design/rendering.md)).
- Nothing reveals the survivor's or the wizard's secret before the memory-30
  gate at the second tower ([presentation](docs/design/presentation.md),
  [story](docs/design/story.txt)).

## Maintaining these docs

Add guidance here only when it changes how future work should be done across
files or prevents a non-obvious recurring mistake. State the rule once with its
owning API and, where useful, a regression test. Keep tuning values, algorithms
and bug history in source comments and tests. When a root rule stops recurring,
move its detail to the owning purpose doc and leave the one-liner. The docs
index in [docs/README.md](docs/README.md) stays authoritative for file paths;
update references when a file moves.
