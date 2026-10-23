// Only explicitly requested conditions load and execute their collectors.
export async function collectCreator(args){
 const {page,username,authorId,conditions={},window,onCheckpoint=async()=>{},readers={}}=args;
 if(Object.hasOwn(conditions,'requireEmail'))return (await import('./verification.mjs')).verifyCreator(args);
 if(typeof username!=='string'||!/^[A-Za-z0-9._]{1,30}$/.test(username))throw new Error('invalid_instagram_username');
 if(!conditions||typeof conditions!=='object'||Array.isArray(conditions)||Object.keys(conditions).some(k=>!['country','hasThreads','minAverageViewsExclusive','requireBioEmail'].includes(k)))throw new Error('unsupported_conditions');
 if(conditions.country!=null&&(typeof conditions.country!=='string'||!/^[A-Z]{2}$/.test(conditions.country)))throw new Error('invalid_country_condition');
 if(conditions.hasThreads!=null&&typeof conditions.hasThreads!=='boolean')throw new Error('invalid_threads_condition');
 if(conditions.requireBioEmail!=null&&typeof conditions.requireBioEmail!=='boolean')throw new Error('invalid_bio_email_condition');
 const needsMean=conditions.minAverageViewsExclusive!=null;
 if(needsMean&&(!Number.isSafeInteger(conditions.minAverageViewsExclusive)||conditions.minAverageViewsExclusive<0||typeof authorId!=='string'||!/^\d+$/.test(authorId)||!Number.isFinite(Date.parse(window?.windowStart))||!Number.isFinite(Date.parse(window?.windowEndExclusive))||Date.parse(window.windowStart)>=Date.parse(window.windowEndExclusive)))throw new Error('invalid_metrics_condition_or_fixed_window');
 const result={username,status:conditions.requireBioEmail===true||conditions.hasThreads===true||conditions.country||needsMean?'in_progress':'not_requested',data:{},checks:{},matches:null};
 let profileReady=false;
 const save=async()=>{
  const checks=Object.values(result.checks);
  result.matches=checks.includes(false)?false:checks.length&&checks.every(x=>x===true)?true:null;
  await onCheckpoint(structuredClone(result));
 };
 const paused=async data=>{if(data?.status!=='paused')return false;result.status='paused';result.reason=data.reason;await save();return true;};
 if(conditions.requireBioEmail===true){
  const read=readers.profile||(await import('./profile.mjs')).readProfile;
  const data=await read({page,username,navigate:!profileReady});result.data.profile=data;
  result.checks.bioEmail=typeof data.biography==='string'&&Array.isArray(data.emails)?data.emails.length>0:null;
  if(await paused(data))return result;
  profileReady=['observed','partial'].includes(data.status);await save();
 }
 if(conditions.hasThreads===true){
  const read=readers.threads||(await import('./threads.mjs')).readThreadsAccount;
  const data=await read({page,username,navigate:!profileReady});result.data.threads=data;
  result.checks.threads=data.status==='observed'&&data.hasThreads===true?true:null;
  if(await paused(data))return result;
  profileReady=['observed','not_observed'].includes(data.status);await save();
 }
 if(conditions.country){
  const read=readers.country||(await import('./region.mjs')).readAccountCountry;
  const data=await read({page,username,navigate:!profileReady});result.data.country=data;
  result.checks.country=data.status==='observed'&&data.countryCode?data.countryCode===conditions.country:null;
  if(await paused(data))return result;
  profileReady=data.status==='observed';await save();
 }
 if(needsMean){
  const read=readers.averageViews||(await import('./reels.mjs')).collectReels;
  const data=await read({page,username,authorId,config:{...window,minAverageViewsExclusive:conditions.minAverageViewsExclusive},onCheckpoint:async progress=>{result.data.averageViews=progress;await save();}});
  result.data.averageViews=data;
  result.checks.averageViews=data.metrics?.coverageComplete?data.metrics.passesThreshold:null;
  if(/instagram_access_stopped_|instagram_login_or_challenge/.test(data.capture?.collectionIssue||'')){result.status='paused';result.reason=data.capture.collectionIssue;}
  await save();
 }
 if(result.status==='in_progress'){result.status='completed';await save();}
 return result;
}
