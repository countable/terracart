# Asset inventory

Run `node tools/asset_inventory.js` to list image files under `assets/` that
have no known runtime reference. Add `--json` for reference evidence, missing
paths, candidate file sizes and Git status, and preserved source/reserve images
under `art-source/`. Paths are relative to the repository; the command works
from any working directory. It writes no files and never deletes anything.

A missing reference or a scanner error exits with status 1. Unreferenced
candidates alone do not fail the command. Git status distinguishes tracked,
untracked and ignored files; staged additions count as tracked. Source masters
and reserve exports are listed separately and are not deletion candidates.

The inventory evaluates the preload manifest with its enemy roster and sprite
layout, the DOM icon sheet table, and every gear slot/tier through the runtime
`gearAssetPath` function. It also scans JavaScript under `src/`, image/CSS paths
in `index.html`, `art` and `story` scene painting stems, and dynamic restoration paintings from
the restoration role table. Enemy full sheets used by the roster therefore
count as referenced even when their paths are not in the preload source text.

This is a conservative reference inventory, not runtime coverage or a JavaScript
parser. Ordinary JavaScript comments are excluded while quoted strings are kept;
unusual regex literals or nested templates can confuse that scan. HTML and block
comments in `index.html` are excluded, but inline JavaScript line comments may
conservatively retain a reference. All `src/` files and literal branches are
scanned, including code that may not currently execute. References assembled by
new dynamic code need an explicit enumerator, like gear and restoration art.
Tests, documentation, generators, and external consumers are outside runtime
scope. Image formats checked are PNG, WebP, JPEG, GIF, SVG and AVIF.

Review each candidate before removal: it may be a useful reserve or an input
to a tool. This command does not establish that it is redundant or recoverable.
After changing assets, run the normal sprite audits and node suite too; existence
checks do not validate pixels, frame indices, preload keys or visual appearance.
