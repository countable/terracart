# UX & Visual Audit

Findings from a driven play session of the running game, not a code read-through.
Everything below was reproduced in a real browser and screenshotted.

**Method.** Chromium via Playwright against `http://127.0.0.1:7731/index.html`,
booted both in `?sandbox=true` and in the plain world, driven through the story
splash, the objective ladder, the ☰ menu, Stats & Relics, Deliveries, a chest,
a tree chop, a till/plant cycle, a house delivery, and an out-of-reach tap.
Repeated at 360×640, 390×844, 412×915, 430×932, 768×1024, 844×390 and 1280×800.
`node test/node/run.js` was green (537/537) throughout; the browser harness was
not run.

The game is in good shape — the art discipline, the reach model, the seat pass
and the onboarding ladder are all carefully done. Almost every finding here is
in two places the sweep concentrates in: **layout on viewports that aren't
390×844**, and **feedback consistency between similar actions**. Nothing found
is a gameplay bug.

Priorities: **P1** breaks or badly degrades the experience for some real
players; **P2** is visibly wrong and cheap to fix; **P3** is polish.

---

## P1 — Breaks the experience

### 1. Portrait scaling is unbounded, so tablets render an unusable HUD

`fitGame()` (`index.html:484`) branches on `vw < vh`. An iPad in portrait
(768×1024) takes the phone path and scales the 352×844 box by `768/352 = 2.18`,
producing a 768×1841 game inside a 1024-tall viewport. The result: the map
overflows ~800px off the bottom, the two-bar inventory HUD lands *on top of the
world* with map art showing through the gaps between slots, the movement stick
sits in the middle of the play field over a chest, and the pager/sort buttons
scatter across the terrain.

The landscape branch already clamps the column to `PHONE_MIN..PHONE_MAX`
(390–430). The portrait branch has no clamp at all.

**Fix.** Apply the same clamp in portrait: `s = min(vw / W, PHONE_MAX / W)`, and
centre the column horizontally with the existing `--phone-left/--phone-right`
gutters when `vw` exceeds it. That is the mechanism already built for desktop —
portrait just isn't using it.

### 2. Landscape centres on the wrong point, hiding the player

`index.html:513` computes `top = Math.min(0, (vh - scaledH) / 2)`, centring the
**844-tall game box**. But the map is centred at `viewCenterY = H/2 - 150 = 272`
(`src/app.js:471`), not at 422. On an 844×390 phone in landscape the game is
shifted up 272px and the player character ends up **29px from the top edge**,
half-hidden behind the energy chip, with no visible cells to the north.

The comment on that line reasons about "canvas-centre ≈ 422", which is where the
box centre is, not where the map centre is.

**Fix.** Centre on the map: `top = Math.min(0, vh / 2 - viewCenterY * s)`. That
puts the player at the viewport's middle in every landscape size.

### 3. The inventory HUD draws over every modal, clipping tall dialogs

`#inv-tabs`, `#inv`, `#inv-name` and `#hud` are `position: fixed` on `<body>` at
`z-index: 5–6`. Modals live inside `#game`, whose CSS transform makes a stacking
context — so a modal at `z-index: 50` can never climb above a body-level element
at `z-index: 6`. This is the exact problem the `body.modal-open #move-pad` rule
(`index.html:112`) was written for, but the gate only hides the movement stick.

Stats & Relics is the worst case: its content is taller than the viewport, the
box has no `max-height` and no internal scroll, so the Energy/Discovery header is
clipped off the top, and the **Close button is buried behind the item bar**. The
only way out is a backdrop tap on a sliver of visible wrap.

**Fix (two parts).**
- Extend the `body.modal-open` gate to the whole bottom HUD cluster, not just
  `#move-pad`. Top chips (`#money`, `#energy`) should dim or hide too.
- Give `makeModalShell`'s box `max-height: calc(100% - 32px); overflow-y: auto;
  overscroll-behavior: contain` so any long dialog scrolls inside itself.

### 4. Static overlays never set `body.modal-open`

`_installModalPadGate` (`src/app.js:7234`) watches for `.game-modal`, which
`makeModalShell` adds. The four hand-written overlays in `index.html` — `#story`,
`#safety`, `#locating`, `#howto` — don't carry that class, so the movement stick
stays live and on top underneath them. Verified: with the story card open,
`document.body.className` is empty and `#move-pad` is `display: block`.

The stick doesn't currently overlap those particular buttons, so it isn't
swallowing taps today — but it is one layout tweak away from doing so, and the
stick visibly floats over the how-to card.

**Fix.** Add `class="game-modal"` to all four, or have the gate also test
`#story, #safety, #locating, #howto` visibility.

### 5. Failed map tiles produce a silent green void

`showBanner(anyFailed && !navigator.onLine)` (`src/app.js:1637`) only surfaces a
problem when the browser reports itself offline. Every realistic failure —
captive portal, blocked or DNS-failed tile host, 5xx, corporate proxy, VPN —
leaves `navigator.onLine === true`, so the player gets a featureless green field,
no roads, no objects, no message, and no retry. The objective chip cheerfully
says *"Supply crates were left along the road nearby. Open one."* over a world
that contains neither road nor crate. The only clue anywhere on screen is
`tiles:0` in the debug HUD, which most players never see.

This was reproduced simply by running the game where the tile host isn't
reachable.

**Fix.** Drop the `!navigator.onLine` condition — show the banner whenever tile
fetches fail — and give it real copy ("can't reach the map — retrying") plus a
tap-to-retry. Suppress the objective ladder's road/crate steps while zero tiles
are ready.

---

## P2 — Visibly wrong, cheap to fix

### 6. Foraging toasts print raw item ids

`src/interact.js:790-791`:

```js
if (bonus) scene.flashLoot(`${outId}${bonus}`, '#ff8aff', 1, outId);
else       scene.flashLoot(`+1 ${outId}`, undefined, 1, outId);
```

Every other loot toast in the codebase resolves the display name first —
`src/app.js:3908`, `src/app.js:4025`, `src/interact.js:701`,
`src/interact.js:1360`, `src/interactables.js:278` all use
`ITEM_BY_ID[id]?.name || id`. The wildplant path doesn't, so picking the most
common early-game plant flashes **"+1 longgrass"** instead of "+1 Long grass",
and a treasure bonus reads "longgrass ✨gold_nugget" — raw ids with underscores.
Screenshotted.

QC_RULES §4 calls out this exact id-vs-name split.

**Fix.** `ITEM_BY_ID[outId]?.name || outId`, and the same for `treasure.bonus`.

### 7. Chopping tells you nothing about what you got

`src/interactables.js:111` flashes `"🌲 Felled birch tree."` — but the handler
just added 2–3+ wood to the bag and never says so. Mining, harvesting, fishing
and catching all show `+N <Item>` with an icon. Chopping and bush-clearing are
the odd ones out, and chopping is one of the first things the starter ladder
sends a player to do.

**Fix.** Follow the felling message with `flashLoot('+N Wood', …, 'wood')`, or
fold the yield into the message.

### 8. Text is not clamped to the canvas, so edge messages get cut in half

Neither `flash()` (`src/app.js:4121`) nor the world label passes
(`src/render.js:1826`, `1982`) clamps x against the 352px canvas — both set
`origin 0.5` at the raw screen x. Reproduced: an out-of-reach tap near the right
edge renders **"Just out o"** and nothing more. The same clips POI names — the
sandbox's "Sandbox Bike Parking" is cut on every viewport size tested, including
desktop.

**Fix.** After `setText`, clamp:
`x = Math.min(Math.max(x, tx.width/2 + 2), W - tx.width/2 - 2)`. One shared
helper covers flash text, POI labels, shop signs and crate labels.

### 9. World labels draw on top of the player

Labels are `setDepth(50)`/`(51)`; the player is `setDepth(10)` (`src/app.js:950`).
POI labels anchor *below* their sprite, so a label routinely lands on the cell
the player is standing in — "PLAYER SPAWN" sits squarely across the character in
most screenshots, and "FOREST" covers them while chopping.

QC_RULES §3 already establishes the principle for ground decals ("player
`setDepth(10)` so ground decals can't draw over the character"); labels break it
from the other side.

**Fix.** Either move `labelContainer` below the player, or fade a label to ~35%
when its rect intersects the player's screen rect. The second keeps labels
readable over buildings.

### 10. The ☰ menu panel is translucent and can't scroll

`#menu .items { background: #000c }` (`index.html:231`) is 80% black over a
bright pixel-art map. Map detail bleeds through behind 12px `#ddd` text — on a
360×640 phone the panel also overlaps the objective chip, so "How to play" and
"Deliveries" render on top of the chip's copy and become genuinely unreadable.
Screenshotted.

The panel is also `overflow: visible` with no `max-height`: at 360×640 with the
Developer disclosure open it is 481px tall starting at y=42, running under the
inventory tabs, and "Reset this game" — the destructive action — ends up sitting
on the item bar.

**Fix.** Opaque background (`#12100e`), `max-height: calc(100vh - 60px)`,
`overflow-y: auto`.

### 11. `#hud` and `#inv-name` overlap at every size

`#inv-name` is pinned at `bottom: 30px` (`src/app.js:8026`) and is ~15px tall;
`#hud` is at `bottom: 8px` (`index.html:144`) and wraps to two lines ≈26px.
They collide by ~4px at every viewport tested, and visually the selected item
name sits directly on the coordinate readout.

`#hud` is intended as an exception state (`updateHUD` blanks it when GPS is
live), but that exception is permanent on desktop and for any player who denies
location permission — which is not a rare case for a game that asks for GPS on
first launch. Those players get `49.85937, -119.47770 gps:waiting tile 2754/5566
tiles:9 caught:0 plots:5` welded to the bottom of their screen.

**Fix.** Move `#hud` above `#inv-name` (or the name below the hud), and reduce
the no-GPS variant to something a player can act on ("waiting for GPS…"), keeping
the coordinate dump behind the Developer disclosure.

### 12. Dismissing the objective chip is a 13×15px button that can't be undone

The `×` on the objective chip measures **13×15 CSS px** (`index.html:380`, styled
at `index.html:206`). Tapping it calls `Quests.starterDismiss`
(`src/app.js:4481` → `src/quests.js:199`), which sets `dismissed = true`
permanently. Nothing anywhere sets it back — there is no "Objectives" entry in
the ☰ menu — so one stray thumb on a 13px target ends the onboarding ladder for
that save forever, with no confirmation.

**Fix.** Enlarge the hit area to ≥44×44 (padding, not font size), and add a
"Show objectives" toggle to the menu. Optionally make the × collapse to a
one-line chip rather than dismiss outright.

---

## P3 — Polish

### 13. Touch targets are consistently under the 44px guideline

Measured on the live page:

| Control | Size |
|---|---|
| Objective `×` | 13 × 15 |
| ☰ summary | 34 × 30 |
| Menu rows (incl. `Reset this game`) | 140 × 26 |
| Inventory tabs | 52 × 36 |
| Item slots | 42 × 42 |
| Pager `◀ ▶ ⇅` | 28 × 42 |

None reach 44×44. For a game explicitly designed to be played one-handed while
walking outdoors, that's the wrong direction. The 26px-tall menu rows are the
sharpest risk because `Reset this game` is 26px below `+ New game`.

**Fix.** Bump vertical padding on menu rows to ~40px and widen the pager
buttons; keep the visual size and grow the hit box with padding where the layout
is tight.

### 14. Roughly a quarter of the screen is dead

`viewCenterY = H/2 - 150` (`src/app.js:471`) lifts the 352×352 map clear of the
inventory HUD, which works — but on 390×844 it leaves the map ending at y≈500
with the item bar starting at y≈706. That's ~200px of pure black containing
only the movement stick on the right; the left two-thirds is empty. Meanwhile
the objective chip overlaps the map's top row by ~14px.

Worth a deliberate decision rather than a leftover: either grow the viewport to
a non-square (e.g. 11 wide × 15 tall) so the map fills the space, move the map
down and the stick into the freed area, or put something there (the relic row,
a compass strip, a quick-action bar).

The same constant is what makes the small-phone case worse in the other
direction: at 360×640 the map runs *under* the stick, so the stick sits on the
world instead of below it. One layout that keys off the actual viewport height
would fix both.

### 15. Map sprites are hard-clipped at the viewport edge

The world container is masked to the 352×352 map rect, so building and tree art
that overhangs the boundary is sliced mid-pixel — bottom-row houses are cut
cleanly in half. The vignette (`src/app.js:898`) peaks at 15% black over 14px,
deliberately light, which isn't enough to sell the cut as intentional.

**Fix.** Either deepen the outer 3–4px of the vignette to near-opaque so art
fades out rather than snapping off, or add a short alpha-gradient band at the
mask edge.

### 16. The Deliveries list can't be read or acted on

`openDeliveryMenu` (`src/app.js:5748`) renders each row as icons + distance:
three unlabelled sprites and `224m ›`. There are no item names, no counts, no
payout, and no house identity — so you can't tell what a run needs, what it's
worth, or which of five rows is the one you can actually complete. Every other
modal ends in a button; this one has no Close affordance at all (backdrop tap
only, on a box that fills most of the width).

**Fix.** Add names and counts under the icons, show the payout, and add the
standard Close button.

### 17. House delivery offers are equally anonymous

*"The household wants the full set: +$6 for 1× [ 🪨 🪵 ]"* — icons with no names,
at ~20px against 13px body text. The `1 / 5` stepper doesn't say what the units
are (sets? items?), and `−` is not disabled at 1.

**Fix.** Label the icons, caption the stepper ("sets"), disable `−` at the floor.

### 18. No haptics anywhere

`navigator.vibrate` appears nowhere in the source. There's also no audio and no
`prefers-reduced-motion` handling. For an outdoor phone game in sunlight, where
the "Just out of reach" flash is a 12px text label that may itself be clipped
(§8), a short buzz on tap-reject and a different one on a successful pickup is
the single cheapest legibility win available.

**Fix.** `navigator.vibrate?.(15)` on accept, `(40)` on reject, gated behind a
menu toggle.

### 19. Empty inventory slots read as broken icons

An empty slot renders the neutral `·` fallback, so a fresh save shows five dark
boxes each with a faint dot. That glyph is deliberately reserved (per QC_RULES
§1) to make a *missing sprite* visible — using it for legitimately empty slots
spends the signal and makes a new player's bag look broken.

**Fix.** Render empty slots as an empty well (no glyph), and keep `·` for the
genuine missing-art case.

### 20. Minor

- The work-progress wheel is a thin white arc over the target — low contrast in
  a leafy scene, and it doesn't say which tool is in use or how long is left.
- `"🌲 Felled birch tree."` uses an evergreen glyph for every species.
- Inventory tabs with zero items (Relics, Armor on a fresh save) look identical
  to stocked tabs apart from the missing count pip.
- The energy chip is `pointer-events: none`, so the obvious "how do I refill
  this?" tap does nothing.

---

## Suggested order

The cheapest high-value batch, in order:

1. §6 display name in the forage toast — one line.
2. §8 clamp flash + label x — one shared helper, fixes both.
3. §7 wood yield toast — one line.
4. §11 move `#hud` off `#inv-name` — one CSS value.
5. §12 enlarge the objective `×` and add a "Show objectives" menu entry.
6. §3 extend `body.modal-open` to the bottom HUD + `max-height` on the modal box.
7. §5 drop `!navigator.onLine` from the tile-failure banner.
8. §1 + §2 the two `fitGame` fixes — largest blast radius, worth doing together
   and testing across the size matrix above.
