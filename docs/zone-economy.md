# Zone economy comparison

These are expected Home sale coins using the current Easy-mode sale formula, from no sword to a Frost sword. Background value is per 100 nominal pattern cells before clipping, not per zone or per 100 placed objects. Fixed grids and rings use their own declared footprint. Mining assumes sufficient tools. Values include normal material bonus drops; exclude shiny bonuses, POI decorations, connection materials, headstone hoards, fauna, guard loot and recurring shrine gifts. The Ancient Grove range additionally allows young/mature maple and axe variation; the table has not fixed tree maturity. Background harvesting is generally one-time, except orchard fruit. This report evaluates the design table; the variants are not live world generation.

| Variant | Background / 100 cells | Finite special finds | Find value / zone | Notes |
|---|---|---|---|---|
| Meadow | 51–88 | 3 × Wild Rose | 42–81 |  |
| Mushroom Grove | 31–55 | 1 × Starflower | 49–98 |  |
| Orchard | 36–64 | 3 × Gemfruit | 30–57 | Apple harvest repeats every 24 h |
| Formal Garden | 80–144 | 2 × Wild Rose | 28–54 |  |
| Hedge Garden | 57–77 | 2 × Wild Rose | 28–54 |  |
| Ancient Grove | 23–26 | 1 × Starflower | 49–98 | Range also allows young/mature maple and axe tier |
| Stone Garden | 404–783 | 3 × Gemfruit | 30–57 |  |
| Ordered Graves | 172–334 | 2 × Gemfruit | 20–38 | Headstone hoards excluded |
| Overgrown Graves | 125–233 | 1 × Starflower | 49–98 | Headstone hoards excluded |
| Broken Masonry | 250–476 | 1 × Platinum ore rock | 202–401 | Pick T4 |
| Silent Circle | 424–828 | 1 × Starflower | 49–98 |  |
| Flint Field | 30–45 | 3 × Gemfruit | 30–57 |  |
| Broken Depot | 24–35 | 2 × Gemfruit | 20–38 | 6% trap |
| Seep | 8–12 | 1 × Starflower | 49–98 | 10% tar |
| Work Yard | 322–578 | 1 × Crimson ore rock | 483–965 | Pick T5 |
| Black Ring | 24–35 | 2 × Gold ore rock | 162–321 | 8% tar; Pick T3 |

## Main findings

- Plain rocks are the biggest balance surprise. A single ordinary churchyard rock has expected sale value 28–55 coins because it independently rolls every bar tier, including Frost at 1/98. Most rocks (about 76.6%) give no bar; the average is driven by rare high-value outcomes. Fifteen stones have about a 14.3% chance of at least one Frost bar. Ordinary rocks have no pick-tier gate.
- Silent Circle is richest per unit area, followed by Stone Garden. Work Yard has more total background wealth because its fixed footprint is larger: about 3,090–5,550 background coins over 961 cells, versus Stone Garden’s 1,780–3,451 over 441 cells, before clipping and POI replacement.
- Work Yard has the largest finite reward: one Crimson rock averages 483–965 coins, versus 202–401 for the Platinum rock and 162–321 for Black Ring’s pair of Gold rocks. Gold requires an Iron pick (T3), Platinum a Gold pick (T4), Crimson a Platinum pick (T5). The existing one-tier-short slow-grind option still applies.
- Formal Garden pays well because ordinary Marigolds sell for 17–34 coins each, more than the designated Wild Rose finds at 14–27. The “special find” label does not always mean a more valuable item.
- Seep and Broken Depot have weak backgrounds. Tar and traps contribute no sale income; their income is mainly the finite find or rubble bonuses. Danger is not currently rewarded with comparable extra value.
- Fauna affinities relocate existing creatures; they do not add a guaranteed animal reward or increase total tile fauna. Guards add risk but are excluded from these material valuations.

## Ore contents

Gold: one Gold bar, 1–2 flint, 25% chance of a Sapphire. Platinum: one Platinum bar, 1–2 flint, 35% chance of a Ruby. Crimson: one Crimson bar, 1–2 flint, 40% chance of an Emerald. These are existing game drop rules; the variants declare where the rocks are placed.

## Source basis

`src/items.js`: PRICES and sale multipliers; `src/app.js`: Home sale fallback price; `src/interactables.js`: tree, fruit, mineral-rock and headstone yields; `src/interact.js`: wildplant harvesting; `src/util.js`: plain-rock base drops, tree maturity and acorn rules; `docs/zone-variants.json`: densities and finite find counts.
