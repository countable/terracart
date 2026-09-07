# QC-rules audit — 2026-09-07

Are the QC rules in `CLAUDE.md` still true of the code, clear enough to act on,
and scoped to the thing they actually govern? Every rule in the file was read
against the shipping source by five parallel read-only sweeps over disjoint
subsystems; every finding below was then re-verified by hand before it was
written down (the sweeps' reports are input, not results).

## Method

- `node test/node/run.js` → **2121 passed, 0 failed** (baseline, green).
- `node tools/sprite_audit.js` → clean (23 seats, 13 wheels, 2 crowns, 12 wild
  frame rows). `node tools/layer_audit.js` → clean.
- Five sweeps: spawn/tiles, sprites/render, camera/lighting/feet,
  combat/energy/home, copy/content/streets. The generated-world rule was
  audited separately (it was being rewritten in the same session).
- Categories used: **OUTDATED** (doc describes code that has changed),
  **UNCLEAR**, **WRONGLY-SCOPED** (a narrow instance of a broader principle, or
  several rules stapled into one), **NOT-FOLLOWED** (live code violates it).

**Headline:** no rule was found to be wrong about its own mechanism. What the
audit did find is three shipped call sites that quietly skip a rule, one number
in the file that contradicts another number in the file, and three bullets that
have grown into several rules wearing one headline.

---

## 1. NOT-FOLLOWED — three call sites that skip a rule

### 1a. The chest coin-burst passes half the spawn rule — `app.js:8914`

```js
const burstOpts = { roadMask: entry.roadMask, pois: [{ ix: poiLocalCX, iy: poiLocalCY }] };
```

`roadMask` yes, **`occupied` no** — so a burst coin can land on a cell already
holding a rock, a tree or a wild plant. The rule ("Nor on top of anything
already there") exists because the art is the only warning, and the cave coin
pass in the same codebase already guards exactly this, in its own words: *"Not
on a staircase or a rock: the coin handler wins the tap, but a coin under a
rock sprite reads as a rock"* (`app.js`, `spawnCaveCreatures`). The surface
burst is the one that doesn't.

**Recommendation.** Add `occupied: entry._occupiedIdx` to `burstOpts`. One
line; the Set is already built for the tile.

### 1b. Cave monsters and rabbits check terrain and nothing else — `app.js:5919`, `5940`

```js
if (entry.grid[cy * N + cx] !== 24 /* CAVE_FLOOR */) continue;
```

No `isSpawnCell`, no `occupied`. A monster can be seated on a staircase cell or
under a rock sprite. Cave coins and cave traps in the *same function* both
check occupancy through their own sets, so this is an inconsistency inside one
method rather than an oversight of the whole rule.

**Note the rule's own gap:** it never says what it wants for MOVING actors. A
monster that spawns under a rock walks out from under it next tick, which is
not the bug the rule was written about (a trap that springs under a rock sprite,
an X you cannot dig). Surface fauna go through the shared rule anyway.

**Recommendation.** Decide the general question first — *does the occupancy
half apply to creatures?* — then either route these two through `isSpawnCell`
with `entry._spawnOpts` or write the exemption into the rule. Do not fix one
without the other.

### 1c. A silent energy drain — `app.js:9246-9251`

```js
while (this._steerCostAccrue >= 1) {
  this._steerCostAccrue -= 1;
  const before = this.save.energy ?? 0;
  this.save.energy = Math.max(0, before - 1);
  this._warnIfTiring(before);
  if (this.updateEnergyDOM) this.updateEnergyDOM();
}
```

The joystick steer cost debits a whole pip per accrued cell with **no
`_popEnergy`**. The rule is "when you add an energy gain or loss the player can
see, pop it with `_popEnergy` and name the cell", and every sibling trickle
obeys it: the slime leech, the monster hit and the trap bleed all accumulate
into a throttled pop. This one shows nothing at all — the bar just falls. The
only feedback is `_warnIfTiring`, which fires once, at 30%, and prints no
number. `energy_pop.test.js` does not cover this call site, so nothing catches
it.

**Recommendation.** Accumulate and pop on the player's own cell, on the same
throttle the slime leech uses (it is the closest sibling: a continuous drain the
player is walking into). If walking costs are meant to be silent, say so in the
rule — but "the bar moved and nothing said why" is the exact complaint the rule
was written to end.

---

## 2. OUTDATED — the file contradicting itself

### 2a. Street-lamp spacing: 200 m in the lighting rule, 100 m everywhere else — **FIXED**

The lighting rule said *"a STREET LAMP on every 200 m of restored street …
one lamp per ladder rung's walk"*. But `Streets.LAMP_SPACING_M = 100`
(`streets.js:250`), `streets.test.js:522` pins it (*"half the ladder's 200 m
rung"*), and the street rule three hundred lines further down documents the
halving at length **and the deliberate decoupling from the ladder's rung** —
the exact thing the lighting rule still asserted.

This is the file failing its own Book rule ("the numbers in a tip are
re-derived from the module that owns them, never retyped"): a retyped constant
that then moved. Fixed in this pass — the lighting rule now points at
`Streets.lampSpacingM()` and says whose constant it is.

### 2b. The seat rule's exemption list, stated twice, differently — **FIXED**

"Interactables must be clearly in one cell" exempted *"houses and fauna"*. The
seat rule directly below exempts house / tower / shrine / produce stands /
pot-of-gold plus moving actors, and `tools/sprite_audit.js` prints that same
wider list. Worse, the bullet's actionable advice ("fix the offset, anchor, or
collision rect") named an artifact that does not exist: there is no pixel
hitbox in this codebase — every tap resolves through `coords.js` ›
`sameAbsCell` against the object's own data cell.

Fixed in this pass: the bullet now states the WHY (the tap is the cell, so art
that straddles a boundary is tappable a cell from where it looks), defers the
exemption list to the seat rule, and no longer promises a rect to adjust.

### 2c. The camera rule's third case has no live instance — **FIXED**

"A layer cached about `viewCenterX/Y` and SLID by the peek" describes nothing
that ships: `render.js`'s `peekPxOf` has no caller left (already noted as dead
in the 2026-09-06 audit), and every cached overlay rebuilds on `viewAnchorCell`
and shifts only by the sub-cell fraction. The guidance is still worth keeping
for the next such layer; it just needed to stop reading as a description of a
live one. Fixed with one sentence.

---

## 3. WRONGLY-SCOPED — three bullets that are several rules each

None of these is wrong. Each has grown past the point where a reader can find
the actionable part, and in each case **the tests already split the way the
prose should**.

| Bullet | Really contains | Tests that already exist |
|---|---|---|
| "Combat is HIT POINTS" | (a) HP/dps derivation, (b) armour mitigation, (c) the downed-player hostility gate | `combat.test.js`, `armor.test.js`, `downed_pursuit.test.js` |
| "Light ADDS, darkness doesn't" | compositing model · plateau geometry · the derived-constants chain · daylight · the `KINDS` table + collectors · the street-lamp row · "no reach outline" | `lighting.test.js`, `reach_corners.test.js`, `layer_audit.js` |
| "A street is restored ALONG THE WAY" | restoration/dwell · lamps · the soft edge · the prize ladder · the two synthetic loot classes | `streets.test.js`, `street_lamps.test.js`, `road_overlay.test.js`, `trail.test.js`, `loot.test.js` |

The lighting bullet is the worst of the three: someone asking "how do I add a
light source?" — the one thing it tells you to do — must read past the sun's
elevation maths and a post-mortem of a deleted outline to reach it. Its
street-lamp paragraph is also the paragraph that went stale in §2a, and it went
stale precisely because it lives away from `LAMP_SPACING_M`; moving it into the
street rule would put the prose next to its constant.

**Recommendation.** Split along the seams above, hoisting each bullet's
imperative ("when you add X, do Y") to its head. Left undone in this pass: it
is a large edit to a file five audits were reading, and it is a judgement call
about how granular the list should get.

---

## 4. Verified accurate — do not re-audit these

Traced to shipping code and passing tests, with no drift in either direction:

- **The painter rule** — screen-row z-order at `render.js:2352-2360`; the
  rampart's `gf`/`gb` split matches the description; `__RAMPART_DEBUG` exists.
- **The seat rule** — no `RENDER_SPEC` entry wrongly lacks `seat: true`
  (`groundstack`'s omission is reasoned and commented); no `CROP_SPRITE` carries
  a bare `variants` count, and `sprite_audit.js` still refuses one.
- **"What the art SHOWS is what it DROPS"** and **"a frame index is not a frame
  COUNT"** — checked specifically for being one rule twice: they are not. The
  first keeps two computations about one entity in sync; the second stops a
  single computation trusting a false range. Different bugs, different tests.
- **The tilled bed**, **the creature crown + health bar** (still derived from
  `CREATURE_ART`; no flat px offset has crept back), **the tile rebuild gate**,
  **the resolved tile URL** (the only `fetch(tileUrlFor(...))` in the tree is
  inside `fetchTileResponse`), **the camera split** (no draw pass on the body,
  no gate on the anchor), **the feet anchor** (`feetOffsetM = 0`,
  `playerFeetNudgeY` still derived, no per-mark offsets, multiplayer mirrors
  it), **"Working is not resting"** (both rests gated; `applyOfflineRest` is a
  one-shot catch-up, correctly outside), **Home's one ring** (`HOME_R = 4`
  genuinely resolves light, rest and ward), **`shortDuration`**,
  **`MAP_MSG_MAX`**, and **the item/Book split**.
- **The Book's numbers** — ~13 tips re-derived against their owning constants
  (`HOME_FULL_REST_S`, `STAGE_HOLD_MS`, `TOOL_DURATION_MS`, `SLOW_GRIND_*`,
  `CHEST_TIER_HOME_RINGS_M`, `dealCap()`, the fort/castle gates,
  `ENEMY_COIN_PER_HP`, `WIZARD_UPGRADE_COST`, `TURRET_RATE_DIV`,
  `MONSTER_TREASURE_CHANCE`). **No stale tip found.** The "twice as quick /
  thirty times" wording is a sanctioned rounding of 2.25×/30×, pinned as such.

## 5. Latent, not yet a violation

**Two unyielded sweeps in the rasterizer** — `worldgen.js:3210` (every struct)
and `3232` (every wildplant) run straight through between yields, while the
near-identical mineralrock sweeps just above them yield every 64 items. The
rule says, without qualification, *"When you add a pass over every cell, object
or polygon, give it a yield."* `tile_build_blocks.test.js` passes at 6000
buildings, so these are inside budget today — which means the rule as stated is
absolutely true and two shipped passes quietly disagree with it.

**Recommendation.** Either add the periodic yield to both (cheap, matches the
neighbouring code) or give the rule the carve-out it actually operates under —
a body that is O(1) per element and bounded by objects-per-tile may run
straight through, and the block-timing test is the arbiter.

---

## Suggested order

1. **§1c** — the silent steer drain: a player-visible gap, one call site.
2. **§1a** — one line, and the codebase already calls this a bug elsewhere.
3. **§1b** — needs the creatures-and-occupancy decision first, then both halves.
4. **§5** — two yields, or one sentence of carve-out.
5. **§3** — the three splits; the lighting bullet first, moving its street-lamp
   paragraph into the street rule where its constant lives.

§2a, §2b and §2c are done.
