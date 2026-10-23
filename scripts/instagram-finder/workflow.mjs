export function parseSearchConnection(connection){
 if(!Array.isArray(connection?.edges))throw new Error('invalid_search_connection');
 const items=[],seen=new Set();
 for(const edge of connection.edges){
  for(const media of edge.node?.items||[]){
   const user=media.user||media.owner;
   if(!media.code||!user?.username||seen.has(media.code))continue;
   seen.add(media.code);
   items.push({id:media.pk||media.id,code:media.code,mediaType:media.media_type,authorId:user.pk||user.id,username:user.username,profileUrl:'https://www.instagram.com/'+user.username+'/',videoUrl:'https://www.instagram.com/p/'+media.code+'/',coverUrl:media.image_versions2?.candidates?.[0]?.url||null,caption:typeof media.caption==='string'?media.caption:media.caption?.text||'',takenAt:media.taken_at??null});
  }
 }
 return {items,hasMore:connection.page_info?.has_next_page??null,cursor:connection.page_info?.end_cursor??null};
}

// Processes a frozen response page; it deliberately has no search-page scrolling API.
export async function processSearchPage(args){
 const {page,items,conditions,window,state,onCheckpoint=async()=>{},readers={}}=args;
 if(!Array.isArray(items)||items.some(x=>typeof x.id!=='string'||typeof x.authorId!=='string'||!/^\d+$/.test(x.authorId)||typeof x.username!=='string'||!/^[A-Za-z0-9._]{1,30}$/.test(x.username)||typeof x.code!=='string'||!x.code))throw new Error('invalid_search_item_identity');
 if(conditions&&Object.hasOwn(conditions,'requireEmail'))return processEmailSearchPage(args);
 if(!conditions||Object.keys(conditions).some(k=>!['requireBioEmail','country','minAverageViewsExclusive'].includes(k))||conditions.requireBioEmail!=null&&typeof conditions.requireBioEmail!=='boolean'||conditions.country!=null&&!/^[A-Z]{2}$/.test(conditions.country))throw new Error('invalid_page_conditions');
 const needsMean=conditions.minAverageViewsExclusive!=null;
 if(needsMean&&(!Number.isSafeInteger(conditions.minAverageViewsExclusive)||conditions.minAverageViewsExclusive<0||!Number.isFinite(Date.parse(window?.windowStart))||!Number.isFinite(Date.parse(window?.windowEndExclusive))||Date.parse(window.windowStart)>=Date.parse(window.windowEndExclusive)))throw new Error('invalid_fixed_metrics_window');
 const config={requireBioEmail:conditions.requireBioEmail===true,country:conditions.country??null,minAverageViewsExclusive:conditions.minAverageViewsExclusive??null,window:needsMean?window:null};
 const key=JSON.stringify({config,items:items.map(x=>[x.id,x.code,x.authorId,x.username,x.mediaType])});
 if(state?.key!==undefined&&state.key!==key)throw new Error('resume_input_mismatch');
 const result=state?structuredClone(state):{key,config,status:'in_progress',nextItemIndex:0,items:items.map(x=>({...x,status:'pending'})),authors:{}};
 const save=async()=>{result.updatedAt=new Date().toISOString();await onCheckpoint(structuredClone(result));};
 if(!config.requireBioEmail&&!config.country&&!needsMean){result.status='not_requested';await save();return result;}
 if(result.status==='completed')return result;
 result.status='in_progress';delete result.reason;await save();
 for(let index=result.nextItemIndex;index<result.items.length;index++){
  const item=result.items[index];
  if(item.mediaType!==2){item.status='not_video';result.nextItemIndex=index+1;await save();continue;}
  let author=result.authors[item.authorId];
  if(author&&author.firstItemIndex!==index){item.status='duplicate_author';item.duplicateOf=author.firstItemIndex;result.nextItemIndex=index+1;await save();continue;}
  if(!author){author={authorId:item.authorId,username:item.username,profileUrl:'https://www.instagram.com/'+item.username+'/',firstItemIndex:index,status:'in_progress',checks:{}};result.authors[item.authorId]=author;}
  const finish=async(status,reason)=>{author.status=status;author.reason=reason;item.status='processed';result.nextItemIndex=index+1;await save();};
  const pause=async data=>{if(data?.status!=='paused'&&data?.reason!=='existing_dialog')return false;result.status='paused';result.reason=data.reason;await save();return true;};
  await save();
  try{
   if(config.requireBioEmail){
    if(!author.profile||author.profile.status==='paused'||author.profile.reason==='existing_dialog'){
     const read=readers.profile||(await import('./profile.mjs')).readProfile;
     author.profile=await read({page,username:item.username});await save();
    }
    if(await pause(author.profile))return result;
    if(author.profile.authorId&&author.profile.authorId!==item.authorId){await finish('pending_review','profile_author_id_mismatch');continue;}
    if(typeof author.profile.biography!=='string'||!Array.isArray(author.profile.emails)){await finish('pending_review','bio_unavailable');continue;}
    author.checks.bioEmail=author.profile.emails.length>0;
    if(!author.checks.bioEmail){await finish('rejected','no_public_bio_email');continue;}
   }
   if(config.country){
    if(!author.country||author.country.status==='paused'||author.country.reason==='existing_dialog'){
     const read=readers.country||(await import('./region.mjs')).readAccountCountry;
     // On resume the browser may be elsewhere; only reuse a profile opened this invocation.
     const current=page?.url?await page.url():null;
     author.country=await read({page,username:item.username,navigate:current!==author.profileUrl});await save();
    }
    if(await pause(author.country))return result;
    if(author.country.status!=='observed'||!author.country.countryCode){await finish('pending_review','country_unknown');continue;}
    author.checks.country=author.country.countryCode===config.country;
    if(!author.checks.country){await finish('rejected','country_mismatch');continue;}
   }
   if(needsMean){
    const read=readers.averageViews||(await import('./reels.mjs')).collectReels;
    author.averageViews=await read({page,username:item.username,authorId:item.authorId,config:{...window,minAverageViewsExclusive:config.minAverageViewsExclusive},cachedCapture:author.averageViews?.capture,onCheckpoint:async progress=>{author.averageViews=progress;await save();}});await save();
    const issue=author.averageViews.capture?.collectionIssue||'';
    if(/instagram_access_stopped_|instagram_login_or_challenge/.test(issue)){result.status='paused';result.reason=issue;await save();return result;}
    if(!author.averageViews.metrics?.coverageComplete){await finish('pending_review',issue||'metrics_incomplete');continue;}
    author.checks.averageViews=author.averageViews.metrics.passesThreshold;
    if(author.checks.averageViews!==true){await finish('rejected','average_views_not_above_threshold');continue;}
   }
   author.contentReview={status:'pending',sourceVideoUrl:item.videoUrl,caption:item.caption,reason:'keyword_hit_alone_does_not_verify_christian_comedy_or_skits'};
   await finish('core_pass_pending_content_review','content_requires_review');
  }catch(error){
   result.status='paused';result.reason=error.message;await save();
   if(/control|delegat|ownership/i.test(error.message))throw error;
   return result;
  }
 }
 result.status='completed';await save();return result;
}

async function processEmailSearchPage({items,conditions,window,state,onCheckpoint=async()=>{},...args}){
 const {verifyCreator,verificationConfig}=await import('./verification.mjs');
 const config=verificationConfig(conditions,window),key=JSON.stringify({mode:'email_v1',config,items:items.map(x=>[x.id,x.code,x.authorId,x.username,x.mediaType])});
 if(state&&state.key!==key)throw Error('resume_input_mismatch');
 const result=state?structuredClone(state):{key,config,status:'in_progress',nextItemIndex:0,items:items.map(x=>({...x,status:'pending'})),authors:{}};
 const save=async()=>{result.updatedAt=new Date().toISOString();await onCheckpoint(structuredClone(result));};
 if(result.status==='completed')return result;
 result.status='in_progress';delete result.reason;await save();
 for(let index=result.nextItemIndex;index<result.items.length;index++){
  const item=result.items[index];
  if(item.mediaType!==2){item.status='not_video';result.nextItemIndex=index+1;await save();continue;}
  let author=result.authors[item.authorId];
  if(author&&author.firstItemIndex!==index){item.status='duplicate_author';result.nextItemIndex=index+1;await save();continue;}
  author??={authorId:item.authorId,username:item.username,profileUrl:`https://www.instagram.com/${item.username}/`,firstItemIndex:index};result.authors[item.authorId]=author;
  author.verification=await verifyCreator({...args,conditions,window,username:item.username,authorId:item.authorId,runDir:args.runDir?`${args.runDir}/authors/${item.authorId}`:null,state:author.verification,
   onCheckpoint:async value=>{author.verification=value;await save();}});
  author.checks=author.verification.checks;author.email=author.verification.data.email;author.country=author.verification.data.country;author.averageViews=author.verification.data.averageViews;
  if(author.verification.status==='paused'){result.status='paused';result.reason=author.verification.reason;await save();return result;}
  author.status=author.verification.status==='pending_review'||author.verification.matches===null?'pending_review':author.verification.matches===false?'rejected':'core_pass_pending_content_review';
  author.reason=author.verification.reason||(author.status==='rejected'?'requested_conditions_failed':author.status==='pending_review'?'requested_conditions_unknown':'content_requires_review');
  author.contentReview={status:'pending',sourceVideoUrl:item.videoUrl,caption:item.caption,reason:'keyword_hit_alone_does_not_verify_content'};
  item.status='processed';result.nextItemIndex=index+1;await save();
 }
 result.status='completed';await save();return result;
}
