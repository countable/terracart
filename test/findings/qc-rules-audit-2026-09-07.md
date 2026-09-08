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

### 1a. The chest coin-burst passes half the spawn rule — `app.js:8914` — **FIXED**

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

**Fixed.** `burstOpts` now carries `occupied` from `entry._spawnOpts.occupied`
(the Set `spawnInTile` already builds once per tile), and the RELAXED lane
re-checks it directly — "not under a rock" is not a frontage nicety. Falls back
to no occupancy check on a tile whose spawn pass has not yet run, rather than
crashing.

### 1b. Cave monsters and rabbits check terrain and nothing else — `app.js:5919`, `5940` — **FIXED**

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

**Fixed, and the general question is settled:** occupancy governs where a thing
is **SEATED**, not where it may later walk. A creature may wander onto any cell
once it exists (the wander loop is untouched); it may not be BORN on a
staircase or inside a rock. Both loops now share ONE occupancy Set with the
coins and traps in the same function — which removed two duplicate scans of
`entry.objects` while it was there. The check is a rejected attempt inside the
existing loop, so no `rng()` draw moved and every existing cave level is
unchanged.

### 1c. A silent energy drain — `app.js:9246-9251` — **FIXED**

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

**Fixed.** Each pip banks into `_steerDrainAccum`, flushed as ONE throttled pop
on the player's own cell — the same shape and the same 1200 ms window as the
slime-leech and monster-hit roll-ups beside it. The flush lives in the
every-frame tick rather than `_steerManual`, so a drag that stops mid-window
still pays out instead of losing the remainder. `energy_pop.test.js` now pins
the call site that had no test at all, which is why it stayed silent.

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

**Done.** Split along the seams above, each bullet keeping the Audit line for
its own test file: Combat into three, Light into three — with "add a row to
`Lighting.KINDS`" promoted from two-thirds down to the headline — and the
street rule into four (the lamps taking the still-loading memo caveat with
them, since that is the lamps' own bug). The Home rule also moved out from
between the two halves of the item/Book pair, which the copy sweep flagged.

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

## 5. Latent, not yet a violation — **FIXED**

**Two unyielded sweeps in the rasterizer** — `worldgen.js:3210` (every struct)
and `3232` (every wildplant) run straight through between yields, while the
near-identical mineralrock sweeps just above them yield every 64 items. The
rule says, without qualification, *"When you add a pass over every cell, object
or polygon, give it a yield."* `tile_build_blocks.test.js` passes at 6000
buildings, so these are inside budget today — which means the rule as stated is
absolutely true and two shipped passes quietly disagree with it.

**Fixed** by taking the first option: both sweeps now yield every 64 items on
the neighbouring idiom, with labels of their own (`structure occupancy sweep`,
`wildplant occupancy sweep`) so a boot profile can name either. The rule keeps
its unqualified form, because now nothing disagrees with it.

---

## Status

**All of it is done.** §1a, §1b and §1c are fixed in code; §2a, §2b and §2c are
fixed in the rules; §5 took the yields rather than the carve-out; and §3's three
bullets are split — Combat into three, Light into three (with "add a row to
`Lighting.KINDS`" promoted to its headline), and the street rule into four. The
item/Book pair is adjacent again, the Home rule having moved out from between
its halves.

What is deliberately NOT done: nothing. If a §4 entry ever needs re-checking it
is because the code moved, not because this pass left it half-audited.
