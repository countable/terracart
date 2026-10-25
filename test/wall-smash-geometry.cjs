const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const { crossing } = vm.runInNewContext(fs.readFileSync('src/wall_smash.js', 'utf8') + '; WallSmash');
const square = [0,0,10,0,10,10,0,10];
assert.equal(crossing(-2,5,2,5,square).x, 0);
assert.equal(crossing(5,5,12,5,square).x, 10);
assert.equal(crossing(-5,5,15,5,square).x, 0, 'fast movement finds the first wall');
assert.equal(crossing(2,2,8,8,square), null, 'walking inside a building is free');
assert.equal(crossing(-2,-2,-1,-1,square), null);
assert.equal(crossing(-2,-1,12,-1,square), null, 'parallel movement is free');
assert.equal(crossing(98,105,102,105,square,100,100).x,100);
const concave = [0,0,10,0,10,4,4,4,4,10,0,10];
assert.equal(crossing(8,8,2,8,concave).x,4);
console.log('Wall crossing geometry: 8 checks passed');
let now = 0;
const cache = new Map([['14/0/0', {tileEdgeM:100, buildingShapes:[{key:'house',ring:[10,0,20,0,20,20,10,20]}]}]]);
const smash = vm.runInNewContext(fs.readFileSync('src/wall_smash.js','utf8')+'; WallSmash', {
  performance:{now:()=>now}, WorldGen:{tileCache:cache}
});
const flashes = [];
const scene = {flashAtWorld: text => flashes.push(text), _burstAtWorld: () => { throw Error('No impact particles'); }, startWorldM:{x:0,y:0},playerM:{x:9,y:5},_targetM:{x:10.5,y:5}};
assert(smash.hold(scene,11,5));
now = 10000;
assert(smash.hold(scene,11,5),'time alone never releases a near-wall target');
assert.equal(scene._wallSmashes,undefined);
scene._targetM = {x:11.99,y:100};
assert(smash.hold(scene,11,5),'parallel distance does not count as wall clearance');
scene._targetM = {x:12,y:5};
assert(smash.hold(scene,11,5),'wind-up starts after clearance');
now += smash.PAUSE_MS - 1; assert(smash.hold(scene,11,5));
scene._targetM.x = 11;
assert(smash.hold(scene,11,5),'GPS retreat resets the wind-up');
now += 1000; scene._targetM.x = 12;
assert(smash.hold(scene,11,5));
now += smash.PAUSE_MS;
assert.equal(smash.hold(scene,11,5),false);
assert.equal(scene._wallSmashes,undefined);
assert.deepEqual(flashes,['SMASH!']);
now += 1000; scene.playerM.x = 11; scene._targetM.x = 9.5;
assert(smash.hold(scene,9,5),'exit also needs clearance');
now += 1000; assert(smash.hold(scene,9,5));
scene._targetM.x = 8; assert(smash.hold(scene,9,5));
now += smash.PAUSE_MS; assert.equal(smash.hold(scene,9,5),false);
console.log('Wall clearance: time, perpendicular distance, retreat, entry and exit passed');

const wreckSmash = vm.runInNewContext(fs.readFileSync('src/wall_smash.js','utf8')+'; WallSmash', {
  performance:{now:()=>now}, WorldGen:{tileCache:cache},
  Houses:{isHouseWreck: (save, house) => house.id === 'house' && !save.restoredHouses?.house}
});
scene.playerM.x = 9; scene._targetM.x = 12; scene.save = {};
now += 1000;
assert.equal(wreckSmash.hold(scene,11,5),false,'wreck crossing is free');
assert.equal(flashes.length,2,'wreck has no smash popup');
scene.save.restoredHouses = {house:'plain'};
assert.equal(wreckSmash.hold(scene,11,5),true,'restored wreck resumes wall wind-up');
