const { chromium } = require('playwright-core'), assert = require('node:assert/strict');
(async () => {
  const env = { ...process.env }; delete env.DISPLAY;
  const browser = await chromium.launch({ executablePath: '/usr/lib/chromium/chromium', env,
    args: ['--no-sandbox', '--ozone-platform=headless', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const canvas of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1120, height: 1000 }, serviceWorkers: 'block' }), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto((process.env.WALL_REVIEW_URL || 'http://localhost:8765/tools/wall-material-preview.html') + (canvas ? '?canvas' : ''));
      await page.waitForFunction(() => window.ready);
      const result = await page.evaluate(() => {
        const scene = wallReviewScene, panels = scene.panels, keys = scene.textures.getTextureKeys().length;
        const blocks = panels.map(p => p.scene._wallPerspective.review.blocks.slice());
        const texture = scene.textures.get(WallMaterials.KEY), original = texture.refresh.bind(texture);
        let uploads = 0; texture.refresh = () => { uploads++; return original(); };
        for (let angle = 0; angle < 360; angle += 15) for (const panel of panels) {
          panel.scene.mapRot = angle * Math.PI / 180; WallPerspective.update(panel.scene);
          const group = panel.scene._wallPerspective.review;
          for (const block of group.blocks) for (const face of block.materialFaces) {
            if (!face.normal && face.visible) {
              const [a, b, c] = face.projected;
              if ((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x) <= 0) throw Error('back-facing crown triangle');
            }
          }
          if (!group.gfx._wallTriangles.every(t => t.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))) throw Error('nonfinite triangle');
        }
        const group = panels[0].scene._wallPerspective.review, retainedCommands = group.gfx._wallTriangles.length;
        WallPerspective.clear(panels[0].scene, 'review');
        const cleared = group.gfx._wallTriangles.length === 0;
        return { renderer: scene.game.renderer.type, uploads, newTextures: scene.textures.getTextureKeys().length-keys,
          retained: panels.slice(1).every((p,i) => blocks[i+1].every(b => p.scene._wallPerspective.review.blocks.includes(b))),
          cleared, retainedCommands, halls: panels.filter(p => p.hall?.visible).length };
      });
      assert.equal(result.renderer, canvas ? 1 : 2); assert.equal(result.uploads, 0); assert.equal(result.newTextures, 0);
      assert(result.retained && result.cleared && result.retainedCommands > 0); assert.equal(result.halls, 2); assert.deepEqual(errors, []);
      console.log(canvas ? 'Canvas' : 'WebGL', result); await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
