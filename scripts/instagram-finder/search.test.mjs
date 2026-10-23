import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearchPager} from './search.mjs';
test('initial keyword page is read from its correlated native response',async()=>{
 let current='about:blank',events=[];
 const connection={edges:[{node:{items:[{pk:'1',code:'ABC',media_type:2,user:{pk:'123',username:'example'}}]}}],page_info:{has_next_page:false,end_cursor:null}};
 const page={url:async()=>current,cdp:async(method)=>method==='Network.getResponseBody'?{body:JSON.stringify({data:{xdt_fbsearch__top_serp_graphql:connection}})}:{},events:async()=>{const r=events;events=[];return r;},goto:async url=>{current=url;events=[{method:'Network.requestWillBeSent',params:{requestId:'first',request:{postData:'variables='+encodeURIComponent(JSON.stringify({query:'#test'}))}}},{method:'Network.responseReceived',params:{requestId:'first',response:{url:'https://www.instagram.com/graphql/query',status:200}}}];},waitForTimeout:async()=>{}};
 const pager=createSearchPager({page,keyword:'#test'});assert.equal(typeof pager.first,'function');const first=await pager.first();assert.equal(first.items[0].authorId,'123');assert.equal(first.hasMore,false);assert.equal(new URL(current).searchParams.get('q'),'#test');
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

test('plain keyword is preserved exactly in native search requests',async()=>{
 const f=fixture({query:'sourcing manager'});f.page.url=async()=> 'https://www.instagram.com/explore/search/keyword/?q=sourcing%20manager';
 const r=await createSearchPager({page:f.page,keyword:'sourcing manager'}).next({previousCursor:'c1',currentPageProcessed:true});assert.equal(r.keyword,'sourcing manager');assert.equal(r.items[0].authorId,'123');
});
