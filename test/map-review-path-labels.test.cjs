const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = { StreetVariants: { VARIANT_BY_ID: {
  lantern: {title:'Lantern Row'}, spider: {title:'Spider Path'},
} } };
vm.runInNewContext(fs.readFileSync('tools/map-review-paths.js','utf8'),root);
const layout=root.MapReviewPaths.labelPlacements;
const row=(variant,line,mapLabel='')=>({variant,line,mapLabel});
const horizontal=row('lantern',[{x:20,y:50},{x:580,y:50}]);
const run=(rows,zoom=17)=>layout(rows,p=>p,{x:600,y:400},text=>text.length*6,zoom);
assert.equal(run([horizontal],16).length,0,'overview stays uncluttered');
let labels=run([horizontal]);
assert.equal(labels[0].text,'Lantern Row','unnamed path still identifies its variant');
assert.equal(labels[0].angle,0,'text sits on the path tangent');
assert.equal(run([horizontal,horizontal]).length,labels.length,'overlapping labels are suppressed');
labels=run([row('spider',[{x:500,y:300},{x:100,y:100}])]);
assert.ok(labels.length);
assert.ok(labels[0].angle>=-Math.PI/2&&labels[0].angle<=Math.PI/2,'reversed source lines never make upside-down type');
assert.ok(Math.abs(labels[0].angle-Math.atan2(200,400))<1e-6,'diagonal baseline follows geometry');
labels=run([row('spider',[{x:20,y:100},{x:580,y:100}],'Creek trail')],19);
assert.equal(labels[0].text,'Spider Path · Creek trail','close view retains both theme and source identity');
assert.equal(run([row('spider',[{x:0,y:10},{x:20,y:10}])]).length,0,'text never overruns short sections');
assert.equal(run([row('spider',[{x:700,y:10},{x:900,y:10}])]).length,0,'offscreen sections do no drawing');
labels=run([row('lantern',[{x:30,y:300},{x:30,y:30},{x:60,y:30},{x:60,y:300}])]);
assert.ok(labels.every(label=>label.y>40),'a hairpin cannot get text stretched across its turn');
labels=layout([row('lantern',[{x:0,y:100},{x:1600,y:100}])],p=>p,{x:1600,y:300},text=>text.length*6,17);
assert.ok(labels.length>1,'long paths repeat their identity');
for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++) {
  const a=labels[i].box,b=labels[j].box;
  assert.ok(!(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top),'accepted label bounds never overlap');
}
console.log('Path labels cover unnamed variants, follow readable tangents, cull and avoid collisions.');
