import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import {join} from 'node:path';
let api={};try{api=await import('./batch.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const config={keywords:['#one','#two'],conditions:{requireEmail:true,country:'US'}};
const item=(authorId='123',username='example')=>({id:authorId,authorId,username,code:'c'+authorId,mediaType:2,videoUrl:'https://www.instagram.com/p/c'+authorId+'/',caption:'caption'});
async function temp(t){const dir=await fs.mkdtemp(join(os.tmpdir(),'ins-batch-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
function browser(){const actions=[];return {actions,session:{spaceId:999,owned:false},page:{url:async()=> 'https://www.instagram.com/example/'},
 startKeyword:async keyword=>{actions.push('search:'+keyword);return {items:[item()],hasMore:keyword==='#one',cursor:keyword==='#one'?'c1':null};},
 nextSearchPage:async()=>{actions.push('next');return {items:[item(),item('456','second')],hasMore:false,cursor:null};},pendingSearchPages:()=>[],
 readers:{profile:async({username})=>{actions.push('profile:'+username);return {status:'observed',username,biography:'',links:[],linksComplete:true};},email:async()=>({completion:'completed',matches:true,acceptedEmails:[{email:'agent@example.com',sourceType:'linked_site',evidence:[{sourceUrl:'https://contact.example/'}]}]}),country:async()=>({status:'observed',countryCode:'US'})},finish:async()=>actions.push('finish')};}
const run=async args=>{assert.equal(typeof api.runBatch,'function','batch integration not implemented');return api.runBatch(args);};
test('BATCH-001 multi-page multi-keyword authors are verified once and exported with sources',async t=>{
 const dir=await temp(t),b=browser(),r=await run({config,runDir:dir,browser:b});
 assert.equal(r.status,'completed');assert.equal(Object.keys(r.authors).length,2);assert.deepEqual(b.actions,['search:#one','profile:example','next','profile:second','search:#two','finish']);
 const out=JSON.parse(await fs.readFile(join(dir,'results.json'),'utf8'));assert.equal(out.rows.length,2);assert.equal(out.rows[0].email,'agent@example.com');assert.match(out.rows[0]['收录依据'],/国家/);assert.deepEqual(out.rows[0].keywords,['#one','#two']);assert.match(out.rows[0].status,/pending_content/);
 assert.equal(out.rows[0].bioEmails,'');assert.equal(out.rows[0].linkedEmails,'agent@example.com');assert.deepEqual(out.rows[0].emailSourceUrls,['https://contact.example/']);
});
test('BATCH-002 paused child resumes current author without repeating profile or first search',async t=>{
 const dir=await temp(t),b=browser();let n=0;b.readers.email=async()=>++n===1?{completion:'paused',matches:null,error:'captcha'}:{completion:'completed',matches:true,acceptedEmails:[]};
 const paused=await run({config,runDir:dir,browser:b});assert.equal(paused.status,'paused');assert.deepEqual(b.actions,['search:#one','profile:example']);
 const r=await run({runDir:dir,resume:true,browser:b});assert.equal(r.status,'completed');assert.equal(b.actions.filter(x=>x==='profile:example').length,1);assert.equal(b.actions.filter(x=>x==='search:#one').length,1);
});
test('BATCH-002 invalid input, stale lock, and historical checkpoints never launch browser',async t=>{
 const dir=await temp(t),launch=async()=>assert.fail('must not launch');
 await assert.rejects(run({runDir:dir,config:{...config,keywords:[]},browser:launch}));
 await fs.writeFile(join(dir,'.lock'),'{}');await assert.rejects(run({runDir:dir,config,browser:launch}),/lock/);await fs.unlink(join(dir,'.lock'));
 await fs.writeFile(join(dir,'execution-state.json'),JSON.stringify({status:'running',topic:'#old'}));await assert.rejects(run({runDir:dir,resume:true,browser:launch}),/invalid_batch_state/);
});
test('BATCH-002 checkpoint failure prevents later author work and space finalization',async t=>{
 const dir=await temp(t),b=browser();b.readers.profile=async()=>{await fs.unlink(join(dir,'execution-state.json'));await fs.mkdir(join(dir,'execution-state.json'));return {status:'observed',biography:'',linksComplete:true};};
 const r=await run({config,runDir:dir,browser:b});assert.equal(r.status,'failed');assert.deepEqual(b.actions,['search:#one']);
});
test('BATCH-002 completed exports can be rebuilt without connecting a browser',async t=>{
 const dir=await temp(t);await run({config,runDir:dir,browser:browser()});
 const r=await run({runDir:dir,resume:true,browser:async()=>assert.fail('completed task should not connect')});assert.equal(r.status,'completed');
});
test('BATCH-002 pause during search advance resumes that cursor without duplicating history',async t=>{
 const dir=await temp(t),b=browser(),next=b.nextSearchPage;let n=0;b.nextSearchPage=async args=>{if(++n===1)throw Object.assign(Error('search_temporary_pause'),{pause:true});return next(args);};
 const stopped=await run({config,runDir:dir,browser:b});assert.equal(stopped.status,'paused');assert.equal(stopped.topics[0].history.length,1);
 const r=await run({runDir:dir,resume:true,browser:b});assert.equal(r.status,'completed');assert.equal(r.topics[0].history.length,2);
});
test('BATCH-002 interrupted placeholder checkpoint cannot lose its candidate',async t=>{
 const dir=await temp(t),b=browser();let n=0;b.readers.profile=async({username})=>{if(++n===1)throw Object.assign(Error('user control lost'),{pause:true});return {status:'observed',username,biography:'',links:[],linksComplete:true};};
 const paused=await run({config,runDir:dir,browser:b});assert.equal(paused.status,'paused');
 const path=join(dir,'execution-state.json'),state=JSON.parse(await fs.readFile(path,'utf8'));state.topics[0].activePageState=null;
 await fs.writeFile(path,JSON.stringify(state));const r=await run({runDir:dir,resume:true,browser:b});assert.equal(r.authors['123'].status,'core_pass_pending_content_review');
});
test('BATCH-001 real email recursion collaborates with country without returning to the original page',async t=>{
 const dir=await temp(t),b=browser();let current='https://www.instagram.com/example/';
 b.page={label:'p2',url:async()=>current,goto:async url=>{current=url;},waitForFunction:async()=>{},evaluate:async()=>({url:current,requestedUrl:current,ready:true,complete:true,httpStatus:200,access:'ok',blocks:[{text:'Bookings: agent@example.com',source:'visible_text'}],links:[],actions:[],issues:[]})};
 const {parseProfilePayload,mergeVisibleProfile}=await import('./profile.mjs');
 b.readers.profile=async()=>({...mergeVisibleProfile(parseProfilePayload({username:'example',biography:'',bio_links:[],external_url:'https://contact.example/'},'example'),{username:'example',biography:'',links:[{url:'https://contact.example/'}],hasMultiLinks:false},'example'),status:'observed'});delete b.readers.email;
 let countryAfterExternal=false;b.readers.country=async args=>{countryAfterExternal=current==='https://contact.example/'&&args.navigate;return {status:'observed',countryCode:'US'};};
 const r=await run({config:{...config,keywords:['#one']},runDir:dir,browser:{...b,startKeyword:async()=>({items:[item()],hasMore:false,cursor:null})}});
 assert.equal(r.status,'completed');assert.equal(r.authors['123'].checks.email,true);assert.equal(r.authors['123'].checks.country,true);assert.equal(countryAfterExternal,true);
 const child=JSON.parse(await fs.readFile(join(dir,'authors/123/email/results.json'),'utf8'));assert.equal(child.emails[0].email,'agent@example.com');assert.equal(child.pages.length,2);
});
test('BATCH-002 damaged author records are rejected without rewriting the checkpoint',async t=>{
 const dir=await temp(t);await run({config,runDir:dir,browser:browser()});
 const path=join(dir,'execution-state.json'),state=JSON.parse(await fs.readFile(path,'utf8'));state.authors={'123':null};const raw=JSON.stringify(state);await fs.writeFile(path,raw);
 await assert.rejects(run({runDir:dir,resume:true,browser:()=>assert.fail('must not connect')}),/invalid_batch_state/);assert.equal(await fs.readFile(path,'utf8'),raw);
});
test('BATCH-002 copied historical run directories are not reused as fresh batches',async t=>{
 const dir=await temp(t);await fs.writeFile(join(dir,'topic.json'),'{}');
 await assert.rejects(run({config,runDir:dir,browser:()=>assert.fail('must not launch')}),/run_directory_not_empty/);
 assert.equal(await fs.readFile(join(dir,'topic.json'),'utf8'),'{}');
});

test('online scope: plain keyword, US or GB, no mean, exact unique author limit',async t=>{
 const dir=await temp(t),b=browser();let countries=0;
 b.startKeyword=async()=>({items:[item(),item('456','second'),item('789','third')],hasMore:true,cursor:'more'});
 b.nextSearchPage=async()=>assert.fail('limit must stop before more search');
 b.readers.country=async()=>({status:'observed',countryCode:++countries===1?'GB':'US'});
 b.readers.averageViews=async()=>assert.fail('mean was not requested');
 const r=await run({config:{keywords:['sourcing manager'],conditions:{requireEmail:true,countries:['US','GB']},maxAuthors:2},runDir:dir,browser:b});
 assert.equal(r.status,'completed');assert.equal(r.completionReason,'author_limit_reached');assert.equal(r.searchExhausted,false);
 assert.equal(Object.values(r.authors).filter(a=>a.verification?.status==='completed').length,2);
 assert.equal(r.authors['123'].checks.country,true);assert.equal(r.authors['456'].checks.country,true);assert.equal(r.authors['789'].status,'pending');
});
test('online scope: native end before author limit is keyword exhaustion',async t=>{
 const dir=await temp(t),b=browser();b.startKeyword=async()=>({items:[item()],hasMore:false,cursor:null});
 const r=await run({config:{keywords:['sourcing manager'],conditions:{requireEmail:true,countries:['US','GB']},maxAuthors:500},runDir:dir,browser:b});
 assert.equal(r.status,'completed');assert.equal(r.completionReason,'keywords_exhausted');assert.equal(r.searchExhausted,true);
});

test('采纳-QUALITY-004 export retains reviewed evidence even when another source confirms the same email',async t=>{
 const dir=await temp(t),b=browser();
 b.startKeyword=async()=>({items:[item()],hasMore:false,cursor:null});
 b.readers.email=async()=>({completion:'completed',matches:true,emails:[{key:'agent@example.com',email:'agent@example.com',evidence:[]}],acceptedEmails:[{key:'agent@example.com',email:'agent@example.com',sourceType:'linked_site',evidence:[{sourceUrl:'https://owner.example/contact'}]}],reviewEmails:[{key:'agent@example.com',email:'agent@example.com',reviewReasons:['linked_site_ownership_unverified'],evidence:[{sourceUrl:'https://publisher.example/contact'}]}]});
 await run({config:{...config,keywords:['#one']},runDir:dir,browser:b});
 const exported=JSON.parse(await fs.readFile(join(dir,'results.json'),'utf8')).rows[0];
 assert.equal(exported.email,'agent@example.com');assert.deepEqual(exported.emailReview.map(e=>e.reviewReasons),[['linked_site_ownership_unverified']]);
});

test('采纳-QUALITY-007 old saved email reports export fresh eligibility without changing the checkpoint',async t=>{
 const dir=await temp(t),b=browser();b.startKeyword=async()=>({items:[item()],hasMore:false,cursor:null});
 const email={key:'info@publisher.example',email:'info@publisher.example',status:'confirmed_public',evidence:[{status:'confirmed_public',source:'visible_text',sourceUrl:'https://publisher.example/contact',path:['https://www.instagram.com/example/','https://publisher.example/magazine/story','https://publisher.example/contact']}]};
 b.readers.email=async()=>({rootUrl:'https://www.instagram.com/example/',completion:'completed',emails:[email],pages:[{status:'complete'}],edges:[],acceptedEmails:[{...email,sourceType:'linked_site'}],matches:true});
 await run({config:{...config,keywords:['#one']},runDir:dir,browser:b});
 const path=join(dir,'execution-state.json'),before=await fs.readFile(path,'utf8');await api.exportSavedBatch(dir);
 const row=JSON.parse(await fs.readFile(join(dir,'results.json'),'utf8')).rows[0];
 assert.equal(row.email,'');assert.equal(row.status,'pending_review');assert.equal(row.checks.email,null);assert.equal(row.evidence.verification.matches,null);assert.equal(row.emailReview[0].email,'info@publisher.example');assert.equal(await fs.readFile(path,'utf8'),before);
});
