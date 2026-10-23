import assert from 'node:assert/strict';
import {navigateWith403Retry,isControlError,inspectReloadScreen} from '../tiktok-browser/access.mjs';

const FIELD='__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct.locationCreated';
const validCode=value=>typeof value==='string'&&/^[A-Z]{2}$/.test(value.trim().toUpperCase())&&!['ZZ','XX'].includes(value.trim().toUpperCase());
const canonical=url=>{
  try{const u=new URL(url);return u.protocol==='https:'&&['tiktok.com','www.tiktok.com'].includes(u.hostname)?u.pathname:null;}catch{return null;}
};

export function selectRecentVideos(capture,limit=1){
  assert([1,3].includes(limit),'limit must be 1 or 3');
  const p=capture.profile;
  assert(p?.identityVerified&&p.latestOrderConfirmed,'profile identity/latest order unconfirmed');
  assert(typeof p.authorId==='string'&&/^\d+$/.test(p.authorId),'author ID must be an exact string');
  assert(typeof p.username==='string'&&/^[\w.-]+$/.test(p.username),'invalid username');
  const captured=Date.parse(p.capturedAt)/1000;
  assert(Number.isFinite(captured),'invalid capture time');
  assert(Array.isArray(capture.pages)&&capture.pages.every(page=>page.statusCode===0),'incomplete profile response');
  const byId=new Map();
  for(const item of capture.pages.flatMap(page=>page.items||[])){
    assert.equal(item.authorId,p.authorId,'video author mismatch');
    assert.equal(item.username?.toLowerCase(),p.username.toLowerCase(),'video username mismatch');
    assert(typeof item.id==='string'&&/^\d+$/.test(item.id),'video ID must be an exact string');
    assert(Number.isSafeInteger(item.createdAt)&&item.createdAt>0&&item.createdAt<=captured+300,'invalid video publish time');
    if(item.privateItem||item.mediaType==='photo')continue;
    const route=canonical(item.url),videoRoute=`/@${p.username}/video/${item.id}`;
    if(route===`/@${p.username}/photo/${item.id}`)continue;
    assert(route?.toLowerCase()===videoRoute.toLowerCase(),'video URL mismatch');
    const prior=byId.get(item.id);
    if(prior){assert.equal(prior.createdAt,item.createdAt,'conflicting duplicate publish time');assert.equal(prior.locationCreated,item.locationCreated,'conflicting duplicate region');}
    else byId.set(item.id,{...item,url:'https://www.tiktok.com'+videoRoute});
  }
  return [...byId.values()].sort((a,b)=>b.createdAt-a.createdAt||b.id.localeCompare(a.id)).slice(0,limit);
}

// This function runs inside Ego's Page, so it must not close over Node variables.
export function readVideoPage(){
  let detail;
  try{detail=JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent).__DEFAULT_SCOPE__['webapp.video-detail'];}catch{}
  const item=detail?.itemInfo?.itemStruct;
  const bodyText=document.body?.innerText||'';
  const denied=/HTTP (?:ERROR )?(401|403|429)\b/i.exec(bodyText);
  const responseStatus=performance.getEntriesByType('navigation')[0]?.responseStatus;
  return {
    url:location.href,capturedAt:new Date().toISOString(),
    httpStatus:responseStatus>=400?responseStatus:(!item&&denied?Number(denied[1]):responseStatus),
    captcha:!!document.querySelector('iframe[src*="captcha"],#captcha_container'),
    loginPrompt:[...document.querySelectorAll('[role="dialog"]')].some(e=>e.getClientRects().length&&/登录\s*TikTok|Log in to TikTok/i.test(e.innerText)),
    statusCode:detail?.statusCode,
    item:item?{id:item.id,authorId:item.author?.id,username:item.author?.uniqueId,createdAt:Number(item.createTime),locationCreated:item.locationCreated}:null
  };
}

async function readReadyVideoPage(page){
  if(page.waitForFunction){
    try{await page.waitForFunction(()=>{
      let detail;try{detail=JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent).__DEFAULT_SCOPE__['webapp.video-detail'];}catch{}
      return !!detail?.itemInfo?.itemStruct||(typeof detail?.statusCode==='number'&&detail.statusCode!==0)||[401,403,429].includes(performance.getEntriesByType('navigation')[0]?.responseStatus)||!!document.querySelector('iframe[src*="captcha"],#captcha_container')||[...document.querySelectorAll('[role="dialog"]')].some(e=>e.getClientRects().length&&/登录\s*TikTok|Log in to TikTok/i.test(e.innerText));
    },undefined,{timeout:8000});}catch(error){if(isControlError(error))throw error;}
  }
  return page.evaluate(readVideoPage);
}

export function extractVideoRegion(observation,expected){
  const raw=observation.item?.locationCreated;
  const result={videoId:expected.id,authorId:expected.authorId,username:expected.username,videoUrl:expected.url,
    publishedAt:new Date(expected.createdAt*1000).toISOString(),capturedAt:observation.capturedAt,
    source:observation.source||'video_detail_hydration',fieldPath:observation.source==='profile_item_list.locationCreated'?'itemList[].locationCreated':FIELD,
    rawValue:raw??null,regionCode:null,status:'pending',reason:null,creatorResidenceVerified:false};
  if([401,403,429].includes(observation.httpStatus))return {...result,status:'blocked',reason:'http_'+observation.httpStatus};
  if(observation.httpStatus>=400)return {...result,reason:'http_'+observation.httpStatus};
  if(observation.captcha)return {...result,status:'blocked',reason:'captcha_requires_user'};
  if(observation.loginPrompt)return {...result,reason:'login_prompt_needs_inspection'};
  if(observation.statusCode!==0||!observation.item)return {...result,reason:'video_data_unavailable'};
  const item=observation.item;
  if(item.id!==expected.id||item.authorId!==expected.authorId||item.username?.toLowerCase()!==expected.username.toLowerCase()||item.createdAt!==expected.createdAt||canonical(observation.url)?.toLowerCase()!==canonical(expected.url)?.toLowerCase())return {...result,reason:'identity_mismatch'};
  if(!validCode(raw))return {...result,reason:raw==null||raw===''?'field_missing':'field_invalid'};
  return {...result,status:'observed',reason:'video_region_field_observed',regionCode:raw.trim().toUpperCase()};
}

export function summarizeRegions(observations,requestedCount){
  const observed=observations.filter(o=>o.status==='observed');
  const codes=[...new Set(observed.map(o=>o.regionCode))];
  let status='incomplete',regionCode=null;
  if(codes.length>1)status='conflicting';
  else if(observed.length===requestedCount){status=requestedCount===1?'single_video':'recent_videos_consistent';regionCode=codes[0];}
  return {status,regionCode,requestedCount,inspectedCount:observations.length,usableCount:observed.length,
    creatorResidenceVerified:false,meaning:'Observed video region field; not verified creator residence or nationality.'};
}

export async function collectVideoRegions({page,capture,limit=1,beforeNavigate=async()=>{},save=async()=>{},sleep,prior403=false}){
  const targets=selectRecentVideos(capture,limit),observations=[];
  const report={schemaVersion:1,username:capture.profile.username,authorId:capture.profile.authorId,selectionSnapshotAt:capture.profile.capturedAt,
    selection:'latest_public_videos_in_verified_profile_snapshot_sorted_by_publish_time',requestedCount:limit,observations,navigationAttempts:structuredClone(capture.videoRegion?.navigationAttempts||[]),stopped:false,stopReason:null};
  for(const target of targets){
    let data,navigationError;
    if(validCode(target.locationCreated)){
      data={url:target.url,httpStatus:200,statusCode:0,capturedAt:target.capturedAt||capture.profile.capturedAt,item:target,source:'profile_item_list.locationCreated'};
    }else{
      const previous=report.navigationAttempts.filter(a=>a.videoId===target.id&&a.url===target.url),last=previous.at(-1);
      const priorReloadClicks=Math.max(0,...previous.map(a=>a.reloadClicks||0),previous.filter(a=>a.action==='reload_button').length);
      const sameUrl=page.url&&canonical(await page.url())?.toLowerCase()===canonical(target.url)?.toLowerCase();
      const screen=await inspectReloadScreen(page),resumeReloadPage=!!(last||sameUrl)&&['reload_button','waiting'].includes(screen);
      let current;
      if(sameUrl||last){
        try{current=await readReadyVideoPage(page);}catch(error){if(isControlError(error))throw error;}
      }
      if(current&&!resumeReloadPage&&(current.httpStatus!==403||current.captcha||current.loginPrompt))data=current;
      else if(last?.httpStatus===403&&last.number>=2&&!resumeReloadPage)data=current||{url:target.url,httpStatus:403,capturedAt:new Date().toISOString(),item:null};
      else{
        const nav=await navigateWith403Retry({page,url:target.url,read:()=>readReadyVideoPage(page),sleep,
          prior403:current?.httpStatus===403||last?.httpStatus===403||(prior403&&observations.length===0),resumeReloadPage,priorReloadClicks,beforeNavigate:()=>beforeNavigate(target),
          retryUsingReload:true,
          onAttempt:async attempt=>{if(last&&attempt.source==='previously_observed_403')return;report.navigationAttempts.push({...attempt,number:report.navigationAttempts.filter(a=>a.videoId===target.id).length+1,videoId:target.id});await save(report);}});
        data=nav.access;navigationError=nav.error;
      }
    }
    const observation=extractVideoRegion(data,target);
    if(navigationError){
      observation.navigationError=navigationError.slice(0,250);
      if(observation.status!=='blocked'){observation.status='pending';observation.reason='navigation_failed';observation.regionCode=null;}
    }
    observations.push(observation);
    if(observation.status==='blocked'||observation.reason?.startsWith('http_')||['identity_mismatch','video_data_unavailable','login_prompt_needs_inspection'].includes(observation.reason)||navigationError){
      report.stopped=true;report.stopReason=observation.reason; 
    }
    report.summary=summarizeRegions(observations,limit);
    await save(report);
    if(report.stopped)break;
  }
  report.summary=summarizeRegions(observations,limit);
  await save(report);
  return report;
}
