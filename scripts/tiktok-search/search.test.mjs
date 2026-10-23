import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const api=await import('./search.mjs').catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?{}:Promise.reject(e));
const fn=name=>{assert.equal(typeof api[name],'function','Missing search implementation: '+name);return api[name];};
const sourceUrl='https://www.tiktok.com/search/video?q=christian%20skits';
const context={keyword:'christian skits',sourceUrl,capturedAt:'2026-10-21T04:00:00.000Z'};
const item=(id,authorId,username)=>({videoId:id,authorId,username,description:'#christianskit',bioHint:'public@example.com'});

test('search response parser extracts only public fields and preserves string IDs',()=>{
 const p=fn('parseSearchResponse')({status_code:0,has_more:1,cursor:12,item_list:[{id:'7698495015676300575',desc:'#christianskit',createTime:1792445566,author:{id:'7401249717328757803',uniqueId:'example',signature:'public@example.com'},secret:'not-to-save'}]});
 assert.equal(p.items[0].videoId,'7698495015676300575');assert.equal(p.items[0].bioHint,'public@example.com');assert.equal(p.hasMore,true);assert(!JSON.stringify(p).includes('not-to-save'));
});
test('a missing has-more flag is unknown rather than proof of search exhaustion',()=>{
 assert.equal(fn('parseSearchResponse')({status_code:0,item_list:[]}).hasMore,null);
});
test('repeated videos from one author produce one candidate and retain both evidence links',()=>{
 const r=fn('mergeCandidates')([], [item('11','21','example'),item('12','21','example')],context);
 assert.equal(r.queue.length,1);assert.equal(r.queue[0].sourceEvidence.length,2);assert.equal(r.newCandidates,1);
 assert.equal(r.queue[0].status,'queued');assert.equal(r.queue[0].keyword,'christian skits');
});
test('native leading-dot handles are retained while route separators remain invalid',()=>{
 const r=fn('mergeCandidates')([], [item('11','21','..liezel4'),item('12','22','.2636628'),item('13','23','bad/route'),item('14','24','../escape')],context);
 assert.deepEqual(r.queue.map(c=>c.username),['..liezel4','.2636628']);assert.equal(r.newCandidates,2);
});
test('repeated search batches preserve checked status and do not duplicate evidence',()=>{
 const merge=fn('mergeCandidates'),first=merge([], [item('11','21','example')],context).queue;first[0].status='checked';
 const r=merge(first,[item('11','21','example')],context);
 assert.equal(r.newCandidates,0);assert.equal(r.queue[0].status,'checked');assert.equal(r.queue[0].sourceEvidence.length,1);
});
test('stable author ID merges a renamed handle while different known authors are kept separate',()=>{
 const merge=fn('mergeCandidates'),first=merge([], [item('11','21','oldname')],context).queue;
 const r=merge(first,[item('12','21','newname'),item('13','22','newname')],context);
 assert.equal(r.queue.length,2);assert.equal(r.queue[0].username,'newname');assert(r.queue[0].aliases.includes('oldname'));
});
test('legacy candidates can acquire author IDs without losing their status',()=>{
 const r=fn('mergeCandidates')([{username:'example',status:'checked',keyword:'christian skits'}],[item('11','21','example')],context);
 assert.equal(r.queue.length,1);assert.equal(r.queue[0].authorIdHint,'21');assert.equal(r.queue[0].status,'checked');
});
test('CLI validates keyword, existing space ID and bounded batch count',()=>{
 const parse=fn('parseArgs');const args=['--space','328','--keyword','christian skits','--run-dir','/tmp/search-run'];
 assert.equal(parse(args).batches,1);assert.throws(()=>parse([...args,'--batches','0']));assert.throws(()=>parse([...args,'--bogus','x']));
 assert.equal(parse([...args,'--continue']).continueSearch,true);
});
test('dry-run emits the encoded TikTok URL and does not create state or call Ego',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'creator-search-'));const runDir=join(dir,'not-created');
 const r=spawnSync(process.execPath,[new URL('./search.mjs',import.meta.url).pathname,'--space','328','--keyword','christian skits','--run-dir',runDir,'--dry-run'],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);const plan=JSON.parse(r.stdout);assert.equal(plan.searchUrl,sourceUrl);await assert.rejects(readFile(join(runDir,'execution-state.json')),{code:'ENOENT'});
});

function browserFixture({documentStatuses=[200],apiStatus=200}={}){
 let navigations=0,url='',buffer=[];
 const page={
  url:async()=>url,
  goto:async target=>{url=target;navigations++;buffer=[{method:'Network.responseReceived',params:{requestId:'public-search',response:{url:'https://www.tiktok.com/api/search/item/full/?keyword=christian%20skits',status:apiStatus}}}];},
  events:async()=>{const events=buffer;buffer=[];return events;},
  evaluate:async()=>({url,httpStatus:documentStatuses[Math.min(navigations-1,documentStatuses.length-1)],captcha:false,loginPrompt:false,links:[]}),
  waitForSelector:async()=>{},
  cdp:async method=>method==='Network.enable'?{}:{body:JSON.stringify({status_code:0,has_more:0,cursor:12,item_list:[{id:'7698495015676300575',desc:'#christianskit',author:{id:'7401249717328757803',uniqueId:'example',signature:'public@example.com'}}]})}
 };
 return {page,get navigations(){return navigations;}};
}
test('real search orchestration persists candidates, evidence and the last observed cursor',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'creator-search-run-')),browser=browserFixture();
 const result=await fn('runSearch')({page:browser.page,config:{runDir,keyword:'christian skits',spaceId:328,batches:1},beforeNavigate:async()=>{}});
 assert.equal(result.totalCandidates,1);assert.equal(result.exhausted,true);
 const queue=JSON.parse(await readFile(join(runDir,'candidate-queue.json'),'utf8'));
 const state=JSON.parse(await readFile(join(runDir,'execution-state.json'),'utf8'));
 assert.equal(queue[0].authorIdHint,'7401249717328757803');assert.equal(queue[0].sourceEvidence[0].text,'#christianskit');
 assert.equal(state.searchCheckpoint.cursor,12);assert.equal(state.runtimeRunning,false);
});
test('HTML and API 403 share one retry budget within a search batch',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'creator-search-403-')),browser=browserFixture({documentStatuses:[403,200],apiStatus:403}),waits=[];
 const result=await fn('runSearch')({page:browser.page,config:{runDir,keyword:'christian skits',spaceId:328,batches:1},beforeNavigate:async()=>{},sleep:async ms=>waits.push(ms)});
 assert.equal(result.hardBlocked,true);assert.equal(result.stopReason,'http_403');assert.equal(browser.navigations,2);assert.deepEqual(waits,[11000]);
 const state=JSON.parse(await readFile(join(runDir,'execution-state.json'),'utf8'));assert.equal(state.status,'waiting_for_user_access_recovery');
});
