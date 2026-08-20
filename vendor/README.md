# vendor/

## phaser.js — Phaser 3.87.0 (minified)

The official minified distribution, taken verbatim from the npm package:

    npm pack phaser@3.87.0
    tar xzf phaser-3.87.0.tgz package/dist/phaser.min.js
    cp package/dist/phaser.min.js vendor/phaser.js

It was previously the unminified `dist/phaser.js` from the same release —
7.6 MB against the minified build's 1.2 MB. That is ~6.4 MB the browser no
longer downloads, parses and holds: measured locally it cut the JS heap from
33.5 MB to 20.5 MB and domContentLoaded from ~378 ms to ~250 ms, and on a
real mobile connection the transfer saving dominates both.

Keep the filename `phaser.js` — `index.html` and `sw.js` both reference it by
that path. When bumping Phaser, take `dist/phaser.min.js` from the npm
tarball again rather than a CDN URL, and bump `SHELL_VERSION` in `sw.js` so
cached copies of the old build are dropped.

The game uses no Phaser physics system, so a custom build (or
`phaser-arcade-physics.min.js`) could trim this further if it ever matters.
