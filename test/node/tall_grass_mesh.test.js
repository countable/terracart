(() => {
  const square = (x=0,y=0,size=32) => [{x,y},{x:x+size,y},{x:x+size,y:y+size},{x,y:y+size}];
  test('grass blades: roots stay grounded and surface/Underdark use separate texture halves', () => {
    const surface = WallMaterials.geometry('grass',square(),0), pink = WallMaterials.geometry('grass',square(),0,{underdark:true});
    assert.gt(surface.length, 64, 'dense field');
    assert.eq(surface.length,pink.length,'same geometry density');
    assert.truthy(surface.every(f=>f.twoSided && f.billboard && f.points.some(p=>p.z===0) && f.points.some(p=>p.z===11.9)));
    assert.truthy(surface.every(f=>f.points.every(p=>p.u>0 && p.u<.5 && Number.isFinite(p.x) && Number.isFinite(p.y))));
    assert.truthy(pink.every(f=>f.points.every(p=>p.u>.5 && p.u<1)));
    assert.eq(WallMaterials.GRASS.rootShade,.45);
  });
  test('grass blades: world-seeded offsets do not leave seams or duplicate boundary blades', () => {
    const roots = (points,options) => WallMaterials.geometry('grass',points,0,options).filter((_,i)=>i%2===0).map(f=>f.billboard);
    const small=[];
    for(let y=0;y<2;y++)for(let x=0;x<2;x++)small.push(...roots(square(x*32,y*32),{cellIX:x,cellIY:y}));
    const key=p=>p.x.toFixed(6)+','+p.y.toFixed(6);
    const whole=roots(square(0,0,64),{cellSize:64});
    assert.eq(new Set(small.map(key)).size,small.length,'unique ownership');
    assert.eq(small.map(key).sort().join('|'),whole.map(key).sort().join('|'),'partition does not change field');
    const shifted=roots(square(100,200),{}), normal=roots(square(),{});
    assert.eq(shifted.map(p=>key({x:p.x-100,y:p.y-200})).join('|'),normal.map(key).join('|'),'camera translation does not reroll');
    const offsets=new Set(normal.map(p=>Math.round(p.x-(Math.round(p.x/4.2-.5)+.5)*4.2)));
    assert.eq([...offsets].sort().join(','),'-1,0,1','individual blade offsets');
    const negative=roots(square(-32,-32),{cellIX:-1,cellIY:-1});
    assert.truthy(negative.every(p=>p.x>=-32 && p.x<0 && p.y>=-32 && p.y<0),'negative cells retain ownership');
  });
  test('grass volume: native gaps do not suppress co-located object or plant rendering', () => {
    assert.falsy(typeof Render.grassHiddenObjects === 'function','no hard concealment predicate');
    assert.falsy(RENDER_SRC.includes('_grassHidden'), 'no hidden-prop metadata or sprite culling');
  });
})();
