import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
const api=await import('./progress.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function state(status='running'){return {status,topicIndex:0,topics:[{keyword:'book',currentPage:{cursor:'c1'},activePageState:{nextItemIndex:0}}],authors:{'1':{verification:{status:'completed',matches:true}},'2':{verification:{status:'completed',matches:false}}}};}
function create(extra={}){assert.equal(typeof api.createProgress,'function','progress reporter missing');const writes=[];return {writes,reporter:api.createProgress({runDir:'/not-used',runId:'test',intervalMs:10,write:async value=>writes.push(structuredClone(value)),...extra})};}
test('状态-PROGRESS-001 heartbeat and real progress remain distinct with bounded snapshots',async()=>{
 let now=1000;const {reporter:r,writes}=create({now:()=>now});const batch=state();await r.updateBatch(batch);now=2000;await sleep(18);const s=writes.at(-1);assert.equal(s.runId,'test');assert.equal(s.processed,2);assert.equal(s.matched,1);assert.equal(s.heartbeatAt,2000);assert.equal(s.lastProgressAt,1000);assert.ok(JSON.stringify(s).length<2048);await r.finish({...batch,status:'completed'});
});
test('状态-PROGRESS-001 action context and pacing wait are visible without changing batch schema',async()=>{
 let now=1000;const {reporter:r,writes}=create({now:()=>now});await r.updateBatch(state());r.context({stage:'profile',username:'example',authorId:'1'});r.wait({until:10000,reason:'action_pacing'});now=2000;await sleep(18);assert.equal(writes.at(-1).status,'waiting');assert.equal(writes.at(-1).waitUntil,10000);assert.equal(writes.at(-1).username,'example');r.wait(null);r.action({phase:'after',action:'click'});await r.finish(state('paused'));assert.equal(writes.at(-1).status,'paused');assert.equal(writes.at(-1).lastProgressAt,2000);
});
test('生命周期-PROGRESS-002 slow writes never overlap and terminal state cannot be overwritten',async()=>{
 let active=0,max=0;const writes=[];const {reporter:r}=create({intervalMs:2,write:async v=>{active++;max=Math.max(max,active);await sleep(8);writes.push(v);active--;}});await r.updateBatch(state());await sleep(14);await r.finish(state('completed'));const n=writes.length;await sleep(18);assert.equal(max,1);assert.equal(writes.length,n);assert.equal(writes.at(-1).status,'completed');await r.finish(state('failed'));assert.equal(writes.length,n);
});
test('生命周期-PROGRESS-002 never started reporter leaves a locked/invalid batch untouched',async()=>{
 const {reporter:r,writes}=create();await r.finish(state('failed'));assert.equal(writes.length,0);
});
test('生命周期-PROGRESS-002 background disk failure is surfaced and stops future writes',async()=>{
 let n=0;const {reporter:r}=create({write:async()=>{if(++n>1)throw Error('disk_full');}});await r.updateBatch(state());await sleep(18);assert.throws(()=>r.assertHealthy(),e=>e.storageFailure===true);await assert.rejects(r.finish(state('failed')),/disk_full/);const count=n;await sleep(18);assert.equal(n,count);
});
function child(){return Object.assign(new EventEmitter(),{exitCode:null,signalCode:null});}
function watcher(extra={}){assert.equal(typeof api.watchChild,'function','child monitor missing');const c=child(),lines=[];const promise=api.watchChild(c,{runDir:'/not-used',runId:'current',intervalMs:5,read:async()=>null,print:v=>lines.push(JSON.parse(v)),...extra});return {c,lines,promise};}
test('启动-PROGRESS-003 monitor streams starting and final result and removes listeners',async()=>{
 const {c,lines,promise}=watcher({read:async()=>({runId:'current',status:'completed',heartbeatAt:Date.now(),lastProgressAt:Date.now()})});c.emit('exit',0,null);assert.equal(await promise,0);assert.equal(lines[0].status,'starting');assert.equal(lines.at(-1).status,'completed');assert.equal(c.listenerCount('exit'),0);assert.equal(c.listenerCount('error'),0);const n=lines.length;await sleep(15);assert.equal(lines.length,n);
});
test('启动-PROGRESS-003 old run status cannot masquerade as a live or successful run',async()=>{
 const {c,lines,promise}=watcher({read:async()=>({runId:'old',status:'completed'})});await sleep(12);assert.ok(lines.every(x=>x.status!=='completed'));c.emit('exit',0,null);await promise;assert.equal(lines.at(-1).status,'interrupted');assert.equal(lines.at(-1).reason,'worker_exit_without_final_status');
});
test('启动-PROGRESS-003 nonzero exit conflicts with completed status and reports failure',async()=>{
 const {c,lines,promise}=watcher({read:async()=>({runId:'current',status:'completed'})});c.emit('exit',1,null);assert.equal(await promise,1);assert.equal(lines.at(-1).status,'failed');
});
test('启动-PROGRESS-003 spawn error has one terminal output and no delayed polling',async()=>{
 const {c,lines,promise}=watcher();c.emit('error',Error('spawn_failed'));assert.equal(await promise,1);assert.equal(lines.at(-1).reason,'spawn_failed');const n=lines.length;await sleep(15);assert.equal(lines.length,n);
});
test('卡住-PROGRESS-004 stale heartbeat and no progress produce distinct attention signals',async()=>{
 let snapshot={runId:'current',status:'running',heartbeatAt:1000,lastProgressAt:1000};const {c,lines,promise}=watcher({now:()=>200000,read:async()=>snapshot});await sleep(10);assert.equal(lines.at(-1).attention,'heartbeat_stale');snapshot={...snapshot,heartbeatAt:200000};await sleep(10);assert.equal(lines.at(-1).attention,'no_progress');snapshot={...snapshot,status:'waiting',waitUntil:300000};await sleep(10);assert.equal(lines.at(-1).attention,null);c.emit('exit',3,null);await promise;
});
test('生命周期-PROGRESS-002 repeated start/finish cycles have no output after closure',async()=>{
 const all=[];for(let i=0;i<20;i++){const f=create({intervalMs:2});await f.reporter.updateBatch(state());await f.reporter.finish(state('completed'));all.push(f.writes);}const n=all.map(x=>x.length);await sleep(15);assert.deepEqual(all.map(x=>x.length),n);
});

test('状态-PROGRESS-005 resumed paused/failed checkpoints are active until this execution finishes',async()=>{
 for(const status of ['paused','failed']){const {reporter:r,writes}=create();await r.updateBatch({...state(status),reason:'previous_error'});assert.equal(writes[0].status,'running');assert.equal(writes[0].reason,null);await r.finish(state('completed'));assert.equal(writes.at(-1).status,'completed');}
});
test('启动-PROGRESS-003 missing or conflicting final status cannot produce success exit code',async()=>{
 for(const snapshot of [null,{runId:'current',status:'paused'}]){const {c,promise}=watcher({read:async()=>snapshot});c.emit('exit',0,null);assert.equal(await promise,1);}
});
test('启动-PROGRESS-003 a broken output consumer does not leak monitor listeners',async()=>{
 const c=child();assert.equal(typeof api.watchChild,'function');const p=api.watchChild(c,{runDir:'/not-used',runId:'x',print:()=>{throw Error('output_closed');},read:async()=>({runId:'x',status:'completed'})});c.emit('exit',0,null);assert.equal(await p,1);assert.equal(c.listenerCount('exit'),0);assert.equal(c.listenerCount('error'),0);
});

test('生命周期-PROGRESS-002 slow parent reads stay serialized and exit waits for the current read only',async()=>{
 let active=0,max=0;const {c,lines,promise}=watcher({intervalMs:2,read:async()=>{active++;max=Math.max(max,active);await sleep(8);active--;return {runId:'current',status:'completed'};}});await sleep(5);c.emit('exit',0,null);assert.equal(await promise,0);const n=lines.length;await sleep(15);assert.equal(max,1);assert.equal(lines.length,n);
});

test('状态-RETRY-001 cooldown snapshots expose deadline and batch-wide budget while waiting',async()=>{
 const {waitForSearchRetry}=await import('./search-retry.mjs');const writes=[];
 const until=Date.now()+60;
 const reporter=api.createProgress({runDir:'/unused',intervalMs:5,write:async value=>writes.push(value)});
 const state={status:'running',topicIndex:0,topics:[{keyword:'#one'}],authors:{},searchRetry:{phase:'waiting',attempts:1,nextRetryAt:until}};
 await reporter.updateBatch(state);
 await waitForSearchRetry(until,{onWait:value=>reporter.wait(value),assertHealthy:reporter.assertHealthy});
 await reporter.finish({...state,status:'paused',reason:'test_complete'});
 const wait=writes.find(value=>value.waitReason==='search_rate_limit');assert.ok(wait);assert.equal(wait.status,'waiting');assert.equal(wait.waitUntil,until);assert.equal(wait.retryAttempts,1);assert.equal(wait.retryLimit,2);assert.equal(wait.nextRetryAt,until);assert.equal(writes.at(-1).status,'paused');assert.equal(writes.at(-1).waitReason,null);
});


test('状态-HASH-006 Ego worker clean pause becomes native CLI exit 3 while real failures remain failures',async()=>{
 const good=watcher({workerPausedExitCode:0,read:async()=>({runId:'current',status:'paused',reason:'search_confirmation_unavailable'})});good.c.emit('exit',0,null);assert.equal(await good.promise,3);assert.equal(good.lines.at(-1).status,'paused');assert.equal(good.lines.at(-1).exitCode,3);assert.equal(good.lines.at(-1).workerExitCode,0);
 const broken=watcher({workerPausedExitCode:0,read:async()=>({runId:'current',status:'paused'})});broken.c.emit('exit',1,null);assert.equal(await broken.promise,1);assert.equal(broken.lines.at(-1).reason,'worker_exit_status_conflict');
});
