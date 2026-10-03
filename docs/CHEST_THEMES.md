# Themed chests and the Magic / Supplies split

Design intent and invariants for themed chest loot. The live tables are code:
this file states what they are for and which rules they must keep. It was
first written as an approved proposal; numbers, weights, item lists and
per-tier odds from that proposal are retired here because the code has moved
on (see [CHEST_BALANCE.md](CHEST_BALANCE.md) for the measured history).

## Purpose

Make the place predict the find. A healthcare chest helps the player recover,
a school feeds the scholar's Books, a garden helps them grow things. Loot
identity by place is the theme row; general frequency inside a group is the
catalog `dropWeight` (CLAUDE.md, "Loot identity by place").

Success: every theme yields a useful, related reward at every reachable tier,
with no empty roll and no silent cash substitute for a missing item.

## Item classes: Magic and Supplies

Potions, powders and scrolls are `magic`; practical tools and consumables are
`supply`. The class drives the inventory tab, the shop label and the loot
lanes. Being supernatural does not make a thing Magic: an item's class is its
use in the player's hands, not its flavour.

- Kinds and their tabs: `src/items.js` `ITEMS` (`kind`) and `INV_CATS`.
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
- **Quantity from value.** A stack is an allowance from `TIER_VALUE`
  (`src/items.js`) divided by the item's value, at least one, capped per item
  (`ChestThemes.quantity`, `ChestThemes.cap`). Leftover allowance pays no
  consolation coins; quantity is applied once, never on top of another
  stack formula.
- **Gear and coins keep their own paths** (`rollGearUpgrade`, `cashValue` in
  `src/rarity.js`); a theme only restricts gear slots (`ChestThemes.gearSlots`).
- **Unique finds stay unique.** Unique relics never drop to a player who
  already carries one (`ChestThemes.eligible`).
- **Books reach the scholar.** Every chest seated at T2 carries a Book share
  (`ChestThemes.BOOK_T2_SHARE`, applied last in `weights`).
- **Seeds thin out with quality.** High rolls move seed share to the related
  group rather than renormalising the row (`seedMultiplier`, `seedTransfers`).

## Underground

A cave chest keeps its surface identity for most rolls and mixes in an
underground lane (magic, field supplies, gems, the cave-only trap); the mix
and its per-tier rows live in `ChestThemes.weights` (`opts.depth`). The
rebalanced identities hold below ground too: commerce stays coins and gems.
The cave tier cap is `chestTierMaxFor` (`src/loot.js`).

## Saves

Stacks store ids and counts, so the class split needs no rewrite. Opened
chests stay opened; a chest held for later keeps its exact saved reward and
never rerolls. No per-chest theme state is saved: it derives from the POI
class and depth. No compatibility migrations (CLAUDE.md).

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
