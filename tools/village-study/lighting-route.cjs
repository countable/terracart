// Fixture-only use of the existing light collector, cookie and lightMap.
module.exports = source => {
  let patched = require('../jungle-study/lighting-route.cjs')(source);
  patched = patched.replace('radiusCells: 2.0625', 'radiusCells: 1.25');
  patched = patched.replace("const lamp = window.__fixture?.layout?.lamps?.find(l => 'jungle-lamp-' + l.base[0] * 2 === o.id);\n      light.dyPx = lamp ? (lamp.light_center[1] - lamp.base[1]) * 2 : -20;", "light.dyPx = o.studyOffset ? o.studyOffset[1] + 24 : -20;");
  return patched;
};
