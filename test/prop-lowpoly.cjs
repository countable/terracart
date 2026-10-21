const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('src/prop_lowpoly.js', 'utf8'), ctx);
const api = ctx.window.PropLowPoly;
const vertexKey = p => [p.x, p.y, p.z].join(',');
for (const kind of ['crate', 'rock']) for (const id of ['north', 'south', 73]) {
  const mesh = api.geometry(kind, { id, mineral: 'gold' });
  assert.deepEqual(mesh, api.geometry(kind, { id, mineral: 'gold' }), 'stable identity');
  const shell = mesh.materialFaces.filter(f => !f.detail), edges = new Map();
  let volume = 0;
  for (const face of shell) {
    const [a, b, c] = face.points;
    volume += (a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)) / 6;
    for (let i = 0; i < 3; i++) {
      const p = vertexKey(face.points[i]), q = vertexKey(face.points[(i + 1) % 3]);
      const key = [p, q].sort().join('|'), edge = edges.get(key) || { count: 0, winding: 0 };
      edge.count++; edge.winding += p < q ? 1 : -1; edges.set(key, edge);
    }
  }
  assert(volume > 0, 'outward closed volume');
  for (const edge of edges.values()) assert.deepEqual(edge, { count: 2, winding: 0 }, 'no gaps or inverted seams');
  for (const f of mesh.materialFaces) for (const p of f.points)
    for (const axis of ['x', 'y', 'z', 'u', 'v']) assert(Number.isFinite(p[axis]));
  for (const { points: [a, b, c] } of mesh.materialFaces)
    assert(Math.abs((b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u)) > 1e-9, 'Canvas texture triangle is nondegenerate');
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 32) {
    let area = 0, visible = 0;
    for (const f of shell) {
      const [a, b, c] = f.points.map(p => ({ x: p.x - Math.sin(angle) * p.z, y: p.y - Math.cos(angle) * p.z }));
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      area += cross; if (cross > 1e-8) visible++;
    }
    assert(Math.abs(area) < 1e-8, 'projected front/back boundaries agree through a full turn');
    assert(visible >= 2, 'solid visible at every compass angle');
  }
}
assert.notDeepEqual(api.geometry('rock', { id: 'a' }), api.geometry('rock', { id: 'b' }), 'rock identity varies silhouette');
for (const mineral of api.MATERIALS.filter(k => k !== 'plain'))
  assert(api.geometry('rock', { mineral }).materialFaces.every(f => f.materialSlot >= api.ATLAS.rockStart), mineral + ' samples authored rock texture');
console.log('Low-poly props: closed volume, deterministic silhouettes, source textures, full compass sweep passed.');

for (let frame = 0; frame < 65; frame++) {
  const mesh = api.geometry('rock', { frame });
  assert(mesh.materialFaces.every(f => f.materialSlot === api.ATLAS.rockStart + frame));
}
for (let frame = 0; frame < 4; frame++) {
  const mesh = api.geometry('crate', { frame });
  assert(mesh.materialFaces.every(f => [frame*2, frame*2+1].includes(f.materialSlot)));
}
console.log('All 65 rock frames and four crate variants preserve authored texture identity.');
