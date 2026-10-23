import {isControlError} from '../tiktok-browser/access.mjs';
const emailPattern=/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+/gi;
const hasEmail=text=>Boolean(String(text||'').match(new RegExp(emailPattern.source,'gi'))?.length);
// shortcut: recognizes visible suffix ellipses only; silent truncation cannot be detected without checking the profile.
const visiblyTruncated=text=>/(?:\.{3,}|…|⋯|﹒﹒﹒)\s*$/u.test(String(text||'').trim());
const exactId=value=>typeof value==='string'&&/^\d+$/.test(value);
const integer=value=>typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;
const profileRoute=(url,username)=>{try{const u=new URL(url);return u.protocol==='https:'&&['www.tiktok.com','tiktok.com'].includes(u.hostname)&&u.pathname.replace(/\/$/,'').toLowerCase()==='/@'+username.toLowerCase();}catch{return false;}};
export function analyzePosts(capture,config){
 const profile=capture.profile||{},pages=capture.pages||[],byId=new Map(),issues=[];
 if(!profile.latestOrderConfirmed)issues.push('latest_order_unconfirmed');
 if(!pages.length||pages.some(p=>p.statusCode!==0))issues.push('post_response_incomplete');
 const captured=Date.parse(profile.capturedAt)/1000;
 for(const raw of pages.flatMap(p=>p.items||[])){
  const item={...raw,views:integer(raw.views)};
  if(!exactId(item.id)||item.authorId!==profile.authorId||item.username?.toLowerCase()!==profile.username?.toLowerCase())issues.push('post_identity_mismatch');
  if(!Number.isSafeInteger(item.createdAt)||item.createdAt<=0||!Number.isFinite(captured)||item.createdAt>captured+300)issues.push('invalid_post_timestamp');
  const old=byId.get(item.id);
  if(old&&(old.createdAt!==item.createdAt||old.authorId!==item.authorId))issues.push('conflicting_duplicate_video');
  if(!old||Date.parse(item.capturedAt||profile.capturedAt)>=Date.parse(old.capturedAt||profile.capturedAt))byId.set(item.id,item);
 }
 const items=[...byId.values()],unpinned=items.filter(i=>!i.pinned&&!i.chronologyExempt),start=Date.parse(config.windowStart)/1000,end=Date.parse(config.windowEndExclusive)/1000;
 if(unpinned.some((i,n)=>n&&i.createdAt>unpinned[n-1].createdAt))issues.push('post_order_invalid');
 const coverageComplete=issues.length===0&&(unpinned.some(i=>i.createdAt<start)||[false,0].includes(pages.at(-1)?.hasMore));
 const sample=items.filter(i=>!i.privateItem&&i.mediaType!=='photo'&&!/\/@[^/]+\/photo\//.test(i.url||'')&&i.createdAt>=start&&i.createdAt<end);
 if(sample.some(i=>!Number.isSafeInteger(i.views)||i.views<0))issues.push('views_missing_or_invalid');
 const complete=coverageComplete&&issues.length===0;
 const total=complete?sample.reduce((n,i)=>n+i.views,0):null;
 if(total!==null&&!Number.isSafeInteger(total))issues.push('views_total_out_of_range');
 return {items,sample,sampleSize:sample.length,totalViews:issues.length?null:total,averageViews:complete&&sample.length&&issues.length===0?total/sample.length:null,coverageComplete:complete&&issues.length===0,issues,windowStart:config.windowStart,windowEndExclusive:config.windowEndExclusive};
}
function contentEvidence(candidate,capture,config){
 const profile=capture.profile,knownId=profile.authorId;
 const evidence=[{source:'profile_bio',text:profile.bio||'',url:profile.profileUrl,capturedAt:profile.capturedAt},...(profile.playlists||[]).map(p=>({source:'creator_playlist',text:p.text,url:p.url})),...(capture.pages||[]).flatMap(p=>p.items||[]).filter(i=>i.authorId===knownId).map(i=>({source:'creator_video_description',text:i.description||'',url:i.url,publishedAt:Number.isFinite(i.createdAt)?new Date(i.createdAt*1000).toISOString():null})),...(candidate.sourceEvidence||[]).filter(e=>e.authorId===knownId).map(e=>({...e,url:e.videoUrl||e.url,source:'tiktok_native_video_search'}))];
 const topic=/christian|bible|church|jesus|christiantiktok/i,form=/skit|comed|humou?r|funny|prank/i;
 const matches=evidence.filter(e=>e.text&&config.keywords.some(keyword=>{
  const needsTopic=topic.test(keyword),needsForm=form.test(keyword);
  return (!needsTopic||topic.test(e.text))&&(!needsForm||form.test(e.text))&&((needsTopic||needsForm)||e.text.toLowerCase().includes(keyword.toLowerCase()));
 }));
 const support=matches.length?matches:evidence.filter(e=>e.text&&(topic.test(e.text)||form.test(e.text)||config.keywords.some(k=>e.text.toLowerCase().includes(k.toLowerCase()))));
 return {decision:matches.length?'passed':'suspected',evidence:support,uncertainty:matches.length?null:'公开原文尚不足以同时确认目标主题与内容形式，待人工复核'};
}
export function evaluateCapture({candidate,capture,config}){
 const p=capture.profile||{},metrics=analyzePosts(capture,config),emails=[...new Set((p.bio||'').match(emailPattern)||[])];
 const content=contentEvidence(candidate,{...capture,profile:p},config);
 const knownAlias=candidate.authorIdHint===p.authorId&&(candidate.aliases||[]).some(alias=>alias.toLowerCase()===p.username?.toLowerCase());
 const result={authorId:p.authorId,username:knownAlias?candidate.username:p.username||candidate.username,profileUrl:knownAlias?'https://www.tiktok.com/@'+candidate.username:p.profileUrl,profile:p,emails,profileCapturedAt:p.capturedAt,metrics,content,capture,sourceKeywords:[...new Set((candidate.sourceEvidence||[]).map(e=>e.keyword).filter(Boolean))],decision:'data_incomplete',reason:null,location:{country:null,evidence:[],semantics:'video_region_field_not_verified_creator_residence'}};
 const finish=(decision,reason)=>{result.decision=decision;result.reason=reason;result.inclusionBasis=[`内容：${content.evidence.map(e=>`${e.publishedAt||''} ${e.text}（${e.url||''}）`).join('；')||'方向证据不足'}${content.uncertainty?'；'+content.uncertainty:''}。`,`邮箱：${emails.join('；')||'未取得公开Bio邮箱'}；来源 ${p.profileUrl||''}，采集 ${p.capturedAt||'未核验'}。`,`主页挂链：${p.externalLink?.status??'unknown'}；${p.externalLink?.url||'未取得可用网址'}；仅记录公开挂链，不作为Bio邮箱。`,`播放：${config.windowStart} 至 ${config.windowEndExclusive}（结束不含），${metrics.sampleSize}条视频，算术均播${metrics.averageViews??'未知'}，须严格大于${config.minAverageViewsExclusive}；覆盖${metrics.coverageComplete?'完整':'未完成'}。`,`地区：${result.location.country?'最新公开视频locationCreated='+result.location.country:'未核验'}；字段不证明本人现居地。`,`判定：${decision}；${reason}。`].join('\n');return result;};
 if(!p.ready||!p.identityVerified||!exactId(p.authorId)||!profileRoute(p.profileUrl,p.username||'')||(candidate.authorIdHint&&candidate.authorIdHint!==p.authorId)||(!knownAlias&&p.username?.toLowerCase()!==candidate.username?.toLowerCase())||p.privateAccount){result.authorId=candidate.authorIdHint||null;result.username=candidate.username;return finish('data_incomplete','profile_not_verified_public');}
 if(config.requireBioEmail&&!emails.length)return finish('rejected','no_profile_bio_email');
 if(!metrics.coverageComplete)return finish('data_incomplete',metrics.issues.join(';')||'window_coverage_incomplete');
 if(!metrics.sampleSize)return finish('rejected','no_eligible_videos');
 if(!(metrics.averageViews>config.minAverageViewsExclusive))return finish('rejected','average_views_not_above_threshold');
 const latest=metrics.items.filter(i=>!i.privateItem&&i.mediaType!=='photo'&&!/\/photo\//.test(i.url||'')).sort((a,b)=>b.createdAt-a.createdAt||b.id.localeCompare(a.id))[0];
 if(latest){
  let code=latest.locationCreated,evidence=[];
  if(typeof code==='string'&&/^[A-Za-z]{2}$/.test(code)&&!['ZZ','XX'].includes(code.toUpperCase()))evidence=[{videoId:latest.id,authorId:p.authorId,rawValue:code,videoUrl:latest.url,capturedAt:latest.capturedAt||p.capturedAt,fieldPath:'itemList[].locationCreated'}];
  else{const observation=(capture.videoRegion?.observations||[]).find(o=>o.videoId===latest.id&&o.authorId===p.authorId&&o.status==='observed'&&Date.parse(o.publishedAt)===latest.createdAt*1000);code=observation?.regionCode;if(observation)evidence=[observation];}
  if(evidence.length)result.location={...result.location,country:code.toUpperCase(),evidence};
 }
 if(config.country&&!result.location.country)return finish('data_incomplete','latest_video_region_unverified');
 if(config.country&&result.location.country!==config.country)return finish('rejected','latest_video_region_not_target');
 return finish(content.decision==='passed'?'confirmed':'suspected',content.decision==='passed'?'all_conditions_verified':'content_requires_human_review');
}
export const sameVerificationContext=(capture,context)=>!!context&&capture?.verificationContext?.runId===context.runId&&capture?.verificationContext?.criteria===context.criteria;
export const basicProfileComplete=capture=>capture?.profile?.ready===true&&capture.profile.identityVerified===true&&!capture.profile.privateAccount&&['present','none'].includes(capture.profile.externalLink?.status);
export async function qualifyCandidate({candidate,config,browser,cachedCapture,forceProfile=false,verificationContext,onCheckpoint=async()=>{}}){
 let capture=structuredClone(cachedCapture||{});
 const staleContext=verificationContext&&!sameVerificationContext(capture,verificationContext);
 if(staleContext)capture={access:capture.access};
 else if(forceProfile&&!basicProfileComplete(capture))capture={access:capture.access,videoRegion:capture.videoRegion,postBodyReplay:capture.postBodyReplay};
 if(verificationContext)capture.verificationContext=structuredClone(verificationContext);
 const save=async()=>onCheckpoint(structuredClone(capture));
 const hint=typeof candidate.bioHint==='string'?candidate.bioHint.trim():'';
 if(!forceProfile&&!(verificationContext&&capture.profile?.identityVerified)&&config.requireBioEmail&&!hasEmail(capture.profile?.bio)&&!hasEmail(hint)&&!visiblyTruncated(hint))return {authorId:candidate.authorIdHint||null,username:candidate.username,profileUrl:'https://www.tiktok.com/@'+candidate.username,profile:null,bioHint:candidate.bioHint??null,emails:[],profileCapturedAt:null,metrics:{sampleSize:null,totalViews:null,averageViews:null,coverageComplete:false,issues:['profile_not_visited']},content:{decision:'not_evaluated',evidence:[],uncertainty:'邮箱条件未通过，未访问主页'},capture:null,sourceKeywords:[...new Set((candidate.sourceEvidence||[]).map(e=>e.keyword).filter(Boolean))],decision:'rejected',reason:'no_search_bio_email',emailCheck:{source:'search_author_signature',status:hint?'skipped_no_email_hint':'skipped_empty_signature'},inclusionBasis:`邮箱：搜索结果简介${hint?'未发现邮箱，且没有结尾省略标记':'为空'}；未访问主页，按必备邮箱条件提前排除。搜索签名可能存在无标记截断，未对该账号的主页Bio作核验。`};
 if(!capture.profile?.ready||!capture.profile?.identityVerified||(!capture.pages?.length&&!capture.postAttemptComplete)){capture={...capture,...await browser.readProfile(candidate,async checkpoint=>{if(checkpoint.profile)capture.profile=checkpoint.profile;capture.access=checkpoint;await save();},capture.access)};await save();}
 let result=evaluateCapture({candidate,capture,config});
 capture.checks={identity:result.reason==='profile_not_verified_public'?'pending':'completed',email:result.reason==='profile_not_verified_public'?'pending':'completed',posts:result.metrics.coverageComplete?'completed':'in_progress',metrics:result.metrics.coverageComplete?'completed':'pending',content:result.content.decision,region:result.location.country?'completed':config.country?'pending':'not_required'};
 capture.nextAction=result.metrics.coverageComplete?'decision':'posts';await save();
 if(result.reason==='profile_not_verified_public'||result.reason==='no_profile_bio_email')return result;
 if(!result.metrics.coverageComplete&&!(result.metrics.issues.length)){
  if(cachedCapture?.profile&&browser.ensureProfile){const restored=await browser.ensureProfile(candidate,capture);if(restored?.pages){capture.pages.push(...restored.pages);await save();result=evaluateCapture({candidate,capture,config});}}
  let previousIds=new Set(result.metrics.items.map(i=>i.id));
  while(!result.metrics.coverageComplete&&result.metrics.issues.length===0){
   const oldCursor=capture.pages.at(-1)?.cursor;
   const next=await browser.nextPosts(candidate,capture,async checkpoint=>{capture.access=checkpoint;await save();});
   capture.pages.push(...(Array.isArray(next)?next:[next]));await save();
   result=evaluateCapture({candidate,capture,config});
   const newIds=new Set(result.metrics.items.map(i=>i.id));
   const cursor=capture.pages.at(-1)?.cursor;
   if(!result.metrics.coverageComplete&&newIds.size===previousIds.size&&cursor===oldCursor){if(!next.restarted||capture.replayCursor===cursor)return {...result,decision:'data_incomplete',reason:'post_progress_stalled'};capture.replayCursor=cursor;await save();}
   previousIds=newIds;
  }
 }
 capture.checks.posts=result.metrics.coverageComplete?'completed':'incomplete';capture.checks.metrics=result.metrics.coverageComplete?'completed':'pending';
 capture.checks.metricsSummary={sampleSize:result.metrics.sampleSize,averageViews:result.metrics.averageViews,windowStart:config.windowStart,windowEndExclusive:config.windowEndExclusive};await save();
 if(config.country&&result.reason==='latest_video_region_unverified'&&!capture.regionChecked){
  capture.nextAction='region';await save();
  try{capture.videoRegion=await browser.collectRegion(capture,async report=>{capture.videoRegion=report;await save();});}
  catch(error){if(isControlError(error)||error.pause)throw error;capture.regionError=error.message;}
  capture.regionChecked=true;capture.nextAction='decision';result=evaluateCapture({candidate,capture,config});capture.checks.region=result.location.country?'completed':'incomplete';await save();
 }
 return result;
}
