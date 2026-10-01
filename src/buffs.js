// ─────────────────────────────────────────────────────────────────────────
// Buffs — the ONE table of the player's TIMED EFFECTS, read by the status
// row under the HUD that shows each one's countdown (app.js _syncStatusRow).
//
// Every timed effect the player can carry is a row of KINDS: a potion, a
// powder, the torch, a coffee, the bike rack's push, the Pairy compass and
// every shrine boon. A row says where its expiry lives (`save` — a
// save.<field> epoch-ms; `scene` — an in-memory scene field a refresh ends;
// or `read(save, scene)` for anything else) plus the word and the ink its
// countdown is drawn in. The rows that stand for shrine boons are derived
// from Shrines.SHRINE_KINDS: a kind whose lever is a potion timer (shield,
// reach, light) already shows as THAT row, so only the boon-only levers
// (save.boonUntil) get a row of their own, named by the kind's `boon` word
// and inked in its light colour.
//
// `active(save, scene, now)` lists the running rows in table order with
// their remaining ms; the status row shows them top-down after the
// conditions, so the order here is the order on screen. A new timed effect
// is a row here, never a chip or label of its own (buffs.test.js sweeps
// every `save.<x>Until =` writer). Not listed: the mercenary's day and a
// training drill — a whole-day countdown on screen all day is noise; the
// wagon and the hall say the wait when asked. Pure: no Phaser, no DOM.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  const GOLD = (typeof UI_GOLD === 'string') ? UI_GOLD : '#ffe066';
  // The dark ground behind a shrine boon's chip (the kind's light colour is
  // its ink); `stroke` on every row is that ground.
  const BOON_STROKE = '#1a1410';

  const KINDS = {
    portal: { name: 'Return', color: '#83caff', stroke: '#10233c', action: 'returnThroughSapphire',
      read: (save, scene) => scene?.depth === save?.sapphireReturn?.depth
        ? Number(save?.sapphireReturn?.until) || 0 : 0 },
    dragon:  { name: 'Dragon',  color: GOLD,      stroke: '#5a1400', scene: '_dragonUntil' },
    shadow:  { name: 'Shadow',  color: '#d9b3ff', stroke: '#2a1040', scene: '_shadowUntil' },
    torch:   { name: 'Torch',   color: '#ffb347', stroke: '#3a1600', scene: '_torchUntil' },
    blight:  { name: 'Blight',  color: '#ff6f9a', stroke: '#3a0418', save: 'blightPotionUntil' },
    speed:   { name: 'Speed',   color: '#9fe8ff', stroke: '#0b2a3a', save: 'speedPotionUntil' },
    shield:  { name: 'Shield',  color: '#c9d6ff', stroke: '#1a2250', save: 'shieldPotionUntil' },
    reach:   { name: 'Reach',   color: '#fff3a8', stroke: '#4a3a00', save: 'reachPotionUntil' },
    raven:   { name: 'Raven',   color: '#b8b8c8', stroke: '#101018', save: 'spiritRavenUntil' },
    coffee:  { name: 'Coffee',  color: '#e0b48a', stroke: '#3a2010', save: 'coffeeUntil' },
    dawnfruit: { name: 'Dawnfruit', color: '#fff3a8', stroke: '#4a3a00', save: 'dawnfruitUntil' },
    lettuce: { name: 'Luck', color: '#b7f598', stroke: '#183819', save: 'miracleLettuceUntil' },
    fish:    { name: 'Fish regen', color: '#a7ffb0', stroke: '#103a18',
      read: (save) => Number(save?.fishRegen?.until) || 0 },
    bike:    { name: 'Bike',    color: '#a8f0b0', stroke: '#103a18', save: 'bikeUntil' },
    compass: { name: 'Compass', color: '#c77dff', stroke: '#2a1040',
      read: (save, scene) => Number(scene?.pairyCompass?.until) || 0 },
  };
  // The shrine boons that keep their own expiry (save.boonUntil[lever]).
  const S = root.Shrines;
  if (S) {
    for (const id of S.KIND_IDS) {
      const row = S.SHRINE_KINDS[id], L = S.LEVERS[row.lever];
      if (!L || L.save || L.scene || L.instant) continue;
      KINDS[row.lever] = {
        name: row.boon, color: '#' + row.light.toString(16).padStart(6, '0'), stroke: BOON_STROKE,
        read: (save) => Number(save?.boonUntil?.[row.lever]) || 0,
      };
    }
  }

  function until(id, save, scene) {
    const k = KINDS[id];
    if (!k) return 0;
    if (k.save) return Number(save?.[k.save]) || 0;
    if (k.scene) return Number(scene?.[k.scene]) || 0;
    return k.read(save, scene);
  }

  // The running effects, in table order: [{ id, name, color, stroke, remainingMs }].
  function active(save, scene, now = Date.now()) {
    const out = [];
    for (const id of Object.keys(KINDS)) {
      const left = until(id, save, scene) - now;
      if (left > 0) out.push({ id, ...KINDS[id], remainingMs: left });
    }
    return out;
  }

  root.Buffs = { KINDS, until, active };
})(typeof globalThis !== 'undefined' ? globalThis : this);
