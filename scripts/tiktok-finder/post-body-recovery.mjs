export function recoverPostBodies(browser,{save,log}){
 const ensure=browser.ensureProfile.bind(browser),next=browser.nextPosts.bind(browser);
 const replay=async(candidate,capture)=>{
  if(capture.postBodyReplay?.attempts>=1)throw Object.assign(Error('post_body_recovery_exhausted'),{pause:true});
  capture.postBodyReplay={attempts:1,startedAt:new Date().toISOString(),reason:'response_body_unavailable',previousPages:structuredClone(capture.pages||[]),previousAccess:structuredClone(capture.access||{})};
  capture.pages=[];capture.postAttemptComplete=false;
  capture.access={...capture.access};delete capture.access.partialBodies;delete capture.access.bodyReadFailure;
  await save(candidate,capture);await log({event:'post_body_replay_start',username:candidate.username,archivedPages:capture.postBodyReplay.previousPages.length});
  const fresh=await browser.readProfile(candidate,async checkpoint=>{if(checkpoint.profile)capture.profile=checkpoint.profile;capture.access=checkpoint;await save(candidate,capture);},capture.access);
  capture.profile=fresh.profile;capture.pages=fresh.pages;capture.postAttemptComplete=fresh.postAttemptComplete;
  capture.postBodyReplay.completedAt=new Date().toISOString();await save(candidate,capture);
  await log({event:'post_body_replay_done',username:candidate.username,initialPages:capture.pages.length});
 };
 browser.ensureProfile=async(candidate,capture)=>{
  if(Object.hasOwn(capture.access||{},'partialBodies')){await replay(candidate,capture);return {pages:[]};}
  return ensure(candidate,capture);
 };
 browser.nextPosts=async(candidate,capture,onCheckpoint)=>{
  try{return await next(candidate,capture,onCheckpoint);}
  catch(error){
   if(error.message!=='response_body_unavailable')throw error;
   await replay(candidate,capture);
   const recovered=[];recovered.restarted=true;return recovered;
  }
 };
 return browser;
}
