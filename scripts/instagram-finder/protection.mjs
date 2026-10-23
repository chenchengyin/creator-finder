export function responseProtectionReason(data){
 const messages=[data?.message,data?.feedback_message,...(Array.isArray(data?.errors)?data.errors.map(e=>e?.message):[])].filter(x=>typeof x==='string').join('\n');
 if(/rate\s*limit|too many requests|please wait a few minutes/i.test(messages))return 'instagram_access_stopped_rate_limit';
 if(/login_required|login required|challenge_required|checkpoint_required/i.test(messages))return 'instagram_login_or_challenge';
 if(/feedback_required|sentry_block/i.test(messages))return 'instagram_access_stopped_protection';
 return null;
}
export function queryOperation(events,requestId){
 const request=events.find(e=>e.method==='Network.requestWillBeSent'&&e.params.requestId===requestId)?.params.request;
 if(!request)return null;
 const params=new URLSearchParams(request.postData||'');
 return params.get('fb_api_req_friendly_name')||params.get('operationName')||Object.entries(request.headers||{}).find(([k])=>k.toLowerCase()==='x-fb-friendly-name')?.[1]||null;
}
export function ignorableQueryFailure(operation,status,data){
 return status===200&&operation==='PolarisProfileSuggestedUsersWithPreloadableQuery'&&responseProtectionReason(data)==='instagram_access_stopped_rate_limit';
}

// Wait only: an unowned dialog must never be dismissed by the collector.
export async function waitForDialogToClear(page){
 try{
  await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'),undefined,{timeout:3000});
  return !await page.evaluate(()=>!!document.querySelector('[role="dialog"]'));
 }catch(error){
  if(/control|delegat|ownership/i.test(error.message))throw error;
  return false;
 }
}
