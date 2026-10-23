import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import {join} from 'node:path';
import {runYoutubeEmailFlow} from './youtube-email.mjs';
import {runFinder} from './finder.mjs';
import {summarizeEmail} from './integration.mjs';
const url='https://www.youtube.com/@sample';
async function temp(t){const dir=await fs.mkdtemp(join(os.tmpdir(),'email-sync-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
function flowFixture(initial='verified'){
 let state=initial;const actions=[],saved=[];
 const capture=()=>({url,kind:'profile',platform:'youtube',ready:true,complete:state==='email',httpStatus:200,access:state==='email'?'ok':'captcha',blocks:[],links:state==='email'?[{url:'mailto:creator@example.com',text:'creator@example.com',source:'profile_contact_email',visible:true}]:[],issues:[]});
 const page={url:async()=>url,waitForTimeout:async()=>{},
  evaluate:async(fn,args)=>fn.name==='inspectYoutubeEmailUi'?{about:true,emailExpected:true,emailVisible:state==='email',nativeVerification:state!=='email',imageChallenge:false,loginRequired:false,submitSelector:'#submit'}:{x:10,y:20},
  snapshot:async()=>`root\n iframe [ref=90]\n  checkbox "${state==='verified'?'您已通过验证':'进行人机身份验证'}" ${state==='verified'?'[checked] ':''}[ref=94]`,
  click:async()=>{actions.push('checkbox');state='verified';},
  mouse:{click:async()=>{actions.push('submit');state='email';}},
  waitForSelector:async(selector)=>{if(selector.includes('mailto')&&state!=='email')throw Error('not displayed');if(selector.includes('aria-checked')&&state!=='verified')throw Error('not verified');}
 };
 return {page,actions,saved,capture,run:checkpoint=>runYoutubeEmailFlow({page,initial:capture(),read:async()=>capture(),checkpoint,onCapture:async(c,cp)=>saved.push(structuredClone(cp))})};
}
test('邮箱-SYNC-001 invalid saved verification state cannot reset interaction budgets',async()=>{
 for(const bad of [null,'submitted',[],{phase:'unknown'},{checkboxAttempted:'false'},{submitAttempts:-1},{submitAttempts:3},{history:{}}]){
  const f=flowFixture();await assert.rejects(f.run({youtubeEmail:bad}),e=>e.pause&&e.reason==='youtube_email_checkpoint_invalid');assert.deepEqual(f.actions,[]);assert.deepEqual(f.saved,[]);
 }
});
test('邮箱-SYNC-002 submitted resume waits for the result without a second submission',async()=>{
 const f=flowFixture();await assert.rejects(f.run({youtubeEmail:{phase:'submit_requested',submitAttempts:1,checkboxAttempted:true}}),e=>e.pause&&e.reason==='youtube_email_result_pending');assert.deepEqual(f.actions,[]);
 const revealed=flowFixture('email');assert.equal((await revealed.run({youtubeEmail:{phase:'submit_pending',submitAttempts:1,checkboxAttempted:true}})).complete,true);assert.deepEqual(revealed.actions,[]);
});
test('邮箱-SYNC-003 click timeouts observe successful checkbox and submit outcomes without duplicate clicks',async()=>{
 const f=flowFixture('checkbox'),checkbox=f.page.click,submit=f.page.mouse.click;
 f.page.click=async()=>{await checkbox();throw Error('element disappeared after click');};
 f.page.mouse.click=async()=>{await submit();throw Error('click timed out');};
 assert.equal((await f.run({})).complete,true);assert.deepEqual(f.actions,['checkbox','submit']);
});
test('邮箱-SYNC-004 snapshot control failures keep their protection meaning',async()=>{
 for(const message of ['Control of this task space was delegated','CDP session closed']){
  const f=flowFixture();f.page.snapshot=async()=>{throw Error(message);};await assert.rejects(f.run({}),e=>e.pause&&/user_control_lost|browser_unavailable/.test(e.reason));assert.deepEqual(f.actions,[]);
 }
});
test('邮箱-SYNC-005 ambiguous visible verification boxes are never selected by first match',async()=>{
 const f=flowFixture('checkbox');f.page.snapshot=async()=> 'iframe [ref=90]\n checkbox "进行人机身份验证" [ref=94]\niframe [ref=91]\n checkbox "进行人机身份验证" [ref=95]';
 await assert.rejects(f.run({}),e=>e.pause);assert.deepEqual(f.actions,[]);
});
function linkedBrowser(reads){return {session:{owned:false},async readPage({url:target,onCapture}){
 reads.push(target);
 await onCapture(target===url?{url,kind:'profile',platform:'youtube',ready:true,complete:true,blocks:[{text:'Helpful links: https://sandcastles.example/',source:'profile_bio'}],links:[{url:'mailto:creator@example.com',text:'creator@example.com',source:'profile_contact_email'}]}:
 target==='https://sandcastles.example/'?{url:target,ready:true,complete:true,blocks:[],links:[{url:'/contact',text:'Contact',source:'page_link'}]}:
 {url:target,ready:true,complete:true,blocks:[{text:'support@sandcastles.example',source:'visible_text'}],links:[]});
 return {complete:true};
}};}
test('邮箱-SYNC-006 native business email retains biography URLs and continues linked contact pages',async t=>{
 const reads=[],r=await runFinder({config:{url},runDir:await temp(t),browser:linkedBrowser(reads)});
 assert.equal(r.completion,'completed');assert.deepEqual(reads,[url,'https://sandcastles.example/','https://sandcastles.example/contact']);assert.deepEqual(r.emails.map(e=>e.email),['creator@example.com','support@sandcastles.example']);
});
test('邮箱-SYNC-007 old native-email stopping checkpoints restore saved links without reading the channel again',async t=>{
 const dir=await temp(t),reads=[];await runFinder({config:{url,maxPages:1},runDir:dir,browser:linkedBrowser(reads)});
 const state=JSON.parse(await fs.readFile(join(dir,'execution-state.json'),'utf8'));
 const root=state.pages[url];root.status='complete';root.stopReason='profile_contact_email_found';root.bioEmailFound=false;root.pendingProfileLinks=[];
 state.pages={[url]:root};state.queue=[];state.edges=[];state.config.maxPages=null;state.completion='completed';
 await fs.writeFile(join(dir,'execution-state.json'),JSON.stringify(state));
 const visited=[],b=linkedBrowser(visited),read=b.readPage;b.readPage=async args=>{assert.notEqual(args.url,url);return read(args);};
 const r=await runFinder({runDir:dir,resume:true,browser:b});assert.equal(r.completion,'completed');assert.deepEqual(visited,['https://sandcastles.example/','https://sandcastles.example/contact']);assert.ok(r.emails.some(e=>e.email==='support@sandcastles.example'));
});
test('邮箱-SYNC-008 external support addresses remain raw findings and need review, normal contacts stay eligible',()=>{
 const e=(email,sourceUrl,source)=>({email,key:email,status:'confirmed_public',evidence:[{status:'confirmed_public',sourceUrl,source,path:sourceUrl===url?[url]:[url,'https://sandcastles.example/',sourceUrl]}]});
 const r=summarizeEmail({rootUrl:url,completion:'completed',pages:[{status:'complete'}],emails:[e('creator@example.com',url,'profile_contact_email'),e('support@sandcastles.example','https://sandcastles.example/contact','visible_text'),e('agent@sandcastles.example','https://sandcastles.example/contact','visible_text')]});
 assert.deepEqual(r.acceptedEmails.map(e=>e.email),['creator@example.com','agent@sandcastles.example']);assert.equal(r.reviewEmails[0].email,'support@sandcastles.example');assert.ok(r.reviewEmails[0].reviewReasons.includes('support_mailbox_requires_review'));assert.equal(r.emails[1].status,'confirmed_public');
});
test('邮箱-SYNC-009 closed owned runs initialize their browser after restoring old native-email links',async t=>{
 const dir=await temp(t);await runFinder({config:{url,maxPages:1},runDir:dir,browser:linkedBrowser([])});
 const state=JSON.parse(await fs.readFile(join(dir,'execution-state.json'),'utf8')),root=state.pages[url];
 root.status='complete';root.stopReason='profile_contact_email_found';root.bioEmailFound=false;root.pendingProfileLinks=[];
 state.pages={[url]:root};state.queue=[];state.edges=[];state.config.maxPages=null;state.completion='completed';state.browser={owned:true,closed:true,spaceId:999};
 await fs.writeFile(join(dir,'execution-state.json'),JSON.stringify(state));let opened=0;const visited=[];
 const r=await runFinder({runDir:dir,resume:true,browser:async()=>{opened++;return linkedBrowser(visited);}});
 assert.equal(opened,1);assert.equal(r.completion,'completed');assert.deepEqual(visited,['https://sandcastles.example/','https://sandcastles.example/contact']);
});
test('邮箱-SYNC-010 raw control failure while waiting for a submitted email forbids further reads or submissions',async()=>{
 const f=flowFixture(),wait=f.page.waitForSelector;let lost=false,extraReads=0;const evaluate=f.page.evaluate;
 f.page.waitForSelector=async(selector)=>{if(selector.includes('mailto')){lost=true;throw Error('Control of this task space was delegated');}return wait(selector);};
 f.page.evaluate=async(...args)=>{if(lost)extraReads++;return evaluate(...args);};
 await assert.rejects(f.run({}),e=>e.pause&&e.reason==='user_control_lost');assert.deepEqual(f.actions,['submit']);assert.equal(extraReads,0);
});
test('邮箱-SYNC-011 interrupted submitted-result resume preserves the pending submission for another resume',async()=>{
 const first=flowFixture();first.page.waitForSelector=async()=>{throw Error('Control of this task space was delegated');};
 await assert.rejects(first.run({youtubeEmail:{phase:'submit_requested',submitAttempts:1,checkboxAttempted:true}}),e=>e.pause&&e.reason==='user_control_lost');
 const second=flowFixture();await assert.rejects(second.run(first.saved.at(-1)),e=>e.pause&&e.reason==='youtube_email_result_pending');assert.deepEqual(second.actions,[]);
});
