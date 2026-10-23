import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {access} from 'node:fs/promises';
import {join} from 'node:path';
import {input,now,temp} from './fixtures.mjs';
const api=await import('./config.mjs').catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?{}:Promise.reject(e));
const fn=name=>{assert.equal(typeof api[name],'function','Missing implementation: '+name);return api[name];};
test('输入-IN-001 short phrases preserve order and stable case-insensitive dedup',()=>{
 const c=fn('normalizeConfig')({...input,keywords:[' christian skits ','BIBLE comedy','CHRISTIAN SKITS']},now);
 assert.deepEqual(c.keywords,['christian skits','BIBLE comedy']);assert.equal(c.requireBioEmail,true);
});
test('输入-IN-002 invalid inputs are rejected before running',()=>{
 const normalize=fn('normalizeConfig');
 for(const change of [{keywords:[]},{keywords:[' ']},{keywords:[1]},{days:0},{days:1.5},{minAverageViewsExclusive:-1},{country:'ZZ'},{country:undefined},{requireBioEmail:'true'},{targetCount:0},{unknown:1}])assert.throws(()=>normalize({...input,...change},now));
 assert.equal(normalize({...input,country:null},now).country,null);
});
test('配置-CONFIG-001 Shanghai complete days remain frozen across resume',()=>{
 const c=fn('normalizeConfig')(input,now);assert.equal(c.windowStart,'2026-10-10T16:00:00.000Z');assert.equal(c.windowEndExclusive,'2026-10-20T16:00:00.000Z');
 fn('assertResumeCompatible')(c,input);assert.throws(()=>fn('assertResumeCompatible')(c,{...input,days:9}));assert.throws(()=>fn('assertResumeCompatible')(c,{...input,keywords:[...input.keywords].reverse()}));
});
test('停止-LIMIT-001 optional run limits are validated, frozen and absent from legacy configs',()=>{
 const normalize=fn('normalizeConfig'),c=normalize({...input,maxKeywords:10,stopAtTarget:true,targetCount:100},now);
 assert.equal(c.maxKeywords,10);assert.equal(c.stopAtTarget,true);
 assert.equal(normalize(input,now).maxKeywords,undefined);assert.equal(normalize(input,now).stopAtTarget,undefined);
 fn('assertResumeCompatible')(c,{...input,maxKeywords:10,stopAtTarget:true,targetCount:100});
 assert.throws(()=>fn('assertResumeCompatible')(c,{...input,maxKeywords:11,stopAtTarget:true,targetCount:100}));
 for(const change of [{maxKeywords:0},{maxKeywords:1.5},{maxKeywords:'10'},{stopAtTarget:'true'},{stopAtTarget:true,targetCount:undefined}])assert.throws(()=>normalize({...input,...change},now));
});
test('CLI dry-run does not touch browser or create a run directory',async t=>{
 const dir=await temp(t),runDir=join(dir,'not-created');
 const r=spawnSync(process.execPath,[new URL('./find.mjs',import.meta.url).pathname,'--run-dir',runDir,'--config-json',JSON.stringify(input),'--dry-run'],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).mode,'dry_run');await assert.rejects(access(runDir));
});
