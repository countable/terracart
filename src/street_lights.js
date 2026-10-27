// Street lamp silhouettes and their emitter anchors share one table. Restoration
// still controls every light; themed art never creates a second light source.
const StreetLights = (() => {
  const ART = {
    hanging_lantern: { scale: 1.25, rise: .55, offset: .25 },
    wooden_lantern: { scale: 1.25, rise: .65, offset: .12 },
    fire_pedestal: { scale: 1.2, rise: .65, offset: 0 },
    green_orb: { scale: 1.2, rise: .65, offset: 0 },
    street_lantern: { scale: 1, rise: 1, offset: 0 },
    tall_lantern: { scale: .48, rise: 1, offset: 0 },
    paired_candles: { scale: 2, rise: .44, offset: 0 },
    flame_pillar: { scale: 1.3, rise: .69, offset: 0 },
    upright_flame: { scale: 1.2, rise: .71, offset: 0 },
  };
  const VARIANTS = {
    hedgerow:'hanging_lantern', trade:'hanging_lantern',
    lantern:'wooden_lantern', promenade:'tall_lantern', parkpath:'street_lantern',
    pilgrim:'fire_pedestal', burned:'flame_pillar', fire_path:'upright_flame',
    golden_path:'paired_candles',
    poison_path:'green_orb', confusion_path:'green_orb',
  };
  function forVariant(variant) { return VARIANTS[variant] || null; }
  function art(o) { return !o.suppressed && ART[o._streetArt] || null; }
  function key(o) { return art(o) ? 'street_decor_' + o._streetArt : o.lit ? 'rogue_lamp' : 'rogue_lamp_unlit'; }
  function scale(o) { return art(o)?.scale || 1.25; }
  function after(sprite, o) {
    // The source has no unlit frame. Dimming its own pixels preserves the
    // silhouette and makes the restoration transition legible without glow.
    if (art(o) && !o.lit) sprite.setTint?.(0x62685d);
    else sprite.clearTint?.();
  }
  return { ART, VARIANTS, forVariant, art, key, scale, after };
})();
if (typeof window !== 'undefined') window.StreetLights = StreetLights;
