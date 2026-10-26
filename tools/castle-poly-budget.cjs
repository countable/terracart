// Compare the retained castle mesh with the pre-fidelity baseline. Counts both
// every material triangle and actual visible submissions through WallPerspective.
// Usage: node tools/castle-poly-budget.cjs [--out /tmp/castle-fidelity-budget.json]
// Strict round audit: --baseline-dir /path/to/saved/src --max-ratio 1
// Optional --current-dir freezes the candidate; --headings accepts comma-separated degrees.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const baselineRef = value('--baseline-ref', '0645a596');
const baselineDir = value('--baseline-dir', null);
const currentDir = value('--current-dir', path.join(ROOT, 'src'));
const out = path.resolve(value('--out', '/tmp/castle-fidelity-budget.json'));
const maxRatio = Number(value('--max-ratio', '1.5'));
if (!Number.isFinite(maxRatio) || maxRatio <= 0) throw Error('--max-ratio must be positive');
const headings = value('--headings', '0,30,45,90,135,180,225,270,315').split(',').map(Number);
if (!headings.length || headings.some(angle => !Number.isFinite(angle))) throw Error('--headings requires comma-separated numeric degrees');
const modules = ['polygon_geometry.js', 'castle_styles.js', 'wall_surface_renderer.js',
  'wall_perspective.js', 'fdr_castle_layout.js', 'fdr_castle_geometry.js'];
const baselineFiles = new Set(['castle_styles.js', 'fdr_castle_layout.js', 'fdr_castle_geometry.js']);
const fixtures = {
  rectangle: [[-100,-80],[100,-80],[100,80],[-100,80]],
  narrow: [[-100,-26],[100,-26],[100,26],[-100,26]],
  concave: [[-100,-80],[100,-80],[100,-20],[20,-20],[20,80],[-100,80]],
  skewed: [[-100,-64],[70,-80],[104,62],[-66,80]],
  acute: [[-100,-64],[50,-80],[104,0],[20,28],[-42,80],[-96,44]],
  tiny: [[-2,-2],[2,-2],[2,2],[-2,2]],
  large: Array.from({length:64}, (_, i) => [10000*Math.cos(i*Math.PI/32), 10000*Math.sin(i*Math.PI/32)]),
};
function source(file, baseline) {
  if (!baseline) return fs.readFileSync(path.join(currentDir, file), 'utf8');
  if (baselineDir && (baselineFiles.has(file) || fs.existsSync(path.join(baselineDir, file)))) return fs.readFileSync(path.join(baselineDir, file), 'utf8');
  return execFileSync('git', ['show', `${baselineRef}:src/${file}`], {cwd:ROOT, encoding:'utf8'});
}
function runtime(baseline) {
  const ctx = { console, CELL_PX:32 };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  ctx.sourceHashes = {};
  for (const file of modules) {
    const code = source(file, baseline);
    ctx.sourceHashes[file] = createHash('sha256').update(code).digest('hex');
    vm.runInContext(code, ctx, {filename:file});
  }
  return ctx;
}
function draw(ctx, points, family, active) {
  let submitted = 0;
  const gfx = { clear(){ submitted = 0; }, fillStyle(){}, fillTriangle(){ submitted++; } };
  const scene = { _headingUp:true, depth:0, mapRot:0, buildingWallContainer:{add(){}},
    add:{graphics:()=>gfx}, textures:{exists:()=>true, get:()=>({setFilter(){}})} };
  const group = ctx.WallPerspective.begin(scene, 'castles');
  const model = ctx.FDRCastleGeometry.draw(scene, 'castles', points.map(([x,y])=>({x,y})), {family,active});
  if (!model) throw Error(`${family}: fixture did not produce a layout`);
  const retained = new Set(group.blocks);
  const result = { blocks:group.blocks.length, materialTriangles:0, byMaterial:{}, visible:[], finite:true, retained:true };
  for (const block of group.blocks) {
    if (!block.materialFaces) throw Error('Budget requires explicit material faces for every castle block');
    for (const face of block.materialFaces) {
      if (face.points.length !== 3) throw Error('Material count must measure triangles, not polygons');
      result.materialTriangles++;
      const material = face.material || 'unlabelled';
      result.byMaterial[material] = (result.byMaterial[material] || 0) + 1;
      result.finite &&= face.points.every(p=>[p.x,p.y,p.z].every(Number.isFinite));
    }
  }
  for (const degrees of headings) {
    scene.mapRot = degrees*Math.PI/180;
    ctx.WallPerspective.update(scene);
    const materialTriangles = group.blocks.reduce((sum,b)=>sum+b.materialFaces.filter(f=>f.visible).length,0);
    result.visible.push({degrees, materialTriangles, submittedTriangles:submitted});
    result.finite &&= group.blocks.every(b=>[...b.projected].every(Number.isFinite));
    result.retained &&= group.blocks.length===retained.size && group.blocks.every(b=>retained.has(b));
  }
  return result;
}
const before = runtime(true), after = runtime(false);
const report = { baselineRef, baselineDir, currentDir, currentRef:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),
  limitRatio:maxRatio, headings, sourceHashes:{baseline:before.sourceHashes,current:after.sourceHashes}, countScope:'All retained castle material triangles; actual submitted triangles at each heading also include outline triangles. Courtyard ground and unrelated gameplay sprites are excluded in both versions.',
  cases:[], failures:[], maxMaterialRatio:0, maxSubmittedRatio:0 };
for (const [shape, points] of Object.entries(fixtures)) for (const family of ['citadel','bastion','archive']) for (const active of [false,true]) {
  const baseline = draw(before, points, family, active), current = draw(after, points, family, active);
  const name = `${family}/${shape}/${active?'restored':'wrecked'}`;
  const materialRatio = baseline.materialTriangles ? current.materialTriangles/baseline.materialTriangles : current.materialTriangles ? Infinity : 1;
  const submitted = baseline.visible.map((base,i)=>{
    const next = current.visible[i];
    const ratio = base.submittedTriangles ? next.submittedTriangles/base.submittedTriangles : next.submittedTriangles ? Infinity : 1;
    if (ratio>maxRatio) report.failures.push(`${name} ${base.degrees}deg: submitted ${next.submittedTriangles} > ${maxRatio} x ${base.submittedTriangles}`);
    report.maxSubmittedRatio=Math.max(report.maxSubmittedRatio,ratio);
    return {degrees:base.degrees,baseline:base.submittedTriangles,current:next.submittedTriangles,ratio};
  });
  report.cases.push({family,shape,active,baseline,current,materialRatio,submitted});
  report.maxMaterialRatio=Math.max(report.maxMaterialRatio,materialRatio);
  if(materialRatio>maxRatio) report.failures.push(`${name}: material ${current.materialTriangles} > ${maxRatio} x ${baseline.materialTriangles}`);
  if(!current.finite||!current.retained) report.failures.push(`${name}: geometry must remain finite and retained through rotation`);
}
report.passed=report.failures.length===0;
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,headings:headings.length,maxMaterialRatio:report.maxMaterialRatio,maxSubmittedRatio:report.maxSubmittedRatio,failures:report.failures,out},null,2));
if(!report.passed)process.exitCode=1;
