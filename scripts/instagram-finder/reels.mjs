import {analyzeReels,clipsPage,detailMedia,freezeWindow,reelAssociation} from './metrics.mjs';
import {responseProtectionReason,queryOperation,ignorableQueryFailure} from './protection.mjs';

// Uses only responses emitted by normal navigation, modal clicks and scrolling.
async function responses(page,warnings=[],requestHistory=[]){
 const result=[];
 const events=await page.events();
 requestHistory.push(...events.filter(e=>e.method==='Network.requestWillBeSent'));
 for(const event of events){
  if(event.method!=='Network.responseReceived')continue;
  const {response,requestId}=event.params;
  const url=new URL(response.url);
  if(url.hostname!=='www.instagram.com'||!/graphql|api\/v1/.test(url.pathname))continue;
  if([401,403,429].includes(response.status))throw new Error('instagram_access_stopped_'+response.status);
  try{
   const body=await page.cdp('Network.getResponseBody',{requestId});
   const text=body.base64Encoded?Buffer.from(body.body,'base64').toString():body.body;
   for(const line of text.replace(/^for\s*\(;;\);/,'').split('\n')){
    try{const data=JSON.parse(line);const operation=queryOperation(requestHistory,requestId);if(ignorableQueryFailure(operation,response.status,data)){warnings.push({operation,reason:responseProtectionReason(data),ignored:true});continue;}const protection=responseProtectionReason(data);if(protection)throw new Error(protection);const blockingErrors=(data.errors||[]).filter(e=>e.path?.slice(-2).join('.')!=='location.profile_pic_url');if(blockingErrors.length||data.status==='fail'){const error=new Error('instagram_response_failed');error.responseErrors=blockingErrors.map(e=>({path:e.path,code:e.extensions?.code,message:e.message}));error.responseDataKeys=Object.keys(data.data||{});throw error;}result.push({data,status:response.status});}
    catch(error){if(/^(instagram_response_failed|instagram_access_stopped_|instagram_login_or_challenge)/.test(error.message))throw error;}
   }
  }catch(error){if(/^(instagram_response_failed|instagram_access_stopped_|instagram_login_or_challenge)/.test(error.message))throw error;}
 }
 return result;
}

export async function collectReels({page,detailPage,username,authorId,config={...freezeWindow(),minAverageViewsExclusive:50000},onCheckpoint=async()=>{},maxPages=50,cachedCapture}){
 if(!/^[A-Za-z0-9._]{1,30}$/.test(username)||typeof authorId!=='string'||!/^\d+$/.test(authorId))throw new Error('invalid_profile_identity');
 const capture={username,authorId,capturedAt:new Date().toISOString(),latestOrderConfirmed:false,pages:[],processedPageCount:0,timestampPages:[],details:[],warnings:[],config};
 const cachedTimes=cachedCapture?.authorId===authorId?[...(cachedCapture.pages||[]).flatMap(p=>p.items),...(cachedCapture.timestampPages||[]).flatMap(p=>p.items),...(cachedCapture.details||[])].filter(m=>reelAssociation(m,authorId)&&Number.isSafeInteger(m.taken_at)):[];
 const seenCursors=new Set(),seenTimelinePages=new Set(),timeline=[];
 let metrics,detailOpen=false,controlLost=false,timelinePageInfo;
 const save=async()=>{capture.capturedAt=new Date().toISOString();metrics=analyzeReels(capture,config);await onCheckpoint(structuredClone({capture,metrics}));};
 const ingest=rs=>{
  for(const r of rs){
   const timelineConnection=r.data.data?.xdt_api__v1__feed__user_timeline_graphql_connection;
   if(timelineConnection){
    const own=timelineConnection.edges.map(e=>e.node).filter(m=>reelAssociation(m,authorId));
    const key=JSON.stringify([timelineConnection.page_info?.end_cursor,own.map(m=>m.pk)]);
    if(!seenTimelinePages.has(key)){
     seenTimelinePages.add(key);timeline.push(...own);timelinePageInfo=timelineConnection.page_info;
     capture.timestampPages.push({cursor:timelinePageInfo?.end_cursor,hasNextPage:timelinePageInfo?.has_next_page,items:own.filter(m=>Number.isSafeInteger(m.taken_at)).map(m=>({pk:m.pk,code:m.code,taken_at:m.taken_at,user:{pk:m.user.pk,username:m.user.username},coauthor_producers:m.coauthor_producers,source:'instagram_profile_posts_response'}))});
    }
   }
   const next=clipsPage(r.data,r.status);
   if(!next)continue;
   if(next.profileId!==authorId)throw new Error('profile_identity_mismatch');
   const key=JSON.stringify([next.cursor,next.items.map(m=>m.pk)]);
   if(!seenCursors.has(key)){capture.pages.push(next);seenCursors.add(key);}
  }
 };
 try{
  const histories=new Map();
  const readResponses=target=>{if(!histories.has(target))histories.set(target,[]);return responses(target,capture.warnings,histories.get(target));};
  await page.cdp('Network.enable',{maxPostDataSize:65536});await page.events();
  await page.goto('https://www.instagram.com/'+username+'/');
  await page.waitForSelector('a[href="/'+username+'/reels/"]',{timeout:15000});
  await page.waitForTimeout(1000);ingest(await readResponses(page));
  // Normal grid batches provide many exact timestamps per request; details remain a fallback.
  const hasOldTimestamp=()=>timeline.some(m=>reelAssociation(m,authorId)==='owner'&&!m.timeline_pinned_user_ids?.includes(authorId)&&Number.isSafeInteger(m.taken_at)&&m.taken_at<Date.parse(config.windowStart)/1000);
  for(let extra=0;extra<4&&timelinePageInfo?.has_next_page===true&&!hasOldTimestamp();extra++){
   const before=timeline.length;await save();await page.waitForTimeout(10500);
   await page.mouse.move(1000,650);await page.mouse.wheel(0,1600,{label:'逐批读取主页视频发布时间'});
   for(let tick=0;tick<12&&timeline.length===before;tick++){await page.waitForTimeout(600);ingest(await readResponses(page));}
   if(timeline.length===before){capture.warnings.push({stage:'timestamp_prefetch',reason:'native_timeline_not_advanced',fallback:'video_detail'});break;}
  }
  await save();
  await page.click('a[href="/'+username+'/reels/"]',{label:'读取作者 Reels 列表'});
  await page.waitForTimeout(1200);ingest(await readResponses(page));
  // Native list requests may finish after the initial render; wait without another navigation.
  for(let attempt=0;attempt<10&&(!capture.pages.length||!timeline.length);attempt++){
   await page.waitForTimeout(600);ingest(await readResponses(page));
  }
  if(!capture.pages.length)throw new Error('clips_response_missing');
  const reelsPinned=new Set(capture.pages.flatMap(p=>p.items).filter(m=>m.clips_tab_pinned_user_ids?.includes(authorId)).map(m=>m.pk));
  const timelineVideos=timeline.filter(m=>m.media_type===2&&reelAssociation(m,authorId)==='owner'&&!reelsPinned.has(m.pk)).sort((a,b)=>b.taken_at-a.taken_at);
  const firstClips=capture.pages[0].items.filter(m=>reelAssociation(m,authorId)==='owner'&&!m.clips_tab_pinned_user_ids?.includes(authorId));
  const overlap=firstClips.filter(m=>timelineVideos.some(t=>t.pk===m.pk));
  // The profile grid can be rearranged; compare verified publication times, not grid position.
  capture.latestOrderConfirmed=timelineVideos.every(m=>Number.isSafeInteger(m.taken_at))&&overlap.length>=2&&firstClips[0]?.pk===timelineVideos[0]?.pk&&overlap.every((m,i)=>i===0||timelineVideos.findIndex(t=>t.pk===m.pk)>timelineVideos.findIndex(t=>t.pk===overlap[i-1].pk));
  const allTimelineVideos=timeline.filter(m=>m.media_type===2&&!reelsPinned.has(m.pk)).sort((a,b)=>b.taken_at-a.taken_at);
  const allFirstClips=capture.pages[0].items.filter(m=>!m.clips_tab_pinned_user_ids?.includes(authorId));
  const allOverlap=allFirstClips.filter(m=>allTimelineVideos.some(t=>t.pk===m.pk));
  capture.collaborationOrderConfirmed=allTimelineVideos.every(m=>Number.isSafeInteger(m.taken_at))&&allOverlap.length>=2&&allFirstClips[0]?.pk===allTimelineVideos[0]?.pk&&allOverlap.every((m,i)=>i===0||allTimelineVideos.findIndex(t=>t.pk===m.pk)>allTimelineVideos.findIndex(t=>t.pk===allOverlap[i-1].pk));
  capture.latestOrderConfirmed ||= capture.collaborationOrderConfirmed;
  for(let index=0;index<capture.pages.length&&index<maxPages;index++){
   const current=capture.pages[index];
   for(const item of current.items){
    if(item.media_type!==2||!reelAssociation(item,authorId))throw new Error('unexpected_reel_identity_or_type');
    const existing=timeline.find(t=>t.pk===item.pk&&t.code===item.code)||capture.details.find(t=>t.pk===item.pk)||cachedTimes.find(t=>t.pk===item.pk&&t.code===item.code);
    if(existing?.taken_at)item.taken_at=existing.taken_at;
    if(!Number.isSafeInteger(item.taken_at)&&detailPage){
     await detailPage.cdp('Network.enable',{maxPostDataSize:65536});await detailPage.events();
     const target='https://www.instagram.com/p/'+item.code+'/';await detailPage.goto(target);
     const current=new URL(await detailPage.url());
     if(/^\/(accounts\/login|challenge|checkpoint)(\/|$)/.test(current.pathname))throw new Error('instagram_login_or_challenge');
     if(current.hostname!=='www.instagram.com'||!new RegExp('^/(?:p|reels?)/'+item.code+'/?$').test(current.pathname))throw new Error('video_page_identity_mismatch');
     await detailPage.waitForTimeout(700);
     const scripts=await detailPage.evaluate(()=>[...document.querySelectorAll('script[type="application/json"]')].map(s=>s.textContent));
     let detail;
     for(const script of scripts){if(detail)break;let data;try{data=JSON.parse(script);}catch{continue;}detail=detailMedia(data,item.code,item.user.pk);}
     if(!detail)detail=(await readResponses(detailPage)).map(r=>detailMedia(r.data,item.code,item.user.pk)).find(Boolean);
     if(!detail)throw new Error('video_timestamp_response_missing_'+item.code);
     item.taken_at=detail.taken_at;
     capture.details.push({pk:detail.pk,code:detail.code,taken_at:detail.taken_at,user:{pk:detail.user.pk,username:detail.user.username},coauthor_producers:item.coauthor_producers,source:'native_video_page_hydration'});
    }
    if(!Number.isSafeInteger(item.taken_at)){
     await page.waitForTimeout(1100);ingest(await readResponses(page));
     await page.click('a[href="/'+username+'/reel/'+item.code+'/"]',{label:'读取视频发布时间'});
     detailOpen=true;
     // Rendering a date is not required when the native response identifies this exact video.
     const rs=[];let detail;
     for(let attempt=0;attempt<8&&!detail;attempt++){
      await page.waitForTimeout(600);const batch=await readResponses(page);rs.push(...batch);
      detail=batch.map(r=>detailMedia(r.data,item.code,item.user.pk)).find(Boolean);
     }
     if(!detail)throw new Error('video_timestamp_response_missing_'+item.code);
     item.taken_at=detail.taken_at;
     capture.details.push({pk:detail.pk,code:detail.code,taken_at:detail.taken_at,user:{pk:detail.user.pk,username:detail.user.username},coauthor_producers:item.coauthor_producers,source:'video_detail_response'});
     ingest(rs);
     await page.keyboard.press('Escape');
     await page.waitForURL('https://www.instagram.com/'+username+'/reels/');
     await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'),undefined,{timeout:5000});
     detailOpen=false;
    }
    await save();
   }
   capture.processedPageCount=index+1;await save();
   if(metrics.coverageComplete)return {capture,metrics};
   // More older pages cannot repair identity, ordering, or missing-view errors already observed.
   const hasCollaborations=capture.pages.slice(0,index+1).some(p=>p.items.some(m=>reelAssociation(m,authorId)==='coauthor'));
   const blocking=metrics.issues.filter(issue=>!(hasCollaborations&&issue==='latest_order_unconfirmed'));
   if(blocking.length)throw new Error(blocking[0]);
   if(!capture.latestOrderConfirmed&&!hasCollaborations)throw new Error('latest_order_unconfirmed');
   if(index+1<capture.pages.length)continue;
   if(current.hasNextPage!==true)throw new Error('pagination_state_unknown');
   await page.waitForTimeout(10500);ingest(await readResponses(page));
   for(let attempt=0;attempt<3&&index+1===capture.pages.length;attempt++){
    await page.mouse.move(1000,650);await page.mouse.wheel(0,1600,{label:'处理完本页后加载更多'});
    await page.waitForTimeout(1200);ingest(await readResponses(page));
   }
   if(index+1===capture.pages.length)throw new Error('reels_pagination_stalled');
  }
  throw new Error('reels_page_budget_reached');
 }catch(error){
  if(error.pause||error.storageFailure){controlLost=true;throw error;}
  capture.collectionIssue=error.message;await save();
  if(error.responseErrors){capture.responseErrors=error.responseErrors;capture.responseDataKeys=error.responseDataKeys;await save();}
  if(/control|delegat|ownership/i.test(error.message)){controlLost=true;throw error;}
  return {capture,metrics};
 }finally{
  if(detailOpen&&!controlLost){await page.keyboard.press('Escape');await page.waitForURL('https://www.instagram.com/'+username+'/reels/');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'),undefined,{timeout:5000});}
 }
}
