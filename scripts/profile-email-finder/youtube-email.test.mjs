import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import {join} from 'node:path';
import {runFinder} from './finder.mjs';
import {createEgoBrowser} from './browser.mjs';
import {inspectYoutubeEmailUi} from './youtube-email.mjs';
import vm from 'node:vm';
const url='https://www.youtube.com/@choruslove';
async function temp(t){const dir=await fs.mkdtemp(join(os.tmpdir(),'youtube-email-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
function fixture(initial='home',imageChallenge=false,submitDelay=0,verificationDelay=false){
 let state=initial;const actions=[];
 const ui=()=>({about:state!=='home',emailVisible:state==='email',emailExpected:['unrecognized','delayed','verification-loading'].includes(state),loginRequired:state==='login',nativeVerification:['checkbox','verified','image'].includes(state),imageChallenge:state==='image',moreSelector:state==='home'?'#more':null,contactSelector:state==='about'?'#view-email':null,submitSelector:['checkbox','verified','image','verification-loading'].includes(state)?'#submit':null});
 const capture=()=>({url,kind:'profile',platform:'youtube',ready:!['checkbox','image','login'].includes(state)&&!state.startsWith('http'),complete:state==='email'||state==='about-no-email',httpStatus:state.startsWith('http')?Number(state.slice(4)):200,access:state==='login'?'login_wall':['checkbox','image','verified'].includes(state)?'captcha':'ok',issues:[],actions:state==='home'?[{selector:'#more',type:'profile_expand'}]:state==='about'?[{selector:'#view-email',type:'contact_expand'}]:[],blocks:[{text:'Channel description',source:'profile_bio'}],links:state==='email'?[{url:'mailto:kikochan@pomato.hk',text:'kikochan@pomato.hk',source:'profile_contact_email',visible:true}]:[]});
 const page={label:'p1',url:async()=>url,goto:async()=>assert.fail('already open; must not navigate'),waitForFunction:async()=>{},waitForTimeout:async()=>{if(state==='delayed')state='about';if(state==='verification-loading')state='checkbox';},
  async evaluate(fn,args){if(fn.name==='readRenderedPage')return capture();if(fn.name==='inspectYoutubeEmailUi')return ui();if(fn.name==='youtubeClickPoint'){actions.push('point:'+args.selector);return {x:20,y:30};}throw Error('unexpected evaluate '+fn.name);},
  async snapshot(){return state==='image'?'iframe "reCAPTCHA challenge"\n text "Select all images with buses"':state==='verified'?'iframe [ref=90]\n checkbox "您已通过验证" [checked] [ref=22]':'iframe [ref=90]\n checkbox "进行人机身份验证" [ref=21]';},
  async click(selector){assert.equal(selector,'@21');actions.push('checkbox');state=imageChallenge?'image':'verified';},
  async waitForSelector(selector){if(selector.includes('aria-checked')){actions.push('verify-state');if(state!=='verified')throw Error('verification timed out');}else if(selector.includes('mailto')&&state!=='email')throw Error('email not yet visible');},
  mouse:{async click(){const target=actions.filter(x=>x.startsWith('point:')).at(-1);actions.push(target.replace('point:','click:'));if(target==='point:#more')state='about';else if(target==='point:#view-email')state=verificationDelay?'verification-loading':'checkbox';else if(target==='point:#submit'){assert.equal(state,'verified');if(submitDelay-->0)return;state='email';}else assert.fail(target);}},
 };
 return {page,actions,setState(v){state=v;}};
}
test('邮箱-YT-001 normal channel business email retains native source after checkbox and submit',async t=>{
 const f=fixture(),r=await runFinder({config:{url},runDir:await temp(t),browser:createEgoBrowser({page:f.page,sleep:async()=>{}})});
 assert.equal(r.completion,'completed');assert.equal(r.emails[0].email,'kikochan@pomato.hk');assert.equal(r.emails[0].evidence[0].source,'profile_contact_email');assert.equal(r.pages.length,1);assert.equal(r.pages[0].bioEmailFound,undefined);
 assert.deepEqual(f.actions.filter(x=>!x.startsWith('point:')),['click:#more','click:#view-email','checkbox','verify-state','verify-state','click:#submit']);
 assert.ok(r.pages[0].checkpoint.youtubeEmail.history.some(x=>x.phase==='verified'));
});

test('邮箱-YT-009 email hint with an unknown control pauses instead of reporting complete',async t=>{
 const f=fixture('unrecognized'),r=await runFinder({config:{url},runDir:await temp(t),browser:createEgoBrowser({page:f.page})});assert.equal(r.completion,'paused');assert.ok(r.pages[0].issues.includes('youtube_email_control_unrecognized'));assert.deepEqual(f.actions,[]);
});
test('邮箱-YT-010 a delayed first submit rechecks verification and is bounded to two attempts',async t=>{
 for(const delay of [1,2]){const f=fixture('verified',false,delay),r=await runFinder({config:{url},runDir:await temp(t),browser:createEgoBrowser({page:f.page,sleep:async()=>{}})});assert.equal(r.completion,delay===1?'completed':'paused');assert.equal(f.actions.filter(x=>x==='click:#submit').length,2);assert.equal(r.pages[0].checkpoint.youtubeEmail.submitAttempts,2);}
});
test('邮箱-YT-011 native contact control can be named by its accessible label',()=>{
 const button={textContent:'',innerText:'',getClientRects:()=>[{}],getAttribute:k=>k==='aria-label'?'查看电子邮件地址':null,setAttribute(){}};
 const table={parentElement:{innerText:'点击查看，会自动上报邮箱，感谢共享邮箱'}};
 const about={innerText:'点击查看，会自动上报邮箱，感谢共享邮箱',getClientRects:()=>[{}],querySelectorAll:s=>s==='button,[role="button"]'?[button]:s==='table'?[table]:[]};
 const context={document:{querySelectorAll:s=>s==='ytd-about-channel-renderer'?[about]:[],querySelector:()=>null},getComputedStyle:()=>({}),URL};
 const result=vm.runInNewContext('('+inspectYoutubeEmailUi.toString()+')()',context);assert.equal(result.contactSelector,'[data-profile-email-youtube-contact]');assert.equal(result.emailExpected,true);
});
test('邮箱-YT-012 free-form biography mentioning email does not imply a missing native control',()=>{
 const about={innerText:'Find my email address on my website',getClientRects:()=>[{}],querySelectorAll:s=>s==='table'?[{innerText:'www.youtube.com/@example',parentElement:{innerText:'More info www.youtube.com/@example'}}]:[]};
 const context={document:{querySelectorAll:s=>s==='ytd-about-channel-renderer'?[about]:[],querySelector:()=>null},getComputedStyle:()=>({}),URL};
 const result=vm.runInNewContext('('+inspectYoutubeEmailUi.toString()+')()',context);assert.equal(result.emailExpected,false);
});
test('邮箱-YT-013 a delayed native email control loads before the flow proceeds',async t=>{
 const f=fixture('delayed'),r=await runFinder({config:{url},runDir:await temp(t),browser:createEgoBrowser({page:f.page,sleep:async()=>{}})});assert.equal(r.completion,'completed');assert.equal(r.emails[0].email,'kikochan@pomato.hk');assert.ok(r.pages[0].checkpoint.youtubeEmail.history.some(s=>s.phase==='email_control_ready'));
});
test('邮箱-YT-015 YouTube custom hidden sentinel does not hide a rendered contact button',()=>{
 const parent={hidden:Symbol('Yf'),getClientRects:()=>[{}],hasAttribute:()=>false};
 const button={parentElement:parent,textContent:'查看电子邮件地址',innerText:'查看电子邮件地址',getClientRects:()=>[{}],getAttribute:()=>null,setAttribute(){}};
 const about={getClientRects:()=>[{}],innerText:'More info',querySelectorAll:s=>s==='button,[role="button"]'?[button]:[]};
 const context={document:{querySelectorAll:s=>s==='ytd-about-channel-renderer'?[about]:[],querySelector:()=>null},getComputedStyle:()=>({}),URL};
 const result=vm.runInNewContext('('+inspectYoutubeEmailUi.toString()+')()',context);assert.equal(result.contactSelector,'[data-profile-email-youtube-contact]');
 parent.hidden=true;assert.equal(vm.runInNewContext('('+inspectYoutubeEmailUi.toString()+')()',context).contactSelector,null);
});
test('邮箱-YT-016 waits for the native verification frame to load after requesting email',async t=>{
 const f=fixture('home',false,0,true),r=await runFinder({config:{url},runDir:await temp(t),browser:createEgoBrowser({page:f.page,sleep:async()=>{}})});assert.equal(r.completion,'completed');assert.equal(r.emails[0].email,'kikochan@pomato.hk');assert.ok(r.pages[0].checkpoint.youtubeEmail.history.some(s=>s.phase==='verification_ready'));
});
test('邮箱-YT-002 image challenge pauses without submitting, explicit resume uses verified state without rechecking',async t=>{
 const f=fixture('home',true),dir=await temp(t),b=()=>createEgoBrowser({page:f.page,sleep:async()=>{}});
 const stopped=await runFinder({config:{url},runDir:dir,browser:b()});assert.equal(stopped.completion,'paused');assert.ok(!f.actions.includes('click:#submit'));
 f.setState('verified');const resumed=await runFinder({runDir:dir,resume:true,browser:b()});assert.equal(resumed.completion,'completed');assert.equal(resumed.emails[0].email,'kikochan@pomato.hk');assert.equal(f.actions.filter(x=>x==='checkbox').length,1);
});
test('邮箱-YT-003 already revealed native email does not click anything again',async t=>{
 const f=fixture('email'),r=await runFinder({config:{url},runDir:await temp(t),browser:createEgoBrowser({page:f.page})});assert.equal(r.completion,'completed');assert.equal(r.emails[0].email,'kikochan@pomato.hk');assert.deepEqual(f.actions,[]);
});
test('邮箱-YT-004 login wall pauses before email interaction',async t=>{
 const f=fixture('login'),r=await runFinder({config:{url},runDir:await temp(t),browser:createEgoBrowser({page:f.page})});assert.equal(r.completion,'paused');assert.deepEqual(f.actions,[]);
});

test('邮箱-YT-007 HTTP401 and 403 keep the original protection pause',async t=>{
 for(const code of [401,403]){const f=fixture('http'+code),r=await runFinder({config:{url},runDir:await temp(t),browser:createEgoBrowser({page:f.page})});assert.equal(r.completion,'paused');assert.ok(r.pages[0].issues.includes('http_'+code));assert.deepEqual(f.actions,[]);}
});
