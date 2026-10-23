import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {writeFile} from 'node:fs/promises';
import {createEgoBrowser} from './browser.mjs';
import {temp} from './fixtures.mjs';

// Browser/network boundaries are simulated; the adapter, timers, parsing and DOM callback are real.
function fixture({onGoto,onScroll,height=40000}={}){
 let tick=20000,url='',sequence=0,position=0,pointer=false;
 const scheduled=[],buffer=[],bodies=new Map(),wheels=[],reads=[];
 const root={clientHeight:800,clientWidth:1200,scrollHeight:height,
  get scrollTop(){return position;},set scrollTop(value){position=Math.min(Math.max(0,value),root.scrollHeight-800);onScroll?.(api);},
  getBoundingClientRect:()=>({left:0,right:1200,top:0,bottom:800,width:1200,height:800}),contains:()=>true};
 const item={parentElement:root,href:'https://www.tiktok.com/@example/video/1',getBoundingClientRect:()=>({top:0,bottom:200})};
 const document={querySelector:()=>item,querySelectorAll:()=>[item],scrollingElement:root,documentElement:root,elementFromPoint:()=>item};
 const flush=()=>{scheduled.sort((a,b)=>a.at-b.at||a.order-b.order);while(scheduled[0]?.at<=tick)buffer.push(scheduled.shift().event);};
 function schedule(event,delay=0){scheduled.push({event,at:tick+delay,order:sequence++});}
 function request({id='r'+sequence,input='0',cursor='10',more=true,author='earlier_author',start=0,headers=0,finish=0,bodyError=false,keyword='bible',documentURL=url}={}){
  const endpoint=new URL(documentURL).pathname.startsWith('/@')?'/api/post/item_list/':'/api/search/item/full/';
  const requestUrl='https://www.tiktok.com'+endpoint+'?keyword='+encodeURIComponent(keyword)+'&cursor='+input+'&secUid=public';
  schedule({method:'Network.requestWillBeSent',params:{requestId:id,documentURL,request:{url:requestUrl},timestamp:(tick+start)/1000}},start);
  schedule({method:'Network.responseReceived',params:{requestId:id,response:{url:requestUrl,status:200}}},headers);
  if(finish!==null)schedule({method:'Network.loadingFinished',params:{requestId:id}},finish);
  bodies.set(id,{ready:finish===null?Infinity:tick+finish,bodyError,data:{status_code:0,has_more:more?1:0,cursor,item_list:[{id:cursor,desc:'#biblecomedy',author:{id:cursor,uniqueId:author,signature:'public@example.com'}}]}});
 }
 const api={request,root,wheels,reads,get tick(){return tick;},get url(){return url;},
  now:()=>tick,sleep:async ms=>{tick+=ms;flush();},
  page:{url:async()=>url,goto:async target=>{url=target;position=0;onGoto?.(api);flush();},
   events:async()=>{flush();return buffer.splice(0);},
   evaluate:async(fn,arg)=>{flush();if(fn.name==='readSearchPage')return {url,httpStatus:200,captcha:false,loginPrompt:false};return vm.runInNewContext('('+fn.toString()+')(argument)',{document,getComputedStyle:()=>({overflowY:'auto'}),innerWidth:1200,innerHeight:800,argument:arg});},
   mouse:{move:async()=>{pointer=true;},wheel:async(dx,dy)=>{assert(pointer,'wheel must point at the list');wheels.push({at:tick,delta:dy});root.scrollTop+=dy;flush();}},
   cdp:async(method,args)=>{if(method==='Network.enable')return {};assert.equal(method,'Network.getResponseBody');const saved=bodies.get(args.requestId);reads.push({id:args.requestId,at:tick});if(!saved||saved.bodyError||tick<saved.ready)throw Error('body unavailable');return {body:JSON.stringify(saved.data)};}}
 };return api;
}
async function browserFor(t,f){return createEgoBrowser({page:f.page,runDir:await temp(t),now:f.now,sleep:f.sleep});}
const nextCheckpoint=result=>({...result.checkpoint,cursor:result.cursor});

test('同步-SYNC-001 slow response body finishes before it is read',async t=>{
 const f=fixture({onGoto:f=>f.request({finish:2000,more:false})}),browser=await browserFor(t,f);
 const result=await browser.discoverBatch({keyword:'bible'});
 assert.equal(result.hasMore,false);assert.equal(f.reads.length,1);assert(f.reads[0].at>=22000);
});

test('同步-SYNC-002 pending prefetch survives the pagination cooldown without another wheel',async t=>{
 const f=fixture({onGoto:f=>f.request()}),browser=await browserFor(t,f);
 const first=await browser.discoverBatch({keyword:'bible'});
 f.request({id:'prefetch',input:'10',cursor:'20',more:false,author:'later_author',headers:2000,finish:2500});
 const next=await browser.discoverBatch({keyword:'bible',checkpoint:nextCheckpoint(first)});
 assert.deepEqual(next.items.map(i=>i.username),['later_author']);assert.equal(next.hasMore,false);assert.equal(f.wheels.length,0);
});

test('同步-SYNC-003 reverse response arrival preserves native author order and the final cursor',async t=>{
 const f=fixture({onGoto:f=>{
  f.request({id:'older',input:'0',cursor:'10',headers:40,finish:100});
  f.request({id:'newer',input:'10',cursor:'20',more:false,author:'later_author',headers:30,finish:100});
 }}),browser=await browserFor(t,f);
 const result=await browser.discoverBatch({keyword:'bible'});
 assert.deepEqual(result.items.map(i=>i.username),['earlier_author','later_author']);assert.equal(result.cursor,'20');assert.equal(result.hasMore,false);
});

test('同步-SYNC-004 a missing intermediate cursor cannot produce a completed search',async t=>{
 const f=fixture({onGoto:f=>{
  f.request({id:'first',input:'0',cursor:'10'});
  f.request({id:'gap',input:'20',cursor:'30',more:false});
 }}),browser=await browserFor(t,f);
 await assert.rejects(browser.discoverBatch({keyword:'bible'}),/pagination_chain/);
});

test('滚动-SCROLL-001 quarter viewport steps remain one second apart and stop at request start',async t=>{
 let loaded=false;
 const f=fixture({onGoto:f=>f.request(),onScroll:f=>{if(!loaded&&f.root.scrollTop>=2800){loaded=true;f.request({input:'10',cursor:'20',more:false,headers:3000,finish:4000});}}}),browser=await browserFor(t,f);
 const first=await browser.discoverBatch({keyword:'bible'});
 const next=await browser.discoverBatch({keyword:'bible',checkpoint:nextCheckpoint(first)});
 assert.equal(next.hasMore,false);assert.equal(f.wheels.length,14);
 for(const [index,wheel] of f.wheels.entries()){assert.equal(wheel.delta,200);if(index)assert(wheel.at-f.wheels[index-1].at>=1000);}
 assert(f.reads.at(-1).at-f.wheels.at(-1).at>=4000);
});

test('同步-SYNC-005 an unfinished download times out without reading or declaring an end',async t=>{
 const f=fixture({onGoto:f=>f.request({finish:null,more:false})}),browser=await browserFor(t,f);
 await assert.rejects(browser.discoverBatch({keyword:'bible'}),/response_timeout/);assert.deepEqual(f.reads,[]);
});

test('滚动-SCROLL-002 reaching an unchanged bottom without a response never means end of results',async t=>{
 const f=fixture({height:1000,onGoto:f=>f.request()}),browser=await browserFor(t,f);
 const first=await browser.discoverBatch({keyword:'bible'});
 await assert.rejects(browser.discoverBatch({keyword:'bible',checkpoint:nextCheckpoint(first)}),/scroll_stalled|response_missing/);
 assert(f.wheels.length<=5,'an unchanged bottom must not keep receiving wheel input');
});

test('同步-SYNC-006 a duplicated page does not regress the final cursor or change author order',async t=>{
 const f=fixture({onGoto:f=>{
  f.request({id:'first',input:'0',cursor:'10'});
  f.request({id:'last',input:'10',cursor:'20',more:false,author:'later_author'});
  f.request({id:'duplicate',input:'0',cursor:'10'});
 }}),browser=await browserFor(t,f);
 const result=await browser.discoverBatch({keyword:'bible'});
 assert.deepEqual(result.items.map(i=>i.username),['earlier_author','later_author']);assert.equal(result.cursor,'20');assert.equal(result.hasMore,false);
});

test('同步-SYNC-007 a broken prefix is never saved as reusable partial author evidence',async t=>{
 let checkpoint;
 const f=fixture({onGoto:f=>{
  f.request({id:'first',input:'0',cursor:'10'});
  f.request({id:'gap',input:'20',cursor:'30'});
  f.request({id:'unreadable',input:'30',cursor:'40',bodyError:true});
 }}),browser=await browserFor(t,f);
 await assert.rejects(browser.discoverBatch({keyword:'bible',onCheckpoint:async value=>checkpoint=value}),/pagination_chain/);
 assert(!checkpoint?.partialBodies?.some(page=>page.cursor==='30'));
});

test('同步-SYNC-008 a request appearing during body read cannot be hidden by an earlier end flag',async t=>{
 const f=fixture({onGoto:f=>f.request({id:'first',more:false})});
 const original=f.page.cdp;let added=false;
 f.page.cdp=async(...args)=>{const result=await original(...args);if(args[0]==='Network.getResponseBody'&&!added){added=true;f.request({id:'late',input:'10',cursor:'20',more:false});}return result;};
 const browser=await browserFor(t,f);
 await assert.rejects(browser.discoverBatch({keyword:'bible'}),/pagination_chain/);
});

test('同步-SYNC-009 profile readiness has a bounded wait even after its response finishes',async t=>{
 const f=fixture({onGoto:f=>f.request()});const original=f.page.evaluate;
 f.page.evaluate=async(fn,arg)=>fn.name==='readProfilePage'?{profileUrl:f.url,statusCode:0,username:'example',authorId:'42',bio:'public@example.com',latestSortAvailable:false}:original(fn,arg);
 const browser=createEgoBrowser({page:f.page,runDir:await temp(t),now:f.now,sleep:async ms=>{await f.sleep(ms);if(f.tick>=35000)throw Error('test_guard_exceeded');}});
 await assert.rejects(browser.readProfile({username:'example',authorIdHint:'42'}),/profile_readiness_timeout/);
});

test('同步-SYNC-010 a valid empty search can omit its item list',async t=>{
 const f=fixture({onGoto:f=>f.request({more:false})}),original=f.page.cdp;
 f.page.cdp=async(...args)=>args[0]==='Network.getResponseBody'?{body:JSON.stringify({status_code:0,has_more:0,cursor:0})}:original(...args);
 const browser=await browserFor(t,f),result=await browser.discoverBatch({keyword:'bible'});
 assert.deepEqual(result.items,[]);assert.equal(result.hasMore,false);
});

test('同步-SYNC-011 a late old-keyword response cannot block the next valid pagination',async t=>{
 let loaded=false;
 const f=fixture({onGoto:f=>f.request(),onScroll:f=>{if(!loaded){loaded=true;f.request({id:'valid-next',input:'10',cursor:'20',more:false});}}}),browser=await browserFor(t,f);
 const first=await browser.discoverBatch({keyword:'bible'});
 f.request({id:'old-word',keyword:'old bible word',input:'0',cursor:'999',more:false});
 const result=await browser.discoverBatch({keyword:'bible',checkpoint:nextCheckpoint(first)});
 assert.equal(result.cursor,'20');assert.equal(result.hasMore,false);assert(f.reads.every(r=>r.id!=='old-word'));
});

test('同步-SYNC-012 long cooldowns keep draining instead of overflowing a bounded browser buffer',async t=>{
 const f=fixture({onGoto:f=>f.request()}),original=f.page.events;let lastDrain=f.tick;
 f.page.events=async()=>{let events=await original();if(f.tick-lastDrain>1000)events=events.filter(e=>e.method!=='Network.requestWillBeSent');lastDrain=f.tick;return events;};
 const browser=await browserFor(t,f),first=await browser.discoverBatch({keyword:'bible'});
 f.request({id:'prefetch',input:'10',cursor:'20',more:false,headers:2000,finish:2500});
 const result=await browser.discoverBatch({keyword:'bible',checkpoint:nextCheckpoint(first)});
 assert.equal(result.cursor,'20');assert.equal(result.hasMore,false);assert.equal(f.wheels.length,0);
});

test('滚动-SCROLL-003 continuously changing layout has a bounded render wait',async t=>{
 let loaded=false;
 const f=fixture({onGoto:f=>f.request(),onScroll:f=>{if(!loaded){loaded=true;f.request({input:'10',cursor:'20',more:false});}}});
 Object.defineProperty(f.root,'scrollHeight',{get:()=>40000+(Math.floor(f.tick/100)%2)*100});
 const browser=createEgoBrowser({page:f.page,runDir:await temp(t),now:f.now,sleep:async ms=>{await f.sleep(ms);if(f.tick>=50000)throw Error('test_guard_exceeded');}});
 const first=await browser.discoverBatch({keyword:'bible'});
 await assert.rejects(browser.discoverBatch({keyword:'bible',checkpoint:nextCheckpoint(first)}),/render_timeout/);
});

test('同步-SYNC-013 a fresh navigation cannot start from a later cursor and claim completeness',async t=>{
 const f=fixture({onGoto:f=>f.request({input:'20',cursor:'30',more:false})}),browser=await browserFor(t,f);
 await assert.rejects(browser.discoverBatch({keyword:'bible'}),/pagination_chain/);
});

test('同步-SYNC-014 a lost response-header event has a bounded wait',async t=>{
 const f=fixture({onGoto:f=>f.request({more:false})}),original=f.page.events;
 f.page.events=async()=>{const events=await original();return events.filter(event=>event.method!=='Network.responseReceived');};
 const browser=createEgoBrowser({page:f.page,runDir:await temp(t),now:f.now,sleep:async ms=>{await f.sleep(ms);if(f.tick>=55000)throw Error('test_guard_exceeded');}});
 await assert.rejects(browser.discoverBatch({keyword:'bible'}),/response_timeout/);assert.deepEqual(f.reads,[]);
});

test('来源-SOURCE-002 matching path and keyword on a different origin cannot supply results',async t=>{
 const f=fixture({onGoto:f=>f.request({more:false})}),original=f.page.events;
 f.page.events=async()=>{const events=await original();for(const event of events){if(event.params.request?.url)event.params.request.url=event.params.request.url.replace('www.tiktok.com','example.invalid');if(event.params.response?.url)event.params.response.url=event.params.response.url.replace('www.tiktok.com','example.invalid');}return events;};
 const browser=await browserFor(t,f);
 await assert.rejects(browser.discoverBatch({keyword:'bible'}),/response_missing|provenance/);assert.deepEqual(f.reads,[]);
});

test('滚动-SCROLL-004 the one-second wheel interval survives a long batch boundary',async t=>{
 let stage=0;
 const f=fixture({onGoto:f=>f.request(),onScroll:f=>{
  if(stage===0&&f.root.scrollTop>=2800){stage=1;f.request({id:'second',input:'10',cursor:'20'});}
  else if(stage===1&&f.root.scrollTop>=3000){stage=2;f.request({id:'third',input:'20',cursor:'30',more:false});}
 }}),browser=await browserFor(t,f);
 const first=await browser.discoverBatch({keyword:'bible'}),second=await browser.discoverBatch({keyword:'bible',checkpoint:nextCheckpoint(first)});
 const third=await browser.discoverBatch({keyword:'bible',checkpoint:nextCheckpoint(second)});
 assert.equal(third.hasMore,false);assert(f.wheels.length>=15);
 for(let i=1;i<f.wheels.length;i++)assert(f.wheels[i].at-f.wheels[i-1].at>=1000,'wheel interval must also hold between batches');
});

test('滚动-SCROLL-005 resuming the adapter retains the saved wheel interval',async t=>{
 let loaded=false;
 const f=fixture({onScroll:f=>{if(!loaded){loaded=true;f.request({input:'10',cursor:'20',more:false});}}}),runDir=await temp(t);
 await f.page.goto('https://www.tiktok.com/search/video?q=bible');
 await writeFile(runDir+'/last-tiktok-scroll.txt',String(f.tick));
 await writeFile(runDir+'/last-tiktok-nav.txt',String(f.tick-20000));
 const browser=createEgoBrowser({page:f.page,runDir,now:f.now,sleep:f.sleep});
 const result=await browser.discoverBatch({keyword:'bible',checkpoint:{started:true,cursor:'10'}});
 assert.equal(result.hasMore,false);assert(f.wheels[0].at>=21000);
});
