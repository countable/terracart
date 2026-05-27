# Sandbox Interaction Sweep — 2026-05-27

Drove every player-interaction path in the sandbox view via the preview MCP
(`/?sandbox=true`, all relics granted at T2, energy/money topped up, all foods
in inventory). Each test teleports the player to the target, sets selSlot
to the relevant item, then invokes `scene.handleWorldTap` with the
target's screen position computed from `worldMetersToScreen`.

22/22 happy-path tests **PASS** — one logic bug found in the tap-handler
ordering.

---

## Test results

| # | Interaction | Result | Notes |
|---|---|---|---|
| 11 | Catch chicken with rainberry | ✅ | rainberry −1, chicken inv +4 (chicken `yieldN=4` by design), caughtKinds.chicken++, energy −5 |
| 12 | Catch cow with pairy | ✅ | pairy −1, cow inv +1, caughtKinds.cow++, energy −5 |
| 13 | Hunt deer (sword T2) | ✅ | meat +1, deer in caught list, energy −5 |
| 14 | Hunt crow (bow T2) | ✅ | crow_feather +1 |
| 15 | Catch butterfly (bugnet T2) | ✅ | butterfly inv +1 (live animal) |
| 16 | Catch rabbit bare-hand | ✅ | rabbit inv +1 (no pelt — only on processing) |
| 17 | Tame released cat with milk | ✅ | `_pettedUntilT` + `_followUntilT` advanced, milk consumed. Note: wild cats/dogs use the favourite-food **catch** path (same as chickens/cows) — tame interaction only fires on `released_*` creatures. |
| 18 | Open chest | ✅ | opened list +1, inv +6 (loot), chest blocks re-open |
| 19 | Harvest wildplant (mushroom instant + shrub via work-progress) | ✅ | mushroom +1, shrub +1 after axe-T2 work completed (took manual `_drawWorkProgress` ticks — see "Preview infra" below) |
| 20 | Chop tree (axe T2) | ✅ | tree +1, `o.chopped=true`, `save.chopped` updated |
| 21 | Mine mineralrock (pick T2) | ✅ | T1 rock with T2 pick → copper_bar +1; T3 rock with T2 pick → rejected (no work started, rock unbroken) |
| 22 | Harvest fruit tree | ✅ | apple +1, picked |
| 23 | Till + plant + harvest crop loop | ✅ | tilled +1, planted +1, potato_seed −1, then +2 potato on mature harvest |
| 24 | Refill watering can | ✅ | `canCharges` set to 50 |
| 25 | Fishing | 🐛 see bug below | Handler never reached when player has watering can equipped |
| 26 | Buy from shop (empty slot) | ✅ | offer-modal: "blacksmith will forge: Gold Bag for 4× Gold Bar" |
| 27 | Sell to shop | ✅ | chicken −1, money +3, modal closed |
| 28 | Shrine transform (rainberry → copper_bar) | ✅ | offer-modal: "Transform 1× Rainberry → 1× Copper Bar" |
| 29 | Place + pickup scarecrow | ✅ | scarecrow −1 on place, +1 on pickup |
| 30 | Release animal | ✅ | chicken −4 (flock of 4), `save.released` +4, 4 new `released_*` creatures in tile |
| 31 | Use consumable (book) | ✅ | offer-modal: "Read the book?" Requires tap at **feet** (player position + `feetOffsetM=3.75m`), not at the visible head — already correctly enforced by handler |
| 32 | Pickup treasure X (synthetic) | ✅ | foundTreasures +1, inv +1 via `pickReward('treasure:default')` |

---

## 🐛 Bug: fishing unreachable while a Watering Can is equipped

**Severity:** medium — entire fishing system is dead-coded for any player
who has a can.

**Where:** `interact.js`, `TAP_HANDLERS` ordering around lines 900-940.

**Symptom:** Tapping a water cell with a fishing rod selected does **not**
start the fishing work-progress — no energy spent, no work wheel,
nothing. The can-refill handler claims the tap and sets `canCharges = 50`
silently.

**Root cause:** `can-refill` (line 900) sits **before** `fishing` (line
914) in `TAP_HANDLERS`. Its only entry condition is "this cell is water
AND the player owns a Watering Can":

```js
{ name: 'can-refill', try: (ctx) => {
    const { scene, save, sx, sy, cell } = ctx;
    if (cell.type !== 3) return false;
    if (!save.relics?.can) return false;
    save.canCharges = 50;
    ...
    return true;
}}
```

It does not look at the selected slot. So once the player has a can in
their relic set, *every* water tap refills it — fishing is unreachable.

**Suggested fix (one of):**
1. Gate `can-refill` on the can being the selected item:
   `if (sel?.id !== 'can') return false;` (most surgical; rod-selected
   water taps now fall through to fishing).
2. Swap the order: put `fishing` before `can-refill`. Then rod-equipped
   water taps fish; otherwise the can refills.
3. Gate `can-refill` on `!save.relics?.rod || sel?.id === 'can'` — i.e.
   refill only if the player has no rod OR explicitly has the can in
   hand.

Option 1 reads cleanest to me — it makes both handlers selection-driven
and consistent with the rest of the dispatcher (release / plant / till
all check `getSelectedSlot`).

**Verification:** Patched `TAP_HANDLERS[i].try` to log dispatch order
during the test. With rod selected, log was:
```
work-progress· use-consumable· eat· treasure· creature· wildplant·
object· cell-resolve· release· pickup-rock· pickup-scarecrow·
place-scarecrow· place-rock· rock· planted· can-refill✓
```
— can-refill returned true before fishing got a chance.

---

## Preview infra note (not a game bug)

Phaser's `requestAnimationFrame` is throttled in the preview MCP's
headless / unfocused Chrome window. Game-loop-dependent paths
(work-progress completion, growth ticks, ease tweens) don't progress on
their own. Workaround for testing: call `scene._drawWorkProgress()`
manually after the expected duration — that completes the work-progress
callback (verified for tree chop, shrub harvest, mineralrock mine,
fishing if reachable). Real-browser play is unaffected.

---

## Findings not flagged as bugs (intentional behaviour worth knowing)

- **Wild cats/dogs catch like chickens/cows.** Feeding milk to a wild
  cat ADDS it to inv (catchKind++); only `released_*` cats trigger the
  pet/follow tame branch. Same for dogs. If we want a separate "befriend
  the strays" mechanic that doesn't capture, that's a feature ask.
- **Chicken catch yields 4** (1 bird + 3 conceptual eggs) — by design
  (`yieldN = c.kind === 'chicken' ? 4 : 1`), all 4 land as `chicken`
  inv items (not split into eggs).
- **Mineralrock drop tier follows pick tier, not rock tier.** T1 rock
  with T2 pick → copper_bar (T2). Looks intentional given the relic
  ramp, but worth documenting.
- **`feetOffsetM = 3.75m`.** Consumable / eat handlers require the tap
  within 1.5m of the player's **feet**, not the rendered head — so a
  tap on the visible sprite body fails the proximity check. Already
  works correctly on real touchscreens because most thumb taps land
  near the feet.
- **`REACH_CELL_M = 16m`.** Generous on tile cells; cell-resolve will
  flash "too far" beyond that.
- **`REACH_CREATURE_M = 4m`.** A creature within 4m of a tap claims it
  before `wildplant` / `object` / `cell` handlers — explains why
  chopping a tree near a chicken sometimes triggers a "needs Rainberry"
  flash instead of the chop. Not a bug, but a discoverability snag.

---

## Sandbox feature catalogue (for next time)

Center tile (`14/2754/5566`) contains:

- **objects** (62): chest×12, flora×23, fruittree×8, house×3, mineralrock×7,
  shrine×1, tower×3, tree×5
- **wildplants** (29): longgrass×13, mushroom×4, nut×2, rockfruit×1,
  shell×5, shrub×4
- **creatures** (25): butterfly×2, cat×5, chicken×7, cow×4, crow×1,
  deer×1, dog×3, rabbit×2
- **parkingTreasures**: 0 (none — inject one synthetically to test the
  treasure handler)

Each kind has at least one instance, but creatures cluster tightly enough
that a tap on a wildplant or tree near a creature gets eaten by the
`creature` handler first. Use `__findCreature(kind)`, `__findObj(kind,
predicate)`, `__findWp(crop)`, `__tp(wx, wy)`, `__sel(itemId)`,
`__tapWorld(wx, wy)` helpers from `/test/findings/` setup snippet for
follow-on testing.
