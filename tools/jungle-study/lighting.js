// Uses the renderer's existing lightMap and Lighting.draw. No second overlay.
window.installStudyLighting = () => {
  window.__JUNGLE_STUDY = true;
  const s = __scene;
  s.lightMap?.setVisible(true);
  if (s.lightTex) s.lightTex.__lightKey = null;
  s._lightCookies = {};
};
