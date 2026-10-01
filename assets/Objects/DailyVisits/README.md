# Daily visit sprites

These sprites replace the older map-audit exports without changing that
exporter's source recipes.

- `wagon.png`: regenerated compact covered wagon, 32 × 32 pixels. The runtime
  scale keeps it within a 2 × 2-cell footprint.
- `potofgold.png`: 24 × 24 pixels. Coins match the muted teal-jade metal and
  embossed star of `assets/Icons/coin.png`.

Generated with the built-in image tool. Transparent masters are preserved in
the shared `idol-review/masters` artifact directory. Runtime exports are
cropped to the opaque silhouette, fitted inside a one-pixel transparent border,
and reduced to 48 colours. The original approved exports remain as references.
