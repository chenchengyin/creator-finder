import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeReels, clipsPage, detailMedia, freezeWindow} from './metrics.mjs';
const config={windowStart:'2026-10-12T00:00:00+08:00',windowEndExclusive:'2026-10-22T00:00:00+08:00',minAverageViewsExclusive:50000};
const start=Date.parse(config.windowStart)/1000,end=Date.parse(config.windowEndExclusive)/1000;
const media=(id,time,views=50000,extra={})=>({pk:id,code:'code'+id,user:{pk:'123',username:'example'},media_type:2,taken_at:time,play_count:views,clips_tab_pinned_user_ids:[],...extra});
const capture=items=>({authorId:'123',username:'example',capturedAt:'2026-10-22T04:00:00Z',latestOrderConfirmed:true,pages:[{status:200,hasNextPage:false,items}]});
test('freezes Shanghai completed natural days',()=>assert.deepEqual(freezeWindow('2026-10-22T04:00:00Z',10),{windowStart:config.windowStart,windowEndExclusive:config.windowEndExclusive}));
test('deduplicates and respects inclusive start/exclusive end; zero is real',()=>{const r=analyzeReels(capture([media('1',end,999),media('2',end-1,100000),media('2',end-1,100000),media('3',start,0),media('4',start-1,3)]),config);assert.equal(r.sampleSize,2);assert.equal(r.averageViews,50000);assert.equal(r.passesThreshold,false);});
test('strict threshold passes above 50000',()=>assert.equal(analyzeReels(capture([media('1',start,50001)]),config).passesThreshold,true));
test('missing views never become zero or pass',()=>{const r=analyzeReels(capture([media('1',start,null)]),config);assert.equal(r.averageViews,null);assert.equal(r.coverageComplete,false);});
test('incomplete pagination never emits average',()=>{const c=capture([media('1',start+1)]);c.pages[0].hasNextPage=true;assert.equal(analyzeReels(c,config).averageViews,null);});
test('old pinned item cannot prove coverage',()=>{const c=capture([media('9',start-1,9,{clips_tab_pinned_user_ids:['123']}),media('1',start+1)]);c.pages[0].hasNextPage=true;assert.equal(analyzeReels(c,config).coverageComplete,false);});
test('pinned item inside window counts; chronological old item proves boundary',()=>{const c=capture([media('9',start,100000,{clips_tab_pinned_user_ids:['123']}),media('1',start+2,200000),media('2',start-1)]);c.pages[0].hasNextPage=true;const r=analyzeReels(c,config);assert.equal(r.coverageComplete,true);assert.equal(r.averageViews,150000);});
test('missing timestamp, wrong author, response error, and invalid order block results',()=>{for(const change of[c=>delete c.pages[0].items[0].taken_at,c=>c.pages[0].items[0].user.pk='999',c=>c.pages[0].status=429,c=>c.latestOrderConfirmed=false,c=>c.pages[0].items.push(media('2',start+2))]){const c=capture([media('1',start)]);change(c);assert.equal(analyzeReels(c,config).averageViews,null);}});
test('reads only profile clips connection and matching detail, not recommendations',()=>{const m=media('1',start);const page=clipsPage({data:{fetch__XDTUserDict:{id:'123',clips_connection:{edges:[{node:{media:m}}],page_info:{has_next_page:true,end_cursor:'next'}}}}});assert.equal(page.items[0].pk,'1');assert.equal(page.hasNextPage,true);assert.equal(clipsPage({data:{recommendations:{items:[m]}}}),null);assert.equal(detailMedia({items:[m]},'code1','123').pk,'1');assert.equal(detailMedia({items:[m]},'code1','999'),null);});
test('does not substitute likes or another view metric',()=>{const r=analyzeReels(capture([media('1',start,null,{like_count:100000,view_count:999999})]),config);assert.equal(r.averageViews,null);});
test('prefetched unprocessed pages do not block a completed window',()=>{const c=capture([media('1',start+1,60000),media('2',start-1)]);c.pages[0].hasNextPage=true;c.pages.push({status:200,hasNextPage:true,items:[media('3',undefined)]});c.processedPageCount=1;assert.equal(analyzeReels(c,config).averageViews,60000);});

const collaboration=(id,time,views=100000)=>media(id,time,views,{user:{pk:'999',username:'original'},coauthor_producers:[{pk:'123',username:'example'}]});
test('explicit coauthor videos count once and preserve original publisher evidence',()=>{
 const r=analyzeReels(capture([media('1',start+20,60000),collaboration('2',start+30),collaboration('2',start+30),media('3',start-1)]),config);
 assert.equal(r.coverageComplete,true);assert.equal(r.sampleSize,2);assert.equal(r.averageViews,80000);
 const row=r.sample.find(m=>m.id==='2');assert.equal(row.authorId,'123');assert.equal(row.originalAuthorId,'999');assert.equal(row.originalUsername,'original');assert.equal(row.attribution,'coauthor');assert.deepEqual(row.coauthorIds,['123']);
});
test('old collaboration cannot establish the window boundary',()=>{
 const c=capture([media('1',start+20),collaboration('2',start-1)]);c.pages[0].hasNextPage=true;
 const r=analyzeReels(c,config);assert.equal(r.coverageComplete,false);assert.equal(r.averageViews,null);
 // Ignoring coauthor order also removes proof that an older owned post ends the whole list.
 c.pages[0].items.push(media('3',start-2));assert.equal(analyzeReels(c,config).coverageComplete,false);
});
test('all-collaboration list requires native exhaustion when latest order is unconfirmed',()=>{
 const c=capture([collaboration('1',start+10),collaboration('2',start+20,60000)]);c.latestOrderConfirmed=false;c.pages[0].hasNextPage=true;
 assert.equal(analyzeReels(c,config).averageViews,null);
 c.pages[0].hasNextPage=false;const r=analyzeReels(c,config);assert.equal(r.coverageComplete,true);assert.equal(r.averageViews,80000);assert.equal(r.coverageBasis,'native_list_exhausted');
});
test('coauthor membership needs an exact native ID and still requires valid plays and dates',()=>{
 for(const mutate of [m=>m.coauthor_producers=[{pk:'321',username:'example'}],m=>delete m.play_count,m=>delete m.taken_at]){
  const m=collaboration('1',start);mutate(m);assert.equal(analyzeReels(capture([m]),config).averageViews,null);
 }
 const c=capture([media('1',start),collaboration('2',start+5),media('3',start+10)]);
 assert.ok(analyzeReels(c,config).issues.includes('post_order_invalid'));
});
test('verified full-list chronology permits a coauthor window boundary but still rejects later disorder',()=>{
 const c=capture([media('1',start+20),collaboration('2',start+10),media('3',start-1)]);c.collaborationOrderConfirmed=true;c.pages[0].hasNextPage=true;
 assert.equal(analyzeReels(c,config).averageViews,75000);
 c.pages[0].items.push(collaboration('4',start+5));assert.equal(analyzeReels(c,config).coverageComplete,false);
});
