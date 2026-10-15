// Development-only visual fixture using the live scene and production controls.
window.installCompassHudHarness = function () {
  const scene = window.__scene;
  if (!scene?._sandboxMode) throw new Error('Compass preview requires the sandbox');
  const original = structuredClone(scene.save);
  const ids = ['inventory', 'joystick', 'distance', 'memories', 'books'];
  function preview(mode = 'active') {
    scene.scene.pause();
    document.querySelectorAll('.game-modal').forEach(el => el.remove());
    document.body.classList.remove('modal-open');
    scene._compassSpiritOpen = false;
    scene.save = structuredClone(original);
    scene.save.memories = Math.min(3, scene.memoriesTotal());
    scene.save.compassModules = { active: Object.fromEntries(ids.map(id => [id, mode === 'active'])), pending: [], walkedM: mode === 'active' ? 200 : 0 };
    if (mode !== 'active') Object.assign(scene.save, { inv: [], relics: {}, armor: {}, discovered: {}, memories: 0, booksRead: 0, tipsRead: 0 });
    for (const key of ['_moneyDOM','_energyDOM','_memoriesDOM','_roadChipDOM','_bookChipDOM']) scene[key] = null;
    scene.buildInventoryDOM(); scene.updateHUD();
    CompassHUD.update(scene);
    // Keep the showcase about the relic; these are ordinary tutorial/debug
    // overlays, not part of the compass surfaces under review.
    for (const id of ['objective', 'hud', 'story-badge', 'bootload']) {
      const el = document.getElementById(id);
      if (el) el.style.setProperty('display', 'none', 'important');
    }
    scene._huNoCompass?.setVisible(false);
    return measure();
  }
  function measure() {
    const rect = id => document.getElementById(id)?.getBoundingClientRect().toJSON();
    return { active: scene.save.compassModules.active, map: document.querySelector('.compass-aperture').getBoundingClientRect().toJSON(), energy: rect('energy'), memories: rect('memories'), books: rect('bookchip'), joystick: rect('move-pad') };
  }
  // The world is frozen for inspection, but explicit spirit-walking
  // activation must still deliver its ordinary queued confirmation.
  const timer = setInterval(() => {
    if (scene.scene.isPaused()) CompassModules.drain(scene);
  }, 250);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  return { preview, measure };
};
