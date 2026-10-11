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
// wagon and the hall say the wait when asked (the drill still takes the
// one extend rule, laterOf). Pure: no Phaser, no DOM.
//
// `extend(save, scene, id, ms)` is THE WRITER of every row's expiry (owner,
// Oct 2026): a second dose while one runs EXTENDS — the new expiry is
// max(now, until) + ms, so nothing a potion or shrine lends is thrown away
// and nothing refuses while active. Shrines.grant, the bike rack and the
// hardworking potion pull it; app.js's potion handlers are to follow.
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
    frostAura: { name: 'Frost aura', color: '#9ad8ff', stroke: '#10233c', save: 'frostAuraUntil' },
    blight:  { name: 'Blight',  color: '#ff6f9a', stroke: '#3a0418', save: 'blightPotionUntil' },
    speed:   { name: 'Speed',   color: '#9fe8ff', stroke: '#0b2a3a', save: 'speedPotionUntil' },
    protection: { name: 'Protection', color: '#c9d6ff', stroke: '#1a2250', save: 'protectionPotionUntil' },
    immortal: { name: 'Immortal', color: '#ffe066', stroke: '#4a3a00', save: 'immortalPotionUntil' },
    fireResistance: { name: 'Fireproof', color: '#ffb347', stroke: '#3a1600', save: 'fireResistancePotionUntil' },
    flight: { name: 'Flight', color: '#9fe8ff', stroke: '#0b2a3a', save: 'flightPotionUntil' },
    shrinking: { name: 'Shrinking', color: '#d9b3ff', stroke: '#2a1040', save: 'shrinkingPotionUntil' },
    giant: { name: 'Giant', color: '#ffb18c', stroke: '#4a180b', save: 'giantPotionUntil' },
    shield:  { name: 'Shield',  color: '#c9d6ff', stroke: '#1a2250', save: 'shieldPotionUntil' },
    reach:   { name: 'Reach',   color: '#fff3a8', stroke: '#4a3a00', save: 'reachPotionUntil' },
    skeleton: { name: 'Bones', color: '#ded6bc', stroke: '#27231d', save: 'skeletonUntil' },
    wraith: { name: 'Wraith', color: '#b9cce2', stroke: '#162034', save: 'wraithUntil' },
    raven:   { name: 'Raven',   color: '#b8b8c8', stroke: '#101018', save: 'spiritRavenUntil' },
    coffee:  { name: 'Coffee',  color: '#e0b48a', stroke: '#3a2010', save: 'coffeeUntil' },
    dawnfruit: { name: 'Dawnfruit', color: '#fff3a8', stroke: '#4a3a00', save: 'dawnfruitUntil' },
    lettuce: { name: 'Luck', color: '#b7f598', stroke: '#183819', save: 'miracleLettuceUntil' },
    fish:    { name: 'Fish regen', color: '#a7ffb0', stroke: '#103a18',
      read: (save) => Number(save?.fishRegen?.until) || 0 },
    bike:    { name: 'Bike',    color: '#a8f0b0', stroke: '#103a18', save: 'bikeUntil' },
    field_scope: { name: 'Telescope', color: '#ffd166', stroke: '#4a3a00',
      read: save => latestUntil(save?.telescopeCompass) },
    wayfarer: { name: 'Directions', color: '#4d9dff', stroke: '#102a40',
      read: save => latestUntil(save?.wayfarerCompass) },
    compass: { name: 'Compass', color: '#67e8f9', stroke: '#2a1040',
      read: (save, scene) => latestUntil(scene?.pairyCompass) },
    // The Treasure Map's mark (app.js useTreasureMap — save.treasureCompass,
    // drawn as the red edge dot), so its quarter hour shows like the others.
    treasure: { name: 'Treasure', color: '#ff5555', stroke: '#3a0a0a',
      read: save => latestUntil(save?.treasureCompass) },
  };
  // The shrine boons that keep their own expiry (save.boonUntil[lever]):
  // every lever Shrines.LEVERS maps to a buff id that is not already a row
  // above gets one, named by the kind's `boon` word, inked in its light.
  // `boon` names the save.boonUntil key extend() writes.
  const S = root.Shrines;
  if (S) {
    for (const id of S.KIND_IDS) {
      const row = S.SHRINE_KINDS[id], buff = S.LEVERS[row.lever];
      if (!buff || KINDS[buff]) continue;
      KINDS[buff] = {
        name: row.boon, color: '#' + row.light.toString(16).padStart(6, '0'), stroke: BOON_STROKE, boon: buff,
        read: (save) => Number(save?.boonUntil?.[buff]) || 0,
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

  // THE EXTEND RULE: a dose of `ms` on an expiry `until` runs to
  // max(now, until) + ms — banked on top of what is left, never reset.
  function laterOf(until, ms, now = Date.now()) {
    return Math.max(now, Number(until) || 0) + ms;
  }
  // A rim mark's slot (save.telescopeCompass, scene.pairyCompass, … — app.js
  // MARKERS) holds a LIST, so several bearings of one kind show at once: two
  // neighbours' directions, two telescope finds, two maps' chests. An older
  // save's single mark reads as a list of one.
  function marks(slot) {
    return Array.isArray(slot) ? slot : slot ? [slot] : [];
  }
  // The slot with `mark` added. A mark on the same target replaces the old
  // one; with `ms` its expiry extends (laterOf) instead of restarting.
  function withMark(slot, mark, ms, now = Date.now()) {
    const list = marks(slot);
    const same = mark.targetId == null ? null : list.find(m => m.targetId === mark.targetId);
    const next = ms == null ? mark : { ...mark, until: laterOf(same?.until, ms, now) };
    return [...list.filter(m => m !== same), next];
  }
  // A slot's chip runs until its last mark does.
  function latestUntil(slot) {
    return Math.max(0, ...marks(slot).map(m => Number(m.until) || 0));
  }
  // Lend row `id` for `ms` more: the one writer of a row's expiry. False for
  // an unknown row or one with nowhere to write (a `read`-only row).
  function extend(save, scene, id, ms, now = Date.now()) {
    const k = KINDS[id];
    if (!k || !save) return false;
    const next = laterOf(until(id, save, scene), ms, now);
    if (k.save) save[k.save] = next;
    else if (k.scene) { if (scene) scene[k.scene] = next; }
    else if (k.boon) (save.boonUntil ||= {})[k.boon] = next;
    else return false;
    return true;
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

  root.Buffs = { KINDS, until, active, laterOf, extend, marks, withMark, latestUntil };
})(typeof globalThis !== 'undefined' ? globalThis : this);
