# Tall grass material study

Standalone WebGL review of three grass cell treatments and leafy walk-through
hedges. The renderer uses the same half-depth ground projection as the existing
temple/fort review, with screen-vertical elevation and a depth buffer. Textures
are deterministic procedural canvas art, built once and uploaded once per view.
No external assets, game save writes or image generation are needed.

Open `index.html` over HTTP. WASD/arrows or the buttons move the placeholder
character. Tap a cell to gather grass; the grass and underlying props have
independent state. The centre chest is hidden until cleared; the taller post
protrudes. Entering a grass cell containing a hidden find displays “oh!”.
Egg contents use a deterministic 1% threshold; this small fixture happens to
contain one at cell (3, 2). Neither cover nor hidden eggs wiggle. Hedge gathering
is illustrative only and does not add tall grass to inventory.

The proposed treatment is an opaque 18-unit volume with an irregular blade
fringe. It hides smaller objects reliably while the fringe breaks up its flat
lid. The fully layered variant deliberately demonstrates visibility leaks.
The character is a scale placeholder, not final character art.

Publish the three web files to `~/.artifacts/tall-grass-study/`. Verify with:

```sh
node tools/tall-grass-study/check.cjs
```

`VIEWER_URL` overrides the default localhost artifact URL; `ART_OUTPUT` sets
the screenshot directory (default `/tmp/tall-grass-check`). The test checks
five headings, one-square harvesting, repeat taps, the discovery pop, egg
collection, cover exit, hedges, mobile overflow and WebGL/browser errors.
