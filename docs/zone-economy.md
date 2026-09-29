# Zone economy comparison

These are expected Home sale coins using the current Easy-mode sale formula, from no sword to a Frost sword. Background value is per 100 nominal pattern cells before clipping, not per zone or per 100 placed objects. Fixed grids and rings use their own declared footprint. Mining assumes sufficient tools. Values include normal material bonus drops; exclude shiny bonuses, POI decorations, connection materials, headstone hoards, fauna, guard loot and recurring shrine gifts. The Ancient Grove range additionally allows young/mature maple and axe variation; the table has not fixed tree maturity. Background harvesting is generally one-time, except orchard fruit. This report evaluates the declarative variant profiles used by world generation. Ordinary-rock bonus odds are read from the runtime helper; other material-yield assumptions retain the reviewed baseline.

| Variant | Background / 100 cells | Finite special finds | Find value / zone | Notes |
|---|---|---|---|---|
| Meadow | 15–15 | 3 × Wild Rose | 42–81 |  |
| Mushroom Grove | 42–75 | 1 × Starflower | 49–98 |  |
| Orchard | 61–125 | 3 × Gemfruit | 30–57 | Apple harvest repeats every 24 h; medium maples are one-time timber |
| Formal Garden | 206–383 | 2 × Wild Rose | 28–54 |  |
| Hedge Garden | 98–148 | 2 × Wild Rose | 28–54 |  |
| Ancient Grove | 65–74 | 1 × Starflower | 49–98 | Range also allows young/mature maple and axe tier |
| Stone Garden | 409–782 | 3 × Gemfruit | 30–57 |  |
| Ordered Graves | 86–163 | 2 × Gemfruit | 20–38 | Headstone hoards excluded |
| Overgrown Graves | 68–118 | 1 × Starflower | 49–98 | Headstone hoards excluded |
| Broken Masonry | 135–248 | 1 × Platinum ore rock | 202–401 | Pick T4 |
| Silent Circle | 371–708 | 1 × Starflower | 49–98 |  |
| Flint Field | 30–44 | 3 × Gemfruit | 30–57 |  |
| Broken Depot | 24–35 | 2 × Gemfruit | 20–38 | 6% trap |
| Seep | 13–18 | 1 × Starflower | 49–98 | 15.625% tar |
| Work Yard | 469–845 | 1 × Crimson ore rock | 483–965 | Pick T5 |
| Black Ring | 50–73 | 2 × Gold ore rock | 162–321 | 12.5% tar; Pick T3 |

## Main findings

- Plain rocks now have a steeper bonus-bar curve: copper stays at 12.5%, while Frost is 0.340% (1/294), three times rarer than before. One ordinary churchyard rock averages 14–27 sale coins. About 80.3% give no bonus bar. Fifteen rocks have a 5.0% chance of at least one Frost bar. Ordinary rocks remain ungated; their averages still include rare jackpots.
- Work Yard background value per unit area is: 469–845 coins per 100 cells, versus Stone Garden at 409–782 and Silent Circle at 371–708. The fixed Work Yard footprint holds about 2070–3726 background coins over 441 cells; Stone Garden holds 1803–3448 over 441 cells, before clipping and POI replacement.
- Work Yard has the largest finite reward: one Crimson rock averages 483–965 coins, versus 202–401 for the Platinum rock and 162–321 for Black Ring’s pair of Gold rocks. Gold requires an Iron pick (T3), Platinum a Gold pick (T4), Crimson a Platinum pick (T5). The existing one-tier-short slow-grind option still applies.
- Formal Garden pays well because ordinary Marigolds sell for 17–34 coins each, more than the designated Wild Rose finds at 14–27. The “special find” label does not always mean a more valuable item.
- Seep and Broken Depot have weak backgrounds. Tar and traps contribute no sale income; their income is mainly the finite find or rubble bonuses. Danger is not currently rewarded with comparable extra value.
- Fauna affinities relocate existing creatures; they do not add a guaranteed animal reward or increase total tile fauna. Guards add risk but are excluded from these material valuations.

## Ore contents

Gold: one Gold bar, 1–2 flint, 25% chance of a Sapphire. Platinum: one Platinum bar, 1–2 flint, 35% chance of a Ruby. Crimson: one Crimson bar, 1–2 flint, 40% chance of an Emerald. These are existing game drop rules; the variants declare where the rocks are placed.

## Source basis

`src/items.js`: PRICES and sale multipliers; `src/app.js`: Home sale fallback price; `src/interactables.js`: tree, fruit, mineral-rock and headstone yields; `src/interact.js`: wildplant harvesting; `src/util.js`: tree maturity and acorn rules; `tools/zone_economy.py`: report generation and remaining baseline assumptions; `docs/zone-variants.json`: densities and finite find counts.
