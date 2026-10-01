// Act 3's first recovered power. Demon identity lives on the enemy roster;
// shots use the normal friendly projectile/collision/kill-credit pipeline.
const DragonStory = (() => {
  const DEPTH = 9;
  const REWARD = 'fire_breath';
  const persist = scene => { if (typeof persistSave === 'function') persistSave(scene.save); };
  function unlocked(save) { return save?.dragonStory?.fireBreath === true; }
  function objective(save) {
    return save?.memoryStory?.act3Started && !unlocked(save)
      ? 'Recover your fire breath from a demon on dungeon level 9.' : null;
  }
  function defeated(scene, victim, source = 'player') {
    if (!scene.save.memoryStory?.act3Started || unlocked(scene.save) || scene.depth !== DEPTH
        || !Combat.isPlayerKill(source) || EnemyRoster.get(victim?.kind)?.storyReward !== REWARD) return false;
    const state = scene.save.dragonStory ||= {};
    state.fireBreath = true;
    state.pending = true;
    persist(scene);
    return true;
  }
  function drain(scene) {
    const state = scene.save.dragonStory;
    if (!state?.pending || scene._dragonStoryOpen || scene._dialogOpen?.()
        || (typeof document !== 'undefined' && document.body?.classList?.contains('modal-open'))) return false;
    scene._dragonStoryOpen = true;
    try {
      scene.showMessageModal({ kind: 'memory', art: 'fire_first', title: 'Your fire breath returns',
        body: 'You feel heat build in your throat and breathe fire. Your flames can now reach nearby foes.',
        mustAcknowledge: true,
        onDismiss: () => {
          scene._dragonStoryOpen = false;
          state.pending = false;
          persist(scene);
        },
      });
    } catch (err) { scene._dragonStoryOpen = false; throw err; }
    return true;
  }
  // `now` is performance.now(), as for the scene's ordinary shot clocks.
  // No world scan: the caller already collected visible, living hostiles.
  // The cooldown gates even the nearest-target and line-of-fire work.
  function tick(scene, now, px, py, enemies) {
    if (!unlocked(scene.save) || Combat.playerDowned(scene.save.energy)
        || now < (scene._fireBreathNextT || 0)) return null;
    const dragon = EnemyRoster.get('red_dragon');
    let target = null, best2 = (dragon.range * scene.cellM) ** 2;
    for (const c of enemies || []) {
      if (!Combat.isEnemy(c)) continue;
      const d2 = (c.x - px) ** 2 + (c.y - py) ** 2;
      if (!(d2 > 0) || d2 > best2) continue;
      if (!Combat.lineOfFire(px, py, c.x, c.y, (x, y) => scene._cellBlocked(x, y), scene.cellM)) continue;
      target = c; best2 = d2;
    }
    if (!target) return null;
    const shot = Combat.spawnShot('staff', px, py, { x: target.x - px, y: target.y - py },
      scene.cellM, dragon.dmg * (scene._attackMul?.() ?? 1), 1, undefined, dragon.range);
    shot.color = 0xff792e;
    shot.pierce = false; // Flame stops in rock and timber, like an arrow.
    shot.source = 'player';
    shot.fireBreath = true;
    (scene._shots ||= []).push(shot);
    scene._fireBreathNextT = now + dragon.damageIntervalSeconds * 1000;
    return shot;
  }
  return { DEPTH, REWARD, unlocked, objective, defeated, drain, tick };
})();
