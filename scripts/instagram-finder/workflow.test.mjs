import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSearchConnection,processSearchPage} from './workflow.mjs';
const window={windowStart:'2026-10-12T00:00:00+08:00',windowEndExclusive:'2026-10-22T00:00:00+08:00'};
const conditions={requireBioEmail:true,country:'US',minAverageViewsExclusive:50000};
const item=(id='1',authorId='123',username='example')=>({id,code:'code'+id,authorId,username,mediaType:2,videoUrl:'https://www.instagram.com/p/code'+id+'/',caption:'Reading #biblereading'});
function setup(){const calls=[];return {calls,readers:{profile:async({username})=>{calls.push('profile:'+username);return {status:'observed',biography:'work@example.com',emails:['work@example.com'],links:[],linksComplete:true};},country:async()=>{calls.push('country');return {status:'observed',countryCode:'US'};},averageViews:async()=>{calls.push('mean');return {capture:{},metrics:{coverageComplete:true,averageViews:60000,passesThreshold:true}};}}};}
test('parses only this response page, preserving exact author IDs, covers and source captions',()=>{
 const media={pk:'99',code:'ABC',media_type:2,user:{pk:'90071992547409999',username:'example'},image_versions2:{candidates:[{url:'https://cdn.example/cover.jpg'}]},caption:{text:'Caption'}};
 const p=parseSearchConnection({edges:[{node:{items:[media,media]}}],page_info:{has_next_page:true,end_cursor:'next'}});
 assert.equal(p.items.length,1);assert.equal(p.items[0].authorId,'90071992547409999');assert.equal(p.items[0].coverUrl,'https://cdn.example/cover.jpg');assert.equal(p.items[0].caption,'Caption');assert.equal(p.hasMore,true);
});
test('completes each author before next, deduplicates authors and never auto qualifies content',async()=>{
 const s=setup();const result=await processSearchPage({items:[item(),item('2'),item('3','456','another')],conditions,window,readers:s.readers});
 assert.deepEqual(s.calls,['profile:example','country','mean','profile:another','country','mean']);assert.equal(result.items[1].status,'duplicate_author');assert.equal(Object.keys(result.authors).length,2);assert.equal(result.authors['123'].status,'core_pass_pending_content_review');assert.equal(result.status,'completed');assert.equal(result.nextItemIndex,3);
});
test('no Bio email skips country and mean; unknown bio is pending rather than rejected',async()=>{
 const s=setup();s.readers.profile=async({username})=>username==='example'?{status:'observed',biography:'No email',emails:[]}:{status:'unknown',biography:null,emails:null};
 const result=await processSearchPage({items:[item(),item('2','456','another')],conditions,window,readers:s.readers});assert.deepEqual(s.calls,[]);assert.equal(result.authors['123'].reason,'no_public_bio_email');assert.equal(result.authors['456'].status,'pending_review');
});
test('non-target country stops before costly mean collection',async()=>{
 const s=setup();s.readers.country=async()=>({status:'observed',countryCode:'MX'});const r=await processSearchPage({items:[item()],conditions,window,readers:s.readers});assert.deepEqual(s.calls,['profile:example']);assert.equal(r.authors['123'].reason,'country_mismatch');
});
test('protection checkpoints current author then resume continues without repeating completed work',async()=>{
 const s=setup();let countryCalls=0;s.readers.country=async()=>++countryCalls===1?{status:'paused',reason:'instagram_access_stopped_429'}:{status:'observed',countryCode:'US'};
 const snapshots=[];const args={items:[item(),item('2')],conditions,window,readers:s.readers,onCheckpoint:async state=>snapshots.push(state)};
 const stopped=await processSearchPage(args);assert.equal(stopped.status,'paused');assert.equal(stopped.nextItemIndex,0);assert.equal(stopped.authors['123'].profile.emails[0],'work@example.com');
 const result=await processSearchPage({...args,state:stopped});assert.equal(result.status,'completed');assert.deepEqual(s.calls,['profile:example','mean']);assert.equal(countryCalls,2);
 const again=await processSearchPage({...args,state:result});assert.equal(again.status,'completed');assert.deepEqual(s.calls,['profile:example','mean']);assert.equal(snapshots[0].nextItemIndex,0);
});
test('incomplete metrics never pass, and disabled modules never run',async()=>{
 const s=setup();s.readers.averageViews=async()=>({capture:{collectionIssue:'reels_pagination_stalled'},metrics:{coverageComplete:false}});
 const r=await processSearchPage({items:[item()],conditions,window,readers:s.readers});assert.equal(r.authors['123'].status,'pending_review');
 s.calls.length=0;const only=await processSearchPage({items:[item()],conditions:{requireBioEmail:true},readers:s.readers});assert.deepEqual(s.calls,['profile:example']);assert.equal(only.authors['123'].status,'core_pass_pending_content_review');
});
test('resume rejects different items or conditions before any browser work',async()=>{
 const s=setup();const state=await processSearchPage({items:[item()],conditions,window,readers:s.readers});s.calls.length=0;
 await assert.rejects(processSearchPage({items:[item('other')],conditions,window,state,readers:s.readers}));await assert.rejects(processSearchPage({items:[item()],conditions:{requireBioEmail:true},window,state,readers:s.readers}));assert.deepEqual(s.calls,[]);
});
test('failed disk checkpoint stops before browser action and invalid identity fails early',async()=>{
 const s=setup();await assert.rejects(processSearchPage({items:[item()],conditions,window,readers:s.readers,onCheckpoint:async()=>{throw new Error('disk_full');}}),/disk_full/);assert.deepEqual(s.calls,[]);
 await assert.rejects(processSearchPage({items:[item('1',123)],conditions,window,readers:s.readers}));assert.deepEqual(s.calls,[]);
});
test('an existing dialog pauses the page instead of marking all later profiles unavailable',async()=>{
 const s=setup();s.readers.profile=async()=>({status:'unknown',reason:'existing_dialog'});
 const r=await processSearchPage({items:[item(),item('2','456','another')],conditions,window,readers:s.readers});assert.equal(r.status,'paused');assert.equal(r.nextItemIndex,0);assert.equal(Object.keys(r.authors).length,1);
});
test('profile author ID must match search identity before any later collection',async()=>{
 const s=setup();s.readers.profile=async()=>({status:'observed',authorId:'999',biography:'work@example.com',emails:['work@example.com']});
 const r=await processSearchPage({items:[item()],conditions,window,readers:s.readers});assert.equal(r.authors['123'].status,'pending_review');assert.equal(r.authors['123'].reason,'profile_author_id_mismatch');assert.deepEqual(s.calls,[]);
});
test('country dialog pause can resume its own stage after the dialog disappears',async()=>{
 const s=setup();let n=0;s.readers.country=async()=>++n===1?{status:'unknown',reason:'existing_dialog'}:{status:'observed',countryCode:'US'};
 const args={items:[item()],conditions,window,readers:s.readers};const state=await processSearchPage(args);assert.equal(state.status,'paused');const r=await processSearchPage({...args,state});assert.equal(r.status,'completed');assert.equal(n,2);
});
test('rate-limited mean saves the current stage and does not visit the next author',async()=>{
 const s=setup();s.readers.averageViews=async()=>{s.calls.push('mean');return {capture:{collectionIssue:'instagram_access_stopped_rate_limit'},metrics:{coverageComplete:false}};};
 const r=await processSearchPage({items:[item(),item('2','456','another')],conditions,window,readers:s.readers});assert.equal(r.status,'paused');assert.equal(r.nextItemIndex,0);assert.deepEqual(s.calls,['profile:example','country','mean']);assert.equal(Object.keys(r.authors).length,1);
});
