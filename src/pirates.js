// One paid passage covers every pirate for a real day, including new tiles.
(function (root) {
  'use strict';
  const PRICE = 25;
  const HIT_COINS = 5;
  const DURATION_MS = 24 * 60 * 60 * 1000;
  const SPEECH_MS = 8000;
  const LINES = ['Arr!', 'Shiver me timbers!'];

  function say(scene, c) {
    if ((!isPirate(c) && c?.kind !== 'pirate_mercenary') || !scene.flashAtWorld) return false;
    const now = Date.now();
    if (now < (c._pirateSpeechAt || 0)) return false;
    const line = c._pirateSpeechLine || 0;
    scene.flashAtWorld(LINES[line % LINES.length], c.x, c.y);
    c._pirateSpeechLine = line + 1;
    c._pirateSpeechAt = now + SPEECH_MS;
    return true;
  }

  function isPirate(c) { return !!c && !!Combat.monster(c.kind)?.pirate; }
  function onHit(scene, c) {
    if (!isPirate(c) || Combat.isPacified(c) || Combat.isCharmed(c) || !(scene.save.money > 0)) return 0;
    // Use the purse's normal loss/feedback path without a thief's daily satiation.
    return scene._losePlayerCoins(HIT_COINS);
  }
  function peaceUntil(scene) {
    const until = scene.save.piratePeaceUntil;
    return Number.isFinite(until) ? until : 0;
  }
  function sync(scene, c) {
    if (!isPirate(c)) return;
    const wasPaused = Combat.isPacified(c);
    c._piratePeaceUntil = peaceUntil(scene);
    c._pirateParleyPending = !!scene._pirateParleyPending;
    if (!wasPaused && Combat.isPacified(c)) Combat.cancelCreatureAction(c);
  }
  function syncAll(scene) {
    WorldGen.forEachItem('creatures', c => sync(scene, c));
    if (isPirate(scene._workProgress?.combat) && Combat.isPacified(scene._workProgress.combat)) {
      scene.cancelWorkProgress();
    }
  }
  function available(scene, c) {
    if (!isPirate(c) || c.id?.startsWith('released_')) return false;
    if ((c._surfaceSpawn || c.lair) && !EnemySpawns.surfaceActive(scene, c)) return false;
    return !c._surfaceInactive && !Combat.isConcealed(c)
      && !scene.save.caught?.includes(c.id) && Combat.hp(c) > 0;
  }
  function inReach(scene, c) {
    const cell = worldMetersToAbsCell(scene, c.x, c.y);
    return cellInReach(scene, cell.cellIX, cell.cellIY);
  }
  function busy(scene) {
    return scene._pirateParleyPending || scene._dialogOpen?.()
      || scene._passingOut || scene.save.exhausted || !(scene.save.energy > 0);
  }
  function present(scene, c) {
    if (busy(scene) || !available(scene, c) || !inReach(scene, c)) return false;
    sync(scene, c);
    if (peaceUntil(scene) > Date.now()) {
      scene.showMessageModal({ title: 'Paid passage',
        body: `All pirates will ignore you for another ${shortDuration(peaceUntil(scene) - Date.now())}.` });
      return true;
    }
    scene._pirateParleyPending = true;
    scene._pirateEncounterOffered = true;
    syncAll(scene);
    // The tapped pirate can belong to a freshly loaded tile not yet indexed.
    sync(scene, c);
    let settled = false;
    const settle = () => {
      if (settled) return false;
      settled = true;
      scene._pirateParleyPending = false;
      scene._pirateParleyModal = null;
      scene._pirateParleyCancel = null;
      syncAll(scene);
      sync(scene, c);
      return true;
    };
    scene._pirateParleyCancel = settle;
    scene.showOfferModal({
      kind: 'trade', title: 'Pirate passage',
      get: `Safe passage for ${shortDuration(DURATION_MS)}`,
      cost: scene.moneyHTML(PRICE),
      blurb: `“Arr!” Pay the pirates and all of them will ignore you for ${DURATION_MS / (60 * 60 * 1000)} hours. Their hits take ${HIT_COINS} coins.`,
      canAfford: (scene.save.money ?? 0) >= PRICE,
      acceptLabel: `Pay ${PRICE} coins`, cancelLabel: 'Leave',
      onCancel: settle,
      onAccept: () => {
        if (settled) return;
        let paid = false;
        if (peaceUntil(scene) <= Date.now() && available(scene, c) && inReach(scene, c)
            && !scene._passingOut && !scene.save.exhausted && scene.save.energy > 0
            && (scene.save.money ?? 0) >= PRICE) {
          addMoney(scene.save, -PRICE);
          scene.save.piratePeaceUntil = Date.now() + DURATION_MS;
          persistSave(scene.save);
          paid = true;
        }
        settle();
        if (paid) {
          scene._finishInventoryChange?.();
          scene.showMessageModal({ title: 'Paid passage',
            body: `“Shiver me timbers!” All pirates will ignore you for ${shortDuration(DURATION_MS)}.` });
        } else if (peaceUntil(scene) <= Date.now()) {
          scene.showMessageModal({ title: 'No deal', body: (scene.save.money ?? 0) < PRICE
            ? `You need ${PRICE} coins for safe passage.` : 'The pirate can no longer make this deal.' });
        }
      },
    });
    scene._pirateParleyModal = root.document?.getElementById?.('offer-modal');
    return true;
  }
  function tick(scene) {
    // Other dialogs can replace the shared offer shell without its callback.
    if (scene._pirateParleyModal && !scene._pirateParleyModal.isConnected) {
      scene._pirateParleyCancel?.();
    }
    const pc = scene.playerToWorldCell();
    let candidate = null;
    WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, c => {
      sync(scene, c);
      if (!candidate && isPirate(c) && inReach(scene, c) && available(scene, c)) candidate = c;
    });
    if (!candidate) scene._pirateEncounterOffered = false;
    if (candidate && !scene._pirateEncounterOffered && peaceUntil(scene) <= Date.now()
        && !busy(scene)) present(scene, candidate);
  }
  root.Pirates = { PRICE, HIT_COINS, DURATION_MS, SPEECH_MS, LINES, isPirate, say, onHit, sync, present, tick };
})(typeof window !== 'undefined' ? window : globalThis);
