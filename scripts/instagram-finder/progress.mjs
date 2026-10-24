import {searchRetryLimit} from './search-retry.mjs';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicJson} from './batch.mjs';

const text=value=>typeof value==='string'?value.slice(0,200):null;
const terminal=status=>['completed','paused','failed'].includes(status);

export function createProgress({runDir,runId=randomUUID(),intervalMs=15000,now=Date.now,write=value=>atomicJson(join(runDir,'progress.json'),value)}){
 let latest=null,context={},waiting=null,timer=null,inFlight=null,failure=null,closing=false,finishPromise=null,finalStatus=null;
 let startedAt=null,lastProgressAt=null,lastCounts=null,lastPosition=null,actionName=null;
 const touch=()=>{lastProgressAt=now();};
 const assertHealthy=()=>{if(failure)throw failure;};
 const snapshot=()=>{
  let tracked=0,processed=0,matched=0;
  for(const author of Object.values(latest?.authors||{})){
   tracked++;
   if(['completed','pending_review'].includes(author.verification?.status)){processed++;if(author.verification.matches===true)matched++;}
  }
  const counts=JSON.stringify([tracked,processed,matched]);if(lastCounts!==null&&counts!==lastCounts)touch();lastCounts=counts;
  const topic=latest?.topics?.[latest.topicIndex];
  return {runId,pid:process.pid,status:finalStatus||(waiting?'waiting':'running'),stage:text(context.stage)||'starting',keyword:text(context.keyword)||text(topic?.keyword),username:text(context.username),authorId:text(context.authorId),action:actionName,tracked,processed,matched,startedAt,heartbeatAt:now(),lastProgressAt,retryAttempts:latest?.searchRetry?.attempts??0,retryLimit:searchRetryLimit,nextRetryAt:latest?.searchRetry?.phase==='waiting'?latest.searchRetry.nextRetryAt:null,waitReason:waiting?.reason??null,waitUntil:waiting?.until??null,reason:finalStatus?text(latest?.reason):null,updatedAt:new Date(now()).toISOString()};
 };
 const flush=()=>{
  const value=snapshot();
  inFlight=Promise.resolve().then(()=>write(value)).catch(error=>{error.storageFailure=true;failure=error;throw error;});
  return inFlight;
 };
 const arm=()=>{
  if(closing||failure)return;
  timer=setTimeout(async()=>{
   timer=null;
   try{await flush();}catch{/* The next action or finalization surfaces this failure. */}
   finally{inFlight=null;arm();}
  },intervalMs);
  timer.unref?.();
 };
 return {
  assertHealthy,
  async updateBatch(state){
   assertHealthy();if(closing)return;latest=state;
   const topic=state.topics?.[state.topicIndex],position=JSON.stringify([state.status,state.topicIndex,topic?.currentPage?.cursor,topic?.activePageState?.nextItemIndex]);
   if(position!==lastPosition){touch();lastPosition=position;}
   if(startedAt===null){startedAt=now();await flush();inFlight=null;arm();}
  },
  context(value){
   const next={...context};for(const key of ['stage','keyword','username','authorId'])if(Object.hasOwn(value,key))next[key]=text(value[key]);
   if(JSON.stringify(next)!==JSON.stringify(context))touch();context=next;
  },
  action(event){
   if(event.phase==='before'){actionName=text(event.action);waiting=null;}
   if(event.phase==='after')touch();
  },
  wait(value){waiting=value?{until:value.until,reason:text(value.reason)}:null;},
  finish(state){
   if(finishPromise)return finishPromise;
   closing=true;if(timer!==null){clearTimeout(timer);timer=null;}
   finishPromise=(async()=>{
    try{
     if(startedAt===null)return;
     if(inFlight)await inFlight;
     assertHealthy();if(state)latest=state;finalStatus=terminal(latest?.status)?latest.status:'failed';waiting=null;await flush();
    }finally{latest=null;context={};waiting=null;inFlight=null;}
   })();
   return finishPromise;
  }
 };
}

export async function readProgress(runDir){
 try{return JSON.parse(await fs.readFile(join(runDir,'progress.json'),'utf8'));}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}

// Observe the existing CLI child. Do not start a watchdog or accumulate stdout.
export function watchChild(child,{runDir,runId,print=console.log,intervalMs=15000,now=Date.now,read=()=>readProgress(runDir),workerPausedExitCode=3}){
 return new Promise(resolve=>{
  let timer=null,inFlight=null,closing=false,outputFailed=false;const startedAt=now();
  const emit=value=>{try{print(JSON.stringify({type:'progress',runId,...value}));}catch{outputFailed=true;}};
  const load=async()=>{const value=await read();return value?.runId===runId?value:null;};
  const view=value=>{
   const age=now()-(value?.heartbeatAt??startedAt),knownWait=value?.status==='waiting'&&value.waitUntil>now();
   const attention=age>45000?'heartbeat_stale':value&&!terminal(value.status)&&!knownWait&&now()-value.lastProgressAt>120000?'no_progress':null;
   return {...value,status:value?.status||'starting',attention};
  };
  const arm=()=>{
   if(closing)return;
   timer=setTimeout(()=>{
    timer=null;
    inFlight=(async()=>{try{const value=await load();if(!closing)emit(view(value));}catch(error){if(!closing)emit({status:'unknown',attention:'progress_unreadable',reason:text(error.message)});}})().finally(()=>{inFlight=null;arm();});
   },intervalMs);
   timer.unref?.();
  };
  const finish=async(code,signal,error)=>{
   if(closing)return;closing=true;if(timer!==null){clearTimeout(timer);timer=null;}
   child.removeListener('exit',onExit);child.removeListener('error',onError);
   if(inFlight)await inFlight;
   let value;try{value=await load();}catch{}
   const terminalCode=value?.status==='completed'?0:value?.status==='paused'?3:value?.status==='failed'?1:null;
   const expected=value?.status==='paused'?workerPausedExitCode:terminalCode;
   if(error)emit({...value,status:'failed',reason:text(error.message),exitCode:1});
   else if(expected===null)emit({...value,status:'interrupted',reason:'worker_exit_without_final_status',exitCode:code,signal,workerState:'unknown'});
   else if(code!==expected)emit({...value,status:'failed',reason:'worker_exit_status_conflict',exitCode:code,signal});
   else emit({...value,exitCode:terminalCode,workerExitCode:code,attention:null});
   resolve(error||outputFailed||expected===null&&(!code||code===3)||expected!==null&&code!==expected?1:terminalCode??code??1);
  };
  const onExit=(code,signal)=>{void finish(code,signal);};
  const onError=error=>{void finish(1,null,error);};
  child.once('exit',onExit);child.once('error',onError);
  emit({status:'starting',startedAt,attention:null});arm();
 });
}
