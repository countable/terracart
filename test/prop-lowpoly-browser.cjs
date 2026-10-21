const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.PROP_REVIEW_BASE || 'http://localhost:8000';
const output = process.env.PROP_REVIEW_OUTPUT || '/tmp/prop-lowpoly-review';
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const env = { ...process.env }; delete env.DISPLAY;
  const browser = await chromium.launch({ executablePath: '/usr/lib/chromium/chromium', env,
    args: ['--no-sandbox', '--ozone-platform=headless', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const canvas of (process.env.PROP_RUNTIME_ONLY ? [] : [false, true])) {
      const page = await browser.newPage({ viewport: { width: 1080, height: 880 }, serviceWorkers: 'block' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/tools/prop-lowpoly-preview.html' + (canvas ? '?canvas' : ''));
      await page.waitForFunction(() => window.ready);
      const result = await page.evaluate(() => {
        const root = propReviewScene, panels = root.panels;
        const textures = root.textures.getTextureKeys().length;
        const originals = panels.map(p => ({ blocks: p.scene._wallPerspective.looseProps.blocks.slice(),
          parts: p.scene._wallPerspective.looseProps.parts.slice(), faces: p.geometry.materialFaces.slice() }));
        let maxDrift = 0, minimumTriangles = Infinity;
        const counts = [];
        for (let deg = 0; deg <= 360; deg++) {
          const angle = deg * Math.PI / 180, s = Math.sin(angle), c = Math.cos(angle);
          const row = [];
          for (const panel of panels) {
            panel.scene.mapRot = angle; WallPerspective.update(panel.scene);
            const group = panel.scene._wallPerspective.looseProps;
            if (group.atlas.key !== PropLowPoly.ATLAS.key) throw Error('Props lost their authored texture atlas');
            if (group.blocks.some(b => b.materialFaces.some(f => f.materialSlot == null))) throw Error('Flat-color face substituted for source texture');
            let visible = 0;
            for (const block of group.blocks) for (const face of block.materialFaces) {
              face.points.forEach((p, i) => {
                const q = face.projected[i], dx = q.x-p.x, dy = q.y-p.y;
                maxDrift = Math.max(maxDrift, Math.abs(c*dx-s*dy), Math.abs(s*dx+c*dy+p.z));
              });
              if (!face.visible) continue;
              visible++;
              const [a,b,d] = face.projected;
              if (![a,b,d].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))) throw Error('Nonfinite vertex');
              if (!face.normal && (b.x-a.x)*(d.y-a.y)-(b.y-a.y)*(d.x-a.x)<=0) throw Error('Back-facing triangle');
            }
            // Ink consists only of upper boundary strips, never triangle
            // underpaint that could leak through Canvas antialiasing seams.
            for (const part of group.parts) {
              const triangles = part._wallTriangles;
              const firstBody = triangles.findIndex(t => t.uv);
              if (firstBody <= 0 || firstBody % 2) throw Error('Missing top boundary strips');
              for (let i = 0; i < firstBody; i += 2) {
                const ink = triangles[i], next = triangles[i+1];
                if (ink.color !== 0 || ink.uv || next.color !== 0 || next.uv) throw Error('Outline must be solid black');
                const [a,b,upB] = ink.points, upA = next.points[2];
                if (c*(b.x-a.x)-s*(b.y-a.y) <= 0) throw Error('Outline covers a bottom edge');
                for (const [p,q] of [[upA,a],[upB,b]]) {
                  const dx = p.x-q.x, dy = p.y-q.y;
                  if (Math.abs(c*dx-s*dy)>1e-7 || Math.abs(s*dx+c*dy+1)>1e-7)
                    throw Error('Outline is not exactly one pixel screen-up');
                }
              }
              if (triangles.slice(firstBody).some(t=>!t.uv)) throw Error('Ink drawn inside textured faces');
            }
            minimumTriangles = Math.min(minimumTriangles, visible); row.push(visible);
            if (!group.parts.every(p=>p.visible&&p._worldGeometry&&p.rotation===0)) throw Error('Prop loses world-space orientation');
          }
          counts.push(row);
        }
        return { renderer: root.game.renderer.type, maxDrift, minimumTriangles,
          newTextures: root.textures.getTextureKeys().length-textures,
          retained: panels.every((p,i)=>originals[i].blocks.every(b=>p.scene._wallPerspective.looseProps.blocks.includes(b))
            && originals[i].parts.every(part=>p.scene._wallPerspective.looseProps.parts.includes(part))
            && originals[i].faces.every(face=>p.geometry.materialFaces.includes(face))),
          first: counts[0], last: counts[360], headings: counts.length };
      });
      assert.equal(result.renderer, canvas ? 1 : 2);
      assert.equal(result.newTextures, 0); assert(result.retained);
      assert(result.minimumTriangles > 0); assert(result.maxDrift < 1e-7);
      assert.deepEqual(result.first, result.last); assert.deepEqual(errors, []);
      for (const angle of [0, 45, 90, 180, 270, 360]) {
        await page.locator('#angle').fill(String(angle)); await page.waitForTimeout(70);
        await page.screenshot({ path: `${output}/${canvas?'canvas':'webgl'}-${angle}.png` });
      }
      console.log(canvas ? 'Canvas' : 'WebGL', result);
      await page.close();
    }
    const game = await browser.newPage({ viewport: { width: 1080, height: 900 }, serviceWorkers: 'block' });
    const gameErrors = []; game.on('pageerror', error => gameErrors.push(error.message));
    await game.goto(base + '/index.html?sandbox=true&sandboxZone=restoration');
    await game.waitForFunction(() => window.__scene?._bootOverlayGone, null, { timeout: 90000 });
    await game.waitForTimeout(3000);
    const live = await game.evaluate(() => {
      const s = __scene, anchor = viewAnchorWorldM(s), m = s.cellM;
      s.scene.pause();
      const items = [{ kind:'chest', crate:true }, { kind:'mineralrock', yieldTier:1 },
        { kind:'mineralrock', yieldTier:3, sightBlocking:true }].map((o,i) => ({ o:{...o,id:'prop-live-'+i,x:anchor.x+(i-1)*m*2,y:anchor.y+m*2} }));
      const covered = Render.drawLowPolyProps(s,items), group = s._wallPerspective.looseProps;
      if (group.atlas.key !== PropLowPoly.ATLAS.key) throw Error('Live props did not load source textures');
      const blocks = group.blocks.slice(), parts = group.parts.slice();
      const second = Render.drawLowPolyProps(s,items);
      const stable = blocks.every(b=>group.blocks.includes(b)) && parts.every(p=>group.parts.includes(p));
      const angles = [0,37,90,180,270,360];
      for (const deg of angles) { s.mapRot=deg*Math.PI/180; HeadingUp._preRender(s);
        if (!group.parts.every(p=>p.visible && p.rotation===0)) throw Error('Live prop orientation lost');
        HeadingUp._postRender(s);
      }
      const firstCount = group.blocks.length;
      Render.drawLowPolyProps(s,items.slice(1));
      const removed = group.blocks.length === firstCount-1 && !group.parts[firstCount-1].visible;
      Render.drawLowPolyProps(s,items);
      document.querySelectorAll('#bootload,#story,#safety-card,#objective').forEach(e=>e.remove());
      return { covered:covered.size,second:second.size,blocks:firstCount,stable,removed,renderer:s.game.renderer.type };
    });
    assert.equal(live.covered,3); assert.equal(live.second,3); assert.equal(live.blocks,3);
    assert(live.stable && live.removed); assert.deepEqual(gameErrors,[]);
    for (const angle of [0,45]) {
      await game.evaluate(deg => { __scene.mapRot=deg*Math.PI/180; __scene._applyMapZoom(); WallPerspective.update(__scene); },angle);
      await game.waitForTimeout(150);
      await game.screenshot({ path:output+'/runtime-'+angle+'.png' });
    }
    console.log('Runtime', live);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
