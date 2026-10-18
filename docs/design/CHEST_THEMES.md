# Themed chests and the Magic / Supplies split

Design intent and invariants for themed chest loot. The live tables are code:
this file states what they are for and which rules they must keep. It was
first written as an approved proposal; numbers, weights, item lists and
per-tier odds from that proposal are retired here because the code has moved
on. Simulate reward value before any change that sharply raises it; edit the
tool or the baseline, not the report.

## Purpose

Make the place predict the find. A healthcare chest helps the player recover,
a school feeds the scholar's Books, a garden helps them grow things. Loot
identity by place is the theme row; general frequency inside a group is the
catalog `dropWeight` (CLAUDE.md, "Loot identity by place").

Success: every theme yields a useful, related reward at every reachable tier,
with no empty roll and no silent cash substitute for a missing item.

## Inventory categories and reward pools

Potions, powders and scrolls are `magic`; practical tools and consumables are
kind `supply` and category `supplies`. Being supernatural does not make a thing
Magic: an item's kind is its use in the player's hands, not its flavour.

- The [glossary](glossary.md#inventory-categories-and-treasure-rewards) owns
  official category names and keys. `INV_CATS` and `invCatForItem` in
  `src/items.js` map items to those categories; `rewardCategory(reward)` exposes
  the same mapping as `reward.category` for treasure. A reward's `cls` identifies
  its handling path, which can differ from its inventory category.
- Reward pools remain separate selection subgroups. For example, `materials`
  and `gems` both award Ores; `books` awards Supplies; `medicalMagic` can award
  Magic items or Relics. Category names preserve each pool's membership and
  odds. Coins have no inventory category.
- Potion behaviour reads the item flag (`isPotion`, `src/items.js`), not the
  class. The potion shop keeps its persisted `potion` key and shows the label
  from `src/shops.js`.

## Themes

A theme is a row of reward-group weights; a group is a membership list or a
catalog query with its own fallback. Geography (world category, chest tier,
pad, art) and loot identity are separate: the theme changes contents, never a
chest's position, id, tier, sprite or cave eligibility.

- Theme rows: `ChestThemes.themes` and `ChestThemes.highTierWeights`
  (`src/chest_themes.js`); the rebalance comment above `themes` states each
  theme's one-line identity.
- Groups, members, item weights and fallbacks: `ChestThemes.groups`.
  Surface and cave gem groups use the full `GEM_DEPOSITS` ladder, deduplicated
  by item so the crystal alias does not give Sapphire extra weight.
  Furniture membership comes from catalog `kind: 'furniture'`, with one piece
  per reward regardless of budget. Culture, Commerce and Roadside reserve 10%
  for furniture in ordinary and T3+ tables; their other lanes shrink
  proportionally. Cave, rare-relic and T2 Book overlays preserve that share.
  Boss and vista pools exclude furniture. Buried `treasure:default` gives its
  furniture class the same weight as supplies. Furnishings use the ordinary
  item reward/card path and display their catalog tier.
  The supply group reaches Javelins and Renovation Permits at T4 and
  Evertorches at T6. Cooked foods inherit their raw ingredient's drop weight.
  Blank Scrolls are affordable T2 materials; a remembered spell can turn one
  into a scroll with a higher sale value. Scroll prices are not bounded by
  the parchment price; the existing learning requirement still gates writing.
- POI to theme: `CHEST_THEME_BY_POI` over `POI_CATEGORY`, read through
  `chestThemeFor` (`src/loot.js`). World categories with no theme of their
  own resolve through `ChestThemes.normalize` (its alias table; unknown
  categories land on `roadside`). Sensitive places mint no chest at all
  (`WorldGen.isSensitivePoi`), so there is no memorial theme.

Surprise comes from rarer eligible items inside a theme, never from a
universal off-theme pool. Starter crates, the starter gear chest, market
stalls and coin pots keep their own interactions.

## Selection invariants

- **Group first, then tier.** The picker draws a group from the theme row,
  then filters that group's members by the rolled tier, so a row's group
  shares hold at every tier (`ChestThemes.weights`, `resolve`, `pickItem`).
- **Eligibility is a ceiling.** A reward may sit below the rolled tier but
  stays in theme. Single-function groups pick from their highest eligible
  tier so a high roll reaches the better item; `mixedTiers` groups keep lower
  tiers in play (`selectableIds`, `pickItem`).
- **Fallbacks stay related.** A group with no eligible item hands its draw to
  its declared fallback; the draw keeps its probability and never rerolls the
  chest or turns into coins by default. Every path must reach a T1 terminal;
  `ChestThemes.validate` checks every theme, tier and depth for cycles and
  conservation at load, and a runtime failure uses the row's `t1Fallback`.
- **Quality before contents.** The quality roll (`rollRewardQuality`,
  `src/rarity.js`) is not capped by a thin pool, and the displayed chest
  tier is not a guaranteed item tier beyond `ChestThemes.qualityFloor`.
- **One chest, one reward.** An ordinary chest gives one item stack, one gear
  piece or coins (`pickChestReward` / `resolveChestReward`).
- **Quantity from the roll budget.** Every reward roll (chests, X marks,
  shrine, vista, road prize, elite drops) sizes its stack the same way: the
  rolled tier's `TIER_VALUE` (`src/items.js`), plus half of it per budget
  bracket (`ChestThemes.budget`), times the item's `BUDGET_SHARE` (potions and
  other magic 0.4, seeds 0.8, everything else 1), divided by the item's
  value, at least one, capped per item (`ChestThemes.quantity`,
  `ChestThemes.cap`). Mushrooms round up to fill their allowance, as magic and
  timber seeds do, so a T2 chest's lower-tier budget roll still buys a stack.
  Fish prices control stack sizes; cooked prices derive from raw ingredients.
  Chest food rewards have a minimum allowance of the displayed chest tier's
  base budget. A T2 roll may still select T1 food, but spends at least the T2
  allowance rather than the smaller T1 budget with one bonus bracket. This
  floor changes quantity, not eligibility, item caps, or other reward kinds.
  A same-tier roll with no brackets typically pays two
  potions or four seeds. Budget steps (the chain, the wizard's ladder and
  budget jackpots) only raise the budget, with no bracket cap; leftover
  budget pays no consolation coins, and no caller adds a bonus on top. Wood
  and rubble use the same budget conversion and item caps. Breakable containers pass their
  explicit coin allowance through `ChestThemes.quantityForBudget`, sharing
  the same item prices, shares and caps (including wood/rubble). POI density
  sets their full chance and allowance; see [generation](generation.md).
- **Gear and coins keep their own paths** (`rollGearUpgrade`, `cashValue` in
  `src/rarity.js`; a purse pays the whole budget); a theme only restricts
  gear slots (`ChestThemes.gearSlots`).
- **Unique finds stay unique.** Unique relics never drop to a player who
  already carries one (`ChestThemes.eligible`).
- **Books reach the scholar.** Every chest seated at T2 carries a Book share
  (`ChestThemes.BOOK_T2_SHARE`, applied last in `weights`).
  Books become ineligible when lifetime Books collected (`booksRead`) exceed
  lifetime recovered memories (keys in `discovered`) plus three. At equality
  one more Book can drop; another memory then reopens eligibility. Blocked
  Book lanes, including fallback paths, yield their existing Torch fallback.
  Purchases and already saved chest rewards are unaffected; this paces new
  chest rolls rather than guaranteeing one Book per memory.
- **Seeds thin out with quality.** High rolls move seed share to the related
  group rather than renormalising the row (`seedMultiplier`, `seedTransfers`).

## Underground

A cave chest keeps its surface identity for most rolls and mixes in an
underground lane (magic, field supplies, gems, the cave-only trap); the mix
and its per-tier rows live in `ChestThemes.weights` (`opts.depth`). The
rebalanced identities hold below ground too: commerce stays coins, gems and furniture. Its cave share adds gems while
the furniture lane remains 10%.
The cave tier cap is `chestTierMaxFor` (`src/loot.js`).

## Saves

Stacks store ids and counts, so the class split needs no rewrite. Opened
chests stay opened; a chest held for later keeps its exact saved reward and
never rerolls. No per-chest theme state is saved: it derives from the POI
class and depth. `normalizeInventoryCategory` translates older saved inventory-tab
keys to the official keys; item ids, counts and equipment storage stay intact.

## Poison, Antidote, Elixir, magical flowers

The proposal also introduced poison, the Antidote, the Elixir and slower
magical flowers. Their owners now:

- Poison is a row of `Conditions.DEFINITIONS` (`src/conditions.js`); the
  purple slime's bite carries it (`src/combat.js`). It drains through
  `Energy.set`, outside armour and difficulty.
- Antidote and Elixir are catalog rows in `src/items.js`; their effects are
  the potion actions.
- Crop stage waits derive from the crop's tier through `Crops.stageHoldMs`
  (`src/crops.js`), shared by growth, countdowns and descriptions.

## Tooling and tests

Tools read the same tables and picker as the game, never a copy:
`tools/simulate-chest-themes.js`, `tools/balancing.html`,
`tools/item-catalog-data.js`, `tools/items.html`. Regression tests:
`test/node/chest_themes.test.js`, `loot.test.js`, `cave_chest_cap.test.js`,
`conditions.test.js`, `crops.test.js`.

Any change that raises a theme's mean reward value sharply needs an explicit
balance decision from a seeded simulation, never a quiet edit to a row.
Full Measure is the wizard's budget upgrade: three levels raise the chance of
one extra budget bracket linearly from 0% to 35%. A bracket adds 50% of the
rolled tier's base budget; it does not directly multiply stack size or promote
item tier. Category shares, rounding and item caps still apply. The saved
`qtyUpgrades` field and `measure` track key retain their names for compatibility.

Full barrels favor practical supplies: two thirds of successful rolls use the
ordinary supply pool (including torches, rope and trap-disarm kits), with one
sixth each for ores and produce. This conditional mix is independent of
the tile-density fullness chance and budget. Clay pots keep their own mix.
