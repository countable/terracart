# Inactive artwork and experiments

Historical artwork, profile implementations, builders and tests retain their
original repository paths beneath this directory. The active game and review
pipeline use Rogue artwork.

[The archive manifest](../../docs/art/inactive-art-manifest.json) records each
original path, archive path, byte count and original SHA-256. Entries whose text
references were updated also record `archivedSha256` for the retained copy.

[Legacy map-art notes](docs/art/legacy-map-art-profiles.md) preserve the former
Trees/Water and Dreamland setup and palette documentation. Retired profile code
lives in `src/`; its builders and tests live in the matching `tools/` and `test/`
subdirectories. The former street-lamp source and selected image are retained
in `tools/legacy_streetlamp_art.js`, `tools/build_selected_streetlamp.py` and
`assets/Objects/SelectedProps/selected_streetlamp.png`, with full pre-cleanup
street-lamp/road/depth test snapshots alongside the other retired tests.

To investigate or restore an experiment, first verify the retained copy against
its recorded checksum. Restore archived scripts to their original repository
location before running them: their relative root calculations were written for
that location. Recheck runtime references and current art parity before making
restored files part of the active game.
