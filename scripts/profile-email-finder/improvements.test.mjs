import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import {join} from 'node:path';
import {classifyUrl,extractCandidates,runFinder} from './finder.mjs';
import {summarizeEmail} from './integration.mjs';
import {runInEgo} from './browser.mjs';
const root='https://www.instagram.com/owner/';
async function temp(t){const dir=await fs.mkdtemp(join(os.tmpdir(),'email-improvements-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
const capture=(url,text='',links=[])=>({url,ready:true,complete:true,blocks:[{text,source:'profile_bio'}],links:links.map(url=>({url,source:'profile_link'}))});

test('别名-ALIAS-001 supported profile hosts share identity while business queries remain distinct',()=>{
 for(const [urls,key] of [
  [['https://instagram.com/Owner/','http://www.instagram.com/owner'],'https://www.instagram.com/owner'],
  [['https://tiktok.com/@Owner','http://www.tiktok.com/@owner/','https://m.tiktok.com/@owner'],'https://www.tiktok.com/@owner'],
  [['https://youtube.com/@Owner','http://m.youtube.com/@Owner/'],'https://www.youtube.com/@Owner'],
 ])for(const url of urls)assert.equal(classifyUrl(url).key,key);
 assert.notEqual(classifyUrl('https://www.tiktok.com/@owner?a=1').key,classifyUrl('https://www.tiktok.com/@owner?a=2').key);
 assert.notEqual(classifyUrl('https://www.youtube.com/channel/UCabc').key,classifyUrl('https://www.youtube.com/channel/UCAbc').key);
 assert.notEqual(classifyUrl('https://www.example.org/').key,classifyUrl('https://example.org/').key);
});

test('别名-ALIAS-002 TikTok aliases are read once and source URLs stay unchanged',async t=>{
 const urls=['https://tiktok.com/@Other','http://www.tiktok.com/@other/','https://m.tiktok.com/@other'],reads=[];
 const r=await runFinder({config:{url:root},runDir:await temp(t),browser:{session:{owned:false},async readPage({url,onCapture}){reads.push(url);await onCapture(capture(url,url===root?'':'other@example.org',url===root?urls:[]));return {complete:true};}}});
 assert.deepEqual(reads,[root,urls[0]]);assert.equal(r.emails[0].evidence[0].sourceUrl,urls[0]);assert.equal(r.pages.length,2);
});

test('别名-ALIAS-003 legacy completed profile aliases resume without another visit',async t=>{
 const dir=await temp(t),old='https://instagram.com/owner',canonical='https://www.instagram.com/owner';
 const page=(url,key,status)=>({url,key,status,depth:0,path:[url],attempted:status==='complete',captures:[],issues:[],checkpoint:{},...(status==='complete'?{finalKey:key,finalUrl:url}:{})});
 await fs.writeFile(join(dir,'execution-state.json'),JSON.stringify({schemaVersion:1,config:{url:old,maxDepth:null,maxPages:null},completion:'partial',pages:{[old]:page(old,old,'complete'),[canonical]:page(canonical,canonical,'pending')},queue:[canonical],emails:[],edges:[],browser:{closed:true}}));
 const r=await runFinder({runDir:dir,resume:true,browser:{readPage:async()=>assert.fail('completed alias must not be visited')}});
 assert.equal(r.completion,'completed');assert.equal(r.pages.find(p=>p.key===canonical).status,'alias');assert.equal(r.pages.find(p=>p.key===old).url,old);
});

test('恢复-RESUME-001 standalone email explicit resume takes over a delegated space',async t=>{
 const dir=await temp(t);await runFinder({config:{url:root},runDir:dir,browser:{session:{spaceId:888,owned:true,pageLabel:'p1'},async readPage(){throw Object.assign(Error('pause'),{pause:true});}}});
 let tookOver=false,finished=false;
 const page={label:'p1',url:async()=>root,waitForFunction:async()=>{},evaluate:async()=>({...capture(root,'hello@example.org'),kind:'profile',platform:'instagram',httpStatus:200,access:'ok',issues:[],actions:[]})};
 const r=await runInEgo({runDir:dir,resume:true},{listTaskSpaces:async()=>[{id:888,ownership:'agentDelegatedToUser'}],taskSpace:async()=>assert.fail('plain reference does not take over'),claimTaskSpace:async()=>assert.fail('delegated space needs takeover'),takeOverTaskSpace:async id=>{assert.equal(id,888);tookOver=true;return {spaceId:888,page:()=>page,finish:async()=>{finished=true;}};}});
 assert.equal(r.completion,'completed');assert.equal(r.emails[0].email,'hello@example.org');assert.equal(tookOver,true);assert.equal(finished,true);
});

test('恢复-RESUME-002 delegated space is not taken over for a fresh run',async t=>{
 const r=await runInEgo({runDir:await temp(t),config:{url:root},spaceId:888},{listTaskSpaces:async()=>[{id:888,ownership:'agentDelegatedToUser'}],taskSpace:async()=>assert.fail('must stop before accessing delegated space'),takeOverTaskSpace:async()=>assert.fail('no resume authorization')});
 assert.equal(r.completion,'paused');assert.equal(r.error,'space_requires_user_authorization');
});

const evidence=(sourceUrl,path,extra={})=>({status:'confirmed_public',source:'visible_text',sourceUrl,path,...extra});
const report=(ev,edges=[])=>({rootUrl:root,completion:'completed',pages:[{status:'complete'}],edges,emails:[{email:'info@example.org',key:'info@example.org',evidence:ev}]});
test('采纳-QUALITY-001 publisher contact email remains public evidence but requires ownership review',()=>{
 const r=summarizeEmail(report([evidence('https://publisher.example/contact-us/',[root,'https://publisher.example/magazine/author-story','https://publisher.example/contact-us/'])]));
 assert.equal(r.acceptedEmails.length,0);assert.equal(r.emails[0].evidence[0].status,'confirmed_public');assert.equal(r.matches,null);assert.ok(r.reviewEmails[0].evidence.some(e=>e.reviewReason==='linked_site_ownership_unverified'));
 const article=summarizeEmail(report([evidence('https://publisher.example/contact-us/',[root,'https://publisher.example/magazine/email-sourcing/','https://publisher.example/contact-us/'])]));assert.equal(article.matches,null);
});
test('采纳-QUALITY-002 author website contact, direct agency address and reciprocal identity stay eligible',()=>{
 for(const ev of [
  evidence('https://owner.example/contact',[root,'https://owner.example/','https://owner.example/contact']),
  evidence('https://agency.example/contact',[root,'https://agency.example/contact']),
  evidence('https://publisher.example/magazine/author-story',[root,'https://publisher.example/magazine/author-story']),
 ])assert.equal(summarizeEmail(report([ev])).matches,true);
 const r=summarizeEmail(report([evidence('https://owner.example/contact',[root,'https://owner.example/pages/bio','https://owner.example/contact'])],[{from:'https://owner.example/pages/bio',to:root}]));
 assert.equal(r.matches,true);
});
test('采纳-QUALITY-003 conflicting mailto and visible address is not silently adopted or replaced',()=>{
 const r=extractCandidates({url:'https://owner.example/contact',links:[{url:'mailto:press@yourstore.com',text:'Email Us',context:'Email Us\nsales@cherrycups.co',source:'page_link'}]});
 assert.equal(r.emails[0].email,'press@yourstore.com');assert.equal(r.emails[0].status,'needs_review');assert.equal(r.emails[0].evidence[0].reason,'mailto_visible_recipient_conflict');
 const saved=summarizeEmail({rootUrl:root,completion:'completed',pages:[{status:'complete'}],emails:[{email:'press@yourstore.com',key:'press@yourstore.com',evidence:[evidence('https://owner.example/contact',[root,'https://owner.example/contact'],{source:'page_link',href:'mailto:press@yourstore.com',context:'Email Us\nsales@cherrycups.co'})]}]});
 assert.equal(saved.matches,null);assert.equal(saved.reviewEmails[0].evidence[0].reviewReason,'mailto_visible_recipient_conflict');
 const valid=extractCandidates({url:'https://agency.example/contact',links:[{url:'mailto:agent@agency.example',text:'agent@agency.example',context:'Bookings agent@agency.example',source:'page_link'}]});assert.equal(valid.emails[0].status,'confirmed_public');
});

test('采纳-QUALITY-005 anchor address overrides wider context without invalidating independent visible text',()=>{
 const found=extractCandidates({url:'https://owner.example/contact',blocks:[{text:'sales@cherrycups.co',source:'visible_text'}],links:[{url:'mailto:press@yourstore.com',text:'sales@cherrycups.co',context:'sales@cherrycups.co / press@yourstore.com',source:'page_link'}]});
 assert.equal(found.emails.find(e=>e.email==='press@yourstore.com').status,'needs_review');
 const r=summarizeEmail({rootUrl:root,completion:'completed',pages:[{status:'complete'}],emails:found.emails.map(e=>({...e,evidence:e.evidence.map(v=>({...v,path:[root,'https://owner.example/contact']}))}))});
 assert.deepEqual(r.acceptedEmails.map(e=>e.email),['sales@cherrycups.co']);assert.equal(r.reviewEmails[0].email,'press@yourstore.com');assert.equal(r.matches,true);
});

test('采纳-QUALITY-006 footer semantics survive capture even when CSS path starts at an id',async t=>{
 const article='https://publisher.example/magazine/owner',dir=await temp(t);
 const r=await runFinder({config:{url:root},runDir:dir,browser:{session:{owned:false},async readPage({url,onCapture}){
  await onCapture(url===root?capture(root,'',[article]):{url:article,ready:true,complete:true,blocks:[{text:'newsroom@publisher.example',source:'visible_text',location:'#site-footer > p',siteWide:true}],links:[]});return {complete:true};
 }}});
 const checked=summarizeEmail(r);assert.equal(checked.acceptedEmails.length,0);assert.equal(checked.reviewEmails[0].evidence[0].siteWide,true);assert.equal(checked.matches,null);
});

test('采纳-QUALITY-008 site-wide mailto keeps its role alongside the same visible address',async t=>{
 const article='https://publisher.example/magazine/owner';
 const r=await runFinder({config:{url:root},runDir:await temp(t),browser:{session:{owned:false},async readPage({url,onCapture}){
  await onCapture(url===root?capture(root,'',[article]):{url:article,ready:true,complete:true,blocks:[{text:'newsroom@publisher.example',source:'visible_text',location:'#site-nav',siteWide:true}],links:[{url:'mailto:newsroom@publisher.example',text:'newsroom@publisher.example',source:'page_link',location:'#site-nav > a',siteWide:true}]});return {complete:true};
 }}});
 const checked=summarizeEmail(r);assert.equal(checked.acceptedEmails.length,0);assert.equal(checked.reviewEmails[0].evidence.length,2);assert.equal(checked.matches,null);
});
