import test from 'node:test';
import assert from 'node:assert/strict';
import {collectCreator} from './creator.mjs';
import {processSearchPage} from './workflow.mjs';
let api={};try{api=await import('./verification.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const window={windowStart:'2026-10-12T00:00:00+08:00',windowEndExclusive:'2026-10-22T00:00:00+08:00'};
function fixture(){const calls=[];return {calls,page:{url:async()=> 'https://external.example/'},username:'example',authorId:'123',runDir:'/tmp/not-written-verification',conditions:{requireEmail:true,country:'US',minAverageViewsExclusive:50000},window,readers:{
 profile:async()=>{calls.push('profile');return {username:'example',authorId:'123',status:'observed',biography:'',links:[{url:'https://contact.example/'}],linksComplete:true};},
 email:async()=>{calls.push('email');return {completion:'completed',matches:false,acceptedEmails:[],emails:[],pages:[]};},
 country:async args=>{calls.push('country:'+args.navigate);return {status:'observed',countryCode:'MX'};},
 averageViews:async()=>{calls.push('mean');return {capture:{},metrics:{coverageComplete:true,passesThreshold:true,averageViews:60000}};}
 }};}
const verify=async args=>{assert.equal(typeof api.verifyCreator,'function','verification not implemented');return api.verifyCreator(args);};
test('VERIFY-001 country mismatch and missing email do not prevent the other requested stages',async()=>{
 const f=fixture(),r=await verify(f);assert.deepEqual(f.calls,['profile','email','country:true','mean']);assert.equal(r.checks.email,false);assert.equal(r.checks.country,false);assert.equal(r.checks.averageViews,true);assert.equal(r.matches,false);
});
test('VERIFY-002 paused country resumes without redoing committed email or profile',async()=>{
 const f=fixture();let n=0;f.readers.country=async()=>++n===1?{status:'paused',reason:'instagram_access_stopped_429'}:{status:'observed',countryCode:'US'};
 const stopped=await verify(f);assert.equal(stopped.status,'paused');assert.equal(stopped.data.email.matches,false);
 const r=await verify({...f,state:stopped});assert.equal(r.status,'completed');assert.deepEqual(f.calls,['profile','email','mean']);assert.equal(n,2);
});
test('VERIFY-002 email pause stops before country and resumes only that stage',async()=>{
 const f=fixture();let n=0;f.readers.email=async()=>++n===1?{completion:'paused',error:'captcha',matches:null}:{completion:'completed',matches:true,acceptedEmails:[{email:'agent@example.com'}]};
 const stopped=await verify(f);assert.equal(stopped.status,'paused');assert.deepEqual(f.calls,['profile']);
 const r=await verify({...f,state:stopped});assert.equal(r.checks.email,true);assert.deepEqual(f.calls,['profile','country:true','mean']);
});
test('VERIFY-003 identity mismatch and changed resume criteria fail before later browsing',async()=>{
 const f=fixture();f.readers.profile=async()=>({status:'observed',authorId:'999'});const r=await verify(f);assert.equal(r.reason,'profile_author_id_mismatch');assert.deepEqual(f.calls,[]);
 const good=fixture(),saved=await verify(good);good.calls.length=0;await assert.rejects(verify({...good,state:saved,conditions:{requireEmail:true,country:'CA'}}),/resume_input_mismatch/);assert.deepEqual(good.calls,[]);
});
test('email result for a different profile cannot be attached to the current creator',async()=>{
 const f=fixture();f.readers.email=async()=>({rootUrl:'https://www.instagram.com/other/',completion:'completed',matches:true,acceptedEmails:[{email:'other@example.com'}]});
 const r=await verify(f);assert.equal(r.status,'pending_review');assert.equal(r.reason,'email_root_url_mismatch');assert.equal(r.checks.email,undefined);assert.deepEqual(f.calls,['profile']);
});
test('VERIFY-003 failed checkpoint propagates and prevents all later browser actions',async()=>{
 const f=fixture();await assert.rejects(verify({...f,onCheckpoint:async()=>{throw Error('disk_full');}}),/disk_full/);assert.deepEqual(f.calls,[]);
});
test('VERIFY-001 collectCreator delegates requireEmail to the same independent checks',async()=>{
 const f=fixture(),r=await collectCreator(f);assert.equal(r.checks.email,false);assert.equal(r.checks.country,false);assert.ok(f.calls.includes('mean'));
});
test('VERIFY-002 search page stops on child pause and keeps the next author untouched',async()=>{
 const f=fixture();f.readers.email=async()=>({completion:'paused',error:'captcha',matches:null});
 const items=['123','456'].map((authorId,i)=>({id:String(i),code:'code'+i,authorId,username:i?'second':'example',mediaType:2}));
 const r=await processSearchPage({...f,items});assert.equal(r.status,'paused');assert.equal(r.nextItemIndex,0);assert.equal(Object.keys(r.authors).length,1);assert.equal(r.authors['123'].verification.data.email.completion,'paused');
});
test('VERIFY-002 a failed email child is retried after its underlying error is resolved',async()=>{
 const f=fixture();let n=0;f.readers.email=async()=>++n===1?{completion:'failed',error:'disk_full',matches:null}:{completion:'completed',matches:true};
 let state;await assert.rejects(verify({...f,onCheckpoint:async cp=>{state=cp;}}),/email_failed/);
 const r=await verify({...f,state});assert.equal(r.checks.email,true);assert.equal(n,2);
});
test('VERIFY-003 real profile reader cannot swallow a session log failure and continue',async()=>{
 const {createSession}=await import('./session.mjs'),f=fixture();delete f.readers.profile;
 const session=createSession({log:async()=>{throw Error('disk_full');}});
 f.page=session.wrap({url:async()=> 'about:blank',evaluate:async()=>false,cdp:async()=>{},events:async()=>[],goto:async()=>assert.fail('logging fails before goto')});
 await assert.rejects(verify(f),/disk_full/);assert.deepEqual(f.calls,[]);
});

test('online scope: either accepted country qualifies while other countries fail',async()=>{
 for(const [countryCode,expected] of [['US',true],['GB',true],['CA',false]]){
  const f=fixture();f.conditions={requireEmail:true,countries:['US','GB']};f.readers.country=async()=>({status:'observed',countryCode});
  f.readers.averageViews=async()=>assert.fail('must not collect metrics');const r=await verify(f);assert.equal(r.checks.country,expected);
 }
});

test('邮箱-EMPTY-001 complete profile without email or links skips remaining checks',async()=>{
 const f=fixture();f.readers.profile=async()=>{f.calls.push('profile');return {username:'example',authorId:'123',status:'observed',biography:'Perfume reviews',links:[],linksComplete:true};};
 const r=await verify(f);
 assert.equal(r.status,'completed');assert.equal(r.matches,false);assert.equal(r.checks.email,false);
 assert.deepEqual(f.calls,['profile','email']);assert.equal(r.data.country,undefined);assert.equal(r.checks.country,undefined);assert.equal(r.data.averageViews,undefined);
 assert.equal(r.reason,'no_email_or_profile_links');
});

test('邮箱-EMPTY-002 incomplete profiles and uncertain email results retain later checks',async()=>{
 for(const change of [{status:'partial'},{biography:null},{linksComplete:false},{links:undefined},{links:[{url:'https://contact.example/'}]},{emailMatches:null}]){
  const f=fixture();f.readers.profile=async()=>{f.calls.push('profile');return {username:'example',authorId:'123',status:'observed',biography:'Perfume reviews',links:[],linksComplete:true,...change};};
  if(Object.hasOwn(change,'emailMatches'))f.readers.email=async()=>{f.calls.push('email');return {completion:'completed',matches:change.emailMatches,acceptedEmails:[],emails:[],pages:[]};};
  const r=await verify(f);assert.deepEqual(f.calls,['profile','email','country:true','mean']);assert.equal(r.checks.country,false);
 }
});

test('邮箱-EMPTY-003 old country pause with complete empty profile resumes without country interaction',async()=>{
 const f=fixture();f.readers.country=async()=>({status:'paused',reason:'instagram_access_stopped_429'});
 const stopped=await verify(f);assert.equal(stopped.status,'paused');stopped.data.profile.links=[];
 f.calls.length=0;f.readers.country=async()=>assert.fail('empty profile must not reopen country');
 const r=await verify({...f,state:stopped});assert.equal(r.status,'completed');assert.equal(r.matches,false);assert.deepEqual(f.calls,[]);assert.equal(r.stage,undefined);
});

test('邮箱-EMPTY-004 search skips country for empty profile and continues to next creator',async()=>{
 const f=fixture();f.conditions={requireEmail:true,country:'US'};
 f.readers.profile=async({username})=>{f.calls.push('profile:'+username);return {username,status:'observed',biography:username==='second'?'Bookings: creator@example.com':'Perfume reviews',links:[],linksComplete:true};};
 f.readers.email=async({profile})=>{f.calls.push('email:'+profile.username);return {completion:'completed',matches:profile.username==='second',acceptedEmails:[],emails:[],pages:[]};};
 f.readers.country=async({username})=>{f.calls.push('country:'+username);return {status:'observed',countryCode:'US'};};
 const items=['123','456'].map((authorId,i)=>({id:String(i),code:'code'+i,authorId,username:i?'second':'example',mediaType:2}));
 const r=await processSearchPage({...f,items});assert.equal(r.status,'completed');assert.equal(r.nextItemIndex,2);
 assert.equal(r.authors['123'].status,'rejected');assert.equal(r.authors['456'].status,'core_pass_pending_content_review');
 assert.deepEqual(f.calls,['profile:example','email:example','profile:second','email:second','country:second']);
});
