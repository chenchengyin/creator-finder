import {join} from 'node:path';
import {findProfileEmail} from '../profile-email-finder/integration.mjs';
import {readProfile} from './profile.mjs';
import {readAccountCountry} from './region.mjs';
import {readThreadsAccount} from './threads.mjs';
import {collectReels} from './reels.mjs';

export function verificationConfig(conditions={},window){
 const allowed=['requireEmail','country','countries','hasThreads','minAverageViewsExclusive'];
 if(!conditions||typeof conditions!=='object'||Array.isArray(conditions)||Object.keys(conditions).some(k=>!allowed.includes(k))||
  conditions.requireEmail!=null&&typeof conditions.requireEmail!=='boolean'||conditions.hasThreads!=null&&typeof conditions.hasThreads!=='boolean'||
  conditions.country!=null&&!/^[A-Z]{2}$/.test(conditions.country))throw Error('invalid_verification_conditions');
 if(conditions.countries!==undefined&&(!Array.isArray(conditions.countries)||!conditions.countries.length||conditions.countries.some(c=>typeof c!=='string'||!/^[A-Z]{2}$/.test(c))||conditions.country!=null))throw Error('invalid_country_conditions');
 const mean=conditions.minAverageViewsExclusive;
 if(mean!=null&&(!Number.isSafeInteger(mean)||mean<0||!Number.isFinite(Date.parse(window?.windowStart))||!Number.isFinite(Date.parse(window?.windowEndExclusive))||Date.parse(window.windowStart)>=Date.parse(window.windowEndExclusive)))throw Error('invalid_fixed_metrics_window');
 return {requireEmail:conditions.requireEmail===true,country:conditions.country??null,...(conditions.countries?{countries:[...new Set(conditions.countries)].sort()}:{}),hasThreads:conditions.hasThreads===true,minAverageViewsExclusive:mean??null,window:mean!=null?window:null};
}

export async function verifyCreator({page,username,authorId,conditions,window,runDir,state,readers={},onCheckpoint=async()=>{},spaceId,emailLimits={},context=()=>{},assertHealthy=()=>{}}){
 if(!/^[A-Za-z0-9._]{1,30}$/.test(username)||typeof authorId!=='string'||!/^\d+$/.test(authorId))throw Error('invalid_profile_identity');
 const config=verificationConfig(conditions,window),key=JSON.stringify({username,authorId,config});
 if(config.requireEmail&&!runDir)throw Error('email_run_dir_required');
 if(state&&state.key!==key)throw Error('resume_input_mismatch');
 const result=state?structuredClone(state):{key,username,authorId,status:'in_progress',data:{},checks:{},matches:null};
 const save=async()=>{
  assertHealthy();
  const values=Object.values(result.checks);result.matches=values.includes(false)?false:values.length&&values.every(v=>v===true)?true:null;
  result.updatedAt=new Date().toISOString();await onCheckpoint(structuredClone(result));
 };
 const pause=async(data,stage)=>{
  const issue=data?.capture?.collectionIssue||'';
  if(data?.status!=='paused'&&data?.completion!=='paused'&&data?.reason!=='existing_dialog'&&!/instagram_access_stopped_|instagram_login_or_challenge/.test(issue))return false;
  result.status='paused';result.stage=stage;result.reason=data.error||data.reason||issue||'email_paused';await save();return true;
 };
 const reusable=data=>data&&data.status!=='paused'&&!['paused','failed'].includes(data.completion)&&data.reason!=='existing_dialog';
 if(result.status==='completed'||result.status==='pending_review')return result;
 result.status='in_progress';delete result.reason;await save();
 if(!config.requireEmail&&!config.country&&!config.countries?.length&&!config.hasThreads&&config.minAverageViewsExclusive===null){result.status='not_requested';await save();return result;}
 if(config.requireEmail){
  context({username,authorId,stage:'profile'});
  if(!reusable(result.data.profile)){result.data.profile=await (readers.profile||readProfile)({page,username,stopOnBioEmail:true});await save();}
  const profile=result.data.profile;
  if(await pause(profile,'profile'))return result;
  if(profile.authorId&&profile.authorId!==authorId||/identity_mismatch|url_mismatch/.test(profile.reason||'')){
   result.status='pending_review';result.reason='profile_author_id_mismatch';await save();return result;
  }
  context({username,authorId,stage:'email'});
  if(!reusable(result.data.email)){
   result.data.email=await (readers.email||findProfileEmail)({page,profile:{...profile,username,profileUrl:`https://www.instagram.com/${username}/`},runDir:join(runDir,'email'),spaceId,limits:emailLimits});await save();
  }
  result.checks.email=result.data.email.matches??null;
  if(result.data.email.completion==='failed')throw Error('email_failed: '+(result.data.email.error||'unknown_failure'));
  if(await pause(result.data.email,'email'))return result;
  await save();
  if(result.checks.email===false&&profile.status==='observed'&&typeof profile.biography==='string'&&profile.linksComplete===true&&Array.isArray(profile.links)&&profile.links.length===0){
   result.status='completed';result.reason='no_email_or_profile_links';delete result.stage;await save();return result;
  }
 }
 for(const [enabled,stage,reader,check] of [
  [config.hasThreads,'threads',readers.threads||readThreadsAccount,d=>d.status==='observed'&&d.hasThreads===true?true:null],
  [config.country||config.countries?.length,'country',readers.country||readAccountCountry,d=>d.status==='observed'&&d.countryCode?(config.countries||[config.country]).includes(d.countryCode):null],
 ]){
  if(!enabled)continue;
  context({username,authorId,stage});
  if(!reusable(result.data[stage])){
   const profileUrl=`https://www.instagram.com/${username}/`,current=page?.url?await page.url():null;
   result.data[stage]=await reader({page,username,navigate:current!==profileUrl});await save();
  }
  if(await pause(result.data[stage],stage))return result;
  result.checks[stage]=check(result.data[stage]);await save();
 }
 if(config.minAverageViewsExclusive!==null){
  context({username,authorId,stage:'averageViews'});
  if(!result.data.averageViews?.metrics?.coverageComplete){
   result.data.averageViews=await (readers.averageViews||collectReels)({page,username,authorId,config:{...window,minAverageViewsExclusive:config.minAverageViewsExclusive},cachedCapture:result.data.averageViews?.capture,
    onCheckpoint:async data=>{result.data.averageViews=data;await save();}});await save();
  }
  if(await pause(result.data.averageViews,'averageViews'))return result;
  result.checks.averageViews=result.data.averageViews.metrics?.coverageComplete?result.data.averageViews.metrics.passesThreshold:null;await save();
 }
 result.status='completed';delete result.stage;await save();return result;
}
