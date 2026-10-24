import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {temp,capture,candidate,config} from './fixtures.mjs';
const api=await import('./browser.mjs').catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?{}:Promise.reject(e));
const fn=name=>{assert.equal(typeof api[name],'function','Missing implementation: '+name);return api[name];};
const chromeErrorSnapshot=await readFile(new URL('../tiktok-browser/fixtures/chromium-403-split-text.txt',import.meta.url),'utf8');
const scrollState={blocked:false,x:600,y:400,viewportHeight:800,position:0,signature:'stable-list'};

for(const previousClicks of [0,3,10,30])test('访问-ACCESS-005 region resume preserves '+previousClicks+' saved button clicks after the ordinary 403 budget is exhausted',async t=>{
 const c=capture(),item=c.pages[0].items[0];delete item.locationCreated;
 const attempt=(number,action)=>({number,action,url:item.url,videoId:item.id,httpStatus:403});
 c.videoRegion={navigationAttempts:[attempt(1,'goto'),attempt(2,'goto'),...Array.from({length:previousClicks},(_,i)=>({...attempt(i+3,'reload_button'),reloadClicks:i+1}))]};
 let clicks=0,tick=20000,saved;
 const recovers=previousClicks===0;
 const page={url:async()=>clicks&&recovers?item.url:'chrome-error://chromewebdata/',snapshot:async()=>clicks&&recovers?'TikTok video page':chromeErrorSnapshot,
  goto:async()=>assert.fail('resume must click the existing button'),click:async()=>clicks++,
  evaluate:async()=>({url:clicks&&recovers?item.url:'chrome-error://chromewebdata/',httpStatus:clicks&&recovers?200:403,capturedAt:c.profile.capturedAt,statusCode:clicks&&recovers?0:null,item:clicks&&recovers?{...item,locationCreated:'US'}:null})};
 const browser=fn('createEgoBrowser')({page,runDir:await temp(t),now:()=>tick,sleep:async ms=>tick+=ms});
 const collect=()=>browser.collectRegion(c,async report=>saved=structuredClone(report));
 if(recovers){const report=await collect();assert.equal(report.summary.regionCode,'US');assert.equal(clicks,1);}
 else{await assert.rejects(collect(),/http_403/);assert.equal(clicks,30-previousClicks);}
 assert.equal(saved.navigationAttempts.filter(a=>a.action==='reload_button').length,recovers?1:30);
 assert.deepEqual(saved.navigationAttempts.slice(0,2),c.videoRegion.navigationAttempts.slice(0,2));
});
function pageFixture({statuses=[200],apiStatuses=[200],queries,failBody=false}={}){
 let nav=0,buffer=[],url='',scrolls=0,filled='';const keyword='christian skits',actions=[];
 const make=()=>apiStatuses.flatMap((status,i)=>[{method:'Network.requestWillBeSent',params:{requestId:String(i),documentURL:url}},{method:'Network.responseReceived',params:{requestId:String(i),response:{url:'https://www.tiktok.com/api/search/item/full/?keyword='+encodeURIComponent(queries?.[i]||keyword),status}}},{method:'Network.loadingFinished',params:{requestId:String(i)}}]);
 return {get nav(){return nav;},get scrolls(){return scrolls;},actions,page:{
  url:async()=>url,events:async()=>{const v=buffer;buffer=[];return v;},
  goto:async value=>{actions.push(['goto',value]);url=value;nav++;buffer=statuses[Math.min(nav-1,statuses.length-1)]>=400?make():[];},
  click:async selector=>actions.push(['click',selector]),
  fill:async(selector,value)=>{filled=value;actions.push(['fill',value]);},
  keyboard:{press:async key=>{assert.equal(key,'Enter');actions.push(['press',key]);url='https://www.tiktok.com/search/video?q='+encodeURIComponent(filled);buffer=make();}},
  evaluate:async f=>f.name==='readSearchPage'?{url,httpStatus:statuses[Math.min(nav-1,statuses.length-1)],links:[],captcha:false,loginPrompt:false}:scrollState,
  mouse:{move:async()=>{},wheel:async()=>{scrolls++;buffer=make();}},waitForSelector:async()=>{},waitForFunction:async()=>{},
  cdp:async(method,arg)=>{if(method==='Network.enable')return {};if(failBody&&arg.requestId==='1')throw Error('missing body');return {body:JSON.stringify({status_code:0,has_more:0,cursor:12,item_list:[]})};}
 }};
}
for(const statuses of [[429],[401]])test('访问-ACCESS-003 document '+statuses[0]+' wins over API403',async t=>{
 const p=pageFixture({statuses,apiStatuses:[403]}),waits=[];const b=fn('createEgoBrowser')({page:p.page,runDir:await temp(t),sleep:async ms=>waits.push(ms)});
 await assert.rejects(b.discoverBatch({keyword:'christian skits'}),new RegExp(String(statuses[0])));assert.equal(p.nav,1);assert(!waits.includes(11000));
});
test('完成-DONE-003 partial bodies cannot mark search exhausted',async t=>{
 let tick=20000;const p=pageFixture({apiStatuses:[200,200],failBody:true}),b=fn('createEgoBrowser')({page:p.page,runDir:await temp(t),now:()=>tick,sleep:async ms=>{tick+=ms;}});
 await assert.rejects(b.discoverBatch({keyword:'christian skits'}),/response|body/i);
});
test('来源-SOURCE-001 old keyword response cannot finish the current word',async t=>{
 let tick=20000;const p=pageFixture({queries:['old query']}),b=fn('createEgoBrowser')({page:p.page,runDir:await temp(t),now:()=>tick,sleep:async ms=>tick+=ms});await assert.rejects(b.discoverBatch({keyword:'christian skits'}),/provenance|source|missing/i);
});
test('访问-ACCESS-001/004 same-address 403 gets one delayed retry, budget persists',async t=>{
 const p=pageFixture({statuses:[403],apiStatuses:[403]}),waits=[];let checkpoint;
 const b=fn('createEgoBrowser')({page:p.page,runDir:await temp(t),sleep:async ms=>waits.push(ms)});
 await assert.rejects(b.discoverBatch({keyword:'christian skits',onCheckpoint:async c=>checkpoint=c}),/403/);assert.equal(p.nav,2);assert.equal(waits.filter(x=>x===11000).length,1);
 await assert.rejects(b.discoverBatch({keyword:'christian skits',checkpoint}),/403/);assert.equal(p.nav,2);
});
test('访问-ACCESS-005 search adapter clicks a visible browser error reload button',async t=>{
 let nav=0,clicks=0,buffer=[],tick=20000;const url='https://www.tiktok.com/search/video?q=christian%20skits';
 const events=status=>[{method:'Network.requestWillBeSent',params:{requestId:String(nav+clicks),documentURL:url}},{method:'Network.responseReceived',params:{requestId:String(nav+clicks),response:{url:'https://www.tiktok.com/api/search/item/full/?keyword=christian%20skits',status}}},{method:'Network.loadingFinished',params:{requestId:String(nav+clicks)}}];
 const page={
  url:async()=>url,goto:async()=>{nav++;buffer=events(403);},
  snapshot:async()=>clicks?"TikTok search results":"访问 www.tiktok.com 的请求遭到拒绝 HTTP ERROR 403 重新加载",
  click:async locator=>{assert.match(locator,/重新加载/);clicks++;buffer=events(200);},
  events:async()=>{const out=buffer;buffer=[];return out;},
  evaluate:async f=>f.name==='readSearchPage'?{url,httpStatus:clicks?200:403,links:[],captcha:false,loginPrompt:false}:undefined,
  cdp:async(method,arg)=>method==='Network.enable'?{}:{body:JSON.stringify({status_code:0,has_more:0,cursor:12,item_list:[]})}
 };
 const waits=[],browser=fn('createEgoBrowser')({page,runDir:await temp(t),now:()=>tick,sleep:async ms=>{waits.push(ms);tick+=ms;}});
 const result=await browser.discoverBatch({keyword:'christian skits'});
 assert.equal(nav,1);assert.equal(clicks,1);assert.equal(waits.filter(ms=>ms===10000).length,1);assert(waits.reduce((sum,ms)=>sum+ms,0)>=10500);assert.equal(result.valid,true);
});
test('访问-ACCESS-005 an exhausted ordinary search 403 budget still permits its unused visible button budget',async t=>{
 const url='https://www.tiktok.com/search/video?q=christian%20skits';let clicks=0,buffer=[],tick=20000;
 const page={url:async()=>clicks?url:'chrome-error://chromewebdata/',goto:async()=>assert.fail('saved error page must not navigate'),
  snapshot:async()=>clicks?'TikTok search results':chromeErrorSnapshot,
  click:async()=>{clicks++;buffer=[{method:'Network.requestWillBeSent',params:{requestId:'recovered',documentURL:url}},{method:'Network.responseReceived',params:{requestId:'recovered',response:{url:'https://www.tiktok.com/api/search/item/full/?keyword=christian%20skits',status:200}}},{method:'Network.loadingFinished',params:{requestId:'recovered'}}];},
  events:async()=>{const events=buffer;buffer=[];return events;},evaluate:async()=>({url:clicks?url:'chrome-error://chromewebdata/',httpStatus:clicks?200:403,captcha:false,loginPrompt:false}),
  cdp:async method=>method==='Network.enable'?{}:{body:JSON.stringify({status_code:0,has_more:0,cursor:12,item_list:[]})}};
 const browser=fn('createEgoBrowser')({page,runDir:await temp(t),now:()=>tick,sleep:async ms=>tick+=ms});
 const result=await browser.discoverBatch({keyword:'christian skits',checkpoint:{retry:{url,attempts:2,status:403}}});
 assert.equal(clicks,1);assert.equal(result.valid,true);
});
test('访问-ACCESS-005 visible reload click budget survives adapter restart',async t=>{
 const runDir=await temp(t),url='https://www.tiktok.com/search/video?q=christian%20skits';let nav=0,clicks=0,buffer=[],checkpoint,tick=20000;
 const events=()=>[{method:'Network.requestWillBeSent',params:{requestId:String(nav+clicks),documentURL:url}},{method:'Network.responseReceived',params:{requestId:String(nav+clicks),response:{url:'https://www.tiktok.com/api/search/item/full/?keyword=christian%20skits',status:403}}},{method:'Network.loadingFinished',params:{requestId:String(nav+clicks)}}];
 const page={url:async()=>url,goto:async()=>{nav++;buffer=events();},snapshot:async()=>"访问 www.tiktok.com 的请求遭到拒绝 HTTP ERROR 403 重新加载",click:async()=>{clicks++;buffer=events();},events:async()=>{const out=buffer;buffer=[];return out;},evaluate:async f=>f.name==='readSearchPage'?{url,httpStatus:403,links:[],captcha:false,loginPrompt:false}:undefined,cdp:async method=>method==='Network.enable'?{}:{body:JSON.stringify({status_code:0,has_more:0,cursor:12,item_list:[]})}};
 const options={page,runDir,now:()=>tick,sleep:async ms=>{tick+=ms;}};
 const first=fn('createEgoBrowser')(options);
 await assert.rejects(first.discoverBatch({keyword:'christian skits',onCheckpoint:async value=>{checkpoint=structuredClone(value);if(value.retry?.reloadClicks===1)throw Error('simulated interruption');}}),/simulated interruption/);
 assert.equal(clicks,1);assert.equal(checkpoint.retry.reloadClicks,1);
 await assert.rejects(fn('createEgoBrowser')(options).discoverBatch({keyword:'christian skits',checkpoint}),/403/);
 assert.equal(nav,1);assert.equal(clicks,30);
});
test('访问-ACCESS-005 an interrupted Ego error-page checkpoint resumes the visible button without navigating again',async t=>{
 const runDir=await temp(t),url='https://www.tiktok.com/search/video?q=christian%20skits';let nav=0,clicks=0,checkpoint,tick=20000;
 const page={url:async()=>"chrome-error://chromewebdata/",goto:async()=>nav++,snapshot:async()=>"www.tiktok.com 已被屏蔽 此页面已被 ego 屏蔽 ERR_BLOCKED_BY_CLIENT 重新加载",click:async()=>clicks++,events:async()=>[],evaluate:async f=>f.name==='readSearchPage'?{url:"chrome-error://chromewebdata/",httpStatus:0,links:[],captcha:false,loginPrompt:false}:undefined,cdp:async method=>method==='Network.enable'?{}:{body:''}};
 const options={page,runDir,now:()=>tick,sleep:async ms=>{tick+=ms;}};
 await assert.rejects(fn('createEgoBrowser')(options).discoverBatch({keyword:'christian skits',onCheckpoint:async value=>{checkpoint=structuredClone(value);if(value.retry?.screen==='reload_button')throw Error('simulated interruption');}}),/simulated interruption/);
 assert.equal(checkpoint.retry.status,null);assert.equal(checkpoint.retry.reloadClicks,0);
 await assert.rejects(fn('createEgoBrowser')(options).discoverBatch({keyword:'christian skits',checkpoint}));
 assert.equal(nav,1);assert.equal(clicks,30);
});
test('节奏-PACE-001 search pagination keeps a serialized 10.5 second interval',async t=>{
 const p=pageFixture(),times=[],runDir=await temp(t);let tick=20000;const original=p.page.goto,originalWheel=p.page.mouse.wheel;
 p.page.goto=async url=>{times.push(tick);return original(url);};
 p.page.mouse.wheel=async(...args)=>{times.push(tick);return originalWheel(...args);};
 const b=fn('createEgoBrowser')({page:p.page,runDir,now:()=>tick,sleep:async ms=>{tick+=ms;}});
 const first=await b.discoverBatch({keyword:'christian skits'});await b.discoverBatch({keyword:'christian skits',checkpoint:first.checkpoint});assert(times[1]-times[0]>=10500);
});
test('节奏-PACE-002 profile post pagination uses a three second interval',async t=>{
 const runDir=await temp(t),url='https://www.tiktok.com/@example';let tick=20000,scrolls=0,buffer=[],times=[];
 const page={
  url:async()=>url,
  events:async()=>{const events=buffer;buffer=[];return events;},
  goto:async()=>{},
  evaluate:async f=>{
   if(f.name==='readSearchPage')return {url,httpStatus:200,captcha:false,loginPrompt:false};
   return scrollState;
  },
  mouse:{move:async()=>{},wheel:async()=>{
   scrolls++;times.push(tick);const requestId=String(scrolls);
   buffer=[
    {method:'Network.requestWillBeSent',params:{requestId,documentURL:url}},
    {method:'Network.responseReceived',params:{requestId,response:{url:'https://www.tiktok.com/api/post/item_list/?cursor='+scrolls,status:200}}},
    {method:'Network.loadingFinished',params:{requestId}}
   ];
  }},
  cdp:async(method,arg)=>method==='Network.enable'?{}:{body:JSON.stringify({statusCode:0,hasMore:true,cursor:scrolls,itemList:[]})}
 };
 const browser=fn('createEgoBrowser')({page,runDir,now:()=>tick,sleep:async ms=>{tick+=ms;}}),saved=capture();saved.profile.profileUrl=url;
 await browser.nextPosts(candidate(),saved);await browser.nextPosts(candidate(),saved);
 assert.equal(times[1]-times[0],3000);
});
test('访问-ACCESS-004 profile 403 budget survives restarting the browser adapter',async t=>{
 const p=pageFixture({statuses:[403],apiStatuses:[403]}),runDir=await temp(t);let checkpoint,tick=20000;
 p.page.evaluate=async f=>f.name==='readSearchPage'?{url:'https://www.tiktok.com/@example',httpStatus:403}:capture().profile;
 const options={page:p.page,runDir,now:()=>tick,sleep:async ms=>tick+=ms};
 await assert.rejects(fn('createEgoBrowser')(options).readProfile({username:'example'},async c=>checkpoint=c),/403/);assert.equal(p.nav,2);
 await assert.rejects(fn('createEgoBrowser')(options).readProfile({username:'example'},async()=>{},checkpoint),/403/);assert.equal(p.nav,2);
});
test('身份-ID-001 real adapter reads profile and post fields; optional email is honored',async t=>{
 const c=capture();c.profile.bio='Christian skits';let buffer=[],url='',nav=0,profileReads=0;
 const item=c.pages[0].items[0];
 const page={goto:async u=>{url=u;nav++;buffer=[{method:'Network.requestWillBeSent',params:{requestId:'posts',documentURL:u}},{method:'Network.responseReceived',params:{requestId:'posts',response:{url:'https://www.tiktok.com/api/post/item_list/?secUid=public',status:200}}},{method:'Network.loadingFinished',params:{requestId:'posts'}}];},events:async()=>{const out=buffer;buffer=[];return out;},url:async()=>url,evaluate:async f=>f.name==='readSearchPage'?{url,httpStatus:200}:(++profileReads<=2?{}:c.profile),cdp:async m=>m==='Network.enable'?{}:{body:JSON.stringify({statusCode:0,hasMore:false,itemList:[{id:item.id,author:{id:item.authorId,uniqueId:item.username},createTime:item.createdAt,stats:{playCount:60000},desc:'#christianskit',locationCreated:'US'}]})}};
 let tick=20000;const browser=fn('createEgoBrowser')({page,runDir:await temp(t),config:{...config,requireBioEmail:false},now:()=>tick,sleep:async ms=>tick+=ms});
 const {qualifyCandidate}=await import('./profile.mjs');const r=await qualifyCandidate({candidate:candidate(),config:{...config,requireBioEmail:false},browser});assert.equal(r.decision,'confirmed');assert.equal(nav,1);assert.equal(r.metrics.sampleSize,1);
});
test('排序-SORT-001 waits for Latest state to settle before deciding whether to click',async t=>{
 const c=capture(),item=c.pages[0].items[0];let buffer=[],url='',nav=0,profileReads=0,latestClicks=0,tick=20000;
 const page={
  goto:async u=>{url=u;nav++;buffer=[{method:'Network.requestWillBeSent',params:{requestId:'posts',documentURL:u}},{method:'Network.responseReceived',params:{requestId:'posts',response:{url:'https://www.tiktok.com/api/post/item_list/?secUid=public',status:200}}},{method:'Network.loadingFinished',params:{requestId:'posts'}}];},
  events:async()=>{const out=buffer;buffer=[];return out;},url:async()=>url,
  evaluate:async f=>{if(f.name==='readSearchPage')return {url,httpStatus:200,captcha:false,loginPrompt:false};if(f.name==='readProfilePage'){profileReads++;return {...c.profile,latestSortAvailable:profileReads>=2,latestOrderConfirmed:profileReads>=3};}latestClicks++;return undefined;},
  cdp:async m=>m==='Network.enable'?{}:{body:JSON.stringify({statusCode:0,hasMore:false,cursor:1,itemList:[{id:item.id,author:{id:item.authorId,uniqueId:item.username},createTime:item.createdAt,stats:{playCount:60000},desc:'#christianskit',locationCreated:'US'}]})}
 };
 const browser=fn('createEgoBrowser')({page,runDir:await temp(t),config,now:()=>tick,sleep:async ms=>{tick+=ms;}});
 const result=await browser.readProfile({username:c.profile.username,authorIdHint:c.profile.authorId});
 assert.equal(result.profile.latestOrderConfirmed,true);assert.equal(result.pages.length,1);assert.equal(result.pages[0].items[0].views,60000);assert.equal(nav,1);assert.equal(latestClicks,0);
});
test('空间-EGO-001 runner chooses p1 and refuses user-owned spaces',async t=>{
 const run=fn('runInEgo'),runDir=await temp(t);let labels=[];
 await assert.rejects(run({spaceId:5,runDir},{listTaskSpaces:async()=>[{id:5,ownership:'user'}],taskSpace:async()=>{throw Error('must not connect');}}),/control|ownership/i);
 const p=pageFixture();await assert.rejects(run({spaceId:5,runDir,config:{}},{listTaskSpaces:async()=>[{id:5,ownership:'agent'}],taskSpace:async()=>({page:label=>{labels.push(label);return p.page;},finish:async()=>{}})}));assert.deepEqual(labels,['p1']);
});
test('账号限制-ACCESS-006 observed audience-control status is incomplete account data, not global login failure',async t=>{
 const url='https://www.tiktok.com/@example';let tick=20000;
 const page={url:async()=>url,goto:async()=>{},events:async()=>[],evaluate:async f=>f.name==='readSearchPage'?{url,httpStatus:200,loginPrompt:true}:{profileUrl:url,statusCode:209002,bio:'',capturedAt:config.createdAt},cdp:async method=>{assert.equal(method,'Network.enable');return {};}};
 const browser=fn('createEgoBrowser')({page,runDir:await temp(t),config,now:()=>tick,sleep:async ms=>tick+=ms});
 const data=await browser.readProfile(candidate());assert.equal(data.profile.ready,false);assert.equal(data.profile.accessRestriction,'audience_management_login_required');assert.deepEqual(data.pages,[]);
 const {evaluateCapture}=await import('./profile.mjs');const result=evaluateCapture({candidate:candidate(),capture:data,config});assert.equal(result.decision,'data_incomplete');assert.equal(result.reason,'profile_not_verified_public');
});
test('账号限制-ACCESS-006 generic login prompt still pauses when audience-control status is absent',async t=>{
 const url='https://www.tiktok.com/@example';let tick=20000;
 const page={url:async()=>url,goto:async()=>{},events:async()=>[],evaluate:async f=>f.name==='readSearchPage'?{url,httpStatus:200,loginPrompt:true}:{profileUrl:url,statusCode:0},cdp:async()=>({})};
 const browser=fn('createEgoBrowser')({page,runDir:await temp(t),config,now:()=>tick,sleep:async ms=>tick+=ms});await assert.rejects(browser.readProfile(candidate()),/login_prompt_needs_inspection/);
});
test('恢复-ACCESS-007 default adapter replays an unreadable post batch once without losing Bio or frozen context',async t=>{
 const url='https://www.tiktok.com/@example',runDir=await temp(t);let tick=20000,buffer=[],profiles=0;
 const page={url:async()=>url,events:async()=>{const out=buffer;buffer=[];return out;},goto:async()=>{},evaluate:async f=>f.name==='readSearchPage'?{url,httpStatus:200}:scrollState,mouse:{move:async()=>{},wheel:async()=>{buffer=[{method:'Network.requestWillBeSent',params:{requestId:'lost',documentURL:url}},{method:'Network.responseReceived',params:{requestId:'lost',response:{url:'https://www.tiktok.com/api/post/item_list/?cursor=2',status:200}}},{method:'Network.loadingFinished',params:{requestId:'lost'}}];}},cdp:async method=>{if(method==='Network.enable')return {};throw Error('body unavailable');}};
 const browser=fn('createEgoBrowser')({page,runDir,config,now:()=>tick,sleep:async ms=>tick+=ms});
 browser.readProfile=async()=>{profiles++;return {...capture(),postAttemptComplete:true};};
 const saved=capture();saved.pages[0].cursor=2;saved.verificationContext={runId:'same-run',criteria:'same-window'};
 const result=await browser.nextPosts(candidate(),saved,async cp=>saved.access=cp);
 assert.equal(result.restarted,true);assert.equal(profiles,1);assert.equal(saved.profile.bio,'Comedy #christianskit public@example.com');assert.equal(saved.verificationContext.runId,'same-run');assert.equal(saved.postBodyReplay.previousPages[0].cursor,2);
 const persisted=JSON.parse(await readFile(runDir+'/capture-9999999999999999999.json','utf8'));assert.equal(persisted.postBodyReplay.attempts,1);assert.equal(persisted.pages[0].cursor,1);
 await assert.rejects(browser.nextPosts(candidate(),saved,async cp=>saved.access=cp),/post_body_recovery_exhausted/);assert.equal(profiles,1);
});
test('恢复-ACCESS-007 successful response clears stale body-failure marker before later pagination',async t=>{
 const fixture=pageFixture();let saved,tick=20000;
 const browser=fn('createEgoBrowser')({page:fixture.page,runDir:await temp(t),config,now:()=>tick,sleep:async ms=>tick+=ms});
 await browser.discoverBatch({keyword:'christian skits',checkpoint:{partialBodies:[]},onCheckpoint:async value=>saved=value});
 assert.equal(Object.hasOwn(saved,'partialBodies'),false);assert.equal(saved.retry,null);
});

test('入口-SEARCH-002 adapter submits through the homepage and saves the actual native result URL',async t=>{
 const p=pageFixture(),runDir=await temp(t);let tick=20000;
 const b=fn('createEgoBrowser')({page:p.page,runDir,now:()=>tick,sleep:async ms=>{tick+=ms;}});
 const result=await b.discoverBatch({keyword:'christian skits'});
 assert.deepEqual(p.actions,[['goto','https://www.tiktok.com/'],['click','loc=role:searchbox[name*=""]'],['click','input[data-e2e="search-user-input"]'],['fill','christian skits'],['press','Enter']]);
 assert.equal(result.sourceUrl,'https://www.tiktok.com/search/video?q=christian%20skits');assert.equal(result.checkpoint.searchPageUrl,result.sourceUrl);
 const capture=JSON.parse((await readFile(runDir+'/tiktok-video-discovery.jsonl','utf8')).trim());assert.equal(capture.url,result.sourceUrl);assert.equal(result.hasMore,false);
});
