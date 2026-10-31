// Coins earned lift the money chip: the count rolls up and the chip hops once
// (CompassHUD.moneyGain / coinRoll); a spend paints flat (app.js updateHUD).

(function () {
// Evaluated here, not loaded globally (see run.js COMPASS_HUD_SRC).
const CompassHUD = (0, eval)(COMPASS_HUD_SRC + ';CompassHUD');

test('money chip: the roll eases from the old balance to the new and reports when it is done', () => {
  const tween = { from: 10, to: 110, t0: 1000, ms: 500 };
  assert.eq(CompassHUD.coinRoll(null, 0), null, 'no roll: nothing to read');
  assert.eq(CompassHUD.coinRoll(tween, 1000).value, 10, 'starts at the old balance');
  const mid = CompassHUD.coinRoll(tween, 1250);
  assert.truthy(mid.value > 60 && mid.value < 110 && !mid.done, `eases out past halfway: ${mid.value}`);
  assert.eq(CompassHUD.coinRoll(tween, 1500).value, 110, 'lands on the new balance');
  assert.truthy(CompassHUD.coinRoll(tween, 1500).done);
  assert.eq(CompassHUD.coinRoll(tween, 9000).value, 110, 'and stays there');
});

test('money chip: a gain starts the roll and hops the chip; a second gain climbs on from the number shown; reduced motion keeps only the roll', () => {
  const previous = document.getElementById;
  const hops = [];
  const el = { animate(frames, opts) { hops.push({ frames, opts }); return { cancel() { this.cancelled = true; } }; } };
  document.getElementById = id => (id === 'money' ? el : null);
  try {
    const scene = {};
    CompassHUD.moneyGain(scene, 50, 80, 1000);
    assert.eq(JSON.stringify(scene._coinRoll), JSON.stringify({ from: 50, to: 80, t0: 1000, ms: CompassHUD.COIN_ROLL_MS }));
    assert.eq(hops.length, 1, 'one hop');
    assert.truthy(/translateY\(-\d+px\)/.test(hops[0].frames[1].transform), 'the chip rises');
    assert.eq(hops[0].frames[2].transform, hops[0].frames[0].transform, 'and settles where it was');
    assert.eq(hops[0].opts.duration, CompassHUD.COIN_HOP_MS);
    const shown = CompassHUD.coinRoll(scene._coinRoll, 1200).value;
    CompassHUD.moneyGain(scene, 80, 100, 1200);
    assert.eq(scene._coinRoll.from, shown, 'a second pickup mid-roll climbs on from the number on screen');
    assert.eq(scene._coinRoll.to, 100);
    assert.eq(hops.length, 2);
    assert.truthy(hops[0] && scene._coinHop && hops.length === 2, 'the earlier hop is replaced');
    const still = { _reducedMotion: true };
    CompassHUD.moneyGain(still, 0, 5, 0);
    assert.eq(still._coinRoll.to, 5, 'reduced motion still rolls the number');
    assert.eq(hops.length, 2, 'but the chip does not hop');
    document.getElementById = () => null;
    CompassHUD.moneyGain({}, 0, 1, 0);
    assert.eq(hops.length, 2, 'no chip, no hop, no error');
  } finally { document.getElementById = previous; }
});

test('money chip: updateHUD lifts on a gain, paints flat on a spend, and reads the roll each frame', () => {
  const src = SCENE_SRC;
  const hud = src.slice(src.indexOf('\n  updateHUD() {'), src.indexOf('\n  updateEnergyDOM() {'));
  assert.truthy(/if \(this\._moneyShown != null && balance > this\._moneyShown\) CompassHUD\.moneyGain\(this, this\._moneyShown, balance\);/.test(hud),
    'a gain lifts the chip from the last balance shown');
  assert.truthy(/else if \(this\._moneyShown != null && balance < this\._moneyShown\) this\._coinRoll = null;/.test(hud),
    'a spend drops any roll and paints flat');
  assert.truthy(/const roll = CompassHUD\.coinRoll\(this\._coinRoll, Date\.now\(\)\);\s*\n\s*if \(roll\?\.done\) this\._coinRoll = null;\s*\n\s*const money = `\$\{roll \? roll\.value : balance\}`;/.test(hud),
    'the painted number is the roll while it runs, the balance after');
});
})();
