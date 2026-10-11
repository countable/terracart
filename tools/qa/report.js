#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve(process.argv[2]||'/tmp/gameplay-qa');
const read=(name,fallback)=>{try{return JSON.parse(fs.readFileSync(path.join(out,name),'utf8'));}catch{return fallback;}};
const run=read('run.json',{});
const actions=fs.readFileSync(path.join(out,'actions.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const findings=read('findings.json',[]);
const coverage=read('coverage.json',[]);
const extraEvidence=[['bow-clock-verification.json','Bow parity'],['integration-verification.json','Runner integration'],['node-tests.log','Game tests'],['maintenance.jsonl','Harness revisions']].filter(([file])=>fs.existsSync(path.join(out,file)));
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const duration=ms=>`${Math.floor((ms||0)/60000)}:${String(Math.floor((ms||0)%60000/1000)).padStart(2,'0')}`;
const milestones=[],stories=[],seenStories=new Set();let lastObjective='';
for(const a of actions){
 const objective=a.after?.hud?.objective;
 if(objective&&objective!==lastObjective){milestones.push({step:a.step,ms:a.simulatedMs,objective});lastObjective=objective;}
 for(const m of a.after?.menus||[]){const key=m.kind+'|'+m.text;if(!seenStories.has(key)){seenStories.add(key);stories.push({step:a.step,ms:a.simulatedMs,...m});}}
}
const energies=actions.map(a=>a.after?.hud?.energy).filter(Number.isFinite);
const waits=actions.filter(a=>a.command.action==='wait');
const metrics={actions:actions.length,simulatedMs:run.simulatedMs||0,wallMinutes:Math.round(((run.completedAt?Date.parse(run.completedAt):Date.now())-Date.parse(run.started))/60000),
 movementActions:actions.filter(a=>a.command.action==='move').length,
 interactionActions:actions.filter(a=>a.command.action==='interact').length,
 menuActions:actions.filter(a=>a.command.action==='activate').length,
 requestedWaitMinutes:waits.reduce((s,a)=>s+(a.command.seconds||0),0)/60,
 actualWaitMinutes:waits.reduce((s,a)=>s+(a.result?.advancedMs||0),0)/60000,
 energyRange:energies.length?[Math.min(...energies),Math.max(...energies)]:[],
 final:actions.at(-1)?.after?.hud,milestones,dialoguePanels:stories.length,screenshots:run.screenshots?.length||0,
 errors:run.errors?.length||0,fixtureMisses:[...new Set(run.fixtureMisses||[])],
 completed:(run.simulatedMs||0)>=run.simulationBudgetMs};
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(metrics,null,2));
const screenshotKeys=new Map();
for(const shot of run.screenshots||[]){
 const observation=read(shot.file.replace(/\.png$/,'.json'),{});
 const panels=(observation.menus||[]).map(m=>m.kind+'|'+m.text).join('\n');
 const key=panels || [shot.reason.replace(/^before-/,'').replace(/reading-time|read-.*|interaction/,'world'),observation.hud?.objective].join('|');
 screenshotKeys.set(key,shot);
}
const selectedShots=[...screenshotKeys.values()].sort((a,b)=>a.action-b.action);
const gallery=shots=>`<div class="gallery">${shots.map(s=>`<div><a href="${encodeURIComponent(s.file)}"><img loading="lazy" src="${encodeURIComponent(s.file)}" alt="${escape(s.reason)}"></a><small>${duration(s.simulatedMs)} · action ${s.action}<br>${escape(s.reason)}</small></div>`).join('')}</div>`;
const table=(headers,rows)=>`<table><thead><tr>${headers.map(h=>`<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Dragon Hood gameplay QA</title><style>
body{font:16px/1.5 system-ui,sans-serif;max-width:1100px;margin:36px auto;padding:0 20px;color:#e5e7eb;background:#111827}h1,h2{line-height:1.2}a{color:#93c5fd}small{color:#9ca3af}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{text-align:left;padding:9px;border-bottom:1px solid #374151;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#1f2937;padding:14px;border-radius:8px}.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px}.gallery img{width:100%;border-radius:8px}.card{background:#1f2937;padding:15px;border-radius:8px;margin:12px 0}.badge{background:#374151;padding:3px 8px;border-radius:6px}details{margin:12px 0}summary{cursor:pointer}blockquote{border-left:3px solid #64748b;padding-left:15px;margin-left:0}footer{margin-top:40px;color:#9ca3af}</style>
<h1>Dragon Hood gameplay QA</h1><p><span class="badge">${metrics.completed?'120-minute budget reached':'Run incomplete'}</span> ${duration(metrics.simulatedMs)} simulated play · ${metrics.actions} actions · ${metrics.screenshots} screenshots</p>
<p>Fresh Easy-mode save on recorded Kelowna tiles. The player used viewport text, displayed menus, one-cell joystick movement, and normal interactions. Simulation pauses between commands. Reading and waiting time is explicit in the action log.</p>
<h2>Findings</h2>${findings.length?findings.map(f=>`<article class="card"><strong>${escape(f.severity||'Observation')} · ${escape(f.title)}</strong><p>${escape(f.description)}</p>${f.evidence?`<p>Evidence: ${escape(f.evidence)}</p>`:''}${f.screenshot?`<a href="${escape(f.screenshot)}">Screenshot</a>`:''}${f.reproduction?`<pre>${escape(f.reproduction)}</pre>`:''}<small>${escape(f.confidence||'Requires review')}</small></article>`).join(''):'<p>Findings have not yet been reviewed. An empty list is not a clean bill of health.</p>'}
<h2>Progression</h2>${table(['Time','Action','Visible objective'],milestones.map(m=>[duration(m.ms),escape(m.step),escape(m.objective)]))}
<p>Energy range: ${escape(metrics.energyRange.join('–'))}. Final HUD: ${escape(JSON.stringify(metrics.final))}. ${metrics.movementActions} movement commands, ${metrics.interactionActions} map interactions, ${metrics.menuActions} control activations.</p>
<h2>Evidence</h2><p><a href="actions.jsonl">Action transcript</a> · <a href="run.json">Run configuration and errors</a> · <a href="summary.json">Metrics</a> · <a href="clock-verification.json">Clock verification</a>${extraEvidence.map(([file,label])=>` · <a href="${file}">${label}</a>`).join('')}</p>
<p>${selectedShots.length} distinct interactions and objective states selected from ${metrics.screenshots} captures.</p>${gallery(selectedShots)}
<details><summary>All ${metrics.screenshots} screenshots</summary>${gallery(run.screenshots||[])}</details>
<h2>Encountered dialogue and menus</h2>${stories.map(s=>`<details><summary>${duration(s.ms)} · ${escape(s.kind)} · action ${s.step}</summary><blockquote>${escape(s.text)}</blockquote></details>`).join('')}
<h2>Coverage and limits</h2>${coverage.map(x=>`<p>${escape(x)}</p>`).join('')}<ul>${(run.limitations||[]).map(x=>`<li>${escape(x)}</li>`).join('')}<li>The player is a conservative scripted policy with agent supervision. Reading time is estimated, and no human-equivalent pacing claim is made.</li><li>Story checks apply only to encountered panels. Unreached story gates remain uncovered.</li><li>Seeded randomness and fixed fixtures aid reproduction; async loading order can still vary. Review checkpoints and observations during replay.</li></ul>
<details><summary>Runtime errors (${metrics.errors}) and missing fixture tiles (${metrics.fixtureMisses.length})</summary><pre>${escape(JSON.stringify({errors:run.errors,fixtureMisses:metrics.fixtureMisses},null,2))}</pre></details>
<footer>Generated ${escape(new Date().toISOString())}. Screenshots show the actual Chromium game page.</footer></html>`;
fs.writeFileSync(path.join(out,'index.html'),html);
console.log(JSON.stringify({report:path.join(out,'index.html'),...metrics,milestones:milestones.length}));
