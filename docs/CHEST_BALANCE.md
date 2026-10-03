# Chest balance review (historical)

A one-off review of the themed-chest change ([CHEST_THEMES.md](CHEST_THEMES.md)),
run on branch `feature/magic-and-supplies` against baseline `dcdb5ab` (with the
road cash reduction and the walking rewards of that time). Its tables are
historical and have been removed: they used theme names that no longer exist
and predate later rebalances. The live numbers are in `src/chest_themes.js`
(`ChestThemes.themes`, `groups`, `quantity`) and `src/rarity.js`
(`RARITY_TUNING`, `pickChestReward`), with the value ladder `TIER_VALUE` in
`src/items.js`.

## What was measured

Mean and 95th-percentile catalogue value (not cash payout) per theme, chest
tier and surface/cave mode, old rules against new, plus item, class and
quantity shares, fallback frequency, gear cash-outs and the rolled-quality
distribution conditional on each chest tier. The simulation did not weight
real-world POI frequency or player routes.

## Method

A seeded simulation that loads the game's own reward modules (no copy of the
rules), run against a clean baseline checkout:

```sh
node tools/simulate-chest-themes.js --baseline /path/to/baseline --out /tmp/chest-balance
```

## Conclusions that still hold as intent

- No theme's reward pool may come back empty at any tier or depth.
- Specialisation moves value: concentrating gear in culture and authority
  raised their payouts while removing generic gear lowered the others. The
  owner reviewed and accepted that trade rather than flattening the rows.
- A sharp rise in a theme's mean value is a balance decision to make
  explicitly after a simulation, never something to hide by quietly editing
  a theme row.
