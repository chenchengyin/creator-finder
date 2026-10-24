import {instagramSearchKeyword} from './keyword.mjs';
const reason='instagram_access_stopped_rate_limit';
export const searchRetryLimit=2;
const pause=(message,evidence)=>Object.assign(Error(reason),{pause:true,reason:message,searchEvidence:evidence});
const matches=(evidence,keyword,cursor)=>evidence?.reason===reason&&evidence.scope==='target'&&evidence.keyword===keyword&&typeof keyword==='string'&&[keyword,instagramSearchKeyword(keyword)].includes(evidence.searchKeyword??keyword)&&evidence.requestKeyword===(evidence.searchKeyword??keyword)&&evidence.requestCursor===cursor;
export function validateSearchRetry(value){
 if(value===undefined)return;
 const invalid=()=>{throw Error('invalid_search_retry');};
 if(!value||!Number.isSafeInteger(value.attempts)||value.attempts<0||value.attempts>searchRetryLimit)invalid();
 if(!['idle','waiting','dispatching','exhausted','stopped'].includes(value.phase))invalid();
 if(typeof value.keyword!=='string'||!value.keyword||value.cursor!==null&&(typeof value.cursor!=='string'||!value.cursor))invalid();
 if(!matches(value.evidence,value.keyword,value.cursor))invalid();
 if(['waiting','dispatching'].includes(value.phase)){
  if(!Number.isSafeInteger(value.nextRetryAt)||value.nextRetryAt<0)invalid();
 }else if(value.nextRetryAt!==null)invalid();
 if(value.phase==='waiting'&&value.attempts>=searchRetryLimit||value.phase==='dispatching'&&value.attempts===0||value.phase==='exhausted'&&value.attempts!==searchRetryLimit)invalid();
}
export function retryDeadline(header,now,attempts,random=Math.random){
 const fallback=now+Math.ceil(60000*2**attempts*(1+Math.max(0,Math.min(1,random()))*0.1));
 let server=0;const value=String(header??'').trim();
 if(/^\d+$/.test(value)){
  server=now+Number(value)*1000;
  if(!Number.isSafeInteger(server))throw Object.assign(Error('search_retry_deadline_invalid'),{pause:true});
 }else if(/^[A-Za-z]{3},/.test(value))server=Date.parse(value)||0;
 return Math.max(fallback,server);
}

// One budget belongs to the batch; a successful page never replenishes it.
export async function runSearchWithRetry({state,keyword,cursor,call,save,onLimited=()=>{},wait,now=Date.now,random=Math.random}){
 validateSearchRetry(state.searchRetry);
 for(;;){
  const retry=state.searchRetry;
  if(retry&&['waiting','dispatching','exhausted'].includes(retry.phase)){
   if(retry.keyword!==keyword||retry.cursor!==cursor)throw Object.assign(Error('search_retry_checkpoint_mismatch'),{pause:true});
   if(retry.phase==='exhausted')throw pause('search_retry_exhausted',retry.evidence);
   if(retry.phase==='dispatching')throw pause('search_retry_dispatch_interrupted',retry.evidence);
   if(retry.nextRetryAt-now()>600000)throw pause('search_retry_deferred',retry.evidence);
   if(typeof wait!=='function')throw pause('search_retry_wait_unavailable',retry.evidence);
   await wait(retry.nextRetryAt);
   if(now()<retry.nextRetryAt)throw pause('search_retry_wait_incomplete',retry.evidence);
   retry.attempts++;retry.phase='dispatching';await save();
  }
  try{
   const result=await call();
   if(state.searchRetry){state.searchRetry.phase='idle';state.searchRetry.nextRetryAt=null;}
   delete state.accessIssue;
   return result;
  }catch(error){
   if(error.storageFailure)throw error;
   if(error.message!==reason||!matches(error.searchEvidence,keyword,cursor)){
    if(state.searchRetry?.phase==='dispatching'){state.searchRetry.phase='stopped';state.searchRetry.nextRetryAt=null;await save();}
    throw error;
   }
   onLimited(error.searchEvidence);
   const attempts=state.searchRetry?.attempts??0;
   let nextRetryAt=null;
   let deadlineError;
   if(attempts<searchRetryLimit)try{nextRetryAt=retryDeadline(error.searchEvidence.retryAfter,now(),attempts,random);}catch(error){deadlineError=error;}
   state.searchRetry={attempts,phase:deadlineError?'stopped':attempts>=searchRetryLimit?'exhausted':'waiting',keyword,cursor,nextRetryAt,evidence:structuredClone(error.searchEvidence)};
   await save();
   if(deadlineError)throw pause(deadlineError.message,error.searchEvidence);
  }
 }
}

export async function waitForSearchRetry(until,{onWait,assertHealthy,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 onWait({until,reason:'search_rate_limit'});
 try{
  for(;;){assertHealthy();const remaining=until-now();if(remaining<=0)return;await sleep(Math.min(15000,remaining));}
 }finally{onWait(null);}
}
