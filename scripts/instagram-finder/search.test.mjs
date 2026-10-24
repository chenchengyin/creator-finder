import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createSearchPager} from './search.mjs';
test('initial search opens homepage, expands the covered input, fills and presses Enter before reading native results',async()=>{
 let current='about:blank',events=[],expanded=false;const actions=[];
 const connection={edges:[{node:{items:[{pk:'1',code:'ABC',media_type:2,user:{pk:'123',username:'example'}}]}}],page_info:{has_next_page:false,end_cursor:null}};
 const page={
  url:async()=>current,
  cdp:async(method)=>method==='Network.getResponseBody'?{body:JSON.stringify({data:{xdt_fbsearch__top_serp_graphql:connection}})}:{},
  events:async()=>{const r=events;events=[];return r;},
  goto:async url=>{actions.push(['goto',url]);current=url;},
  evaluate:async()=>true,
  waitForSelector:async()=>{},waitForFunction:async()=>{},waitForTimeout:async()=>{},
  click:async selector=>{actions.push(['click',selector]);if(selector==='a[href="/explore/"]')current='https://www.instagram.com/explore/';else if(selector==='main input + [role="button"]')expanded=true;else assert.equal(expanded,true,'search overlay must be opened before clicking its input');},
  fill:async(selector,value)=>{actions.push(['fill',value]);assert.equal(expanded,true);},
  keyboard:{press:async key=>{actions.push(['press',key]);current='https://www.instagram.com/explore/search/keyword/?q=%23test';events=[{method:'Network.requestWillBeSent',params:{requestId:'first',request:{postData:'variables='+encodeURIComponent(JSON.stringify({query:'#test'}))}}},{method:'Network.responseReceived',params:{requestId:'first',response:{url:'https://www.instagram.com/graphql/query',status:200}}}];}}
 };
 const first=await createSearchPager({page,keyword:'#test'}).first();
 assert.equal(first.items[0].authorId,'123');assert.equal(first.hasMore,false);
 assert.deepEqual(actions.filter(a=>a[0]==='goto'),[['goto','https://www.instagram.com/']]);
 assert.deepEqual(actions.slice(-2),[['fill','#test'],['press','Enter']]);
});
const item={pk:'1',code:'abc',media_type:2,user:{pk:'123',username:'example'}};
function fixture({hasMore=false,query='#biblereading',delayed=false,limit=false,missing=false,loadedWithoutResponse=false}={}){
 let queue=[],ticks=0,scrolls=0,ready=false;const actions=[];
 const connection={edges:[{node:{items:[item]}}],page_info:{has_next_page:hasMore,end_cursor:hasMore?'c2':null}};
 const body=JSON.stringify(limit?{errors:[{message:'Rate limit exceeded'}]}:{data:{xdt_fbsearch__top_serp_graphql:connection}});
 const emit=()=>{if(missing)return;queue.push({method:'Network.requestWillBeSent',params:{requestId:'next',request:{postData:new URLSearchParams({fb_api_req_friendly_name:'PolarisKeywordSearchExplorePaginationQuery',variables:JSON.stringify({query,after:'c1'})}).toString()}}},{method:'Network.responseReceived',params:{requestId:'next',response:{url:'https://www.instagram.com/api/graphql',status:200}}});ready=true;};
 const page={url:async()=> 'https://www.instagram.com/explore/search/keyword/?q=%23biblereading',cdp:async(m)=>m==='Network.getResponseBody'?{body}:{},events:async()=>{const e=queue;queue=[];return e;},evaluate:async()=>({codes:scrolls&&loadedWithoutResponse?['old','new']:['old'],text:'',url:'https://www.instagram.com/explore/search/keyword/?q=%23biblereading'}),waitForTimeout:async()=>{if(scrolls&&delayed&&!ready&&++ticks===3)emit();},mouse:{move:async()=>{},wheel:async()=>{actions.push('scroll');scrolls++;if(!delayed)emit();}}};
 return {page,actions,connection};
}
test('refuses another search page while the current page is unprocessed',async()=>{const f=fixture();const pager=createSearchPager({page:f.page,keyword:'#biblereading'});await assert.rejects(pager.next({previousCursor:'c1',currentPageProcessed:false}),/current_page_not_processed/);assert.deepEqual(f.actions,[]);});
test('accepts a native explicit final page and retains its items',async()=>{const f=fixture();const r=await createSearchPager({page:f.page,keyword:'#biblereading'}).next({previousCursor:'c1',currentPageProcessed:true});assert.equal(r.hasMore,false);assert.equal(r.items[0].authorId,'123');assert.deepEqual(f.actions,['scroll']);});
test('waits for a delayed search response without scrolling past unprocessed data',async()=>{const f=fixture({delayed:true});const r=await createSearchPager({page:f.page,keyword:'#biblereading'}).next({previousCursor:'c1',currentPageProcessed:true});assert.equal(r.hasMore,false);assert.equal(f.actions.length,1);});
test('missing end state cannot be called keyword completion',async()=>{const f=fixture({hasMore:null});await assert.rejects(createSearchPager({page:f.page,keyword:'#biblereading'}).next({previousCursor:'c1',currentPageProcessed:true}),/search_pagination_state_unknown/);});
test('stops when UI adds results whose native response could not be read',async()=>{const f=fixture({missing:true,loadedWithoutResponse:true});await assert.rejects(createSearchPager({page:f.page,keyword:'#biblereading'}).next({previousCursor:'c1',currentPageProcessed:true}),/search_results_loaded_without_verified_response/);assert.equal(f.actions.length,1);});
test('target search rate limit stops instead of claiming exhaustion',async()=>{const f=fixture({limit:true});await assert.rejects(createSearchPager({page:f.page,keyword:'#biblereading'}).next({previousCursor:'c1',currentPageProcessed:true}),/instagram_access_stopped_rate_limit/);assert.equal(f.actions.length,1);});
test('restores an already loaded next batch without scrolling again',async()=>{
 const f=fixture();const initialPages=[{keyword:'#biblereading',requestCursor:'c1',connection:f.connection,capturedAt:'2026-10-22T00:00:00Z'}];
 const r=await createSearchPager({page:f.page,keyword:'#biblereading',initialPages}).next({previousCursor:'c1',currentPageProcessed:true});
 assert.equal(r.items[0].code,'abc');assert.deepEqual(f.actions,[]);
});

test('legacy plain-query pagination preserves its original query and cursor',async()=>{
 const f=fixture({query:'sourcing manager'});f.page.url=async()=> 'https://www.instagram.com/explore/search/keyword/?q=sourcing%20manager';
 const r=await createSearchPager({page:f.page,keyword:'sourcing manager'}).next({previousCursor:'c1',currentPageProcessed:true});assert.equal(r.keyword,'sourcing manager');assert.equal(r.items[0].authorId,'123');
});

test('归属-SEARCH-001 pager records an unrelated 429 but returns the correlated search page',async()=>{
 const f=fixture(),evidence=[];const events=f.page.events,cdp=f.page.cdp;
 f.page.events=async()=>{const out=await events();return out.length?[{method:'Network.requestWillBeSent',params:{requestId:'feed',request:{postData:'fb_api_req_friendly_name=PolarisFeedQuery'}}},{method:'Network.responseReceived',params:{requestId:'feed',response:{url:'https://www.instagram.com/graphql/query',status:429}}},...out]:out;};
 f.page.cdp=async(method,args)=>args?.requestId==='feed'?{body:JSON.stringify({message:'Rate limit exceeded'})}:cdp(method,args);
 const r=await createSearchPager({page:f.page,keyword:'#biblereading',onEvidence:async e=>evidence.push(e)}).next({previousCursor:'c1',currentPageProcessed:true});assert.equal(r.items.length,1);assert.equal(evidence.find(e=>e.requestId==='feed').action,'warning');
});
test('证据-SEARCH-004 a failed evidence write stops before returning search data',async()=>{
 const f=fixture();await assert.rejects(createSearchPager({page:f.page,keyword:'#biblereading',onEvidence:async()=>{throw Error('disk_full');}}).next({previousCursor:'c1',currentPageProcessed:true}),e=>e.storageFailure===true&&e.message==='disk_full');
});
test('信号-SEARCH-002 target errors retain structured evidence for batch pause',async()=>{
 const f=fixture({limit:true});await assert.rejects(createSearchPager({page:f.page,keyword:'#biblereading'}).next({previousCursor:'c1',currentPageProcessed:true}),e=>e.pause===true&&e.searchEvidence?.requestId==='next'&&e.searchEvidence?.scope==='target');
});

function entryFixture({nativeLink=false,keyword='book',nativeHref='https://www.instagram.com/explore/search/keyword/?q=book'}={}){
 let current='about:blank',value='',events=[],clicked=false;const actions=[],evidence=[];
 const connection={edges:[],page_info:{has_next_page:false,end_cursor:null}};
 const emit=()=>{events=[{method:'Network.requestWillBeSent',params:{requestId:'entry',request:{postData:new URLSearchParams({fb_api_req_friendly_name:'PolarisKeywordSearchExploreQuery',variables:JSON.stringify({query:keyword})}).toString()}}},{method:'Network.responseReceived',params:{requestId:'entry',response:{url:'https://www.instagram.com/graphql/query',status:200}}}];};
 const page={url:async()=>current,goto:async u=>{current=u;actions.push(['goto',u]);},events:async()=>{const e=events;events=[];return e;},cdp:async m=>m==='Network.getResponseBody'?{body:JSON.stringify({data:{xdt_fbsearch__top_serp_graphql:connection}})}:{},waitForSelector:async()=>{},waitForFunction:async()=>{},waitForTimeout:async()=>{},fill:async(s,v)=>{value=v;},keyboard:{press:async()=>{actions.push(['press','Enter']);}},evaluate:async(fn)=>fn.toString().includes('main input +')?false:nativeLink&&!clicked?[{href:nativeHref}]:[],click:async selector=>{actions.push(['click',selector]);if(selector==='a[href="/explore/"]')current='https://www.instagram.com/explore/';if(selector==='loc=href:'+nativeHref){clicked=true;current='https://www.instagram.com/explore/search/keyword/?q='+encodeURIComponent(keyword);emit();}}};
 return {page,actions,evidence,get filled(){return value;},onEvidence:async e=>evidence.push(e)};
}
test('入口-SEARCH-005 account suggestions alone pause without calling them rate limiting or an empty search',async()=>{
 const f=entryFixture();await assert.rejects(createSearchPager({...f,keyword:'book'}).first(),e=>e.pause===true&&e.message==='search_confirmation_unavailable');assert.equal(f.evidence.at(-1)?.reason,'search_confirmation_unavailable');assert.equal(f.actions.filter(a=>a[0]==='goto').length,1);
});
test('入口-SEARCH-005 an exact native keyword result link is clicked only after Enter',async()=>{
 const f=entryFixture({nativeLink:true,keyword:'#book',nativeHref:'https://www.instagram.com/explore/search/keyword/?q=%23book'});const r=await createSearchPager({...f,keyword:'book'}).first();assert.equal(r.hasMore,false);const enter=f.actions.findIndex(a=>a[0]==='press'),click=f.actions.findIndex(a=>a[1]==='loc=href:https://www.instagram.com/explore/search/keyword/?q=%23book');assert.ok(click>enter);assert.equal(f.actions.filter(a=>a[0]==='goto').length,1);
});

test('恢复-SEARCH-006 a saved first page resumes on its original keyword page without navigating',async()=>{
 const f=fixture(),initialPages=[{keyword:'#biblereading',requestCursor:null,connection:f.connection,capturedAt:'2026-10-23T00:00:00Z'}];f.page.goto=async()=>assert.fail('saved page must not be discarded');
 const r=await createSearchPager({page:f.page,keyword:'#biblereading',initialPages}).first();assert.equal(r.items[0].authorId,'123');assert.equal(r.capturedAt,'2026-10-23T00:00:00Z');
});

test('信号-SEARCH-002 unreadable target 401 cannot be masked by another valid response',async()=>{
 const f=fixture(),events=f.page.events,cdp=f.page.cdp;const evidence=[];
 f.page.events=async()=>{const out=await events();if(!out.length)return out;const request=structuredClone(out[0]);request.params.requestId='blocked';return [request,{method:'Network.responseReceived',params:{requestId:'blocked',response:{url:'https://www.instagram.com/graphql/query',status:401}}},...out];};
 f.page.cdp=async(method,args)=>{if(args?.requestId==='blocked')throw Error('No resource with given identifier found');return cdp(method,args);};
 const pager=createSearchPager({page:f.page,keyword:'#biblereading',onEvidence:async e=>evidence.push(e)});await assert.rejects(pager.next({previousCursor:'c1',currentPageProcessed:true}),e=>e.message==='instagram_login_or_challenge'&&e.searchEvidence.httpStatus===401);assert.equal(evidence[0].httpStatus,401);assert.equal(pager.pendingPages().length,1,'valid page arriving after the blocking response must survive pause');
});

 test('入口-SEARCH-005 exact native hashtag links may be selected but different tags are never substituted',async()=>{
 for(const tag of ['christianskits','different']){
  const keyword='#christianskits',href='https://www.instagram.com/explore/tags/'+tag+'/',f=entryFixture({nativeLink:true,keyword,nativeHref:href});
  f.page.evaluate=async(fn,value)=>fn.toString().includes('main input +')?false:vm.runInNewContext('('+fn.toString()+')(keyword)',{keyword:value,URL,document:{querySelectorAll:()=>[{href,getClientRects:()=>[{}]}]}});
  const promise=createSearchPager({...f,keyword}).first();
  if(tag==='christianskits')assert.equal((await promise).hasMore,false);else await assert.rejects(promise,/search_confirmation_unavailable/);
 }
});

test('信号-RETRY-002 non-retryable target failure outranks rate limiting regardless of event order',async()=>{
 for(const status of [403,500])for(const blockedFirst of [false,true]){
  const f=fixture({limit:true}),events=f.page.events,cdp=f.page.cdp;
  f.page.events=async()=>{const out=await events();if(!out.length)return out;const request=structuredClone(out[0]);request.params.requestId='deny';const denied=[request,{method:'Network.responseReceived',params:{requestId:'deny',response:{url:'https://www.instagram.com/graphql/query',status}}}];return blockedFirst?[...denied,...out]:[...out,...denied];};
  f.page.cdp=async(method,args)=>{if(args?.requestId==='deny'){if(status===500)throw Error('No response body');return {body:'{}'};}return cdp(method,args);};
  await assert.rejects(createSearchPager({page:f.page,keyword:'#biblereading'}).next({previousCursor:'c1',currentPageProcessed:true}),e=>e.message===(status===403?'instagram_access_stopped_403':'search_response_failed'));
 }
});


test('输入-HASH-001 only adds a missing hash and preserves case and internal spaces in the real fill boundary',async()=>{
 for(const [raw,actual] of [['book','#book'],['christian skits','#christian skits'],['#Book','#Book']]){
  const nativeHref='https://www.instagram.com/explore/search/keyword/?q='+encodeURIComponent(actual);
  const f=entryFixture({nativeLink:true,keyword:actual,nativeHref});
  const r=await createSearchPager({...f,keyword:raw}).first();
  assert.equal(f.filled,actual);assert.equal(r.keyword,raw);assert.equal(r.searchKeyword,actual);
  const accepted=f.evidence.find(e=>e.action==='accepted');assert.equal(accepted.keyword,raw);assert.equal(accepted.searchKeyword,actual);assert.equal(accepted.requestKeyword,actual);
 }
});
test('恢复-HASH-003 cached hash-query page uses its saved actual query without navigation',async()=>{
 const f=fixture({query:'#book'});f.page.url=async()=> 'https://www.instagram.com/explore/search/keyword/?q=%23book';
 f.page.goto=async()=>assert.fail('do not restart saved search');
 const pager=createSearchPager({page:f.page,keyword:'book',initialPages:[{keyword:'book',searchKeyword:'#book',requestCursor:null,connection:f.connection}]});
 const r=await pager.first();assert.equal(r.keyword,'book');assert.equal(r.searchKeyword,'#book');
});
test('恢复-HASH-003 legacy cached plain page preserves its old actual query',async()=>{
 const f=fixture();f.page.url=async()=> 'https://www.instagram.com/explore/search/keyword/?q=book';
 const r=await createSearchPager({page:f.page,keyword:'book',initialPages:[{keyword:'book',requestCursor:null,connection:f.connection}]}).first();
 assert.equal(r.searchKeyword,'book');
});
test('归属-HASH-002 restored hash pagination retains raw provenance and rejects another raw response',async()=>{
 const f=fixture({query:'#book'});f.page.url=async()=> 'https://www.instagram.com/explore/search/keyword/?q=%23book';
 const r=await createSearchPager({page:f.page,keyword:'book'}).next({previousCursor:'c1',currentPageProcessed:true});assert.equal(r.keyword,'book');assert.equal(r.searchKeyword,'#book');
 const wrong=fixture({query:'book'});wrong.page.url=f.page.url;
 await assert.rejects(createSearchPager({page:wrong.page,keyword:'book'}).next({previousCursor:'c1',currentPageProcessed:true}),/search_pagination_stalled_end_unconfirmed/);
});


test('恢复-HASH-003 explicit saved plain cursor rejects a manually changed hashtag page',async()=>{
 const f=fixture({query:'#book'});f.page.url=async()=> 'https://www.instagram.com/explore/search/keyword/?q=%23book';
 await assert.rejects(createSearchPager({page:f.page,keyword:'book',searchKeyword:'book'}).next({previousCursor:'c1',currentPageProcessed:true}),/search_topic_mismatch/);assert.equal(f.actions.length,0);
});
