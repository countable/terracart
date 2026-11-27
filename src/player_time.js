// Reset only the player's temporary effects and action gates. World clocks,
// hired companions, travel anchors, and permanent progression keep their state.
(function (root) {
  'use strict';

  function reset(scene) {
    const save = scene.save;
    const wasDragon = !!scene._dragonActive;
    for (const row of Object.values(Buffs.KINDS)) {
      if (row.save) delete save[row.save];
      if (row.scene) scene[row.scene] = 0;
    }
    // Compound effects and training drills have their own expiry readers.
    delete save.boonUntil;
    delete save.trainingDrills;
    delete save.fishRegen;
    delete save.treasureCompass;
    scene.pairyCompass = null;
    scene._shrineRegenAcc = 0;
    scene._blightLastT = null;
    scene.blightAura?.setVisible(false);

    Conditions.clearDebuffs(save, scene);
    save.fireDamageRemainder = 0;
    scene._conditionLastT = null;

    delete save.eatReadyAt;
    delete save.eatCooldownMs;
    delete save.restedAt;   // the bed gate (src/rest.js)
    delete save.tomeDays;
    delete save.tomeReadyAt;
    delete save.tomeMagicCd;
    scene._throwReadyAt = 0;
    scene._nextBlowT = 0;
    scene._nextShotT = {};
    scene._staffCharge = null;
    scene._igniteNextT = 0;

    // Removing Giant or a Stamina drill can lower the cap; never heal here.
    Energy.set(save, save.energy ?? 0, Energy.maxEnergy(save));
    if (wasDragon) scene._applyDragonSkin?.(false);
    else scene._syncPlayerSkin?.();
    scene._dragonBuffActive = false;
    scene._tickSpiritRaven?.();
    for (const [kind, row] of Object.entries(Companions.KINDS)) {
      if (scene[row.instance] && !Companions.active(save, kind)) Companions.tick(scene, kind);
    }
    scene._updatePlayerAura?.();
    scene.updateEnergyDOM?.();
    scene._syncStatusRow?.();
    scene.syncEatButton?.();
    scene.syncConsumableButton?.();
    return true;
  }

  // Bring every running ITEM cooldown closer — the same item gates reset()
  // clears: the bite (save.eatReadyAt), each resting tome
  // (save.tomeMagicCd[id]) and the shared throw recovery
  // (scene._throwReadyAt, a performance.now clock). Each timer loses
  // max(cutMs, frac × what is left on IT), never past ready; a timer already
  // run out is untouched. Lighting a Torch calls it (CONSUMABLE_SPEC.torch
  // cooldownCutMs / cooldownCutFrac). Returns how many timers moved.
  function cutLeft(left, cutMs, frac) {
    return Math.max(0, left - Math.max(cutMs, frac * left));
  }
  function shortenItemCooldowns(scene, cutMs, frac, now = Date.now(), perfNow = performance.now()) {
    const save = scene.save;
    let n = 0;
    if (typeof save.eatReadyAt === 'number' && save.eatReadyAt > now) {
      save.eatReadyAt = now + cutLeft(save.eatReadyAt - now, cutMs, frac); n++;
    }
    const cd = save.tomeMagicCd;
    if (cd && typeof cd === 'object') {
      for (const id of Object.keys(cd)) {
        if (typeof cd[id] === 'number' && cd[id] > now) { cd[id] = now + cutLeft(cd[id] - now, cutMs, frac); n++; }
      }
    }
    if ((scene._throwReadyAt || 0) > perfNow) {
      scene._throwReadyAt = perfNow + cutLeft(scene._throwReadyAt - perfNow, cutMs, frac); n++;
    }
    if (n) { scene.syncEatButton?.(); scene.syncConsumableButton?.(); }
    return n;
  }

  root.PlayerTime = { reset, shortenItemCooldowns };
})(typeof globalThis !== 'undefined' ? globalThis : this);
