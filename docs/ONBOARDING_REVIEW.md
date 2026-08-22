# Initial-player-experience review

A focused pass over the **first launch through the first hour**: the story
slides, the safety/permission gate, the how-to card, the starter provisioning
(crate trail, relic chest, soil plot, tutorial pocket) and the six-step
objective ladder. Complements `docs/UX_AUDIT.md`, which sweeps the whole game —
overlapping findings are cross-referenced rather than repeated.

**Method.** Chromium via Playwright against `http://127.0.0.1:7731/index.html`,
driven from a wiped profile through story → safety → how-to → world, then
played: walked the crate trail, opened all four supply crates, tilled the
starter plot. Repeated at 390×844, 360×640, 768×1024, 844×390 and 1280×800.
`node test/node/run.js` was green throughout; the browser harness was not run.
Every finding was re-verified after merging the fog-of-war / boot-overlay work
from `origin/main` (864/864 green on the merged tree); line references point at
the merged code.

**One caveat on the world.** `tiles.openfreemap.org` is unreachable from this
environment, and `test/fixtures/*.pbf` is gitignored and absent, so the map came
from a synthetic MVT layer set (residential landuse, a street grid, building
footprints, a wood patch) injected at `MVT.decodeTile`. The starter
provisioners, the ladder, the trail geometry and every HUD/layout finding below
exercise real code paths. What it does **not** exercise is real OSM variety —
so anything that depends on what a particular neighbourhood contains is out of
scope here. The scene's grey-brown cast in the screenshots is the fixture
(residential terrain everywhere), not the game.

Priorities: **P1** breaks or badly degrades the opening for real players;
**P2** is visibly wrong and cheap to fix; **P3** is polish.

---

## P1 — Breaks the opening

### 1. The "guided first harvest" cannot be finished in a first session, and the chip misstates how growing works

The how-to card promises *"follow it for a guided first harvest"*, and step 5 of
the ladder says:

> **Bring in the crop** — Your seed grows a stage every 15 minutes. Tap it when
> it is ripe. (`src/quests.js:152`)

That is not what the crop model does. `MAX_GROWTH_STAGE = 4`
(`src/items.js:32`), and `Crops.advanceGrowth` only advances a plant whose
`watered_t` is set — then **clears it** (`src/crops.js:45-51`):

```js
if (now - p.watered_t < STAGE_HOLD_MS) continue;
p.stage = (p.stage ?? 0) + 1;
p.watered_t = 0;              // ← needs watering again for the next stage
```

So reaching harvest takes **four separate waterings, each followed by its own
15-minute hold**: a one-hour wall-clock floor and four return visits to the
plot. Growth is not passive and the 15 minutes is per stage, not to ripeness.
Step 6 ("Cash out at Home") sits behind step 5, so the last third of the ladder
is unreachable in a first sitting no matter how well the player plays.

Compounding it, the flash on a stage advance is wrong
(`src/interact.js:1218-1223`): the branch that **increments the stage and
clears the watering** prints `🌱 Watered.` — the one thing that did not just
happen. The plant grew and now needs water; the message says it was watered.
The tap that actually waters, one branch below, prints the stage readout
instead.

**Fix.** Two independent halves:
- Copy: say what the loop is — *"Water it, wait, water it again. Four waterings
  and it's ripe."* — and swap the advance flash for the new stage
  (`🌱 <stageReadout()>`), keeping `🌱 Watered.` for the branch that waters.
- Pacing: if the ladder is meant to complete in a session, either shorten
  `STAGE_HOLD_MS` for the *first* planted crop, or seed the starter potato
  further along, or reorder so steps 5–6 aren't the tail. A one-hour gate at
  step 5 of 6 is a place first sessions end.

### 2. A short viewport collapses the whole first screen

At 844×390 (a phone held sideways, or a short laptop window) the opening screen
is unusable. Measured:

| | |
|---|---|
| game column | **160 × 384** inside an 844-wide viewport |
| objective chip | 140 × **123** — wraps to 3 lines, covers the top third of the map |
| movement stick | 114 × 114 at (372, 120) — **over the middle of the play field** |
| inventory tabs | truncated to `Se… Pr… An… Re… Ar… Or… It…` |
| slot row | runs past the column's right edge, last slot clipped |

The cause is in `layOutVertically` (`index.html:1004-1050`). The caller passes a
width-derived floor — `Math.max(sByMinW, sByMaxW)` (`index.html:1117`), i.e.
"never narrower than PHONE_MIN=390" — and the function then discards it, because
the landscape branch passes `fillWidth: false`:

```js
const band = Math.max(160, vh - TOP_CHROME - INV_CLUSTER);
const maxS = (band + (TOP_CHROME - TOP_ROW)) / (MAP_H_GAME - CELL_GAME);
const s = Math.min(sByWidth, fillWidth ? maxS : band / MAP_H_GAME);   // ← no floor
```

At `vh = 390` the band is ~165px, so `s ≈ 0.47` and the column lands at 165px —
well under `PHONE_MIN`. Every fixed-size HUD piece (chip, tabs, slot row, stick)
is sized for a 390–430px column and no longer fits.

The `fillWidth` parameter that landed while this review was being written is
the same diagnosis, applied to the portrait branch only: *"letting the height
shrink a PHONE is exactly the bug this parameter fixes."* Re-measured after that
change and the numbers above are unchanged — a short **landscape** viewport
still takes the un-floored path.

**Fix.** Give the landscape branch a floor too — either `fillWidth: true` (and
let `#frame`'s `overflow:hidden` clip), or a `Math.max(sByMinW, …)` on the
result — or detect that the vertical budget can't afford a phone-width column
and lay the HUD out beside the map instead of under it. Either way `PHONE_MIN`
should mean something in the branch it was introduced for.

### 3. Every new player's bag starts with a dev test item

`src/app.js:802-812`:

```js
// TEST SEED: drop one Dragon Powder into the bag the first time this build
// runs, so the transform can be tried without finding one in the wild.
if (!this.save.gotDragonTestPowder) { … this.save.inv.push({ id: 'dragon_powder', count: 1 }); }
```

Verified on a wiped profile: a brand-new save's inventory is exactly
`[{ id: 'dragon_powder', count: 1 }]` — a tier-3 consumable that turns the
player into a dragon for a minute (`src/items.js:505`). It is the first and
only thing in a new player's bag, it is the reason the `Items` tab carries the
only count pip on the opening screen (see §8), and it contradicts the starter
crates' own premise: *"the player's first crops; inventory starts empty"*
(`src/app.js:2568`).

**Fix.** Gate it behind `DEBUG` / the Developer disclosure, or drop it. Nothing
else in the opening depends on it.

---

## P2 — Visibly wrong, cheap to fix

### 4. The first step's completion is celebrated entirely behind the modal that hides it

Opening the first crate fires, in this order (`src/interactables.js:449-454`):

```js
scene.addToInv(lootId, lootQty);
markOpened();                       // → scene.questEvent('chest')
scene.showChestRewardModal({ … });
```

`questEvent` (`src/app.js:6303-6329`) does two things: a canvas `flashLoot`
(`✅ Gather your supplies +$5`) at the view centre, and a 1400 ms green hold on
the objective chip (`✓ Gather your supplies / Done — $5 earned.`). The reward
modal then covers the view centre, and `body.modal-open` hides the chip — so
**both** land under the card. Screenshotted: the toast survives only as a sliver
of green text clipped at the modal's top edge, and the 1400 ms chip hold expires
while the modal is still up. By the time the player taps through, the chip reads
`2/6` with no acknowledgement that step 1 was ever completed.

This is the one step every single player completes first.

**Fix.** `showChestRewardModal` already takes `onDismiss` — defer `questEvent`
(or just its celebration half) to it, so the toast and the green chip play on a
clear screen.

### 5. Supply crates open with the treasure ceremony

Opening the first crate shows **💎 TREASURE / Wood / × 9**. The chip called
them "supply crates" one line earlier, they render as the humble box sprite
precisely to read as supplies (`src/app.js:2688-2694`), and 9 wood is not
treasure. Spending the blue-white treasure ceremony (spec §UI COLOUR LANGUAGE)
on the tutorial's material handout devalues it for the actual treasure — the
relic chest at the end of the same trail, which is the trail's payoff.

**Fix.** `showChestRewardModal` already supports a label override via `header`
(`src/app.js:9650-9654`) — pass `header: 'SUPPLIES'` for `o.crate` chests.

### 6. The gold guidance arrow parks on top of the crate it is pointing at

`_drawEdgeCompass` (`src/app.js:3622-3638`) parks the arrow on a **fixed ring**,
`min(viewSize/2 - 18, 140)` game px from the view centre, and the caller retires
it only once the target is within `cellM * 1.5` (`src/app.js:4017`). Between
those two radii the arrow floats over the world at a fixed distance while the
target slides toward it — and when they coincide, the arrow blots out the
target completely.

That is not a rare alignment: it happened on the opening screen in **two
independent runs, at 390×844 and at 360×640 and again at 768×1024** — the ring
radius and where the first crate seats along the trail land in the same place.
Screenshotted: a solid gold triangle centred on the crate, pointing *east, away
from it*, with only the crate's corners visible around the arrow.

**Fix.** Retire the arrow once the target is **on screen** (its screen position
inside the map rect), not at 1.5 cells — an on-screen target needs no bearing.
Failing that, park the arrow just outside the target's own screen position
rather than on a fixed ring, so it points *at* the sprite instead of standing
on it.

### 7. The live HUD sits over the narrative cards, and the money chip lies

During the two story slides and the safety card, `#money`, `#energy` and `☰` are
drawn at full brightness above the black boot screen. Measured at story time:
`#money` reads **`$0`** and `#energy-label` reads `⚡100/100` — the scene has not
booted, so the money chip shows a value that is simply wrong (`STARTING_MONEY`
is 50; the chip flips to `$50` the moment the world comes up).

`document.body.className` is empty for the whole intro, so `body.modal-open`
never applies. This is the residue of `UX_AUDIT` §4: the gate was moved into the
scene's update loop (`_syncModalGate`), and on a fresh boot **the scene does not
exist yet** while the story plays. The how-to card, which comes up after the
scene, correctly dims the chips — so the opening dims inconsistently within a
single sitting.

**Fix.** Hide the top chips (not just the move-pad) until the world is up, and
don't paint `#money` until it has a real value. A `body.booting` class set in
`index.html` and cleared from `create()` covers both without depending on the
scene being alive.

### 8. The fresh-save inventory opens on an empty tab

`invCat` defaults to `'seed'` (`src/app.js:754`), but a fresh save's only item
is the Dragon Powder (§3), which files under `Items`. So the first inventory a
new player sees is the **Seeds tab with nothing in it**, while the only count
pip on screen is two tabs away. `addToInv` already switches tabs for a new stack
(`src/app.js:9806-9813`) — the default just doesn't get the same treatment.

**Fix.** Default `invCat` to the first category that has anything in it, falling
back to `'seed'` when the bag is empty.

### 9. Wood is filed under "Ores 💎"

`{ id: 'wood', name: 'Wood', kind: 'mineral' }` (`src/items.js:434`), and
`INV_CATS` maps `mineral → ores` (`src/app.js:155-164`). The first supply crate
hands the player 9 Wood — the material step 4 ("Rebuild a neighbour") then asks
them to spend — and it lands in a tab labelled **Ores** behind a diamond icon.
Step 4's copy says *"Ruined houses can be rebuilt with wood or stone"*, which
sends a player to look under anything but gems.

**Fix.** Either a `material` kind with its own tab (wood, stone, rockfruit), or
rename the tab to something that honestly covers both — "Materials 💎" costs
nothing and stops the lie.

---

## P3 — Polish

### 10. Slide 2's "remains of your neighbourhood" are three intact cottages

`STORY_SLIDES[1]` (`index.html:1526-1533`) pairs *"…to see the remains of your
neighbourhood. Time to rebuild!"* with three copies of
`assets/Objects/Houses/Wreck.png` — which renders as a tidy gingerbread cottage
with a green roof, flowers and mushrooms. Nothing about it reads as ruined, and
three identical copies read as placeholder art. The single emotional beat of the
intro is carried entirely by the caption.

**Fix.** Vary the three (different wreck variants, or one wreck at three
scales/rotations), and darken/desaturate them for the card so the picture says
what the sentence says.

### 11. The ladder walks the trail, then turns the player round

`_placeStarterTrail` (`src/app.js:2564-2583`) is carefully built as a trail with
a destination — crates evenly spaced along the walked route to the relic chest,
"walk to the crate you can see, and from there the next one is in view, and the
last one puts the chest in view."

The ladder then completes step 1 on the **first** crate (`onStarterEvent(save,
'chest')` takes one event), and step 2 ("Break ground") re-aims the gold arrow at
`save.starterPlotAt`, which is ~18 m from Home. Measured on this spawn: crate 1
at 29 m out, plot at 18 m back. So a player who follows the chip walks out to
crate 1, turns around, walks home, and only rejoins the trail at step 3 when the
arrow falls back to the crates. The relic chest — the only tool a new player is
handed anywhere, and the reason the trail exists — is reached late, if at all.

**Fix.** Make step 1 the whole trail (*"Follow the supply crates — there's
something at the end of them"*, completing on the last crate or on the relic
chest), or carve the starter plot at the trail's far end so step 2 continues the
walk instead of reversing it. Either keeps the trail's shape intact.

### 12. "Welcome to Pocket Acres" arrives third

The greeting card is shown *after* both story slides (`index.html:1671-1680` —
deliberate, so the CTA never interrupts the story). The consequence is that the
player is welcomed to the game two screens after it started, and the card has to
carry the title, the tagline, the safety warning and the permission CTA at once.

**Fix.** Move the title/tagline to a slide 0 (or onto slide 1) and let the third
card be what it functionally is: the safety notice plus "Go to my location".

### 13. A quarter of the opening screen is dead, and on small screens the stick takes the world instead

`layOutVertically` spends slack on the stick first, then on a margin — a
deliberate, well-reasoned priority. The outcome across sizes is still uneven:

| viewport | map bottom → inventory top | what's in the gap |
|---|---|---|
| 390×844 | ~180 px | the stick, left two-thirds empty |
| 768×1024 | ~270 px | the stick, left two-thirds empty |
| 360×640 | 0 | **stick sits on the map**, over the road and ~4 cells |
| 844×390 | 0 | **stick sits mid-play-field** (see §2) |

This is `UX_AUDIT` §14 seen from the onboarding side: it is the *first* screen
the player ever sees, and on the two small sizes the first thing occluding the
world is the control they were just told to use. Worth a deliberate decision
about what lives in that band on tall screens (relic row? quick actions? a
taller viewport?) rather than leaving it as slack.

### 14. The how-to card hides the two things it describes

The card's own comment explains the design: it is shown from `create()` rather
than in the story sequence *"by then the world is up, so the player can see the
reach bubble and the tabs the card is describing behind it"*
(`src/app.js:1638-1645`). In practice the card is **645 of 844 css px tall at
390×844** and fully covers the map rect — nothing of the reach bubble, the tabs
or the objective chip is visible behind it. The closing line, *"The card at the
top gives you one task at a time"*, refers to a chip the player cannot see while
the only card on screen is this one.

**Fix.** Either shrink the card so the map's top rows show through (moving
"Reach"/"The stick" into a second page), or make the closing line unambiguous
about *which* card — and defer it to a small callout that fires once the how-to
is dismissed and the chip is actually visible.

### 15. The new fog reads as a lighting fault on the first walk

Noted as an observation on work that landed while this review was being written
(`src/fog.js`, "Fog of war: 80% black over land the player has never walked").
The onboarding trail is explicitly revealed, so the opening screen is clean —
but the first walk out to the second crate already puts a hard-edged fog
boundary on screen. Two things make it read as a bug rather than as unexplored
land:

- The edge is a crisp, **cell-aligned staircase** with no falloff: 80% black
  butting directly against fully lit ground. Every other edge in the game is
  softened deliberately — the viewport vignette, the inward noise nibble on
  road bands — so this one reads as the odd one out.
- **Objects inside the fog still draw at full detail**, merely dimmed.
  Screenshotted: two mineral rocks perfectly legible inside the black band.
  So the fog hides the terrain but not its contents, which is the opposite way
  round from what "land you have never walked" implies, and reinforces the
  "the lighting broke" reading.

**Fix.** Fade the mask over a cell or two at the boundary (the same treatment
the vignette gets), and either drop or heavily silhouette sprites on unseen
cells so the dark band reads as unknown rather than unlit.

### 16. Minor

- The `Home` label draws over the trailer's body, and the GPS ghost stands
  inside the trailer's footprint at spawn — so the "you vs your GPS" idea the
  how-to card illustrates is invisible in the one place it is first true.
- POI names hang vertically by design (`src/render.js:2536-2558`) and a long one
  is ~3 cells tall, so it sweeps across whatever is above it. On the walk out
  from spawn, "(Tourney Grounds)" ran straight through a chest two cells north
  of its own. Worth a length cap or a fade where it crosses a sprite.
- Step 2's copy — *"Tap a patch of open grass within reach"* — is accurate only
  once you're standing on the carved plot; while the arrow is still pointing
  home, a player who takes it literally taps grass wherever they are.
- The safety card is `sessionStorage`-gated, so it re-gates every session,
  full-screen, with the same "Welcome to Pocket Acres" header a returning player
  has already read. The warning is worth repeating; the welcome isn't.

---

## Suggested order

1. §3 drop the Dragon Powder test seed — one guard.
2. §5 `header: 'SUPPLIES'` for crate chests — one argument.
3. §1's copy half: fix the `🌱 Watered.` flash and step 5's body text.
4. §8 default `invCat` to a non-empty tab.
5. §4 defer `questEvent` to the reward modal's `onDismiss`.
6. §6 retire the guidance arrow once the target is on screen.
7. §7 a `body.booting` gate for the top chips.
8. §2 the `layOutVertically` floor — largest blast radius, test across the size
   matrix above.
9. §1's pacing half and §11's ladder ordering — design calls, not fixes.
