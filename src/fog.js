// Fog of war — which cells the player has actually been to.
//
// Depends on:
//   nothing external. Pure data + math (no Phaser, no DOM, no WorldGen).
//
// Exports as globals:
//   Fog.REVEAL_CELLS      — reveal radius, in cells, around the player
//   Fog.init(save, w)     — load the persisted masks; w = cellsPerTile
//   Fog.reveal(ix, iy)    — reveal around the PLAYER's cell; true if anything changed
//   Fog.revealDisc(ix, iy, r) — reveal an arbitrary disc (the onboarding trail)
//   Fog.seen(tx, ty, ix, iy) — is that cell revealed?
//   Fog.maskFor(tx, ty)   — the tile's raw bitset (or null), for hot per-cell reads
//   Fog.bit(mask, i)      — read bit i of a mask
//   Fog.flush(save)       — write the masks back into save.fog
//   Fog.revision          — bumps whenever anything is revealed (render dirty-gate)
//
// ── Why a bitset per tile, and not a Set of cell keys ──────────────────────
// Every other per-cell fact in the save (tilled, picked, opened) is a Set of
// "ix_iy" strings, and that is right for those: a player tills dozens of cells,
// not thousands. Fog is the opposite shape — walking 5 km reveals ~5000 cells,
// and as strings that is ~68 KB of save that keeps growing for as long as the
// player keeps walking.
//
// One BIT per cell, packed per tile, costs the same whether the player crossed
// a tile once or explored every corner of it: 51,984 cells at a 228-cell tile
// edge (49°N) → 6,498 bytes, ~8.7 KB as base64. Flat, bounded, and the tile is
// already the unit everything else in the world is keyed by.
//
// The masks live HERE, in this module's own Map — deliberately NOT hung on the
// WorldGen tile-cache entry beside `grid` / `roadMask`. Those are DERIVED world
// state: loadTile LRU-prunes at 64 tiles and re-rasterises every 30 days, and
// either would silently wipe a player's exploration history. Fog is player
// state and outlives both.
(function (window) {
  'use strict';

  // How far around the player a step reveals, in cells (7 m each).
  //
  // This has a hard ceiling that is easy to miss: the viewport is VIEW_CELLS
  // (11) wide, so the player can see 5 cells in every direction. Reveal 5 or
  // more and every cell is revealed the moment it becomes visible — the fog
  // would be real, persisted, and completely invisible, because the only cells
  // still dark would be off-screen ones.
  //
  // 3 is the reach radius: you reveal what you could have reached out and
  // touched. That leaves a 2-cell band of fog around the viewport edge, so
  // walking down a street reveals the street and leaves the land either side of
  // it dark until you go there — which is the whole point of the feature.
  const REVEAL_CELLS = 3;

  // tileKey → Uint8Array bitset, one bit per cell of that tile, row-major.
  let _masks = new Map();
  // tileKey → the encoded blob for that mask, dropped whenever a bit is set.
  //
  // Without this, flush() re-codes every loaded tile on every new cell — 64
  // tiles × 6.5 KB of run-length coding for the sake of the handful of bytes
  // that actually moved. A walk only ever dirties the one or two tiles the
  // player is standing across, so the rest keep last flush's blob.
  let _enc = new Map();
  // Cells per tile edge. Latitude-dependent (WorldGen.cellsPerEdgeForLat), so a
  // save carries the width its masks were built at and we drop them rather than
  // mis-index if it ever changes under us.
  let _w = 0;
  // Bumped on every actual reveal. The renderer keeps the last value it drew
  // and rebuilds only when this moves — see the fog pass in render.js.
  let _revision = 0;
  // The last cell we revealed around, so reveal() is free to call every frame.
  let _lastIX = null, _lastIY = null;

  const key = (tx, ty) => tx + '/' + ty;

  // ── Byte-run-length coding ────────────────────────────────────────────────
  // A fresh mask is 6.5 KB of zeros, and even a well-explored tile is mostly
  // zeros — a player walks corridors through a tile, they don't fill it. So the
  // raw bitset goes through a zero-run coder before base64: a 0x00 byte is
  // written as [0x00, run-length], everything else literally. A barely-visited
  // tile packs to a few hundred bytes; a saturated one degrades to at worst
  // 2× the raw size, which is still bounded and still flat in exploration.
  function rleEncode(bytes) {
    const out = [];
    for (let i = 0; i < bytes.length;) {
      const b = bytes[i];
      if (b === 0) {
        let n = 0;
        while (i + n < bytes.length && bytes[i + n] === 0 && n < 255) n++;
        out.push(0, n);
        i += n;
      } else {
        out.push(b);
        i++;
      }
    }
    return out;
  }

  function rleDecode(bytes, len) {
    const out = new Uint8Array(len);
    let o = 0;
    for (let i = 0; i < bytes.length && o < len;) {
      const b = bytes[i];
      if (b === 0) {
        // A trailing 0 with no count is corrupt input — stop rather than loop.
        if (i + 1 >= bytes.length) break;
        o += bytes[i + 1];
        i += 2;
      } else {
        out[o++] = b;
        i++;
      }
    }
    return out;
  }

  // base64 over a byte array. btoa/atob are latin-1 string codecs, so the bytes
  // go through String.fromCharCode in chunks — one call with a 13 KB spread
  // argument list is a stack-overflow risk on some engines.
  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 4096) {
      s += String.fromCharCode.apply(null, bytes.slice(i, i + 4096));
    }
    return window.btoa(s);
  }

  function fromB64(str) {
    const s = window.atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  const bit = (mask, i) => (mask[i >> 3] >> (i & 7)) & 1;

  function maskFor(tx, ty) {
    return _masks.get(key(tx, ty)) || null;
  }

  // The mask for a tile, created on first write. Read paths use maskFor and
  // treat a missing mask as "all fogged" rather than allocating 6.5 KB for a
  // tile the player has only ever seen the edge of.
  function ensureMask(tx, ty) {
    const k = key(tx, ty);
    let m = _masks.get(k);
    if (!m) {
      m = new Uint8Array(Math.ceil((_w * _w) / 8));
      _masks.set(k, m);
    }
    return m;
  }

  function seen(tx, ty, ix, iy) {
    const m = maskFor(tx, ty);
    return !!m && !!bit(m, iy * _w + ix);
  }

  // Reveal a disc of radius R around one ABSOLUTE cell (tile-pixel basis, the
  // same ix/iy space drawCells and every save key use). The walk calls this
  // through reveal() at REVEAL_CELLS; the onboarding trail calls it directly
  // with its own radius (see _revealStarterTrail in app.js).
  function revealDisc(cellIX, cellIY, R) {
    if (!_w || !(R >= 0)) return false;
    const R2 = R * R;
    let changed = false;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R2) continue;   // a disc, not a square
        const ax = cellIX + dx, ay = cellIY + dy;
        // Absolute cell → owning tile + local cell. Floor-div / floor-mod so
        // negative world coordinates (west / north of the origin tile) land in
        // the right tile instead of collapsing toward zero.
        const tx = Math.floor(ax / _w), ty = Math.floor(ay / _w);
        const ix = ax - tx * _w, iy = ay - ty * _w;
        const i = iy * _w + ix;
        const m = ensureMask(tx, ty);
        const byte = i >> 3, mask = 1 << (i & 7);
        if (!(m[byte] & mask)) {
          m[byte] |= mask;
          changed = true;
          _enc.delete(key(tx, ty));   // this tile's cached blob is now stale
        }
      }
    }
    if (changed) _revision++;
    return changed;
  }

  // The walk-time entry point: reveal around the player. Cheap enough to call
  // every frame — it bails unless the player has actually changed cell.
  function reveal(cellIX, cellIY) {
    if (cellIX === _lastIX && cellIY === _lastIY) return false;
    _lastIX = cellIX; _lastIY = cellIY;
    return revealDisc(cellIX, cellIY, REVEAL_CELLS);
  }

  // save.fog = { w, tiles: { "tx/ty": "<rle+base64>" } }.
  // A save written at a different cells-per-tile width can't be re-indexed, so
  // it is dropped: the player re-reveals as they walk rather than seeing fog
  // torn at tile seams. (Only reachable if the world's latitude anchor moves —
  // see the cellsPerEdgeForLat note on the tile cache key in worldgen.js.)
  function init(save, w) {
    _masks = new Map();
    _enc = new Map();
    _w = w | 0;
    _revision++;
    _lastIX = _lastIY = null;
    const fog = save && save.fog;
    if (!fog || !fog.tiles || fog.w !== _w) return;
    const bytes = Math.ceil((_w * _w) / 8);
    for (const k of Object.keys(fog.tiles)) {
      try {
        const m = rleDecode(fromB64(fog.tiles[k]), bytes);
        // Re-seed the blob cache from what we just read, so the first flush
        // after a load doesn't re-code every tile the player has ever visited.
        if (m.length === bytes) { _masks.set(k, m); _enc.set(k, fog.tiles[k]); }
      } catch { /* a corrupt blob costs that tile's fog, not the save */ }
    }
  }

  function flush(save) {
    if (!save || !_w) return;
    const tiles = {};
    for (const [k, m] of _masks) {
      const cached = _enc.get(k);
      if (cached !== undefined) { tiles[k] = cached; continue; }
      // Skip tiles whose every bit is still 0 — ensureMask allocates on the
      // first write, but a reveal that changed nothing (re-walking known
      // ground) shouldn't add an all-zero blob to the save forever.
      let any = false;
      for (let i = 0; i < m.length; i++) { if (m[i]) { any = true; break; } }
      if (!any) continue;
      const blob = toB64(Uint8Array.from(rleEncode(m)));
      _enc.set(k, blob);
      tiles[k] = blob;
    }
    save.fog = { w: _w, tiles };
  }

  window.Fog = {
    REVEAL_CELLS,
    init, reveal, revealDisc, seen, maskFor, bit, flush,
    get revision() { return _revision; },
    get width() { return _w; },
    // Test seams — the codec is the one part with a round-trip worth pinning.
    _rle: { encode: rleEncode, decode: rleDecode },
  };
})(typeof window !== 'undefined' ? window : globalThis);
