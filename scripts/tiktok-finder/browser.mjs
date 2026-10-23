import fs from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {navigateWith403Retry,isControlError,inspectReloadScreen} from '../tiktok-browser/access.mjs';
import {readSearchPage,parseSearchResponse} from '../tiktok-search/search.mjs';
import {collectVideoRegions} from '../tiktok-video-region/region.mjs';
import {runCampaign,writeJson} from './workflow.mjs';
import {recoverPostBodies} from './post-body-recovery.mjs';
import {createPaginationCollector,readScrollState,validatePaginationChain} from './pagination.mjs';
const pause=reason=>Object.assign(new Error(reason),{pause:true});
const scopeMatches=(actual,target)=>{try{const a=new URL(actual),b=new URL(target);return a.hostname===b.hostname&&a.pathname.replace(/\/$/,'')===b.pathname.replace(/\/$/,'')&&(b.pathname.startsWith('/search')?a.searchParams.get('q')===b.searchParams.get('q'):true);}catch{return false;}};
export function readProfilePage(){
 let d;try{d=JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent).__DEFAULT_SCOPE__['webapp.user-detail'];}catch{}
 const u=d?.userInfo?.user,latest=[...document.querySelectorAll('button')].find(b=>/^(最新|Latest)$/i.test(b.textContent?.trim()||''));
 // This callback executes in the page; keep extraction self-contained and never visit targets.
 const profileUrl=location.origin+location.pathname,capturedAt=new Date().toISOString();
 const validUrl=value=>{try{const url=new URL(value);return typeof value==='string'&&['https:','http:'].includes(url.protocol)&&!!url.hostname?value:null;}catch{return null;}};
 const evidence=[];let domRead=false,invalid=false;
 const hasField=!!u&&Object.hasOwn(u,'bioLink'),fieldValue=u?.bioLink?.link;
 if(hasField)evidence.push({fieldPath:'__DEFAULT_SCOPE__["webapp.user-detail"].userInfo.user.bioLink.link',rawValue:fieldValue??null});
 const urls=[];
 if(fieldValue){if(validUrl(fieldValue))urls.push(fieldValue);else invalid=true;}
 else if(hasField&&u.bioLink!==null&&(typeof u.bioLink!=='object'||Array.isArray(u.bioLink)||!Object.hasOwn(u.bioLink,'link')||(fieldValue!==null&&fieldValue!=='')))invalid=true;
 try{
  for(const anchor of document.querySelectorAll('a[href*="/link/v2"]')){
   const href=anchor.href,url=new URL(href);
   if(url.hostname!=='www.tiktok.com'||url.pathname.replace(/\/$/,'')!=='/link/v2'||url.searchParams.get('scene')!=='bio_url')continue;
   const target=url.searchParams.get('target');evidence.push({fieldPath:'DOM.a.bio_url.target',href,rawValue:target});
   if(validUrl(target))urls.push(target);else invalid=true;
  }
  domRead=true;
 }catch{}
 const unique=[...new Set(urls)],verified=d?.statusCode===0&&!!u?.id&&!u.privateAccount&&decodeURIComponent(location.pathname).replace(/\/$/,'').toLowerCase()==='/@'+u.uniqueId?.toLowerCase();
 const status=!verified||invalid||unique.length>1?'unknown':unique.length===1?'present':hasField&&domRead?'none':'unknown';
 const externalLink={status,url:status==='present'?unique[0]:null,evidence,profileUrl,authorId:u?.id,capturedAt,domRead,reason:!verified?'profile_not_verified':invalid?'invalid_url':unique.length>1?'conflicting_sources':status==='unknown'?'insufficient_evidence':null};
 return {profileUrl,username:u?.uniqueId,authorId:u?.id,secUid:u?.secUid,bio:u?.signature||'',externalLink,statusCode:d?.statusCode,privateAccount:u?.privateAccount,followers:d?.userInfo?.statsV2?.followerCount??d?.userInfo?.stats?.followerCount,capturedAt,latestSortAvailable:!!latest,latestOrderConfirmed:latest?.dataset.active==='true'||latest?.getAttribute('aria-selected')==='true',playlists:[...document.querySelectorAll('a[href*="/playlist/"]')].map(a=>({text:a.innerText,url:a.href}))};
}
function parsePosts(data){return {statusCode:data.statusCode,hasMore:[1,true].includes(data.hasMore)?true:[0,false].includes(data.hasMore)?false:null,cursor:data.cursor,items:(data.itemList||[]).map(i=>({id:i.id,authorId:i.author?.id,username:i.author?.uniqueId,createdAt:Number(i.createTime),views:i.statsV2?.playCount??i.stats?.playCount,description:i.desc||'',pinned:i.isPinnedItem===true,privateItem:i.privateItem===true,mediaType:i.imagePost?'photo':'video',locationCreated:i.locationCreated,capturedAt:new Date().toISOString(),url:'https://www.tiktok.com/@'+i.author?.uniqueId+'/video/'+i.id,source:'ego_passive_profile_item_list'}))};}
export function createEgoBrowser({page,task,runDir,config,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now()}){
 const pacePath=join(runDir,'last-tiktok-nav.txt');
 const scrollPacePath=join(runDir,'last-tiktok-scroll.txt');let lastWheel=-Infinity,scrollClockLoaded=false;
 const collector=createPaginationCollector({page,scopeMatches,now});
 const paced=async(minimumIntervalMs=10500)=>{
  let last=0;try{last=Number(await fs.readFile(pacePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  assert(Number.isFinite(last)&&last>=0&&last<=now()+1000,'invalid shared navigation timestamp');
  for(let remaining=Math.max(0,minimumIntervalMs-(now()-last));remaining>0;){const step=Math.min(250,remaining);await sleep(step);await collector.drain();remaining-=step;}
  await fs.writeFile(pacePath,String(now()));
 };
 async function action({url,endpoint,keyword,checkpoint={},onCheckpoint=async()=>{},scrollPage=false,trigger,readyToSkip,minimumIntervalMs=10500,expectedCursor=checkpoint.cursor}){
  await page.cdp('Network.enable',{});
  collector.configure({url,endpoint,keyword},scrollPage);
  if(!scrollClockLoaded){
   try{lastWheel=Number(await fs.readFile(scrollPacePath,'utf8'));assert(Number.isFinite(lastWheel)&&lastWheel>=0&&lastWheel<=now()+1000,'invalid shared scroll timestamp');}catch(error){if(error.code!=='ENOENT')throw error;}
   scrollClockLoaded=true;
  }
  const sameRetryTarget=checkpoint.retry?.url===url;
  const priorReloadClicks=sameRetryTarget?Number(checkpoint.retry.reloadClicks||0):0;
  const prior403=sameRetryTarget&&((checkpoint.retry.status===403&&checkpoint.retry.attempts===1)||priorReloadClicks>0);
  let resumeReloadPage=sameRetryTarget&&(checkpoint.retry.screen==='reload_button'||priorReloadClicks>0);
  if(sameRetryTarget&&checkpoint.retry.status===403&&!resumeReloadPage&&await inspectReloadScreen(page)==='reload_button')resumeReloadPage=true;
  if(!prior403&&!resumeReloadPage&&sameRetryTarget&&[401,403,429].includes(checkpoint.retry.status)){
   const current=await page.evaluate(readSearchPage);
   if(!scopeMatches(current.url,url)||current.captcha||current.loginPrompt||current.httpStatus!==200)throw pause('http_'+checkpoint.retry.status);
   checkpoint={...checkpoint,retry:null};
  }
  let captured=[],first=!prior403,skipBodies=false,scrolling=false,restarted=false;
  const inspect=async()=>{
   let access,start=now(),lastPosition,lastMovement=now(),signature,stableSince=now(),networkSignature,networkStableSince=now(),settleStarted;
   for(;;){
    access=await page.evaluate(readSearchPage);captured=await collector.drain();
    const statuses=[access.httpStatus,...captured.map(r=>r.response?.status)];
    const status=statuses.find(s=>s===401||s===429)??statuses.find(s=>s===403)??statuses.find(s=>s>=400)??access.httpStatus;
    access={...access,httpStatus:status};
    if(access.captcha||access.loginPrompt||status>=400)break;
    if(!scopeMatches(access.url,url)&&await inspectReloadScreen(page)!=='reload_button')throw pause('page_identity_mismatch');
    const readiness=readyToSkip?await readyToSkip():false;
    if(readiness===true){skipBodies=true;break;}
    if(readiness==='wait'&&now()-start>=12000)throw pause('profile_readiness_timeout');
    if(collector.rejected&&!captured.length)throw pause('response_provenance_mismatch');
    if(captured.some(r=>r.failed))throw pause('response_download_failed');
    if(captured.some(r=>now()-r.observedAt>=30000&&(!r.finished||!r.response)))throw pause('response_timeout');
    const currentNetwork=captured.map(r=>r.id+':'+!!r.response+':'+!!r.finished).join('|');
    if(currentNetwork!==networkSignature){networkSignature=currentNetwork;networkStableSince=now();}
    let scrollState;
    if(scrolling){
     scrollState=await page.evaluate(readScrollState);
     if(scrollState.blocked)throw pause('scroll_target_unavailable');
     if(signature!==scrollState.signature){signature=scrollState.signature;stableSince=now();}
    }
    if(captured.length&&readiness!=='wait'){
     if(captured.every(r=>r.finished&&r.response)){
      settleStarted??=now();
      if(now()-networkStableSince>=300&&(!scrolling||now()-stableSince>=300))break;
      if(now()-settleStarted>=5000)throw pause('render_timeout');
     }else settleStarted=undefined;
    }
    if(scrolling&&!captured.length){
     if(now()-start>=120000)throw pause('scroll_progress_timeout');
     if(lastPosition!==scrollState.position){lastPosition=scrollState.position;lastMovement=now();}
     if(now()-lastMovement>=3000)throw pause('scroll_stalled');
     if(now()-lastWheel>=1000){
      await page.mouse.move(scrollState.x,scrollState.y,{label:'定位视频列表区域'});
      // Moving the pointer can itself cause a prefetch; inspect again before sending input.
      if((await collector.drain()).length)continue;
      const delta=Math.max(1,Math.floor(scrollState.viewportHeight/4));
      await page.mouse.wheel(0,delta,{label:'逐段向下浏览视频'});lastWheel=now();
      await writeJson(scrollPacePath,lastWheel);
      await fs.appendFile(join(runDir,'scroll-events.jsonl'),JSON.stringify({url,delta,position:scrollState.position,at:now()})+'\n');
      continue;
     }
    }else if(!captured.length&&now()-start>=12000)throw pause('response_missing');
    await sleep(100);
   }
   return access;
  };
  const reset=async()=>{await collector.reset();scrolling=false;restarted=true;};
  const navigationPage={goto:async()=>{if(first&&trigger){first=false;await reset();await trigger();}else if(first&&scrollPage){first=false;scrolling=true;}else{first=false;await reset();await page.goto(url);}}};
  for(const method of ['snapshot','url'])if(typeof page[method]==='function')navigationPage[method]=(...args)=>page[method](...args);
  for(const method of ['click','reload'])if(typeof page[method]==='function')navigationPage[method]=async(...args)=>{await reset();return page[method](...args);};
  const nav=await navigateWith403Retry({page:navigationPage,url,prior403,priorReloadClicks,resumeReloadPage,read:inspect,sleep,beforeNavigate:async()=>{await paced(minimumIntervalMs);await collector.drain();},onAttempt:async attempt=>{checkpoint={...checkpoint,retry:{url,attempts:attempt.number,status:attempt.httpStatus,screen:attempt.screen||null,reloadClicks:attempt.reloadClicks??checkpoint.retry?.reloadClicks??0}};await onCheckpoint(checkpoint);await fs.appendFile(join(runDir,'access-attempts.jsonl'),JSON.stringify({url,number:attempt.number,httpStatus:attempt.httpStatus,action:attempt.action,screen:attempt.screen||null,reloadClicks:checkpoint.retry.reloadClicks,capturedAt:attempt.capturedAt})+'\n');}});
  if(nav.access.captcha)throw pause('captcha_requires_user');if(nav.access.loginPrompt)throw pause('login_prompt_needs_inspection');if(nav.access.httpStatus>=400)throw pause('http_'+nav.access.httpStatus);if(nav.error)throw pause(nav.error);
  const completedCheckpoint={...checkpoint,retry:null};delete completedCheckpoint.partialBodies;delete completedCheckpoint.bodyReadFailure;
  if(skipBodies){await onCheckpoint(completedCheckpoint);return [];}
  let bodies=[];
  const chain={keyword,expectedCursor:restarted?'0':expectedCursor};
  for(;;){
   const raw=[];
   for(const record of captured){
    try{if(!record.body){const response=await page.cdp('Network.getResponseBody',{requestId:record.id});record.body=JSON.parse(response.base64Encoded?Buffer.from(response.body,'base64').toString('utf8'):response.body);}}
    catch(error){if(isControlError(error))throw error;const prefix=validatePaginationChain(captured,raw,chain);await onCheckpoint({...checkpoint,partialBodies:prefix.map(b=>keyword?parseSearchResponse(b):parsePosts(b))});throw pause('response_body_unavailable');}
    raw.push(record.body);validatePaginationChain(captured,raw,chain);
   }
   bodies=validatePaginationChain(captured,raw,chain);
   const latest=await collector.drain();
   if(latest.length===captured.length&&latest.every((r,i)=>r===captured[i]&&r.finished))break;
   const access=await inspect();
   if(access.captcha)throw pause('captcha_requires_user');if(access.loginPrompt)throw pause('login_prompt_needs_inspection');if(access.httpStatus>=400)throw pause('http_'+access.httpStatus);
  }
  if(!bodies.length)throw pause('response_missing');
  collector.commit(captured);await onCheckpoint(completedCheckpoint);bodies.restarted=nav.retried;return bodies;
 }
 const browser={
  async discoverBatch({keyword,checkpoint={},onCheckpoint}){
   const url='https://www.tiktok.com/search/video?q='+encodeURIComponent(keyword);
   const bodies=await action({url,endpoint:'/api/search/item/full/',keyword,checkpoint,onCheckpoint,scrollPage:checkpoint.started===true&&scopeMatches(await page.url(),url)});
   const responses=bodies.map(parseSearchResponse);if(responses.some(r=>r.statusCode!==0||r.hasMore===null))throw pause('search_response_invalid');
   const result={items:responses.flatMap(r=>r.items),hasMore:responses.at(-1).hasMore,cursor:responses.at(-1).cursor,valid:true,checkpoint:{keyword,started:true,retry:null}};
   await fs.appendFile(join(runDir,'tiktok-video-discovery.jsonl'),JSON.stringify({keyword,url,capturedAt:new Date().toISOString(),responses})+'\n');return result;
  },
  async readProfile(candidate,onCheckpoint=async()=>{},checkpoint={}){
   const url='https://www.tiktok.com/@'+candidate.username;let profile,lastSaved,latestInactiveSince=null;
   const inspectProfile=async()=>{
    const raw=await page.evaluate(readProfilePage);
    const identityVerified=raw.statusCode===0&&raw.username?.toLowerCase()===candidate.username.toLowerCase()&&(!candidate.authorIdHint||raw.authorId===candidate.authorIdHint);
    profile={...raw,identityVerified,ready:identityVerified};
    if(!identityVerified&&profile.externalLink)profile.externalLink={...profile.externalLink,status:'unknown',url:null,reason:'candidate_identity_mismatch'};
    if(raw.authorId&&raw.authorId!==lastSaved){lastSaved=raw.authorId;await onCheckpoint({...checkpoint,profile});}
    if(!raw.authorId&&typeof raw.statusCode!=='number')return 'wait';
    if(!raw.authorId||!identityVerified||raw.privateAccount||((config?.requireBioEmail??true)&&!raw.bio?.includes('@')))return true;
    if(raw.latestSortAvailable===false)return 'wait';
    if(!raw.latestOrderConfirmed){if(latestInactiveSince===null)latestInactiveSince=now();return now()-latestInactiveSince>=750?true:'wait';}
    latestInactiveSince=null;return false;
   };
   let bodies;
   try{bodies=await action({url,endpoint:'/api/post/item_list/',checkpoint,onCheckpoint,readyToSkip:inspectProfile});}
   catch(error){
    if(error.message!=='login_prompt_needs_inspection')throw error;
    const raw=await page.evaluate(readProfilePage);
    // Observed TikTok audience controls block one profile; do not request a global login for it.
    if(raw.statusCode!==209002||!scopeMatches(raw.profileUrl,url))throw error;
    const profile={...raw,ready:false,identityVerified:false,accessRestriction:'audience_management_login_required'};
    await onCheckpoint({...checkpoint,profile});return {profile,pages:[],postAttemptComplete:true};
   }
   if(profile?.ready&&!profile.privateAccount&&!profile.latestOrderConfirmed&&(!(config?.requireBioEmail??true)||profile.bio?.includes('@'))){
    bodies=await action({url,endpoint:'/api/post/item_list/',onCheckpoint,trigger:()=>page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^(最新|Latest)$/i.test(b.textContent?.trim()||''));if(!b)throw Error('latest_sort_unavailable');b.click();})});
   }
   const raw=await page.evaluate(readProfilePage);const identityVerified=raw.statusCode===0&&raw.username?.toLowerCase()===candidate.username.toLowerCase()&&(!candidate.authorIdHint||raw.authorId===candidate.authorIdHint);
   const verifiedProfile={...raw,identityVerified,ready:identityVerified};
   if(raw.statusCode===209002)verifiedProfile.accessRestriction='audience_management_login_required';
   if(!identityVerified&&verifiedProfile.externalLink)verifiedProfile.externalLink={...verifiedProfile.externalLink,status:'unknown',url:null,reason:'candidate_identity_mismatch'};
   return {profile:verifiedProfile,pages:bodies.map(parsePosts),postAttemptComplete:true};
  },
  async ensureProfile(candidate){if(!scopeMatches(await page.url(),'https://www.tiktok.com/@'+candidate.username))return browser.readProfile(candidate);},
  async nextPosts(candidate,capture,onCheckpoint){const bodies=await action({url:capture.profile.profileUrl,endpoint:'/api/post/item_list/',checkpoint:capture.access,onCheckpoint,scrollPage:true,minimumIntervalMs:3000,expectedCursor:capture.pages.at(-1)?.cursor});const pages=bodies.map(parsePosts);pages.restarted=bodies.restarted;return pages;},
  async collectRegion(capture,save){const report=await collectVideoRegions({page,capture,limit:1,beforeNavigate:()=>paced(),sleep,save});if(report.stopped)throw pause(report.stopReason);return report;},
  finish:async()=>{if(task)await task.finish({keep:[]});}
 };return recoverPostBodies(browser,{
  save:async(candidate,capture)=>{const key=candidate.authorIdHint||candidate.username.toLowerCase();assert(/^[\w.-]+$/.test(key),'invalid capture key');await writeJson(join(runDir,'capture-'+key+'.json'),capture);},
  log:event=>fs.appendFile(join(runDir,'post-body-recovery.jsonl'),JSON.stringify({...event,at:new Date().toISOString()})+'\n')
 });
}
export async function runInEgo(options,{listTaskSpaces,taskSpace}){
 const space=(await listTaskSpaces()).find(s=>s.id===options.spaceId);assert(space&&['agent','agentOwned'].includes(space.ownership),'original space requires Agent control ownership');
 const task=await taskSpace(options.spaceId),page=task.page('p1');
 const result=await runCampaign({...options,browser:createEgoBrowser({page,task,config:options.config,runDir:options.runDir})});
 if(result.status==='paused'&&/^(http_(401|403|429)|captcha)/.test(result.stopReason||''))await task.handOff();
 return result;
}
