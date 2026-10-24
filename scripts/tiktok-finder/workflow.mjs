import fs from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {inputConfig,assertResumeCompatible,verificationContextFor} from './config.mjs';
import {mergeCandidates} from '../tiktok-search/search.mjs';
import {qualifyCandidate,sameVerificationContext,basicProfileComplete} from './profile.mjs';
import {exportResults} from './export.mjs';
export const readJson=async(path,fallback)=>{try{return JSON.parse(await fs.readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
export async function writeJson(path,value){const temp=path+'.tmp-'+process.pid;await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n');await fs.rename(temp,path);}
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
export async function runCampaign({config,runDir,browser,exporter=exportResults,onProgress=async()=>{},resume=false,spaceId}){
 assert(config?.keywords?.length&&config.windowStart&&config.windowEndExclusive,'invalid frozen configuration');
 await fs.mkdir(runDir,{recursive:true});
 const lockPath=join(runDir,'run.lock');let lock;
 try{lock=await fs.open(lockPath,'wx');}catch(e){
  if(e.code!=='EEXIST')throw e;const old=await readJson(lockPath,{});assert(old.pid&&Number.isSafeInteger(old.pid),'invalid writer lock');assert(!alive(old.pid),'another writer is running');assert(resume,'stale writer requires resume');await fs.unlink(lockPath);lock=await fs.open(lockPath,'wx');
 }
 await lock.writeFile(JSON.stringify({pid:process.pid}));await lock.close();
 let state,queue,results,verificationContext;
 const firstN=config.forceProfileFirstN||0;
 const isSelected=r=>['confirmed','suspected'].includes(r.decision)&&(!firstN||sameVerificationContext(r.capture,verificationContext));
 const statePath=join(runDir,'execution-state.json'),queuePath=join(runDir,'candidate-queue.json'),resultsPath=join(runDir,'results.json');
 const persist=async()=>{
  if(firstN&&state.runId)for(const record of state.keywords){
   if(!record.authorOrder)continue;
   const checked=results.filter(r=>sameVerificationContext(r.capture,verificationContext)&&r.keywordChecks?.[record.keyword]?.forced&&r.keywordChecks[record.keyword].completed&&basicProfileComplete(r.capture));
   record.forcedProfiles={required:Math.min(firstN,record.authorOrder.length),completed:checked.length,reused:checked.filter(r=>r.keywordChecks[record.keyword].reused).length};
  }
  state.counts={uniqueCandidates:queue.length,processed:results.length,confirmed:results.filter(r=>isSelected(r)&&r.decision==='confirmed').length,suspected:results.filter(r=>isSelected(r)&&r.decision==='suspected').length};await writeJson(queuePath,queue);await writeJson(resultsPath,results);await writeJson(statePath,state);await onProgress({status:state.status,currentKeywordIndex:state.currentKeywordIndex,stage:state.stage,counts:state.counts,forcedProfiles:state.keywords[state.currentKeywordIndex]?.forcedProfiles});};
 try{
  const saved=await readJson(join(runDir,'config.json'),null);
  if(saved){assert(resume,'run already exists; use resume');assertResumeCompatible(saved,inputConfig(config));assert.deepEqual(saved,config,'resume configuration mismatch');}
  else{assert(!resume,'nothing to resume');assert(!await readJson(statePath,null),'existing legacy run directory cannot be reused');await writeJson(join(runDir,'config.json'),config);}
  const loadedState=await readJson(statePath,{schemaVersion:1,status:'running',stage:'searching',currentKeywordIndex:0,keywords:config.keywords.map(keyword=>({keyword,stage:'pending',checkpoint:{}})),browser:{spaceId,pageLabel:'p1'},counts:{}});
  if(spaceId!==undefined){assert(!loadedState.browser.spaceId||loadedState.browser.spaceId===spaceId,'original space mismatch');loadedState.browser.spaceId=spaceId;}
  queue=await readJson(queuePath,[]);results=await readJson(resultsPath,[]);
  state=loadedState;
  if(firstN)state.runId??=randomUUID();
  verificationContext=firstN?verificationContextFor(config,state.runId):undefined;
  const upsert=result=>{const index=results.findIndex(r=>(r.authorId&&r.authorId===result.authorId)||(!r.authorId&&r.username.toLowerCase()===result.username.toLowerCase()));if(index<0)results.push(result);else if((result.processedKeywords?.length||0)>=(results[index].processedKeywords?.length||0))results[index]=result;};
  // Author records commit before queue/index updates. Reconcile them after an interrupted write.
  for(const file of (await fs.readdir(runDir)).filter(f=>/^author-[\w.-]+\.json$/.test(f))){const result=await readJson(join(runDir,file));upsert(result);for(const candidate of queue){if((!candidate.authorIdHint||candidate.authorIdHint===result.authorId)&&(candidate.username.toLowerCase()===result.username.toLowerCase()||(candidate.aliases||[]).includes(result.profile?.username))&&typeof result.authorId==='string'&&/^\d+$/.test(result.authorId))candidate.authorIdHint=result.authorId;}}
  if(state.status==='completed')return {...state,results,runtimeRunning:false,activeProcessId:null};
  const targetReached=()=>config.stopAtTarget===true&&results.filter(isSelected).length>=config.targetCount;
  state.runtimeRunning=true;state.activeProcessId=process.pid;state.status='running';state.stopReason=null;await persist();
  while(state.currentKeywordIndex<config.keywords.length&&!state.completionReason){
   if(targetReached()){state.completionReason='target_reached';break;}
   if(config.maxKeywords&&state.keywords.filter(k=>k.stage==='completed').length>=config.maxKeywords){state.completionReason='keyword_limit_reached';break;}
   const record=state.keywords[state.currentKeywordIndex],keyword=record.keyword;
   const mergeBatch=(items,sourceUrl=record.checkpoint?.searchPageUrl)=>{
    record.authorOrder??=[];
    queue=mergeCandidates(queue,items,{keyword,sourceUrl:sourceUrl||null,capturedAt:new Date().toISOString()}).queue;
    for(const item of items){
     const username=item.username?.toLowerCase();if(!username)continue;
     const match=queue.find(c=>item.authorId&&c.authorIdHint===item.authorId||!item.authorId&&[c.username,...(c.aliases||[])].some(name=>name.toLowerCase()===username));
     if(!match)continue;
     const id=match.authorIdHint;
     const existing=record.authorOrder.find(entry=>id&&entry.authorId===id||!entry.authorId&&entry.username===username);
     if(existing){if(id)existing.authorId=id;continue;}
     record.authorOrder.push({authorId:id||null,username});
    }
   };
   if(record.stage==='pending')record.stage='searching';state.stage=record.stage;
   while(record.stage==='searching'){
    const response=await browser.discoverBatch({keyword,checkpoint:record.checkpoint,onCheckpoint:async checkpoint=>{record.checkpoint=checkpoint;if(checkpoint.partialBodies)mergeBatch(checkpoint.partialBodies.filter(r=>r.statusCode===0).flatMap(r=>r.items),checkpoint.searchPageUrl);await persist();}});
    assert(response&&Array.isArray(response.items),'search_response_missing');
    const before=new Set(queue.flatMap(c=>c.sourceEvidence||[]).map(e=>e.keyword+':'+e.videoId));
    mergeBatch(response.items,response.sourceUrl);
    const newEvidence=queue.flatMap(c=>c.sourceEvidence||[]).some(e=>!before.has(e.keyword+':'+e.videoId));
    const oldCursor=record.checkpoint?.cursor;record.checkpoint={...record.checkpoint,...response.checkpoint,keyword,cursor:response.cursor??record.checkpoint?.cursor};await persist();
    assert(response.valid===true&&typeof response.hasMore==='boolean','search_completion_unknown');
    if(response.hasMore===false){record.stage='filtering';record.checkpoint.exhausted=true;state.stage='filtering';await persist();break;}
    assert(newEvidence||response.cursor!==oldCursor,'search_progress_stalled');
   }
   const wordCandidates=queue.filter(c=>(c.sourceEvidence||[]).some(e=>e.keyword===keyword));
   if(firstN)assert(Array.isArray(record.authorOrder),'keyword_author_order_missing');
   const ordered=firstN?record.authorOrder.map(entry=>queue.find(c=>entry.authorId?c.authorIdHint===entry.authorId:[c.username,...(c.aliases||[])].some(name=>name.toLowerCase()===entry.username))):wordCandidates;
   assert(ordered.every(Boolean)&&new Set(ordered).size===ordered.length,'keyword_author_order_incomplete');
   if(firstN)record.forcedProfiles??={required:Math.min(firstN,ordered.length),completed:0,reused:0};
   for(const [index,candidate] of ordered.entries()){
    if(targetReached()){state.completionReason='target_reached';break;}
    const key=candidate.authorIdHint||candidate.username.toLowerCase();
    state.currentAuthor=key;
    const finalPath=join(runDir,'author-'+key+'.json');const prior=await readJson(finalPath,null);
    const forced=index<firstN;
    if(prior?.processedKeywords?.includes(keyword)&&(!firstN||sameVerificationContext(prior.capture,verificationContext)&&(!forced||prior.keywordChecks?.[keyword]?.attempted)))continue;
    const capturePath=join(runDir,'capture-'+key+'.json');
    const checkpointCapture=await readJson(capturePath,null);
    // A paused upgrade can have newer profile/post evidence than the committed author record.
    const cachedCapture=firstN?(checkpointCapture||prior?.capture):(prior?.capture||checkpointCapture);
    const reused=forced&&sameVerificationContext(cachedCapture,verificationContext)&&basicProfileComplete(cachedCapture);
    const result=await qualifyCandidate({candidate,config,browser,cachedCapture,forceProfile:forced,verificationContext,onCheckpoint:c=>writeJson(capturePath,c)});
    result.processedKeywords=[...new Set([...(prior?.processedKeywords||[]),keyword])];
    if(firstN){
     result.keywordChecks={...prior?.keywordChecks,[keyword]:{rank:index+1,forced,reason:forced?'first_n_unique_authors':'existing_signature_prefilter',attempted:!!result.capture?.profile,completed:sameVerificationContext(result.capture,verificationContext)&&basicProfileComplete(result.capture),reused:!!reused}};
    }
    const stableId=typeof result.authorId==='string'&&/^\d+$/.test(result.authorId)?result.authorId:null;
    await writeJson(stableId?join(runDir,'author-'+stableId+'.json'):finalPath,result);
    if(stableId)candidate.authorIdHint=stableId;upsert(result);
    candidate.status='checked';candidate.decision=result.decision;
    await persist();
   }
   if(state.completionReason)break;
   record.stage='completed';state.currentKeywordIndex++;state.currentAuthor=null;await persist();
  }
  state.completionReason??=targetReached()?'target_reached':'all_keywords_completed';
  if(state.stage!=='finalizing'){
  state.stage='exporting';state.status='exporting';await persist();
  try{
   state.output=await exporter({runDir,results:results.filter(isSelected),config});
   assert(state.output?.verification?.passed,'export verification failed');
  }catch(e){state.status='export_failed';state.stopReason=e.message;await persist();return {...state,results,runtimeRunning:false,activeProcessId:null};}
  state.stage='finalizing';state.status='finalizing';await persist();
  }
  if(browser.finish)await browser.finish();state.status='completed';state.stage='completed';await persist();return {...state,results,runtimeRunning:false,activeProcessId:null};
 }catch(error){
  if(!state)throw error;
  state.status='paused';state.stopReason=error.message;state.resumeStage=state.stage;await persist();return {...state,results,runtimeRunning:false,activeProcessId:null};
 }finally{
  try{if(state){state.runtimeRunning=false;state.activeProcessId=null;await writeJson(statePath,state);}}finally{await fs.unlink(lockPath).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
}
