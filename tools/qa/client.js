#!/usr/bin/env node
'use strict';
const command=JSON.parse(process.argv[2]||'{"action":"observe"}');
fetch(`http://127.0.0.1:${process.env.QA_PORT||7732}/command`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)})
.then(async r=>{const data=await r.json();if(!r.ok)process.exitCode=1;
  if(process.argv.includes('--full'))return console.log(JSON.stringify(data));
  const o=data.observation||data;
  const compact={...o};delete compact.cells;
  if(compact.controls)compact.controls=compact.controls.map(c=>`${c.id} ${c.label}${c.disabled?' [disabled]':''}`);
  if(compact.targets)compact.targets=compact.targets.map(({x,y,cellIX,cellIY,...t})=>t);
  console.log(JSON.stringify({step:data.step,simulatedMs:data.simulatedMs,result:data.result&&{...data.result,observation:undefined},observation:compact}));
}).catch(e=>{console.error(e);process.exitCode=1;});
