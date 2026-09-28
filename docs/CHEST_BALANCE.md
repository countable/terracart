# Chest balance review

Implementation branch: `feature/magic-and-supplies`.
Baseline: `dcdb5ab`, including the road cash reduction and latest walking rewards.

The seeded simulation uses 50,000 rewards per cell: 140 chest-tier/mode comparisons
and 196 conditional rolled-quality cells. Conditional cells cover T1–T7 without
inventing displayed chest tiers above T5. No current reward pool returned empty.

| Normal surface location | Old mean catalog value | New mean | Change |
|---|---:|---:|---:|
| Roadside T1 | 6.49 | 7.64 | +17.7% |
| Commerce T1 | 8.40 | 8.40 | 0.0% |
| Food T1 | 7.25 | 5.55 | −23.5% |
| Park T2 | 27.99 | 12.78 | −54.3% |
| Farm T3 | 62.46 | 21.00 | −66.4% |
| Garden T4 | 535.32 | 48.44 | −91.0% |
| Healthcare T3 | 120.60 | 28.80 | −76.1% |
| School T3 | 134.78 | 78.22 | −42.0% |
| Culture T3 | 145.95 | 243.55 | +66.9% |
| Worship T3 | 146.52 | 34.49 | −76.5% |
| Memorial T3 | 147.97 | 61.68 | −58.3% |
| General civic T3 | 146.53 | 106.68 | −27.2% |
| Police/fire T3 | 145.72 | 422.92 | +190.2% |
| Pets T3 | 148.05 | 31.90 | −78.5% |

These are catalog values, not cash payouts. The concentration of expensive gear
raises culture and authority rewards; removing generic gear lowers other themes.
The simulation does not weight real-world POI frequency or player routes.

Eighteen comparison cells exceed the design's +20% review threshold, including
some unreachable surface-tier stress cases. **Decision approved:** retain the reviewed specialist gear rates and resulting
payouts. The user approved these measured changes and publication to main.

Magical seeds now drop singly and less often at higher rolled quality. Existing
harvest returns remain 25% + 10% per bed-quality tier, at most one returned seed.
A quality-7 bed therefore permits 20 expected harvests per starting seed before
loss, averaging four flowers per harvest. Four Growth Powders still bypass all
growth stages. Direct flower chest rewards also remain available.

Run the report with a clean baseline checkout/archive:

```sh
node tools/simulate-chest-themes.js --baseline /path/to/dcdb5ab --out /tmp/chest-balance
```

The output includes item/class/quantity shares, fallbacks, mean/p95 values,
gear cash-out projections and conditional quality distributions.

Verification: 2,717 headless checks passed; item catalogue validated 226 rows
against 28,000 sampled outcomes; Chromium medicine-use and visible inventory
checks passed at 320px, 390px and 430px. Baseline and updated browser harnesses both report 108 passed and 16 failed,
with identical failure sets; there are no new browser regressions.
