import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {normalizeConfig,assertResumeCompatible,inputConfig} from './config.mjs';
import {runCampaign} from './workflow.mjs';
import {qualifyCandidate} from './profile.mjs';
import {readProfilePage,createEgoBrowser} from './browser.mjs';
import {candidate,capture,config,input,now,temp} from './fixtures.mjs';

const settings={...config,forceProfileFirstN:10,keywords:['christian skits']};
const exported=async({results})=>({verification:{passed:true},count:results.length});
const item=(n,bioHint='')=>({videoId:String(1000+n),authorId:String(n),username:'creator'+n,bioHint,description:'#christianskit'});
function observed(c,withEmail=false){
 const value=capture(c.username,c.authorIdHint);
 value.profile.bio=withEmail?'public@example.com':'Christian comedy';
 value.profile.externalLink={status:'none',url:null,evidence:[],capturedAt:now};
 return value;
}
function scripted(batches,{withEmail=false}={}){
 const events=[],opened=[],offsets=new Map();
 return {events,opened,discoverBatch:async({keyword})=>{
  const offset=offsets.get(keyword)||0;offsets.set(keyword,offset+1);events.push('search:'+keyword+':'+offset);
  const batch=batches[keyword][offset];assert(batch,'unexpected extra search');return structuredClone(batch);
 },readProfile:async c=>{opened.push(c.authorIdHint);events.push('profile:'+c.authorIdHint);return observed(c,withEmail);},finish:async()=>events.push('finish')};
}
const batch=(items,hasMore=false,cursor=1)=>({items,hasMore,cursor,valid:true});
const read=async(dir,name)=>JSON.parse(await readFile(join(dir,name),'utf8'));
async function seed(dir,cfg,queue,author){
 await writeFile(join(dir,'config.json'),JSON.stringify(cfg));
 await writeFile(join(dir,'candidate-queue.json'),JSON.stringify(queue));
 await writeFile(join(dir,'execution-state.json'),JSON.stringify({status:'paused',stage:'searching',currentKeywordIndex:0,browser:{},keywords:cfg.keywords.map(keyword=>({keyword,stage:'pending',checkpoint:{}}))}));
 if(author)await writeFile(join(dir,'author-'+author.authorId+'.json'),JSON.stringify(author));
}

test('参数-N-001/002 N is optional, frozen and a nonnegative safe integer',()=>{
 for(const n of [0,10]){const c=normalizeConfig({...input,forceProfileFirstN:n},now);assert.equal(c.forceProfileFirstN,n);assert.equal(inputConfig(c).forceProfileFirstN,n);assertResumeCompatible(c,{...input,forceProfileFirstN:n});assert.throws(()=>assertResumeCompatible(c,{...input,forceProfileFirstN:n+1}));}
 assert(!Object.hasOwn(normalizeConfig(input,now),'forceProfileFirstN'));
 for(const n of [-1,1.5,'10',null,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>normalizeConfig({...input,forceProfileFirstN:n},now));
});
test('顺序-ORDER-001 搜索-SEARCH-001 主页-PROFILE-001/002 first ten unique authors are forced after valid exhaustion; later authors retain prefilter',async t=>{
 const dir=await temp(t),word=settings.keywords[0];
 const first=[item(1),item(1),...Array.from({length:9},(_,i)=>item(i+2))];
 const browser=scripted({[word]:[batch(first,true,12),batch([],true,24),batch([item(11),item(12,'public@example.com'),item(13,'Comedy…')],false,36)]});
 const r=await runCampaign({config:settings,runDir:dir,browser,exporter:exported});
 assert.equal(r.status,'completed');assert.deepEqual(browser.events.slice(0,3),['search:'+word+':0','search:'+word+':1','search:'+word+':2']);
 assert.deepEqual(browser.opened,['1','2','3','4','5','6','7','8','9','10','12','13']);
 assert.equal(r.results.find(x=>x.authorId==='11').reason,'no_search_bio_email');
 assert.equal(r.results.find(x=>x.authorId==='1').reason,'no_profile_bio_email');
 assert.equal(r.keywords[0].authorOrder.length,13);assert.deepEqual(r.keywords[0].forcedProfiles,{required:10,completed:10,reused:0});
 const saved=await read(dir,'author-1.json');assert.equal(saved.keywordChecks[word].rank,1);assert.equal(saved.keywordChecks[word].forced,true);
});
test('顺序-ORDER-002 current response order beats preseeded global queue order',async t=>{
 const dir=await temp(t),cfg={...settings,forceProfileFirstN:1},a=candidate('creator1','1'),b=candidate('creator2','2');a.bioHint='';b.bioHint='';
 await seed(dir,cfg,[a,b]);const browser=scripted({[cfg.keywords[0]]:[batch([item(2),item(1)])]});
 const r=await runCampaign({config:cfg,runDir:dir,browser,exporter:exported,resume:true});assert.equal(r.status,'completed');assert.deepEqual(browser.opened,['2']);assert.equal(r.results.find(x=>x.authorId==='2').keywordChecks[cfg.keywords[0]].rank,1);
});
test('顺序-ORDER-002 a historical keyword source absent from the new response does not enter its forced prefix',async t=>{
 const dir=await temp(t),cfg={...settings,forceProfileFirstN:1},a=candidate('creator1','1'),b=candidate('creator2','2');a.bioHint='';b.bioHint='';
 await seed(dir,cfg,[a,b]);const browser=scripted({[cfg.keywords[0]]:[batch([item(2)])]});
 const r=await runCampaign({config:cfg,runDir:dir,browser,exporter:exported,resume:true});assert.equal(r.status,'completed');assert.deepEqual(browser.opened,['2']);assert.equal(r.keywords[0].forcedProfiles.required,1);
});
test('顺序-ORDER-003 native leading-dot usernames retain their place in the forced prefix',async t=>{
 const dir=await temp(t),cfg={...settings,forceProfileFirstN:2},word=cfg.keywords[0];
 const browser=scripted({[word]:[batch([item(1),{...item(2),username:'.2636628'},item(3)])]});
 const result=await runCampaign({config:cfg,runDir:dir,browser,exporter:exported});
 assert.equal(result.status,'completed');assert.deepEqual(browser.opened,['1','2']);assert.equal(result.counts.uniqueCandidates,3);assert.equal(result.results.find(r=>r.authorId==='2').keywordChecks[word].rank,2);assert.equal(result.results.find(r=>r.authorId==='3').reason,'no_search_bio_email');
});
test('搜索-SEARCH-002 only seven available authors means seven forced; unknown end never proceeds',async t=>{
 const word=settings.keywords[0],browser=scripted({[word]:[batch(Array.from({length:7},(_,i)=>item(i+1)))]});
 const r=await runCampaign({config:settings,runDir:await temp(t),browser,exporter:exported});assert.equal(browser.opened.length,7);assert.equal(r.keywords[0].forcedProfiles.required,7);
 const broken=scripted({[word]:[{items:[item(1)],hasMore:null,valid:true}]});
 const paused=await runCampaign({config:settings,runDir:await temp(t),browser:broken,exporter:exported});assert.equal(paused.status,'paused');assert.deepEqual(broken.opened,[]);
});
test('主页-PROFILE-003 complete same-run profile and link checks are reused across keyword and stable-ID rename',async t=>{
 const cfg={...settings,keywords:['christian skits','bible comedy']};
 const browser=scripted({[cfg.keywords[0]]:[batch([item(1)])],[cfg.keywords[1]]:[batch([{...item(1),username:'renamed'}])]});
 const r=await runCampaign({config:cfg,runDir:await temp(t),browser,exporter:exported});assert.equal(r.status,'completed');assert.deepEqual(browser.opened,['1']);assert.deepEqual(r.keywords[1].forcedProfiles,{required:1,completed:1,reused:1});assert.equal(r.results[0].username,'renamed');
});
test('缓存-CACHE-001 a historical processedKeyword from signature rejection cannot satisfy forced inspection',async t=>{
 const dir=await temp(t),c=candidate('creator1','1');c.bioHint='';
 await seed(dir,settings,[c],{authorId:'1',username:'creator1',decision:'rejected',reason:'no_search_bio_email',capture:null,processedKeywords:settings.keywords});
 const browser=scripted({[settings.keywords[0]]:[batch([item(1)])]});
 const r=await runCampaign({config:settings,runDir:dir,browser,exporter:exported,resume:true});assert.equal(r.status,'completed');assert.deepEqual(browser.opened,['1']);assert.equal(r.results[0].reason,'no_profile_bio_email');
});
test('缓存-CACHE-002 old qualifying authors cannot stop the new run or leak into an early export',async t=>{
 const dir=await temp(t),cfg={...settings,forceProfileFirstN:1,targetCount:1,stopAtTarget:true},c=candidate('creator1','1');c.bioHint='public@example.com';
 const old=observed(c,true);const {evaluateCapture}=await import('./profile.mjs');
 await seed(dir,cfg,[c],{...evaluateCapture({candidate:c,capture:old,config:cfg}),processedKeywords:cfg.keywords});
 const browser=scripted({[cfg.keywords[0]]:[batch([item(1,'public@example.com')])]});
 const r=await runCampaign({config:cfg,runDir:dir,browser,exporter:exported,resume:true});
 assert.deepEqual(browser.opened,['1']);assert.equal(r.counts.confirmed,0);assert.equal(r.output.count,0);assert.equal(r.completionReason,'all_keywords_completed');
});
test('缓存-CACHE-002 historic captures and unknown link observations cannot be silently reused',async()=>{
 for(const mutate of [c=>{},c=>{c.verificationContext={runId:'this-run',criteria:'same'};c.profile.externalLink.status='unknown';}]){
  const c=candidate();c.bioHint='';const old=observed(c,true);mutate(old);let visits=0;
  const r=await qualifyCandidate({candidate:c,config:settings,forceProfile:true,verificationContext:{runId:'this-run',criteria:'same'},cachedCapture:old,browser:{readProfile:async()=>{visits++;return observed(c);}}});
  assert.equal(visits,1);assert.equal(r.reason,'no_profile_bio_email');
 }
});
test('缓存-CACHE-003 same context reuses full metrics, changed context refreshes and does not mix old posts',async()=>{
 const c=candidate(),context={runId:'this-run',criteria:'window-A'},saved=observed(c,true);saved.verificationContext=context;
 const reused=await qualifyCandidate({candidate:c,config:settings,forceProfile:true,verificationContext:context,cachedCapture:saved,browser:{readProfile:async()=>assert.fail('same context must reuse')}});assert.equal(reused.metrics.averageViews,60000);
 let visits=0;const fresh=observed(c,true);fresh.pages[0].items[0].views=40000;
 const changed=await qualifyCandidate({candidate:c,config:settings,forceProfile:true,verificationContext:{...context,criteria:'window-B'},cachedCapture:saved,browser:{readProfile:async()=>{visits++;return fresh;}}});assert.equal(visits,1);assert.equal(changed.metrics.averageViews,40000);assert.equal(changed.decision,'rejected');
});
test('断点-RESUME-003 refreshing unknown mounted links preserves video reload and post replay budgets',async()=>{
 const c=candidate(),context={runId:'same-run',criteria:'same-window'},saved=observed(c,true);saved.verificationContext=context;saved.profile.externalLink.status='unknown';
 saved.videoRegion={navigationAttempts:Array.from({length:30},(_,i)=>({action:'reload_button',reloadClicks:i+1}))};saved.postBodyReplay={attempts:1};
 const fresh=observed(c,true);delete fresh.pages[0].items[0].locationCreated;let received;
 await assert.rejects(qualifyCandidate({candidate:c,config:settings,forceProfile:true,verificationContext:context,cachedCapture:saved,browser:{readProfile:async()=>fresh,collectRegion:async capture=>{received=structuredClone(capture);throw Object.assign(Error('http_403'),{pause:true});}}}),/http_403/);
 assert.equal(received.videoRegion?.navigationAttempts.length,30);assert.equal(received.postBodyReplay?.attempts,1);
});
test('邮箱-EMAIL-003 mounted links are saved without granting email eligibility or triggering deep lookup',async()=>{
 const c=candidate();c.bioHint='';const data=observed(c);data.profile.externalLink={status:'present',url:'https://example.com/?contact=site@example.com',evidence:[{fieldPath:'userInfo.user.bioLink.link',rawValue:'https://example.com/?contact=site@example.com'}]};
 const r=await qualifyCandidate({candidate:c,config:settings,forceProfile:true,verificationContext:{runId:'one',criteria:'same'},browser:{readProfile:async()=>data,nextPosts:async()=>assert.fail('no post pagination'),collectRegion:async()=>assert.fail('no region detail')}});
 assert.equal(r.reason,'no_profile_bio_email');assert.deepEqual(r.emails,[]);assert.equal(r.profile.externalLink.url,'https://example.com/?contact=site@example.com');assert.match(r.inclusionBasis,/挂链/);
});
test('断点-RESUME-001 fourth forced profile failure resumes without repeating first three or replacing it with rank eleven',async t=>{
 const dir=await temp(t),word=settings.keywords[0],browser=scripted({[word]:[batch(Array.from({length:11},(_,i)=>item(i+1)))]});
 let fail=true;const original=browser.readProfile;browser.readProfile=async c=>{if(c.authorIdHint==='4'&&fail)throw Object.assign(Error('http_403'),{pause:true});return original(c);};
 let r=await runCampaign({config:settings,runDir:dir,browser,exporter:exported});assert.equal(r.status,'paused');assert.deepEqual(browser.opened,['1','2','3']);assert.equal(r.keywords[0].forcedProfiles.completed,3);
 fail=false;r=await runCampaign({config:settings,runDir:dir,browser,exporter:exported,resume:true});assert.equal(r.status,'completed');assert.deepEqual(browser.opened,['1','2','3','4','5','6','7','8','9','10']);assert.equal(r.keywords[0].forcedProfiles.completed,10);
});
test('断点-RESUME-002 explicit target stop retains incomplete forced count',async t=>{
 const cfg={...settings,stopAtTarget:true,targetCount:2},browser=scripted({[cfg.keywords[0]]:[batch(Array.from({length:11},(_,i)=>item(i+1)))]},{withEmail:true});
 const r=await runCampaign({config:cfg,runDir:await temp(t),browser,exporter:exported});assert.equal(r.completionReason,'target_reached');assert.deepEqual(r.keywords[0].forcedProfiles,{required:10,completed:2,reused:0});assert.equal(r.keywords[0].stage,'filtering');
});
test('断点-RESUME-001 checkpoint captured during upgrade wins over old author snapshot; committed authors repair stale counts',async t=>{
 const dir=await temp(t),word=settings.keywords[0],c=candidate('creator1','1');c.bioHint='';
 await seed(dir,settings,[c],{authorId:'1',username:'creator1',decision:'rejected',reason:'old',capture:observed(c,true),processedKeywords:[word]});
 const browser=scripted({[word]:[batch([item(1)])]});let profiles=0;
 browser.readProfile=async()=>{profiles++;const value=observed(c,true);value.pages[0].hasMore=true;return value;};
 browser.nextPosts=async()=>{throw Object.assign(Error('http_403'),{pause:true});};
 let r=await runCampaign({config:settings,runDir:dir,browser,exporter:exported,resume:true});assert.equal(r.status,'paused');assert.equal(profiles,1);
 browser.ensureProfile=async()=>{};browser.nextPosts=async()=>({statusCode:0,hasMore:false,items:[]});
 r=await runCampaign({config:settings,runDir:dir,browser,exporter:exported,resume:true});assert.equal(r.status,'completed');assert.equal(profiles,1);
 const state=await read(dir,'execution-state.json');state.status='paused';state.stage='filtering';state.currentKeywordIndex=0;delete state.completionReason;state.keywords[0].stage='filtering';state.keywords[0].forcedProfiles.completed=0;
 await writeFile(join(dir,'execution-state.json'),JSON.stringify(state));await writeFile(join(dir,'results.json'),'[]');
 r=await runCampaign({config:settings,runDir:dir,browser,exporter:exported,resume:true});assert.equal(r.keywords[0].forcedProfiles.completed,1);assert.equal(profiles,1);
});
test('回归-REG-001 N zero keeps signature prefilter without forced profile reads',async t=>{
 const cfg={...settings,forceProfileFirstN:0},browser=scripted({[cfg.keywords[0]]:[batch([item(1),item(2,'public@example.com')])]});
 const r=await runCampaign({config:cfg,runDir:await temp(t),browser,exporter:exported});assert.equal(r.status,'completed');assert.deepEqual(browser.opened,['2']);
});
test('回归-REG-001 disabled N preserves legacy handling of a cached no-email Bio',async()=>{
 const c=candidate();c.bioHint='';const saved=observed(c);
 const result=await qualifyCandidate({candidate:c,config:{...settings,forceProfileFirstN:0},cachedCapture:saved,browser:{readProfile:async()=>assert.fail('legacy prefilter must skip')}});
 assert.equal(result.reason,'no_search_bio_email');
});
test('顺序-ORDER-001 partial search checkpoint retains first appearance order after restart',async t=>{
 const dir=await temp(t),cfg={...settings,forceProfileFirstN:2},word=cfg.keywords[0],browser=scripted({[word]:[batch([item(1),item(3)])]});
 const discover=browser.discoverBatch;browser.discoverBatch=async({onCheckpoint})=>{await onCheckpoint({partialBodies:[{statusCode:0,items:[item(2),item(1)]}]});throw Error('response_body_unavailable');};
 let r=await runCampaign({config:cfg,runDir:dir,browser,exporter:exported});assert.equal(r.status,'paused');assert.deepEqual(browser.opened,[]);
 browser.discoverBatch=discover;r=await runCampaign({config:cfg,runDir:dir,browser,exporter:exported,resume:true});assert.equal(r.status,'completed');assert.deepEqual(browser.opened,['2','1']);assert.equal(r.keywords[0].authorOrder.length,3);
});

function domProfile({user={bioLink:{link:'https://example.com/?x=1&y=two'}},links=[],statusCode=0,domFails=false}={}){
 const previous={document:globalThis.document,location:globalThis.location};
 globalThis.location={origin:'https://www.tiktok.com',pathname:'/@example'};
 globalThis.document={getElementById:()=>({textContent:JSON.stringify({__DEFAULT_SCOPE__:{'webapp.user-detail':{statusCode,userInfo:{user:{id:'9999999999999999999',uniqueId:'example',signature:'comedy',...user}}}}})}),querySelectorAll:selector=>{if(selector.includes('link/v2')||selector==='a[href]'){if(domFails)throw Error('DOM unavailable');return links.map(href=>({href}));}return [];}};
 try{return readProfilePage();}finally{globalThis.document=previous.document;globalThis.location=previous.location;}
}
const native=target=>'https://www.tiktok.com/link/v2?scene=bio_url&target='+encodeURIComponent(target);
test('外链-LINK-001 raw hydration and native DOM link preserve full URL and source evidence',()=>{
 const url='https://example.com/?x=1&y=two',p=domProfile({links:[native(url)]});
 assert.equal(p.externalLink.status,'present');assert.equal(p.externalLink.url,url);assert.equal(p.externalLink.authorId,p.authorId);assert.equal(p.externalLink.evidence.length,2);assert.match(p.externalLink.evidence[0].fieldPath,/bioLink.link/);assert.equal(p.externalLink.evidence[1].href,native(url));
});
test('外链-LINK-002 DOM fallback works; unloaded, wrong route and conflicts remain unknown',()=>{
 const fallback=domProfile({user:{bioLink:undefined},links:[native('https://example.org/?a=1&b=2')]});assert.equal(fallback.externalLink.status,'present');assert.equal(fallback.externalLink.url,'https://example.org/?a=1&b=2');
 for(const options of [{statusCode:10221},{user:{uniqueId:'other'}},{links:[native('https://conflict.example/')]},{user:{bioLink:undefined}},{user:{bioLink:null},domFails:true}])assert.equal(domProfile(options).externalLink.status,'unknown');
});
test('外链-LINK-003 explicit empty mount is none; unsupported schemes stay unknown',()=>{
 assert.equal(domProfile({user:{bioLink:null}}).externalLink.status,'none');
 for(const link of ['javascript:alert(1)','mailto:a@example.com','not a url'])assert.equal(domProfile({user:{bioLink:{link}}}).externalLink.status,'unknown');
 for(const bioLink of [{},[],{link:0},{link:false}])assert.equal(domProfile({user:{bioLink}}).externalLink.status,'unknown');
});
test('外链-LINK-001 real adapter saves basic mounted link without post calls or navigating its target',async t=>{
 const urls=[],p=domProfile(),page={goto:async url=>urls.push(url),url:async()=>urls.at(-1),events:async()=>[],evaluate:async fn=>fn.name==='readSearchPage'?{url:urls.at(-1),httpStatus:200}:domProfile(),cdp:async method=>{assert.equal(method,'Network.enable');return {};}};
 let tick=20000;const browser=createEgoBrowser({page,runDir:await temp(t),config:settings,now:()=>tick,sleep:async ms=>tick+=ms});
 const r=await browser.readProfile(candidate());assert.equal(r.profile.externalLink.url,p.externalLink.url);assert.equal(r.profile.identityVerified,true);assert.deepEqual(r.pages,[]);assert.deepEqual(urls,['https://www.tiktok.com/@example']);
});
