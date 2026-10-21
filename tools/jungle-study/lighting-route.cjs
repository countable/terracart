// Browser study only: retain the production Lighting collector, cookie bake,
// world projection, cache and single lightMap compositing path.
module.exports=function jungleLightingSource(source){
  function replaceOnce(needle,replacement){if(source.split(needle).length!==2)throw new Error('Jungle lighting route anchor changed: '+needle);source=source.replace(needle,replacement);}
  replaceOnce('  const KINDS = {',`  const KINDS = {
    study_jungle_lamp: { radiusCells: 2.0625, colour: 0xffffff, peak: 0.5, flicker: 0 },`);
  replaceOnce('  function profile(scene, daylightIn, nowIn) {',`  function profile(scene, daylightIn, nowIn) {
    if (typeof window !== 'undefined' && window.__JUNGLE_STUDY) return {
      depth: scene.depth ?? 0, dimA: 0.5, dimColour: 0, farA: 0.5,
      ambient: 0x808080, edge: 0, lit: 0, litColour: 0xffffff, night: 0
    };`);
  replaceOnce("    if (o.kind === 'torch') return 'torch';",`    if (o.kind === 'torch') return typeof window !== 'undefined' && window.__JUNGLE_STUDY ? 'study_jungle_lamp' : 'torch';`);
  replaceOnce('    const light = { kind, dx, dy, id: o.id };',`    const light = { kind, dx, dy, id: o.id };
    if (kind === 'study_jungle_lamp') {
      const lamp = window.__fixture?.layout?.lamps?.find(l => 'jungle-lamp-' + l.base[0] * 2 === o.id);
      light.dyPx = lamp ? (lamp.light_center[1] - lamp.base[1]) * 2 : -20;
    }`);
  replaceOnce('    bakeRadialCookie(canvas, R, stops);',`    if (kind === 'study_jungle_lamp') {
      stops.length = 0;
      stops.push([0, col, 0.5], [0.70, col, 0.425], [0.93, col, 0.20], [1, col, 0]);
    }
    bakeRadialCookie(canvas, R, stops);`);
  replaceOnce('  function coverFrame(scene, ax, ay, W, H) {', `  function coverFrame(scene, ax, ay, W, H) {
    if (typeof window !== 'undefined' && window.__JUNGLE_STUDY) return null;`);
  return source;
};
