import test from 'node:test';
import assert from 'node:assert/strict';
import {collectReels} from './reels.mjs';
const config={windowStart:'2026-10-12T00:00:00+08:00',windowEndExclusive:'2026-10-22T00:00:00+08:00',minAverageViewsExclusive:50000};
const start=Date.parse(config.windowStart)/1000;
const media=(pk,time)=>({pk,code:'code'+pk,user:{pk:'123',username:'example'},media_type:2,taken_at:time,play_count:60000,clips_tab_pinned_user_ids:[]});
function fakePage({avatarError=false,blocked=false,prefetch=false,rateLimit=false,outOfOrder=false,reorderedGrid=false,delayedClips=false,timestampGrid=false}={}){
 let events=[],n=0,pendingClips,reelWaits=0,onReels=false;const bodies=new Map(),actions=[];
 const emit=(body,status=200)=>{const id=String(++n);bodies.set(id,JSON.stringify(body));events.push({method:'Network.responseReceived',params:{requestId:id,response:{url:'https://www.instagram.com/api/graphql',status}}});};
 const emitClips=(items,has_next_page,end_cursor)=>emit({data:{fetch__XDTUserDict:{id:'123',clips_connection:{edges:items.map(m=>({node:{media:{...m,taken_at:undefined}}})),page_info:{has_next_page,end_cursor}}}}});
 const initial=[media('1',start+20),media('2',start+(outOfOrder?30:10))],old=media('3',start-1);
 return {actions,async cdp(method,{requestId}={}){return method==='Network.getResponseBody'?{body:bodies.get(requestId)}:{};},async events(){const e=events;events=[];return e;},async goto(){emit(rateLimit?{data:null,errors:[{message:'Rate limit exceeded'}]}:{data:{xdt_api__v1__feed__user_timeline_graphql_connection:{edges:(reorderedGrid?[...initial].reverse():initial).map(node=>({node})),...(timestampGrid?{page_info:{has_next_page:true,end_cursor:'grid-next'}}:{})}},...(avatarError?{errors:[{path:['xdt_api__v1__feed__user_timeline_graphql_connection','edges',0,'node','location','profile_pic_url'],message:'field_exception'}]}:{})},blocked?429:200);},async click(selector){if(selector.includes('/reels/')){onReels=true;const send=()=>{emitClips(prefetch?[...initial,old]:initial,true,'next');if(prefetch)emitClips([media('4',start-2)],true,'later');};if(delayedClips)pendingClips=send;else send();}else{actions.push('detail');emit({items:[old]});}},async waitForTimeout(){if(pendingClips&&++reelWaits>=3){const send=pendingClips;pendingClips=null;send();}},async waitForSelector(){},async waitForURL(){},async waitForFunction(){},mouse:{async move(){},async wheel(){if(timestampGrid&&!onReels){actions.push('timestamp_grid_scroll');emit({data:{xdt_api__v1__feed__user_timeline_graphql_connection:{edges:[{node:old}],page_info:{has_next_page:false,end_cursor:null}}}});}else{actions.push('scroll');emitClips([old],false,null);}}},keyboard:{async press(){actions.push('close');}}};
}
test('completes one page before scrolling, reads exact detail then computes window',async()=>{const page=fakePage();let saves=0;const result=await collectReels({page,username:'example',authorId:'123',config,onCheckpoint:async()=>saves++});assert.equal(result.metrics.averageViews,60000);assert.equal(result.metrics.sampleSize,2);assert.equal(result.metrics.coverageComplete,true);assert.deepEqual(page.actions,['scroll','detail','close']);assert.ok(saves>=3);});
test('unrelated location avatar GraphQL field failure does not discard valid timestamps',async()=>{const result=await collectReels({page:fakePage({avatarError:true}),username:'example',authorId:'123',config});assert.equal(result.metrics.averageViews,60000);});
test('429 saves incomplete checkpoint and performs no scrolling',async()=>{const page=fakePage({blocked:true});let state;const result=await collectReels({page,username:'example',authorId:'123',config,onCheckpoint:async s=>state=s});assert.equal(result.metrics.averageViews,null);assert.equal(state.capture.collectionIssue,'instagram_access_stopped_429');assert.deepEqual(page.actions,[]);});
test('stops at processed window boundary without processing prefetched older page',async()=>{const page=fakePage({prefetch:true});const result=await collectReels({page,username:'example',authorId:'123',config});assert.equal(result.metrics.averageViews,60000);assert.equal(result.capture.processedPageCount,1);assert.equal(result.capture.pages.length,2);assert.deepEqual(page.actions,['detail','close']);});
test('reuses verified timestamps but refreshes list play counts',async()=>{const page=fakePage();const cachedCapture={authorId:'123',pages:[{items:[media('3',start-1)]}]};const result=await collectReels({page,username:'example',authorId:'123',config,cachedCapture});assert.equal(result.metrics.averageViews,60000);assert.deepEqual(page.actions,['scroll']);});
test('standalone mean collection never runs country collection implicitly',async()=>{let called=false;const result=await collectReels({page:fakePage(),username:'example',authorId:'123',config,countryReader:async()=>{called=true;return {status:'observed',countryCode:'US'};}});assert.equal(called,false);assert.equal(result.capture.location,undefined);assert.equal(result.metrics.averageViews,60000);});
test('a timed-out detail closes its own dialog before returning incomplete metrics',async()=>{
 const page=fakePage();const click=page.click.bind(page);page.click=async selector=>{if(selector.includes('/reels/'))await click(selector);else page.actions.push('detail');};
 const result=await collectReels({page,username:'example',authorId:'123',config});
 assert.match(result.capture.collectionIssue,/video_timestamp_response_missing/);assert.equal(result.metrics.coverageComplete,false);assert.deepEqual(page.actions,['scroll','detail','close']);
});
test('verified native detail timestamp does not require a rendered time element',async()=>{
 const page=fakePage();page.waitForSelector=async selector=>{if(selector.includes('time[datetime]'))throw new Error('UI date never rendered');};
 const result=await collectReels({page,username:'example',authorId:'123',config});assert.equal(result.metrics.coverageComplete,true);assert.equal(result.metrics.averageViews,60000);
});
test('fixed detail tab reads exact native hydration and leaves the author tab untouched',async()=>{
 const page=fakePage();const visits=[];
 const detailPage={cdp:async()=>{},events:async()=>[],goto:async url=>visits.push(url),url:async()=>visits.at(-1),waitForTimeout:async()=>{},evaluate:async()=>[JSON.stringify({data:{xig_fetch_media:media('3',start-1)}})]};
 const r=await collectReels({page,detailPage,username:'example',authorId:'123',config});assert.equal(r.metrics.coverageComplete,true);assert.deepEqual(visits,['https://www.instagram.com/p/code3/']);assert.deepEqual(page.actions,['scroll']);assert.equal(r.capture.details[0].source,'native_video_page_hydration');
});
test('HTTP 200 rate limit stops without any detail or scroll action',async()=>{
 const page=fakePage({rateLimit:true});const r=await collectReels({page,username:'example',authorId:'123',config});assert.equal(r.capture.collectionIssue,'instagram_access_stopped_rate_limit');assert.equal(r.metrics.coverageComplete,false);assert.deepEqual(page.actions,[]);
});
test('suggested-users rate limit is recorded without discarding valid author lists',async()=>{
 const page=fakePage();const events=page.events.bind(page),cdp=page.cdp.bind(page);let added=false;
 page.events=async()=>{const result=await events();if(!added&&result.length){added=true;result.push({method:'Network.requestWillBeSent',params:{requestId:'recommended',request:{postData:'fb_api_req_friendly_name=PolarisProfileSuggestedUsersWithPreloadableQuery'}}},{method:'Network.responseReceived',params:{requestId:'recommended',response:{url:'https://www.instagram.com/api/graphql',status:200}}});}return result;};
 page.cdp=async(method,params)=>method==='Network.getResponseBody'&&params.requestId==='recommended'?{body:JSON.stringify({data:null,errors:[{message:'Rate limit exceeded'}]})}:cdp(method,params);
 const r=await collectReels({page,username:'example',authorId:'123',config});assert.equal(r.metrics.coverageComplete,true);assert.equal(r.metrics.averageViews,60000);assert.equal(r.capture.warnings[0].operation,'PolarisProfileSuggestedUsersWithPreloadableQuery');
});
test('loaded video HTML timestamp stays usable when unrelated recommendations fail',async()=>{
 const page=fakePage();let read=0;
 const detailPage={cdp:async()=>{},events:async()=>++read===1?[]:[{method:'Network.responseReceived',params:{requestId:'unrelated',response:{url:'https://www.instagram.com/api/graphql',status:200}}}],goto:async()=>{},url:async()=> 'https://www.instagram.com/p/code3/',waitForTimeout:async()=>{},evaluate:async()=>[JSON.stringify({data:{xig_fetch_media:media('3',start-1)}})]};
 detailPage.cdp=async method=>method==='Network.getResponseBody'?{body:JSON.stringify({errors:[{message:'Rate limit exceeded'}]})}:{};
 const r=await collectReels({page,detailPage,username:'example',authorId:'123',config});assert.equal(r.metrics.coverageComplete,true);
});

test('invalid chronological order stops after the current page instead of scrolling older history',async()=>{
 const page=fakePage({outOfOrder:true});
 const r=await collectReels({page,username:'example',authorId:'123',config});
 assert.ok(r.metrics.issues.includes('post_order_invalid'));
 assert.ok(['post_order_invalid','latest_order_unconfirmed'].includes(r.capture.collectionIssue));
 assert.equal(r.metrics.coverageComplete,false);
 assert.equal(r.capture.processedPageCount,1);
 assert.deepEqual(page.actions,[]);
});

test('profile grid rearrangement does not override verified publication-time order',async()=>{
 const r=await collectReels({page:fakePage({reorderedGrid:true}),username:'example',authorId:'123',config});
 assert.equal(r.metrics.coverageComplete,true);
 assert.equal(r.metrics.averageViews,60000);
});
test('waits for a delayed native Reels response without reloading the author',async()=>{
 const page=fakePage({delayedClips:true});
 const r=await collectReels({page,username:'example',authorId:'123',config});
 assert.equal(r.metrics.coverageComplete,true);
 assert.equal(r.metrics.averageViews,60000);
});
test('correlates a recommendation response whose request was observed in an earlier read',async()=>{
 const page=fakePage(),events=page.events.bind(page),cdp=page.cdp.bind(page);let reads=0;
 page.events=async()=>{const e=await events();reads++;if(reads===2)e.push({method:'Network.requestWillBeSent',params:{requestId:'late-recommended',request:{postData:'fb_api_req_friendly_name=PolarisProfileSuggestedUsersWithPreloadableQuery'}}});if(reads===3)e.push({method:'Network.responseReceived',params:{requestId:'late-recommended',response:{url:'https://www.instagram.com/api/graphql',status:200}}});return e;};
 page.cdp=async(method,params)=>method==='Network.getResponseBody'&&params.requestId==='late-recommended'?{body:JSON.stringify({data:null,errors:[{message:'Rate limit exceeded'}]})}:cdp(method,params);
 const r=await collectReels({page,username:'example',authorId:'123',config});
 assert.equal(r.metrics.coverageComplete,true);assert.equal(r.capture.warnings[0].ignored,true);
});

test('native post-grid pagination supplies timestamps without opening individual old videos',async()=>{
 const page=fakePage({timestampGrid:true});
 const r=await collectReels({page,username:'example',authorId:'123',config});
 assert.equal(r.metrics.coverageComplete,true);assert.equal(r.metrics.averageViews,60000);
 assert.deepEqual(page.actions,['timestamp_grid_scroll','scroll']);
});
test('verified timestamp-only pages can be reused after an interruption',async()=>{
 const page=fakePage();const cachedCapture={authorId:'123',timestampPages:[{items:[media('3',start-1)]}]};
 const r=await collectReels({page,username:'example',authorId:'123',config,cachedCapture});
 assert.equal(r.metrics.coverageComplete,true);assert.deepEqual(page.actions,['scroll']);
});

function collaborationPage({member=true}={}){
 const page=fakePage(),events=page.events.bind(page),cdp=page.cdp.bind(page);
 const collab=(pk,time)=>({...media(pk,time),user:{pk:'999',username:'original'},coauthor_producers:member?[{pk:'123',username:'example'}]:[]});
 // Transform the normal native fixture into an entirely coauthored feed.
 page.cdp=async(method,params)=>{
  const r=await cdp(method,params);if(method!=='Network.getResponseBody')return r;
  const data=JSON.parse(r.body),timeline=data.data?.xdt_api__v1__feed__user_timeline_graphql_connection;
  if(timeline)timeline.edges=[];
  const clips=data.data?.fetch__XDTUserDict?.clips_connection;
  if(clips)clips.edges=clips.edges.map(({node})=>({node:{media:collab(node.media.pk,undefined)}}));
  return {body:JSON.stringify(data)};
 };
 const visits=[];const times={'1':start+20,'2':start+30,'3':start-1};
 const detailPage={cdp:async()=>{},events:async()=>[],goto:async url=>visits.push(url),url:async()=>visits.at(-1),waitForTimeout:async()=>{},evaluate:async()=>{const pk=visits.at(-1).match(/code(\d+)/)[1];return [JSON.stringify({items:[collab(pk,times[pk])]})];}};
 return {page,detailPage,visits,collab};
}
test('coauthored feed uses original-owner details and waits for native exhaustion',async()=>{
 const {page,detailPage,visits}=collaborationPage();
 const r=await collectReels({page,detailPage,username:'example',authorId:'123',config});
 assert.equal(r.metrics.coverageComplete,true);assert.equal(r.metrics.sampleSize,2);assert.equal(r.metrics.averageViews,60000);
 assert.equal(r.capture.processedPageCount,2);assert.equal(r.metrics.coverageBasis,'native_list_exhausted');
 assert.equal(visits.length,3);assert.equal(r.capture.details[0].user.pk,'999');assert.equal(r.capture.details[0].coauthor_producers[0].pk,'123');
});
test('coauthor timestamp evidence is reusable while foreign unassociated videos remain blocked',async()=>{
 const f=collaborationPage();const cachedCapture={authorId:'123',details:['1','2','3'].map((pk,i)=>f.collab(pk,i===2?start-1:start+10+i))};
 const r=await collectReels({...f,username:'example',authorId:'123',config,cachedCapture});assert.equal(r.metrics.coverageComplete,true);assert.equal(f.visits.length,0);
 const wrong=collaborationPage({member:false});const bad=await collectReels({...wrong,username:'example',authorId:'123',config});assert.equal(bad.capture.collectionIssue,'unexpected_reel_identity_or_type');assert.equal(wrong.visits.length,0);
});
