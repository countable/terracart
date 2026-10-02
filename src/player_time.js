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
    delete save.trainingBuffUntil;
    delete save.fishRegen;
    delete save.treasureCompass;
    scene.pairyCompass = null;
    scene._shrineRegenAcc = 0;
    scene._blightLastT = null;
    scene.blightAura?.setVisible(false);

    Conditions.clearDebuffs(save, scene);
    save.fireDamageRemainder = 0;
    scene._conditionLastT = null;
    scene._pinnedUntil = 0;

    delete save.eatReadyAt;
    delete save.tomeDays;
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
    scene._updatePlayerAura?.();
    scene.updateEnergyDOM?.();
    scene._syncStatusRow?.();
    scene.syncEatButton?.();
    scene.syncConsumableButton?.();
    return true;
  }

  root.PlayerTime = { reset };
})(typeof globalThis !== 'undefined' ? globalThis : this);
