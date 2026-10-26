import {isControlError} from '../tiktok-browser/access.mjs';
const pause=reason=>Object.assign(new Error(reason),{pause:true,reason});
function preserveFailure(error){
 if(error.pause||error.storageFailure)throw error;
 if(isControlError(error))throw pause('user_control_lost');
 if(/CDP|Target\.|unresponsive|target.*(?:closed|detached)|session.*(?:closed|invalid)/i.test(error.message))throw pause('browser_unavailable: '+error.message);
}
const phases=new Set(['observed','about_opened','email_control_ready','email_requested','verification_visible','verification_ready','checkbox_requested','verification_pending','verified','submit_requested','submit_pending','email_displayed']);
function validateCheckpoint(checkpoint){
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const s=checkpoint?.youtubeEmail;
 if(!object(checkpoint)||Object.hasOwn(checkpoint,'youtubeEmail')&&!object(s))throw pause('youtube_email_checkpoint_invalid');
 if(!s)return;
 const invalid=[
  s.stage!==undefined,
  s.phase!==undefined&&!phases.has(s.phase),
  s.checkboxAttempted!==undefined&&typeof s.checkboxAttempted!=='boolean',
  s.checkboxExpiryRetryAttempted!==undefined&&typeof s.checkboxExpiryRetryAttempted!=='boolean',
  s.reopenedCheckboxAttempted!==undefined&&typeof s.reopenedCheckboxAttempted!=='boolean',
  s.emailRequestCount!==undefined&&(!Number.isSafeInteger(s.emailRequestCount)||s.emailRequestCount<0),
  s.submitAttempts!==undefined&&(!Number.isSafeInteger(s.submitAttempts)||s.submitAttempts<0||s.submitAttempts>2),
  s.startedAt!==undefined&&(!Number.isFinite(s.startedAt)||s.startedAt<0),
  s.history!==undefined&&(!Array.isArray(s.history)||s.history.some(v=>!object(v)||!phases.has(v.phase)||!Number.isFinite(Date.parse(v.at))||!Number.isFinite(v.elapsedMs)||v.elapsedMs<0)),
  s.phase==='checkbox_requested'&&s.checkboxAttempted!==true,
  ['submit_requested','submit_pending'].includes(s.phase)&&!(s.submitAttempts>=1)
 ];
 if(invalid.some(Boolean))throw pause('youtube_email_checkpoint_invalid');
}

export function inspectYoutubeEmailUi(){
 const visible=e=>{
  if(!e||!e.getClientRects().length)return false;
  for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);if(p.hidden===true||p.hasAttribute?.('hidden')||s.display==='none'||s.visibility==='hidden'||s.opacity==='0')return false;}
  return true;
 };
 const about=[...document.querySelectorAll('ytd-about-channel-renderer')].find(visible);
 const header=document.querySelector('yt-page-header-renderer,yt-page-header-view-model,ytd-c4-tabbed-header-renderer');
 const more=header&&[...header.querySelectorAll('button')].find(b=>visible(b)&&(b.matches('.ytTruncatedTextAbsoluteButton')||/点按即可了解详情|more about this channel|tap to learn more/i.test(b.getAttribute('aria-label')||'')));
 const buttons=[...about?.querySelectorAll('button,[role="button"]')||[]].filter(visible);
 const named=(b,pattern)=>[b.getAttribute('aria-label'),b.innerText,b.textContent].some(v=>pattern.test((v||'').trim()));
 const contact=buttons.find(b=>named(b,/^(查看电子?邮件地址|查看電子郵件地址|查看邮箱|View email address)$/i));
 const submit=buttons.find(b=>named(b,/^(提交|Submit)$/i));
 const mark=(element,name)=>{if(!element)return null;element.setAttribute(name,'');return '['+name+']';};
 const frames=[...document.querySelectorAll('iframe')].filter(visible);
 const contactText=[...about?.querySelectorAll('table')||[]].map(t=>t.parentElement?.innerText||t.innerText).join('\n');
 const recaptcha=f=>{try{const u=new URL(f.src);return /(^|\.)(google\.com|recaptcha\.net)$/.test(u.hostname)&&/\/recaptcha\//.test(u.pathname);}catch{return false;}};
 return {about:!!about,emailVisible:!![...about?.querySelectorAll('a[href^="mailto:"]')||[]].find(visible),
  emailExpected:/邮箱|郵箱|电子邮件|電子郵件|email address/i.test(contactText),
  loginRequired:!!about&&/需要登录才能查看|登录后.*(?:邮箱|邮件)|sign in to (?:see|view).*email/i.test(about.innerText),
  nativeVerification:!!about&&!!submit&&[...about.querySelectorAll('iframe')].some(f=>visible(f)&&recaptcha(f)),
  imageChallenge:frames.some(f=>recaptcha(f)&&/\/bframe/.test(new URL(f.src).pathname)),
  moreSelector:mark(more,'data-profile-email-youtube-more'),contactSelector:mark(contact,'data-profile-email-youtube-contact'),submitSelector:mark(submit,'data-profile-email-youtube-submit')};
}

export async function youtubeClickPoint({selector}){
 const nodes=[...document.querySelectorAll(selector)].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
 if(nodes.length!==1)return {error:'target_not_unique'};
 const element=nodes[0];
 if(element.disabled||element.getAttribute('aria-disabled')==='true')return {error:'target_disabled'};
 element.scrollIntoView({behavior:'instant',block:'center'});
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const r=element.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
 return hit&&(hit===element||element.contains(hit))?{x,y}:{error:'target_covered'};
}

export function youtubeCheckbox(snapshot){
 const boxes=[];
 for(const line of snapshot.split('\n')){
  const checkbox=line.match(/^\s*checkbox\s+"([^"]*)"/),ref=line.match(/\bref=(\d+)/);
  if(checkbox&&ref&&/进行人机身份验证|我不是机器人|I['’]m not a robot|您已通过验证|you are verified/i.test(checkbox[1]))boxes.push({ref:'@'+ref[1],checked:/\bchecked\b|您已通过验证|you are verified/i.test(line),line});
 }
 return boxes.length===1?boxes[0]:null;
}
async function checkboxInFrame(page){
 const full=await page.snapshot({scope:'full_page'}),box=youtubeCheckbox(full);
 if(!box)return null;
 const frames=[...full.slice(0,full.indexOf(box.line)).matchAll(/^\s*iframe[^\n]*\[ref=(\d+)/gm)];
 if(!frames.length)return null;
 const subtree=await page.snapshot({scope:'subtree',root:'@'+frames.at(-1)[1]}),local=youtubeCheckbox(subtree);
 if(local){
  if(/(?:container|text) "(?:您已通过验证|已通过验证|You are verified|You have been verified|Verification complete(?:d)?)"/i.test(subtree))local.checked=true;
  local.expired=/(?:验证已过期|驗證已過期|verification (?:has )?expired|recaptcha (?:has )?expired)/i.test(subtree);
 }
 return local;
}

export async function runYoutubeEmailFlow({page,initial,read,onCapture,checkpoint={},now=()=>Date.now()}){
 validateCheckpoint(checkpoint);
 let capture=initial,ui,cp=structuredClone(checkpoint);
 const resumeSubmitted=['submit_requested','submit_pending','email_displayed'].includes(cp.youtubeEmail?.phase);
 cp.youtubeEmail={startedAt:now(),history:[],emailRequestCount:cp.youtubeEmail?.history?.filter(s=>s.phase==='email_requested').length||0,...cp.youtubeEmail};
 const click=async(selector,label,{verified=false}={})=>{
  await page.prepareAction?.('mouse.click',selector);
  if(verified)await page.waitForSelector('loc=css:[role="checkbox"][aria-checked="true"]',{state:'attached',timeout:1000});
  ui=await page.evaluate(inspectYoutubeEmailUi);
  if(ui.imageChallenge)throw pause('youtube_image_challenge');
  if(ui.loginRequired)throw pause('youtube_login_required');
  const point=await page.evaluate(youtubeClickPoint,{selector});
  if(point.error)throw pause('youtube_'+point.error);
  try{await page.mouse.click(point.x,point.y,{label});}catch(error){preserveFailure(error);}
 };
 const commit=async phase=>{
  const step={phase,at:new Date(now()).toISOString(),elapsedMs:now()-cp.youtubeEmail.startedAt};
  cp.youtubeEmail={...cp.youtubeEmail,phase,history:[...cp.youtubeEmail.history,step].slice(-24)};
  const directive=await onCapture(capture,cp);
  if([401,403].includes(capture.httpStatus))throw pause('http_'+capture.httpStatus);
  if(capture.httpStatus===429||capture.access==='rate_limited')throw pause('rate_limited');
  if(ui.loginRequired||capture.access==='login_wall')throw pause('youtube_login_required');
  if(ui.imageChallenge)throw pause('youtube_image_challenge');
  if(capture.access==='captcha'&&!ui.nativeVerification)throw pause('captcha');
  return directive?.stop===true;
 };
 const observe=async phase=>{capture=await read();ui=await page.evaluate(inspectYoutubeEmailUi);return commit(phase);};
 const done=()=>({complete:true,issues:[],checkpoint:cp});
 try{
  ui=await page.evaluate(inspectYoutubeEmailUi);
  if(await commit(resumeSubmitted?cp.youtubeEmail.phase:'observed')||ui.emailVisible)return done();
  if(resumeSubmitted){
   try{await page.waitForSelector('ytd-about-channel-renderer a[href^="mailto:"]',{state:'visible',timeout:8000});}
   catch(error){preserveFailure(error);await observe('submit_pending');throw pause('youtube_email_result_pending');}
   await observe('email_displayed');
   if(!ui.emailVisible)throw pause('youtube_email_result_pending');
   return done();
  }
  if(!ui.about){
   if(!ui.moreSelector)return {complete:false,issues:['youtube_about_control_missing'],checkpoint:cp};
   await click(ui.moreSelector,'打开频道简介详情');
   await page.waitForSelector('ytd-about-channel-renderer',{state:'visible',timeout:8000});
   if(await observe('about_opened')||ui.emailVisible)return done();
  }
  // About can be visible while its business-email button is still rendering.
  if(ui.emailExpected&&!ui.contactSelector&&!ui.nativeVerification&&!ui.submitSelector){
   for(let tick=0;tick<30&&!ui.contactSelector&&!ui.nativeVerification&&!ui.emailVisible;tick++){
    await page.waitForTimeout(200);
    ui=await page.evaluate(inspectYoutubeEmailUi);
    if(ui.imageChallenge)throw pause('youtube_image_challenge');
    if(ui.loginRequired)throw pause('youtube_login_required');
   }
   if(await observe('email_control_ready')||ui.emailVisible)return done();
  }
  if(ui.contactSelector){
   cp.youtubeEmail.emailRequestCount++;
   if(await commit('email_requested'))return done();
   await click(ui.contactSelector,'查看频道电子邮箱');
   await page.waitForFunction(()=>{
    const about=document.querySelector('ytd-about-channel-renderer');
    return !!about&&(!!about.querySelector('iframe,a[href^="mailto:"]')||[...about.querySelectorAll('button')].some(b=>/^(提交|Submit)$/i.test(b.textContent.trim())));
   },undefined,{timeout:8000});
   if(await observe('verification_visible')||ui.emailVisible)return done();
   if(!ui.nativeVerification){
    for(let tick=0;tick<30&&!ui.nativeVerification&&!ui.emailVisible;tick++){
     await page.waitForTimeout(200);
     ui=await page.evaluate(inspectYoutubeEmailUi);
     if(ui.imageChallenge)throw pause('youtube_image_challenge');
     if(ui.loginRequired)throw pause('youtube_login_required');
    }
    if(await observe('verification_ready')||ui.emailVisible)return done();
   }
  }
  if(!ui.nativeVerification&&!ui.submitSelector){
   if(ui.emailExpected)throw pause('youtube_email_control_unrecognized');
   return {complete:capture.complete!==false,issues:capture.issues||[],checkpoint:cp};
  }
  if(ui.nativeVerification){
  let checkbox;
  await page.prepareAction?.('click','youtube-checkbox');
  for(let tick=0;tick<30;tick++){
   checkbox=await checkboxInFrame(page);
   if(checkbox)break;
   ui=await page.evaluate(inspectYoutubeEmailUi);
   if(ui.imageChallenge)throw pause('youtube_image_challenge');
   await page.waitForTimeout(200);
  }
  if(!checkbox)throw pause('youtube_checkbox_not_observed');
  if(!checkbox.checked){
   if(cp.youtubeEmail.checkboxAttempted){
    const history=cp.youtubeEmail.history;
    const freshRequest=history.findLastIndex(s=>s.phase==='email_requested')>history.findLastIndex(s=>s.phase==='checkbox_requested');
    if(freshRequest&&cp.youtubeEmail.emailRequestCount>1)cp.youtubeEmail.reopenedCheckboxAttempted=true;
    else if(checkbox.expired&&!cp.youtubeEmail.checkboxExpiryRetryAttempted)cp.youtubeEmail.checkboxExpiryRetryAttempted=true;
    else throw pause('youtube_verification_incomplete');
   }else cp.youtubeEmail.checkboxAttempted=true;
   if(await commit('checkbox_requested'))return done();
   try{await page.click(checkbox.ref,{label:'勾选人机身份验证'});}catch(error){preserveFailure(error);}
  }
  try{await page.waitForSelector('loc=css:[role="checkbox"][aria-checked="true"]',{state:'attached',timeout:8000});}
  catch(error){
   preserveFailure(error);
   await observe('verification_pending');
   throw pause('youtube_verification_incomplete');
  }
  if(await observe('verified')||ui.emailVisible)return done();
  }else{
   if(!cp.youtubeEmail.checkboxAttempted)throw pause('youtube_submit_without_verification_evidence');
   if(await commit('verified'))return done();
  }
  while((cp.youtubeEmail.submitAttempts||0)<2){
   if(!ui.submitSelector)throw pause('youtube_submit_not_observed');
   await page.waitForSelector(ui.submitSelector+':not([disabled]):not([aria-disabled="true"])',{state:'visible',timeout:8000});
   cp.youtubeEmail.submitAttempts=(cp.youtubeEmail.submitAttempts||0)+1;
   if(await commit('submit_requested'))return done();
   await click(ui.submitSelector,'提交已验证邮箱请求',{verified:ui.nativeVerification});
   try{await page.waitForSelector('ytd-about-channel-renderer a[href^="mailto:"]',{state:'visible',timeout:8000});}
   catch(error){
    preserveFailure(error);
    if(await observe('submit_pending')||ui.emailVisible)return done();
    if(!ui.nativeVerification)throw pause('youtube_email_result_pending');
    await page.waitForSelector('loc=css:[role="checkbox"][aria-checked="true"]',{state:'attached',timeout:3000});
    continue;
   }
   await observe('email_displayed');return done();
  }
  throw pause('youtube_email_not_displayed');
 }catch(error){
  preserveFailure(error);
  throw pause('youtube_flow_unavailable: '+error.message);
 }
}
