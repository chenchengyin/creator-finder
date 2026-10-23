import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import {join} from 'node:path';
let api={};try{api=await import('./integration.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const root='https://www.instagram.com/example/';
const profile={username:'example',profileUrl:root,biography:'',links:[],linksComplete:true,status:'observed'};
async function temp(t){const dir=await fs.mkdtemp(join(os.tmpdir(),'email-integration-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
function browser(pages){const reads=[];return {reads,session:{spaceId:999,owned:false},async readPage({url,onCapture}){reads.push(url);assert.ok(pages[url],url);await onCapture({url,ready:true,complete:true,blocks:[{text:pages[url].text||'',source:'visible_text'}],links:(pages[url].links||[]).map(url=>({url,source:'page_link'}))});return {complete:true};}};}
const find=async args=>{assert.equal(typeof api.findProfileEmail,'function','email integration not implemented');return api.findProfileEmail(args);};
test('邮箱-YT-014 native business email is accepted with a distinct profile contact source',()=>{
 const rootUrl='https://www.youtube.com/@example',evidence={sourceUrl:rootUrl,source:'profile_contact_email',status:'confirmed_public',path:[rootUrl],href:'mailto:agent@example.com',context:'agent@example.com'};
 const result=api.summarizeEmail({rootUrl,completion:'completed',pages:[{status:'complete'}],emails:[{email:'agent@example.com',evidence:[evidence]}]});
 assert.equal(result.matches,true);assert.equal(result.acceptedEmails[0].sourceType,'profile_contact');assert.equal(result.reviewEmails.length,0);
});
test('EMAIL-001 Bio snapshot uses shared parser and never reads links',async t=>{
 const b=browser({}),r=await find({profile:{...profile,biography:'💌 hello＠example.com',links:[{url:'https://contact.example/'}]},runDir:await temp(t),browser:b});
 assert.equal(r.matches,true);assert.equal(r.acceptedEmails[0].email,'hello@example.com');assert.deepEqual(b.reads,[]);assert.equal(r.emails[0].evidence[0].raw,'hello＠example.com');
});
test('EMAIL-002 linked website email qualifies and keeps its discovery path',async t=>{
 const b=browser({'https://contact.example/':{text:'Booking: agent@example.com'}});
 const r=await find({profile:{...profile,links:[{url:'https://contact.example/'}]},runDir:await temp(t),browser:b});
 assert.equal(r.matches,true);assert.equal(r.acceptedEmails[0].sourceType,'linked_site');assert.deepEqual(r.emails[0].evidence[0].path,[root,'https://contact.example/']);
});
test('EMAIL-003 skipped links and ambiguous addresses are unknown instead of no email',async t=>{
 const skipped=await find({profile:{...profile,links:[{url:'https://linktr.ee/example'}]},runDir:await temp(t),browser:browser({})});assert.equal(skipped.matches,null);assert.equal(skipped.completion,'completed');
 const ambiguous=await find({profile:{...profile,biography:'a..b@example.com'},runDir:await temp(t),browser:browser({})});assert.equal(ambiguous.matches,null);
 const empty=await find({profile,runDir:await temp(t),browser:browser({})});assert.equal(empty.matches,false);
});
test('EMAIL-003 a second social profile keeps email evidence but needs ownership review',async t=>{
 const b=browser({'https://www.youtube.com/@other':{text:'other@example.com'}});
 const r=await find({profile:{...profile,links:[{url:'https://www.youtube.com/@other'}]},runDir:await temp(t),browser:b});
 assert.equal(r.emails.length,1);assert.equal(r.acceptedEmails.length,0);assert.equal(r.matches,null);
});
test('EMAIL-004 completed child can be recovered before parent bookkeeping without rereading',async t=>{
 const dir=await temp(t),b=browser({'https://contact.example/':{text:'agent@example.com'}});
 await find({profile:{...profile,links:[{url:'https://contact.example/'}]},runDir:dir,browser:b});
 const r=await find({profile,runDir:dir,browser:browser({})});assert.equal(r.matches,true);assert.deepEqual(b.reads,['https://contact.example/']);
});
test('EMAIL-001 incomplete profile falls back to borrowed browser instead of declaring empty',async t=>{
 const b=browser({[root]:{text:'actual@example.com'}}),r=await find({profile:{...profile,biography:null,linksComplete:false},runDir:await temp(t),browser:b});
 assert.equal(r.matches,true);assert.deepEqual(b.reads,[root]);
});
test('EMAIL-004 child directory for a different creator cannot be reused',async t=>{
 const dir=await temp(t);await find({profile,runDir:dir,browser:browser({})});
 await assert.rejects(find({profile:{...profile,username:'other',profileUrl:'https://www.instagram.com/other/'},runDir:dir,browser:browser({})}),/resume URL mismatch/);
});
