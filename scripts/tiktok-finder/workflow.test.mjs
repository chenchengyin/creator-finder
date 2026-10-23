import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {candidate,capture,config,temp} from './fixtures.mjs';
const api=await import('./workflow.mjs').catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?{}:Promise.reject(e));
const fn=name=>{assert.equal(typeof api[name],'function','Missing implementation: '+name);return api[name];};
const exportOK=async({results})=>({verification:{passed:true},count:results.length});
function fake(){
 const log=[];return {log,discoverBatch:async({keyword,checkpoint})=>{log.push('search:'+keyword);return {items:[{videoId:'7777777777777777777',authorId:'9999999999999999999',username:'example',bioHint:'public@example.com',description:keyword==='bible comedy'?'#christianskit':'christian discussion'}],hasMore:false,cursor:1,valid:true};},readProfile:async()=>{log.push('profile');const c=capture();c.profile.bio='public@example.com';c.pages[0].items[0].description='hello';return c;},finish:async()=>log.push('finish')};
}
test('停止-LIMIT-002 the keyword cap stops before searching the next keyword',async t=>{
 const browser=fake(),searched=[],limited={...config,keywords:['one','two','three'],maxKeywords:2};
 browser.discoverBatch=async({keyword})=>{searched.push(keyword);return {items:[],hasMore:false,valid:true};};
 const r=await fn('runCampaign')({config:limited,runDir:await temp(t),browser,exporter:exportOK});
 assert.equal(r.status,'completed');assert.equal(r.completionReason,'keyword_limit_reached');assert.equal(r.currentKeywordIndex,2);
 assert.deepEqual(searched,['one','two']);assert.equal(r.keywords[2].stage,'pending');
});
function limitBrowser(){
 const browser=fake();browser.opened=[];
 browser.discoverBatch=async()=>({items:[1,2,3].map(n=>({videoId:String(n),authorId:String(n),username:'creator'+n,bioHint:'public@example.com',description:'#christianskit'})),hasMore:false,valid:true});
 browser.readProfile=async c=>{browser.opened.push(c.username);return capture(c.username,c.authorIdHint);};return browser;
}
test('停止-LIMIT-003 target stops within a keyword after saving the qualifying author',async t=>{
 const browser=limitBrowser(),limited={...config,stopAtTarget:true,targetCount:2};
 const r=await fn('runCampaign')({config:limited,runDir:await temp(t),browser,exporter:exportOK});
 assert.equal(r.status,'completed');assert.equal(r.completionReason,'target_reached');assert.equal(r.counts.confirmed,2);
 assert.deepEqual(browser.opened,['creator1','creator2']);assert.equal(r.currentKeywordIndex,0);assert.equal(r.keywords[0].stage,'filtering');assert.equal(r.keywords[1].stage,'pending');
});
test('停止-LIMIT-002/004 saved completed keywords consume the cap and export retry does not search again',async t=>{
 const browser=fake(),runDir=await temp(t),limited={...config,keywords:['one','two','three'],maxKeywords:2};
 browser.discoverBatch=async()=>({items:[],hasMore:false,valid:true});
 let r=await fn('runCampaign')({config:limited,runDir,browser,exporter:async()=>{throw Error('disk full');}});
 assert.equal(r.status,'export_failed');assert.equal(r.currentKeywordIndex,2);
 browser.discoverBatch=async()=>assert.fail('limit resume must not search keyword three');
 r=await fn('runCampaign')({config:limited,runDir,browser,exporter:exportOK,resume:true});
 assert.equal(r.status,'completed');assert.equal(r.completionReason,'keyword_limit_reached');assert.equal(r.currentKeywordIndex,2);
});
test('停止-LIMIT-003/004 target limit and unfinished candidates survive export and finish failures',async t=>{
 const browser=limitBrowser(),runDir=await temp(t),limited={...config,stopAtTarget:true,targetCount:2};
 let r=await fn('runCampaign')({config:limited,runDir,browser,exporter:async()=>{throw Error('disk full');}});
 assert.equal(r.status,'export_failed');assert.equal(r.results.length,2);
 browser.discoverBatch=async()=>assert.fail('must not search');browser.readProfile=async()=>assert.fail('must not open another profile');browser.finish=async()=>{throw Error('finish unavailable');};
 r=await fn('runCampaign')({config:limited,runDir,browser,exporter:exportOK,resume:true});assert.equal(r.stage,'finalizing');assert.equal(r.status,'paused');
 browser.finish=async()=>{};
 r=await fn('runCampaign')({config:limited,runDir,browser,exporter:async()=>assert.fail('must not export twice'),resume:true});
 assert.equal(r.status,'completed');assert.equal(r.completionReason,'target_reached');assert.deepEqual(browser.opened,['creator1','creator2']);
});
test('停止-LIMIT-003 repeated authors do not consume the unique creator target twice',async t=>{
 const browser=fake(),runDir=await temp(t),limited={...config,keywords:[...config.keywords,'church humor','jesus comedy'],stopAtTarget:true,targetCount:2};let searches=0,profiles=0;
 browser.discoverBatch=async()=>{searches++;return {items:[{videoId:String(searches),authorId:'1',username:'creator1',bioHint:'public@example.com',description:'#christianskit'},...(searches===3?[{videoId:'30',authorId:'2',username:'creator2',bioHint:'public@example.com',description:'#christianskit'}]:[])],hasMore:false,valid:true};};
 browser.readProfile=async c=>{profiles++;return capture(c.username,c.authorIdHint);};
 const r=await fn('runCampaign')({config:limited,runDir,browser,exporter:exportOK});
 assert.equal(searches,3);assert.equal(profiles,2);assert.equal(r.results.length,2);assert.equal(r.counts.confirmed,2);
});
test('停止-LIMIT-002 imported completed keywords consume the cap before any browser action',async t=>{
 const runDir=await temp(t),limited={...config,keywords:['one','two','three'],maxKeywords:2},browser=fake();
 await writeFile(join(runDir,'config.json'),JSON.stringify(limited));
 await writeFile(join(runDir,'execution-state.json'),JSON.stringify({status:'running',stage:'searching',currentKeywordIndex:2,browser:{},keywords:limited.keywords.map((keyword,n)=>({keyword,stage:n<2?'completed':'pending',checkpoint:{}}))}));
 browser.discoverBatch=async()=>assert.fail('completed seed keywords already consume the cap');
 const r=await fn('runCampaign')({config:limited,runDir,browser,exporter:exportOK,resume:true});
 assert.equal(r.completionReason,'keyword_limit_reached');assert.equal(r.currentKeywordIndex,2);
});
test('停止-LIMIT-003 suspected counts toward target while rejected authors do not',async t=>{
 const runDir=await temp(t),limited={...config,stopAtTarget:true,targetCount:2},browser=limitBrowser();
 browser.discoverBatch=async()=>({items:[1,2,3,4].map(n=>({videoId:String(n),authorId:String(n),username:'creator'+n,bioHint:'public@example.com',description:n===2?'funny story':'#christianskit'})),hasMore:false,valid:true});
 browser.readProfile=async c=>{browser.opened.push(c.username);const value=capture(c.username,c.authorIdHint);if(c.authorIdHint==='1')value.profile.bio='no email';if(c.authorIdHint==='2'){value.profile.bio='Funny skits public@example.com';value.pages[0].items[0].description='Funny skits';}return value;};
 const r=await fn('runCampaign')({config:limited,runDir,browser,exporter:exportOK});
 assert.deepEqual(browser.opened,['creator1','creator2','creator3']);assert.equal(r.counts.confirmed,1);assert.equal(r.counts.suspected,1);assert.equal(r.results[0].decision,'rejected');assert.equal(r.completionReason,'target_reached');
});
test('顺序-SEQ-001/002 复用-CACHE-001 target reached still searches next word and reuses facts',async t=>{
 const runDir=await temp(t),browser=fake();const r=await fn('runCampaign')({config,runDir,browser,exporter:exportOK});
 assert.deepEqual(browser.log,['search:christian skits','profile','search:bible comedy','finish']);assert.equal(r.results.length,1);assert.equal(r.results[0].decision,'confirmed');assert.deepEqual(r.results[0].sourceKeywords,config.keywords);
 const state=JSON.parse(await readFile(join(runDir,'execution-state.json'),'utf8'));assert.equal(state.status,'completed');assert.equal(state.runtimeRunning,false);assert.equal(state.currentKeywordIndex,2);
});
test('完成-DONE-001 empty valid search exports an empty list',async t=>{
 const browser=fake();browser.discoverBatch=async()=>({items:[],hasMore:false,valid:true});const r=await fn('runCampaign')({config,runDir:await temp(t),browser,exporter:exportOK});assert.equal(r.status,'completed');assert.equal(r.results.length,0);
});
test('邮箱-EMAIL-002 empty search signature rejection is persisted without opening a profile',async t=>{
 const browser=fake();let searches=0;browser.discoverBatch=async()=>({items:searches++?[]:[{videoId:'1',authorId:'2',username:'blankbio',bioHint:'',description:'#christianskit'}],hasMore:false,valid:true});browser.readProfile=async()=>{throw Error('empty search signature must skip profile');};
 const runDir=await temp(t),r=await fn('runCampaign')({config,runDir,browser,exporter:exportOK});assert.equal(r.status,'completed');assert.equal(r.results[0].reason,'no_search_bio_email');assert.equal(r.results[0].profile,null);assert.equal(r.results[0].emailCheck.status,'skipped_empty_signature');
 const saved=JSON.parse(await readFile(join(runDir,'author-2.json'),'utf8'));assert.equal(saved.reason,'no_search_bio_email');assert.match(saved.inclusionBasis,/未访问主页/);assert.match(saved.inclusionBasis,/主页Bio/);
});
test('完成-DONE-002 unknown completion pauses without switching words',async t=>{
 const browser=fake();browser.discoverBatch=async()=>({items:[],hasMore:null,valid:true});const runDir=await temp(t),r=await fn('runCampaign')({config,runDir,browser,exporter:exportOK});assert.equal(r.status,'paused');assert.equal(r.currentKeywordIndex,0);assert(!browser.log.includes('finish'));
});
test('分页-PAGE-001 repeated cursor with new evidence continues; no progress pauses',async t=>{
 const browser=fake();let calls=0;browser.discoverBatch=async()=>({items:[{videoId:String(++calls<3?calls:2),authorId:'1',username:'one',description:'x'}],hasMore:true,cursor:1,valid:true});
 const r=await fn('runCampaign')({config,runDir:await temp(t),browser,exporter:exportOK});assert.equal(r.stopReason,'search_progress_stalled');assert.equal(calls,3);
});
test('恢复-RESUME-001 落盘-STORE-001/002 pause restores first-page facts and clears PID',async t=>{
 const runDir=await temp(t),browser=fake();const c=capture();c.pages[0].hasMore=true;browser.readProfile=async()=>c;browser.nextPosts=async()=>{throw Object.assign(new Error('control_lost'),{pause:true});};
 let r=await fn('runCampaign')({config,runDir,browser,exporter:exportOK});assert.equal(r.status,'paused');let s=JSON.parse(await readFile(join(runDir,'execution-state.json'),'utf8'));assert.equal(s.runtimeRunning,false);assert.equal(s.activeProcessId,null);assert.equal(s.currentKeywordIndex,0);
 browser.readProfile=async()=>{throw Error('email repeated');};browser.ensureProfile=async()=>{};browser.nextPosts=async()=>({statusCode:0,hasMore:false,items:[]});r=await fn('runCampaign')({config,runDir,browser,exporter:exportOK,resume:true});assert.equal(r.status,'completed');
});
test('导出-EXPORT-002 export failure resumes export only and finishes after verification',async t=>{
 const runDir=await temp(t),browser=fake();let r=await fn('runCampaign')({config,runDir,browser,exporter:async()=>{throw Error('disk full');}});assert.equal(r.status,'export_failed');assert(!browser.log.includes('finish'));
 browser.discoverBatch=async()=>{throw Error('must not search');};browser.readProfile=async()=>{throw Error('must not visit');};r=await fn('runCampaign')({config,runDir,browser,exporter:exportOK,resume:true});assert.equal(r.status,'completed');assert.equal(browser.log.at(-1),'finish');
});
test('落盘-STORE-001 active writer and changed resume config are rejected',async t=>{
 const runDir=await temp(t),browser=fake();await fn('runCampaign')({config,runDir,browser,exporter:exportOK});
 await assert.rejects(fn('runCampaign')({config:{...config,days:9},runDir,browser,exporter:exportOK,resume:true}),/config|configuration/i);
 await writeFile(join(runDir,'run.lock'),JSON.stringify({pid:process.pid}));await assert.rejects(fn('runCampaign')({config,runDir,browser,exporter:exportOK,resume:true}),/running|writer/i);
});
test('依赖-DEP-001 whole offline flow works with global fetch forbidden',async t=>{
 const old=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden');};try{assert.equal((await fn('runCampaign')({config,runDir:await temp(t),browser:fake(),exporter:exportOK})).status,'completed');}finally{globalThis.fetch=old;}
});
test('顺序-SEQ-001/002 two search pages finish before profiles and all extra authors export',async t=>{
 const browser=fake(),events=[];let pages=0;
 browser.discoverBatch=async({keyword})=>{events.push('search:'+keyword);const n=keyword===config.keywords[0]?++pages:1;return {valid:true,cursor:n,hasMore:keyword===config.keywords[0]&&n===1,items:[{videoId:String(n),authorId:String(n),username:'creator'+n,bioHint:'creator@example.com',description:'#christianskit'}]};};
 browser.readProfile=async q=>{events.push('profile:'+q.username);return capture(q.username,q.authorIdHint);};
 const r=await fn('runCampaign')({config,runDir:await temp(t),browser,exporter:exportOK});assert.equal(r.results.length,2);assert.deepEqual(events.slice(0,5),['search:christian skits','search:christian skits','profile:creator1','profile:creator2','search:bible comedy']);assert.equal(r.output.count,2);
});
test('落盘-STORE-001 final author record survives crash before results and keyword pointer',async t=>{
 const runDir=await temp(t),browser=fake();await fn('runCampaign')({config,runDir,browser,exporter:exportOK});
 const state=JSON.parse(await readFile(join(runDir,'execution-state.json'),'utf8'));state.status='paused';state.currentKeywordIndex=0;state.keywords[0].stage='filtering';await writeFile(join(runDir,'execution-state.json'),JSON.stringify(state));await writeFile(join(runDir,'results.json'),'[]');
 browser.readProfile=async()=>{throw Error('completed author revisited');};const r=await fn('runCampaign')({config,runDir,browser,exporter:exportOK,resume:true});assert.equal(r.results.length,1);assert.equal(r.output.count,1);
});
test('去重-DEDUP-001 stable author rename reuses prior facts and retains both keywords',async t=>{
 const browser=fake();let visits=0;browser.discoverBatch=async({keyword})=>({valid:true,hasMore:false,items:[{videoId:'1',authorId:'9999999999999999999',username:keyword===config.keywords[0]?'oldname':'newname',bioHint:'creator@example.com',description:'#christianskit'}]});browser.readProfile=async q=>{visits++;return capture(q.username,q.authorIdHint);};
 const r=await fn('runCampaign')({config,runDir:await temp(t),browser,exporter:exportOK});assert.equal(r.results.length,1);assert.equal(r.results[0].decision,'confirmed');assert.equal(r.results[0].username,'newname');assert.equal(visits,1);
});
test('配置-CONFIG-001 wrong resume space rejects before changing persisted task data',async t=>{
 const runDir=await temp(t),browser=fake();await fn('runCampaign')({config,runDir,browser,exporter:exportOK,spaceId:5});
 const before=await readFile(join(runDir,'candidate-queue.json'),'utf8');
 await assert.rejects(fn('runCampaign')({config,runDir,browser,exporter:exportOK,resume:true,spaceId:6}),/space mismatch/);
 assert.equal(await readFile(join(runDir,'candidate-queue.json'),'utf8'),before);
});
test('落盘-STORE-001 legacy directories cannot be silently converted to a new campaign',async t=>{
 const runDir=await temp(t),original=JSON.stringify({task:'old completed task'});await writeFile(join(runDir,'execution-state.json'),original);
 await assert.rejects(fn('runCampaign')({config,runDir,browser:fake(),exporter:exportOK}),/legacy|existing|directory/i);assert.equal(await readFile(join(runDir,'execution-state.json'),'utf8'),original);await assert.rejects(access(join(runDir,'config.json')));
});
test('完成-DONE-003 successful partial search bodies persist without finishing the word',async t=>{
 const runDir=await temp(t),browser=fake();browser.discoverBatch=async({onCheckpoint})=>{await onCheckpoint({partialBodies:[{statusCode:0,hasMore:false,items:[{videoId:'1',authorId:'2',username:'partial',description:'#christianskit'}]}]});throw Error('response_body_unavailable');};
 const r=await fn('runCampaign')({config,runDir,browser,exporter:exportOK});assert.equal(r.status,'paused');assert.equal(r.currentKeywordIndex,0);assert.equal(JSON.parse(await readFile(join(runDir,'candidate-queue.json'),'utf8')).length,1);
});
test('身份-ID-001 unverified wrong profile cannot overwrite the candidate stable identity',async t=>{
 const runDir=await temp(t),browser=fake();let visits=0;browser.readProfile=async()=>{visits++;const c=capture();if(visits===1){c.profile.authorId='2222222222222222222';c.profile.identityVerified=false;c.profile.ready=false;}return c;};
 const r=await fn('runCampaign')({config,runDir,browser,exporter:exportOK});const queue=JSON.parse(await readFile(join(runDir,'candidate-queue.json'),'utf8'));assert.equal(queue[0].authorIdHint,'9999999999999999999');assert.equal(visits,2);assert.equal(r.results.length,1);assert.equal(r.results[0].decision,'confirmed');
});
test('导出-EXPORT-002 browser finish failure resumes finalization without exporting again',async t=>{
 const runDir=await temp(t),browser=fake();browser.finish=async()=>{throw Error('finish unavailable');};
 let r=await fn('runCampaign')({config,runDir,browser,exporter:exportOK});assert.equal(r.status,'paused');assert(r.output.verification.passed);
 browser.finish=async()=>{};r=await fn('runCampaign')({config,runDir,browser,exporter:async()=>{throw Error('duplicate export');},resume:true});assert.equal(r.status,'completed');
});
