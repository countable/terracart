# Asset inventory

Run `node tools/asset_inventory.js --json` to inventory active image files and
archive candidates. The command is read-only, works from any working directory,
and fails on missing runtime references or scanner errors.

The runtime profile is Rogue. The scanner evaluates its effective preload
manifest, including dynamic enemy/NPC rows, atlas aliases and Rogue profile
installers. Procedural textures have no file and are excluded. It enumerates
all gear slots and tiers, portraits, compass emission layers, and chest-tier
paintings. It scans only JavaScript loaded by `index.html` (plus `app.js`), CSS,
and the index itself. Quoted painting stems in arrays, returns and conditions
count as consumers; generated thumbnail metadata alone does not make art active.

JSON `references` records runtime paths and their evidence. `missing` reports
broken runtime references. `candidates` contains images under `assets/` outside
that set, with sizes, Git status, categories and full-path `supportReferences`
from tools, tests, docs and asset manifests. `overrides` identifies base preload
rows whose paths differ from the effective runtime manifest. Staged additions
count as tracked. Existing external source archives are listed in `sources`.

Candidate categories distinguish source/master folders, other tool or
documentation references, and files without a known full-path consumer. These
are review aids, not proof of dead code: generator paths assembled from folder
and filename fragments require inspection too. Update builder inputs and
provenance paths when moving candidates into `extra_assets/inactive/`; preserve
original relative paths and hashes. No runtime reference should point into the
archive. The inventory never moves or deletes files itself.

The scanner is conservative, not a JavaScript parser or runtime coverage tool.
New dynamic filename families need an explicit enumerator. Literal branches
inside loaded modules remain retained. Existence checks do not validate pixels,
frame geometry or appearance. Run `node test/asset-inventory.cjs`, the normal
sprite audits, and relevant visual checks after changing asset organization.
