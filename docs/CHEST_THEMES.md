# Themed chests and the Magic / Supplies split

**Status: approved for implementation.** Numeric defaults and behavior were approved in the design review; the implementation and balance report verify them.

## Purpose

Make the place predict the find. A healthcare chest should help the player recover; a garden should help them grow things. Separate potions and powders from practical supplies throughout loot, inventory and tooling.

Success means every supported chest theme can produce a useful, related reward at every reachable tier, without an empty roll or an automatic cash substitute for a missing item.

## Scope

This proposal covers item classification, chest contents, tier gaps, quantities, underground variants, inventory tabs, save compatibility and balancing tools. It adds an Antidote and an Elixir, with distinct item art, plus poison and longer magical-flower growth times. Other items keep their existing art. Each ordinary chest still awards one item stack, one gear piece or cash; mixed bundles are a separate future feature.

The baseline is the current working branch at `47d7f4f` (walking gear, road rewards and item catalogue), plus the shared reward/damage refactor already merged into `main` at `625a91e`. Implementation must integrate those lines of work before changing their shared files. The recent road-prize redesign is retained; the chest proposal does not replace it with the older seed-heavy road pool.

The numbers below are proposed balance settings, not measured current behavior.

## 1. Item classes

| Class | Contents | Inventory tab |
|---|---|---|
| `magic` | Existing nine potions and four powders, plus Antidote and Elixir | Magic |
| `supply` | Honey, Book, Rope, Torch, Trap Disarm Kit, Magic Trap, Scarecrow | Supplies |
| Existing classes | Seeds, produce, saplings, animals, minerals and gear retain their classifications | Existing tabs |

Magic Trap stays a supply: the requested magic class means potions and powders, not everything with a supernatural effect. The Crow Feather keeps its existing class and revival behavior. Item IDs, prices, effects, icons and carried quantities remain unchanged.

`isPotion` reads catalog membership rather than the old consumable kind. Potion fire interactions, channelling and the Use button continue to dispatch to their existing actions. Both new kinds join fort prizes and the sandbox inventory.

## 2. Chest themes and proposed probabilities

Weights below sum to 100% per row. They select a themed reward group. Item eligibility and the explicit fallbacks in section 4 determine the final item. Thus a low-tier garden may turn a flower-seed draw into ordinary flowers, but never an unrelated coal drop.

| Theme | Normal surface tier | Reward-group weights |
|---|---:|---|
| Roadside / shelters | 1 | Supplies 45%; building materials 40%; cash 15% |
| Commerce | 1 | Cash 60%; supplies 25%; provisions 15% |
| Food | 1 | Food 80%; matching crop seeds 15%; Honey 5% |
| Parks / recreation | 2 | Seeds 45%; saplings/acorns 25%; forage 20%; Growth Powder 10% |
| Farms | 3 | Crop seeds 40%; produce 30%; farm animals 15%; farm supplies 10%; Growth Powder 5% |
| Gardens / flora | 4 | Flower seeds 45%; flowers 30%; saplings/acorns 15%; Growth Powder 10% |
| Healthcare | 3 | Recovery magic 35%; Antidote 25%; revival magic 20%; restorative food 10%; Shielding 10% |
| Schools / libraries | 3 | Books 55%; exploration supplies 15%; study magic 20%; noncombat gear 10% |
| Museums / culture | 3 | Gear 35%; gems 30%; Books 25%; study magic 10% |
| Worship | 3 | Revival magic 50%; Shielding 25%; Books 15%; flowers 10% |
| Memorials / cemeteries | 3 | Raven/Shadow magic 55%; flowers 25%; Books 15%; gems 5% |
| General civic | 3 | Supplies 35%; cash 30%; Books 20%; noncombat gear 15% |
| Police / fire stations | 3 | Protective gear 40%; field supplies 40%; healing magic 15%; cash 5% |
| Pet locations | 3 | Companion animals 70%; animal food 20%; supplies 10% |

These replace the vague 80/15/5 suggestion with specific, reviewable rows. Surprises come from rarer eligible items within each theme. There is no universal off-theme surprise pool.

**Material balance changes:** schools become more reliable Book sources; healthcare becomes a reliable recovery destination; roadside boxes concentrate on supplies/materials; gear moves toward cultural and protective locations. These changes intentionally replace the current class odds.

## 3. What each reward group contains

Every named group is an explicit, tier-filtered list or a catalog query with clear membership. An item's general class alone never determines its suitability for a theme.

| Group | Proposed contents |
|---|---|
| General supplies | Torch, Rope, Trap Disarm Kit, Honey; Torch weight 3, others weight 1 |
| Exploration / field supplies | Torch, Rope, Trap Disarm Kit; equal weights |
| Farm supplies | Scarecrow, Honey; equal weights |
| Building materials | Wood or stone (`rockfruit`); equal weights |
| Provisions / restorative food | Berry, cress, potato, egg, milk; equal weights. Honey is an animal lure, not a healing item. |
| Food | Existing edible produce, excluding materials, flowers, feathers and live animals; when its recognized venue product is eligible, choose it 70% of the time and use the ordinary food pool for the other 30%; otherwise use that pool for all draws |
| Matching crop seeds | Seeds for the food group's growable crops; if a venue product has no seed, use its food instead |
| Park seeds | Kitchen-garden crop seeds; exclude stone and magical flower crops |
| Farm seeds / produce | Growable food crops; exclude stone and magical flower crops |
| Flower seeds | Sunflower, Fireflower and Iceflower seeds; use the catalog's actual tiers |
| Flowers / forage | Flowers, Forget-me-not, Marigold, Wildrose, Starflower, Sunflower, Fireflower, Iceflower; park forage excludes magical flowers and also includes berries and mushrooms |
| Saplings / acorns | Acorn, Apple Sapling, Peach Sapling |
| Farm animals | Chicken, cow, rabbit; equal weights among eligible entries |
| Companion animals | Cat, dog, rabbit; equal weights among eligible entries |
| Animal food | Existing cat/dog/rabbit feeding items, resolved from the feeding rules |
| Recovery magic | Vigor T2; Elixir T6; food fallback at T1 |
| Antidote | Antidote T1; one per chest |
| Healing magic (protective locations) | Vigor weight 3, Revival weight 2, Resurrection weight 1; Elixir from T6 |
| Revival magic | Revival weight 3, Resurrection weight 1 |
| Study magic | Reach weight 2, Raven weight 1, Shielding weight 1 |
| Raven / Shadow | Raven Potion and Shadow Powder; equal weights |
| Gems | Sapphire, Ruby, Emerald, Diamond |
| Noncombat gear | Amulet, bags, watering can, hoe, fishing rod, bug net; equal slot weights |
| Protective gear | Armor slots only, equally weighted |
| Cultural gear | Existing chest gear pool, excluding the wizard-exclusive Ring |

For each item group, first select the highest eligible item tier, then apply the stated weights within that tier. Missing tiers fall downward. This lets a T5 revival draw reach Resurrection instead of being permanently diluted by lower-tier Revival. Healthcare gives recovery magic its own 35% group: Vigor at T2–T5, Elixir at T6+. This keeps immediate restoration separate from revival. Antidote has its own 25% group and remains eligible at every tier.

Books have an explicit weight through their group; the old additional 70% school-favorite roll is removed for themed chests. The same applies to the old Torch favorite: one table owns its probability. Catalog `dropWeight` remains the default for groups without an explicit item weight.

### Mapping real locations

Keep the existing geography/tier category separate from the new loot theme. The new theme changes contents, not chest positions, IDs, tiers, sprites or underground eligibility.

- Existing food, commerce, low-tier, park, farm, health and school categories select their corresponding themes.
- Gardens select flora. Florists and garden centres retain their retail behavior where they already resolve to stalls.
- Museum, art gallery, cinema and theatre select culture.
- Place of worship selects worship; cemetery, memorial and monument select memorial.
- Police and fire station select protective/field rewards.
- Pet locations select companions.
- Remaining civic locations, including town halls, information points, attractions and harbors, select general civic.
- Unknown categories keep the existing default world tier and use the roadside theme.

Surface market stalls remain shops with a known product and price. Coin-burst pots retain their own interaction. Their underground mirrors, where present, use chest themes. Starter crates and the starter gear chest keep their fixed contents.

## 4. Tier gaps and low-tier fallbacks

**Eligibility is a ceiling, not an exact match.** A reward may be below the rolled tier, but it stays within the theme. No new potions are needed merely to fill every tier.

The existing catalog has no T1 potions or powders; the proposed Antidote adds a T1 medicine. Honey is a T2 animal lure, not a restorative food. Berry, cress, potato and egg are existing T1 restorative foods.

| Function | Current item tiers | Proposed gap handling |
|---|---|---|
| Immediate energy restoration | Food from T1; Vigor T2; proposed Elixir T6 | Food at T1; Vigor at T2–T5; Elixir at T6+ |
| Revival while downed | Revival T2; Crow Feather T3; Resurrection T5 | Revival through T4; Resurrection from T5. T1 food is only a related fallback, not equivalent revival |
| Damage protection | Shielding T2 | Food or field supplies at T1; retain Shielding above T2 |
| Crop growth magic | Growth Powder T2 | Seeds/flowers/farm supplies at T1; retain Growth above T2 |
| Concealment / raven | Shadow T2; Raven T3 | Flowers at T1; Shadow at T2; Raven from T3 |
| Magical flower growing | Sunflower seeds T4; Fireflower T5; Iceflower T6 | Ordinary flowers below T4; retain Iceflower at T7 |
| Gems | Sapphire T4; Ruby T5; Emerald T6; Diamond T7 | Books/flowers/field supplies below T4, depending on theme |

**A real gap remains:** food cannot revive a downed player in hard mode, and Vigor is not a substitute for a revival potion. This proposal does not promise functional revival in a T1 reward. Adding a new T1 revival item would be a separate balance decision; the existing Crow Feather is T3.

For a group with no eligible item, transfer that draw to the following fallback. Preserve the original group probability; do not reroll the entire chest or silently turn it into money.

| Missing group | Fallback |
|---|---|
| Vigor / healing / revival magic, Honey | Restorative food |
| Shielding | Restorative food for healthcare/worship; field supplies elsewhere |
| Study magic / school gear | Book |
| Raven / Shadow magic | Flowers |
| Gems | Book in cultural chests; flowers in memorial chests |
| Other unavailable gear | The theme's supplies; Book for cultural gear |
| Flower seeds / garden Growth Powder | Flowers |
| Park Growth Powder / saplings | Park seeds |
| Farm Growth Powder | Farm supplies |
| Garden saplings | Flowers |
| Unavailable farm / companion animal | The corresponding food group |
| Generic Supplies / Books outside school | Torch |

School Books retain the existing explicit T1 exception, capped at one: the school near Home still teaches. Cultural, memorial and worship Books obey their actual tier and fall back as listed. These exceptions are rows in the theme data, not hidden code branches.

Food, seed, flower, Torch and building-material fallback groups have T1 members. Validate the fallback graph for cycles and terminal coverage at startup in development and in tests. Invalid authored themes must fail validation; release code can use the theme's declared T1 fallback and record an error rather than dropping a claimed chest's reward.

## 5. Quality and quantities

Retain the current Home downgrade, cave depth bonus, Ring luck, quantity upgrades and 16% jackpot entry / 25% continuation rates. Retain the existing tier-versus-quantity chain split: the effective chest tier is not a guaranteed minimum item tier. Roll quality before resolving the group's item pool. A thin pool must not cap the quality roll: a T4 school can spend quality on useful lower-tier items even though supplies stop at T2.

Use the existing `TIER_VALUE` table as the allowance for extra copies: T1–T7 currently map to 2, 8, 25, 70, 160, 360, 800. This is a quantity allowance, not a cash payment or a promise of equal resale value.

For ordinary item stacks:

`allowance = TIER_VALUE[rolledTier] × (1 + 0.5 × quantityBracket)`

`quantity = min(itemCap, max(1, floor(allowance / itemValue(item))))`

The current bracket cap remains 3. A valid themed item always pays at least one even if it costs more than the allowance. Allowance left after a quantity cap produces no consolation coins. Quantity and tier use the same rolled quality; do not also apply the old per-bump stack formula.

| Item group | Maximum quantity per chest |
|---|---:|
| Potions and powders | 3 |
| Resurrection Potion, Elixir, Antidote | 1 |
| Books, live animals, saplings, Scarecrows, gear | 1 |
| Honey, Torch, Rope, Trap Disarm Kit | 5 |
| Food and ordinary flowers | 5 |
| Ordinary crop seeds | 9 |
| Magical flower seeds | 1 |
| Magical flowers | 3 |
| Wood and stone | Existing material bundle rule: 3–8 base plus 2 per bracket, capped at 12 |
| Gems | 1 |
| Metal bars, if a future theme adds them | 3 |

Gear keeps its existing chest-tier roll, slot ownership checks and duplicate cash-out. Restrict its slots through the theme; do not create another gear-equip path. T1 chest rolls still exclude gear. Cash groups keep the existing cash value/jitter/cap rule. The quantity allowance does not multiply either path a second time.

Examples, without quantity bonuses:

- A T1 healthcare draw resolves to restorative food; it cannot produce Vigor or Honey.
- A T2 healing draw can pay one Vigor or Revival potion.
- A T3 healing draw still pays one of those T2 potions: no unrelated Blight substitution.
- A T4 Vigor draw pays two (`floor(70 / 35)`); a T4 Revival draw pays one (`floor(70 / 40)`).
- A T5 revival draw pays one Resurrection potion. A T5 Vigor draw pays three Vigor potions. The separate groups preserve both recovery functions.
- A high-tier school still pays one Book on a Book draw. Its other groups provide the tier-driven variety.

The allowance curve and caps are proposed defaults. Simulation must report the resulting value changes before these settings ship; exact economic equivalence is not claimed.

## 6. Underground chests

Keep each chest's surface identity for **60%** of rolls. Use an underground reward group for **40%**. This replaces the existing additive cave class weights, which can wash out the surface theme.

| Cave roll tier | Distribution within the underground 40% |
|---|---|
| T1 | Antidote 60%; Torch 40% |
| T2 | Magic 60%; Torch 15%; Rope 10%; Trap Disarm Kit 10%; Magic Trap 5% |
| T3+ | Magic 80%; gems 10%; field supplies 10% |

The cave magic pool contains all eligible potions and powders. For this pool, choose from the highest eligible tier 70% of the time and all lower eligible tiers 30% of the time, with equal item weights inside each pool. If the lower pool is empty, use the highest pool. This explicit exception to the general highest-tier rule keeps powders and utility potions available even when Resurrection is the highest-tier magic item. The gem group follows the same rule. Missing deep gems fall back to field supplies. Magic Trap remains cave-only and caps at one.

The cave component alone now contributes a 24% magic chance at rolled T2 and 32% at rolled T3+, plus any magic from the location component. These are conditional on rolled tier, not the chest's displayed tier. A T2 cave chest retains a 2% overall Magic Trap chance (`40% × 5%`). At rolled T1, Antidote contributes a 24% overall magic chance from the cave component. Include Antidote in the lower-tier magic pool at deeper levels; healthcare remains its most reliable location source. A school underground remains a useful Book destination instead of losing its specialty to a global favorite override. Existing rules still determine which surface chests have underground mirrors.

## 7. Other reward systems and the UI

The class split applies everywhere, while the new thematic selection and quantity policy apply to ordinary chests.

- Road rewards retain their latest choices, walking emphasis and first-prize behavior. Retain the previously requested 50% cash reduction relative to the pre-refactor road cash formula, applied exactly once; reconcile the latest road redesign against that baseline during integration. Split their current 25% consumable share into Magic 22.5% and Supplies 2.5%, preserving the combined share. Keep the existing named potion preference within Magic. Antidote now fills T1 Magic; if a future catalog leaves a magic pool empty, use one Torch. Do not restore an older road table during integration.
- Ordinary buried treasure assigns its current 15% consumable weight to Supplies. Tier/jackpot rules stay intact. This intentionally removes occasional generic magic from a basic buried X; cave X rewards retain their existing cave probabilities through a compatibility group over the union of Magic and Supplies. That group is a loot pool, not a restored inventory class; returned `cls` identifies the actual item kind.
- Elite drops assign their current 15% consumable share to Magic. If its rolled tier has no magic, use one Torch (Antidote now fills T1); their gear/mineral shares stay intact.
- Legacy `shop:*` simulation contexts split their old consumable weight equally between Magic and Supplies. Empty Magic pools fall back to Supplies; Antidote now fills T1. Production themed shops retain their current stock rules and prices. Label the potion/powder shop "Magic Shop" while preserving its persisted theme key.
- Fort slots include both kinds and keep their existing stake, quantity and payout formulas. This avoids changing slot economics as a side effect of classification.
- Existing shared Use/Drink, book-reading and reward-grant code remains the execution path.

Inventory replaces Items with **Magic** and **Supplies**. Reuse current item icons. Check all eight tabs at 320px, 390px and 430px widths; allow horizontal category scrolling if the labels no longer fit. The item catalogue exposes both classes and theme-specific sources. Balancing reports show class and theme separately.

## 8. Save compatibility

Existing stacks store item IDs and counts, so the class split changes their catalog interpretation without rewriting inventory.

Bump `SaveMigrate.SAVE_SCHEMA`. When `save.invCat` is `consumables`, move to the selected item's new tab, otherwise Supplies, and reset `invPage`. Preserve the selected item, stack counts, gear and all other progress. Migration must be idempotent.

Opened chests stay opened. A chest held for later keeps its exact saved item, quantity and consolation; it does not reroll under the new theme. Already cached held rewards from the old rules remain valid. Unopened chests use the new rules. Persist no new per-chest theme state; derive it from the existing POI class and depth.

## 9. Implementation structure

| Owner | Responsibility |
|---|---|
| `items.js` | Magic/Supplies kinds and tabs; potion predicate; reusable catalog group membership |
| New `chest_themes.js` | Theme rows, reward groups, tier exceptions, fallback graph and quantity caps |
| `loot.js` | POI-to-theme resolver, separate from existing world category/tier and chest art |
| `rarity.js` | Shared quality roll; theme-constrained selection; generic non-chest class updates |
| `rewards.js` | Apply the chosen reward once; preserve actual accepted quantities and deferred Book behavior |
| `interactables.js` | Ask for the chest's theme; retain full-bag take/leave decisions and opened-state handling |
| `app.js`, `shops.js`, `sandbox.js` | Inventory/fort/label integration; existing use actions |
| `savemigrate.js` | Old tab migration and schema version |
| `tools/balancing.html`, `tools/item-catalog-data.js`, `tools/items.html` | Shared resolver for probabilities, eligible contents and sources |
| `index.html`, browser harnesses, node runner | Register the new module in dependency order; regenerate cache hashes |

Prefer one `pickChestReward(theme, save, rng, {tier, depth})` entry point. Extract shared quality arithmetic from `pickReward` rather than duplicating the chain/jackpot logic. Give the theme picker its own reward RNG stream while preserving generated chest identities and existing unrelated spawner streams. Keep the existing reward shape (`kind`, `id`, `qty`, gear fields, gold amount), with `cls` reflecting the actual new item kind. Tooling must query this same theme data and eligibility logic rather than reimplementing it.

## 10. Validation and release

1. Inventory tests cover every potion/powder and every supply, old-tab migration, unchanged actions and fort membership.
2. Exhaustive theme tests cover every theme, T1–T7 and surface/cave modes: valid items, no forbidden kinds, no null outcomes, no fallback cycles, explicit T1 exceptions only.
3. Quantity tests pin the healthcare examples, caps, actual price lookup, no double quantity scaling and no automatic leftover cash.
4. Behavior tests cover starter fixed rewards, retail stalls, coin pots, duplicate gear, full-bag partial takes, held rewards and deferred Books.
5. Seeded simulations use at least 50,000 rolls per theme/tier/mode. Report final class and item shares, fallback frequency, mean/95th-percentile item value, gear cash-outs and quantity distributions. Compare against the current baseline. Any mean value increase over 20% requires an explicit balance decision before release; do not silently alter the reviewed theme percentages to hide it.
6. Browser checks cover narrow inventory tabs, a T1 healthcare chest, a high-tier healing chest, school Books, a cave supply drop, and reopening a held chest.
7. Run the headless suite and cache/sprite/layout audits, then review the item catalogue for misleading sources or missing classes.

Implement on an isolated branch after review: taxonomy and migration; theme data and picker; integration and tools; balance simulation and browser checks. Commit and publish only after the agreed settings and validations are complete.

## Review decisions

The proposed defaults are:

- Fourteen location themes with the exact weights above, including splits of the broad civic category.
- Two new items: T1 Antidote and T6 Elixir. Restorative food still covers the T1 energy-restoration gap.
- Up to three ordinary potions/powders per chest; one Antidote, Elixir, Resurrection potion or Book.
- A 60% location / 40% underground mix, with 60% Magic inside the T2 cave pool and 80% inside T3+.
- A quantity allowance derived from `TIER_VALUE`, with unused allowance discarded.
- Schools guarantee that their Book group can work even at T1; other groups obey their tier ceiling.

These are the settings to review before implementation. The simulation report is the second review point if the new specialization materially raises payouts.

## 11. Poison, Antidote and Elixir

This revision replaces the earlier candidates for extra Vigor potions, Wildflower Seeds and Glimmer Powder. None of those candidates are included.

### Poison from Purple Slimes

- A successful hostile Purple Slime bite that deals energy damage applies poison. This includes hostile variants inheriting that kind, not tamed slimes. Proposed application chance: 100%; the bite's existing damage remains.
- Poison drains exactly 1 energy every 2 seconds for 60 seconds: 30 ticks and 30 energy maximum from one application, before other recovery. The first tick occurs after 2 seconds.
- Further bites refresh the remaining duration to 60 seconds. They do not stack damage or reset the next tick, so repeated bites cannot indefinitely postpone ticking.
- Poison damage bypasses armor and Shielding and does not scale with difficulty. Those still affect the initial bite; a fully prevented bite applies no poison.
- Energy floors at zero; poison can down the player. While downed, the timer continues but ticks cannot take energy below zero. Reviving does not remove remaining poison.
- Proposed timer policy: count active gameplay time only. Save remaining duration and the next-tick offset; pause while the app is suspended. No retroactive offline damage on return. Ordinary in-game inventory/dialog use does not pause it.
- Food, Vigor, Elixir, resting and Home can restore energy under their usual rules but do not cure poison. It ends through expiry or Antidote.
- Show a poison indicator with remaining time and `−1 energy / 2s`, a clear first-application message, and the normal energy-loss feedback. Keep countdown and tick values derived from the same condition definition.

Implement a small data-driven condition module, initially with poison only. It owns application, refresh, ticking, curing and persisted state; enemy rows reference the condition. Route energy changes through `Energy.set`, not a second damage or energy store.

### Antidote

- T1 Magic item, proposed value 12 gold, one per chest. Instantly removes poison without restoring energy or granting immunity.
- Healthcare receives a dedicated 25% Antidote group, unaffected by item-tier gaps; caves provide a secondary source as described above.
- Usable while poisoned, including while downed, but does not revive. If there is no poison, keep the item and explain that no cure is needed.
- No food cooldown requirement or new cooldown. A subsequent bite can poison the player again.
- Antidote is classified as a potion, with distinct art and explicit cure behavior; it receives no fire-transmutation recipe by default.

### Elixir

- Recommend T6: it gives recovery a new high-tier reward above the existing T5 Resurrection potion. Proposed value 360 gold; one per chest.
- Instantly set energy to the player's current maximum, including permanent upgrades. No cooldown of its own; usable during the food cooldown without resetting or clearing that cooldown.
- Proposed scope: use while standing. It does not revive or cure poison; preserve Resurrection's separate purpose. At full energy, keep the Elixir rather than wasting it.
- Healthcare's recovery group chooses Elixir at rolled T6+, Vigor at T2–T5, and food at T1. Cave magic pools also include it from T6. Existing shop eligibility rules can include it without introducing guaranteed stock.
- Its full refill uses the existing energy/reward/UI paths and a shared maximum-energy calculation.

## 12. Rarer seeds and slower magical flowers

### Chest probabilities

After rolling reward quality, scale seed-group probability by the following factor. Apply to all ordinary chest seed groups, not just gardens. Do not silently renormalize every other group: explicitly transfer the removed probability to the related group listed below.

| Rolled reward tier | Seed probability multiplier |
|---|---:|
| T1–T3 | 1.0 |
| T4 | 0.5 |
| T5 | 0.33 |
| T6–T7 | 0.25 |

Food seed probability transfers to food; park seeds to forage; farm seeds to produce; garden seeds split the removed probability equally between Growth Powder and saplings. Apply normal tier eligibility/fallbacks after selecting the resulting group. The cave component contains no seed group; scale the location component before mixing it with the cave component.

Example: gardens' base 45% flower-seed chance becomes 22.5% at rolled T4, 14.85% at T5, and 11.25% at T6–T7. These are surface probabilities conditional on rolled quality, not unconditional odds for a displayed chest tier. Magical flower seeds award one seed rather than up to three. Other sources and existing owned seeds remain unchanged.

Direct flower rewards still exist. Their odds and crafting contribution must be included in the balance report: making seeds rarer alone does not make all magical-flower materials equally rare. Report harvested seed returns too; repeated planting may eventually make chest supply less important.

### Growth times

There are four growth stages, each normally requiring watering and a wait. Proposed ordinary timers:

| Crop | Tier | Wait per stage | Base time through four stages |
|---|---:|---:|---:|
| Existing T1–T3 crops | 1–3 | 15 minutes | 1 hour |
| Sunflower | 4 | 1 hour | 4 hours |
| Fireflower | 5 | 2 hours | 8 hours |
| Iceflower | 6 | 3 hours | 12 hours |

These totals exclude delays before rewatering, watering-can stage jumps and Growth Powder. Preserve the existing can bonuses: a top-tier can roughly halves the required waits. Growth Powder still advances one stage instantly; four powders can bypass all waits, so quantify its increased value in the balance report rather than silently weakening it.

Centralize the crop-specific wait in `Crops.stageHoldMs(crop)` and use it for advancement, rendering, countdowns and descriptions. Preserve elapsed progress for already-watered crops on migration: convert the fraction of the old stage timer completed into the same fraction of the new timer; if already ready under the old timer, advance that stage before migration. Mature crops stay mature. Offline time still advances a watered crop by one stage, then it needs watering again.

### Added validation

Test poison's 30 ticks, refresh without tick reset, armor interaction, zero-energy floor, suspension/reload, curing at a tick boundary, and downed use. Test Elixir with upgraded maximum energy and active food cooldown, full-energy refusal, and no accidental cure/revival. Test the seed probability transfers, single magical seed stacks, all new growth timers and migration, watering-can jumps and Growth Powder. Add the new item icons to sprite/layout audits and teach poison on first exposure.

These numeric defaults extend the reviewed chest proposal; no gameplay implementation is included in this design artifact.
