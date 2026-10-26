test('FDR Canvas: cached coverage and UV transforms invalidate for atlas or geometry changes', () => {
  const previous={Phaser:globalThis.Phaser,Path2D:globalThis.Path2D};
  const matrix={a:1,b:0,c:0,d:1,e:0,f:0},image={width:512,height:512};
  let draws=0,inverses=0;
  globalThis.Phaser={GameObjects:{GetCalcMatrix:()=>({calc:matrix})}};
  globalThis.Path2D=class {moveTo(){} lineTo(){} closePath(){}};
  const transform={transformPoint:p=>({x:p.x+matrix.e,y:p.y+matrix.f}),
    inverse(){inverses++;return {transformPoint:p=>({x:p.x-matrix.e,y:p.y-matrix.f})};}};
  const context={save(){},restore(){},setTransform(){},getTransform:()=>transform,beginPath(){},
    moveTo(){},lineTo(){},closePath(){},clip(){},transform(){},fill(){},drawImage(){draws++;}};
  const triangle=points=>({points:points.map(([x,y])=>({x,y})),
    uv:points.map(([x,y])=>({x,y,z:0,u:x/512,v:y/512})),alpha:1,color:0xffffff});
  const target={alpha:1,_wallAtlas:{getSourceImage:()=>image},_wallTriangles:[
    // One same-affine run starts offscreen and has an offscreen middle
    // triangle between visible neighbors sharing a diagonal.
    triangle([[40,0],[50,0],[40,10]]),triangle([[0,0],[10,0],[10,10]]),
    triangle([[60,0],[70,0],[60,10]]),triangle([[0,0],[10,10],[0,10]]),
    triangle([[21,0],[31,0],[21,10]]),triangle([[90,0],[100,0],[90,10]])]};
  target._wallTriangles[4].uv.forEach(p=>p.z=1);
  target._wallTriangles[5].uv.forEach(p=>p.z=2);
  const camera={x:0,y:0,width:20,height:20,alpha:1,addToRenderList(){}};
  const render=()=>target.renderCanvas({currentContext:context},target,camera,null);
  try {
    FDRCastleCanvas.attach(target);render();
    assert.eq(draws,3,'original same-affine union batches and all retained triangles draw');
    assert.eq(inverses,1,'coverage expansion inverts the camera once for the frame');
    const cache=target._fdrCanvasEdgeCache,affines=cache.affines;
    render();
    assert.truthy(target._fdrCanvasEdgeCache===cache&&cache.affines===affines,'paused frames reuse topology and UV transforms');
    assert.eq(inverses,2);
    matrix.e=-40;draws=0;render();
    assert.eq(draws,3,'panning preserves the original draw batches');
    assert.truthy(target._fdrCanvasEdgeCache===cache,'camera changes do not alter shared-edge coverage');
    image.width=1024;render();
    assert.truthy(target._fdrCanvasEdgeCache!==cache,'atlas dimensions invalidate texture transforms');
    assert.eq(target._fdrCanvasEdgeCache.affines[0][0],affines[0][0]/2);
    const resized=target._fdrCanvasEdgeCache,oldFirst=target._wallTriangles[0],commands=target._wallTriangles.slice();
    target._wallTriangles.length=0;
    for(const t of commands)WallSurfaceRenderer.paint(target,t.points[0].x,t.points[0].y,t.points[1].x,t.points[1].y,
      t.points[2].x,t.points[2].y,0xffffff,1,{points:t.uv,color:0xffffff});
    assert.truthy(target._wallTriangles[0]!==oldFirst,'production FDR repaint replaces retained command identities');
    render();assert.truthy(target._fdrCanvasEdgeCache!==resized,'same-count geometry repaint invalidates coverage');
  } finally {
    for(const [key,value]of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;
  }
});
