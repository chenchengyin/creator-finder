import {analyzePosts} from '../tiktok-finder/profile.mjs';

export function freezeWindow(now=new Date().toISOString(),days=10){
 if(!Number.isInteger(days)||days<1||!Number.isFinite(Date.parse(now)))throw new Error('invalid_window');
 const day=new Date(Date.parse(now)+8*3600000).toISOString().slice(0,10);
 const end=Date.parse(day+'T00:00:00+08:00');
 return {windowStart:new Date(end-days*86400000+8*3600000).toISOString().slice(0,10)+'T00:00:00+08:00',windowEndExclusive:day+'T00:00:00+08:00'};
}

export function clipsPage(payload,status=200){
 const user=payload.data?.fetch__XDTUserDict,connection=user?.clips_connection;
 if(!Array.isArray(connection?.edges))return null;
 return {status,profileId:user.id,hasNextPage:connection.page_info?.has_next_page,cursor:connection.page_info?.end_cursor,items:connection.edges.map(edge=>edge.node?.media).filter(Boolean)};
}

export function detailMedia(payload,code,authorId){
 const found=[];
 function visit(value){
  if(!value||typeof value!=='object')return;
  if(value.code===code&&value.user?.pk===authorId&&Number.isSafeInteger(value.taken_at))found.push(value);
  for(const child of Object.values(value))visit(child);
 }
 visit(payload);
 return found[0]||null;
}

// Membership must come from the native author IDs, never from list placement alone.
export function reelAssociation(media,authorId){
 if(media.user?.pk===authorId)return 'owner';
 if(Array.isArray(media.coauthor_producers)&&media.coauthor_producers.some(user=>(user.pk??user.id)===authorId))return 'coauthor';
 return null;
}

export function analyzeReels(capture,config){
 if(!Number.isFinite(Date.parse(config.windowStart))||!Number.isFinite(Date.parse(config.windowEndExclusive))||Date.parse(config.windowStart)>=Date.parse(config.windowEndExclusive)||!Number.isSafeInteger(config.minAverageViewsExclusive)||config.minAverageViewsExclusive<0)throw new Error('invalid_metrics_config');
 const pages=Number.isInteger(capture.processedPageCount)?(capture.pages||[]).slice(0,capture.processedPageCount):capture.pages||[];
 const hasCollaborations=pages.some(p=>p.items.some(m=>reelAssociation(m,capture.authorId)==='coauthor'));
 const exhausted=pages.at(-1)?.hasNextPage===false;
 const normalized={profile:{authorId:capture.authorId,username:capture.username,capturedAt:capture.capturedAt,latestOrderConfirmed:capture.latestOrderConfirmed||(hasCollaborations&&exhausted)},pages:pages.map(page=>({statusCode:page.status===200?0:page.status||-1,hasMore:page.hasNextPage,items:page.items.map(m=>{
  const attribution=reelAssociation(m,capture.authorId);
  return {id:m.pk,authorId:attribution?capture.authorId:m.user?.pk,username:attribution?capture.username:m.user?.username,originalAuthorId:m.user?.pk,originalUsername:m.user?.username,attribution,coauthorIds:(m.coauthor_producers||[]).map(u=>u.pk??u.id),chronologyExempt:attribution==='coauthor'&&!capture.collaborationOrderConfirmed,createdAt:m.taken_at,views:m.play_count,pinned:Array.isArray(m.clips_tab_pinned_user_ids)?m.clips_tab_pinned_user_ids.includes(capture.authorId):null,mediaType:m.media_type===2?'video':'photo',url:'https://www.instagram.com/reel/'+m.code+'/',capturedAt:m.capturedAt||capture.capturedAt};
 })}))};
 const result=analyzePosts(normalized,config);
 const issues=[...result.issues];
 if(pages.some(p=>p.items.some(m=>!Array.isArray(m.clips_tab_pinned_user_ids))))issues.push('pin_status_unknown');
 if(capture.collectionIssue)issues.push(capture.collectionIssue);
 // Coauthor insertion order is not guaranteed to match original publication time.
 // Without verified full-list chronology, exhaustion is needed to rule out missed samples.
 const complete=result.coverageComplete&&issues.length===0&&(!hasCollaborations||capture.collaborationOrderConfirmed||exhausted);
 return {...result,issues:[...new Set(issues)],coverageComplete:complete,coverageBasis:complete?(exhausted?'native_list_exhausted':hasCollaborations?'verified_full_video_window_boundary':'verified_owned_video_window_boundary'):null,totalViews:complete?result.totalViews:null,averageViews:complete?result.averageViews:null,passesThreshold:complete&&result.sampleSize>0?result.averageViews>config.minAverageViewsExclusive:null,viewField:'play_count',collaborationPolicy:'count_explicit_native_coauthors'};
}
