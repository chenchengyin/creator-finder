import fs from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {verificationConfig} from './verification.mjs';
import {freezeWindow} from './metrics.mjs';
import {runSearchWithRetry,validateSearchRetry} from './search-retry.mjs';
import {processSearchPage} from './workflow.mjs';
import {summarizeEmail} from '../profile-email-finder/integration.mjs';

export const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function atomicJson(path,value){
 const tmp=path+'.tmp-'+randomUUID();try{await fs.writeFile(tmp,JSON.stringify(value,null,2));await fs.rename(tmp,path);}catch(e){await fs.unlink(tmp).catch(()=>{});e.storageFailure=true;throw e;}
}
export function normalizeBatchConfig(input){
 if(!input||!Array.isArray(input.keywords)||!input.keywords.length||input.keywords.some(k=>typeof k!=='string'||!k.trim()||k!==k.trim()||k.length>200||/[\x00-\x1f]/.test(k)))throw Error('invalid_batch_keywords');
 const conditions=input.conditions||{requireEmail:true};
 if(!Object.hasOwn(conditions,'requireEmail'))throw Error('requireEmail_must_be_explicit');
 const window=input.window||(conditions.minAverageViewsExclusive!=null?freezeWindow():null);
 verificationConfig(conditions,window);
 const emailLimits=input.emailLimits||{};
 if(Object.keys(emailLimits).some(k=>!['maxPages','maxDepth'].includes(k))||Object.entries(emailLimits).some(([k,v])=>v!==null&&(!Number.isSafeInteger(v)||v<(k==='maxPages'?1:0))))throw Error('invalid_email_limits');
 if(input.maxAuthors!==undefined&&(!Number.isSafeInteger(input.maxAuthors)||input.maxAuthors<1))throw Error('invalid_author_limit');
 return {keywords:[...new Set(input.keywords)],conditions,window,emailLimits,...(input.maxAuthors!==undefined?{maxAuthors:input.maxAuthors}:{})};
}
export function validateBatchState(state){
 if(state?.schemaVersion!==2||state.kind!=='instagram_email_batch'||state.projectRoot!==projectRoot||!state.config||!Array.isArray(state.topics)||state.topics.length!==state.config.keywords?.length||!state.authors||!Number.isSafeInteger(state.topicIndex)||state.topicIndex<0||state.topicIndex>state.topics.length||!['running','paused','failed','completed'].includes(state.status))throw Error('invalid_batch_state');
 normalizeBatchConfig(state.config);
 validateSearchRetry(state.searchRetry);
 if(Array.isArray(state.authors)||Object.entries(state.authors).some(([id,a])=>!/^\d+$/.test(id)||!a||a.authorId!==id||typeof a.username!=='string'||!/^[A-Za-z0-9._]{1,30}$/.test(a.username)||!Array.isArray(a.sources)||a.verification&&(!a.verification.data||!a.verification.checks||a.verification.key!==JSON.stringify({username:a.username,authorId:id,config:verificationConfig(state.config.conditions,state.config.window)}))))throw Error('invalid_batch_state');
 for(const [index,t] of state.topics.entries())if(t.keyword!==state.config.keywords[index]||!Array.isArray(t.history)||!Array.isArray(t.pendingSearchPages)||t.currentPage&&(!Array.isArray(t.currentPage.items)||typeof t.currentPage.hasMore!=='boolean'||t.currentPage.hasMore&&!t.currentPage.cursor))throw Error('invalid_batch_state');
 return state;
}
export async function readBatch(runDir){return validateBatchState(JSON.parse(await fs.readFile(join(runDir,'execution-state.json'),'utf8')));}
async function lockBatch(dir){
 let handle;try{handle=await fs.open(join(dir,'.lock'),'wx');await handle.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));}catch(e){if(e.code==='EEXIST')throw Error('batch_lock_exists');if(handle){await handle.close();await fs.unlink(join(dir,'.lock')).catch(()=>{});}throw e;}
 return async()=>{await handle.close();await fs.unlink(join(dir,'.lock'));};
}
export async function exportSavedBatch(dir){const unlock=await lockBatch(dir);try{return await exportBatch(await readBatch(dir),dir);}finally{await unlock();}}
export async function exportBatch(state,runDir){
 validateBatchState(state);
 const rows=Object.values(state.authors).map(a=>{
  const data={...a.verification?.data},checks={...a.verification?.checks};
  let verification=a.verification,status=a.status;
  if(typeof data.email?.rootUrl==='string'&&Array.isArray(data.email.emails)){
   data.email=summarizeEmail(data.email);
   if(state.config.conditions.requireEmail)checks.email=data.email.matches;
   const values=Object.values(checks),matches=values.includes(false)?false:values.length&&values.every(v=>v===true)?true:null;
   verification={...verification,data,checks,matches};
   if(verification.status==='completed')status=matches===false?'rejected':matches===true?'core_pass_pending_content_review':'pending_review';
  }
  const emails=data.email?.acceptedEmails||[];
  return {authorId:a.authorId,username:a.username,profileUrl:a.profileUrl,status,keywords:[...new Set((a.sources||[]).map(s=>s.keyword))],searchKeywords:[...new Set((a.sources||[]).map(s=>s.searchKeyword??s.keyword))],
   email:emails.map(e=>e.email).join('; '),bioEmails:emails.filter(e=>e.sourceType==='bio').map(e=>e.email).join('; '),linkedEmails:emails.filter(e=>e.sourceType!=='bio').map(e=>e.email).join('; '),
   emailSourceUrls:[...new Set(emails.flatMap(e=>(e.evidence||[]).map(v=>v.sourceUrl)))],emailPaths:emails.flatMap(e=>(e.evidence||[]).map(v=>(v.path||[v.sourceUrl]).join(' → '))),
   emailReview:data.email?.reviewEmails??(data.email?.emails||[]).filter(e=>!emails.some(a=>a.key===e.key)),emailSources:emails.flatMap(e=>e.evidence||[]),emailCompletion:data.email?.completion??null,emailGaps:data.email?.issues||[],
   country:data.country?.countryCode??null,countryMeaning:'account_based_in',averageViews:data.averageViews?.metrics?.averageViews??null,
   checks,'收录依据':`邮箱：${checks.email===true?'公开明确邮箱（Bio或挂链）':checks.email===false?'未发现':'待核验'}；国家：${data.country?.countryCode||'未知'}；均播：${data.averageViews?.metrics?.coverageComplete?data.averageViews.metrics.averageViews:'未核验或未请求'}；内容待人工复核`,
   evidence:{emailRun:`authors/${a.authorId}/email/results.json`,verification,sources:a.sources||[]}};
 });
 const report={schemaVersion:2,status:state.status,reason:state.reason??null,accessIssue:state.accessIssue??null,completionReason:state.completionReason??null,searchExhausted:state.searchExhausted??false,config:state.config,rows,updatedAt:state.updatedAt};
 await atomicJson(join(runDir,'results.json'),report);
 const fields=['authorId','username','profileUrl','status','keywords','searchKeywords','email','bioEmails','linkedEmails','emailSourceUrls','emailPaths','emailCompletion','country','averageViews','收录依据'];
 const quote=value=>'"'+String(Array.isArray(value)?value.join('; '):value??'').replaceAll('"','""')+'"';
 // A leading apostrophe keeps untrusted profile text from becoming spreadsheet formulas.
 const cell=value=>quote(typeof value==='string'&&/^[=+@-]/.test(value)?"'"+value:value);
 const csv='\uFEFF'+[fields.map(quote).join(','),...rows.map(row=>fields.map(f=>cell(row[f])).join(','))].join('\r\n');
 const tmp=join(runDir,'results.csv.tmp-'+randomUUID());
 try{await fs.writeFile(tmp,csv);await fs.rename(tmp,join(runDir,'results.csv'));}catch(e){await fs.unlink(tmp).catch(()=>{});e.storageFailure=true;throw e;}
 return report;
}
export async function runBatch({config,runDir,resume=false,browser,retryTiming={},onProgress=async()=>{},onFinish=async()=>{}}){
 if(!runDir)throw Error('run_dir_required');
 const dir=resolve(runDir);await fs.mkdir(dir,{recursive:true});
 const unlock=await lockBatch(dir);
 let state,active,committed;
 try{
  let saved;try{saved=await readBatch(dir);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(saved){
   if(!resume)throw Error('run_exists_use_resume');
   if(config&&JSON.stringify(normalizeBatchConfig(config))!==JSON.stringify(saved.config))throw Error('resume_input_mismatch');
   state=saved;
  }else{
   if(resume)throw Error('saved_run_not_found');
   if((await fs.readdir(dir)).some(name=>name!=='.lock'))throw Error('run_directory_not_empty');
   const normalized=normalizeBatchConfig(config);
   state={schemaVersion:2,kind:'instagram_email_batch',projectRoot,config:normalized,status:'running',topicIndex:0,authors:{},topics:normalized.keywords.map(keyword=>({keyword,history:[],pendingSearchPages:[],currentPage:null,activePageState:null})),browser:null};
   await atomicJson(join(dir,'config.json'),normalized);
  }
  const save=async()=>{active?.assertHealthy?.();if(active?.session)state.browser=structuredClone(active.session);state.updatedAt=new Date().toISOString();await atomicJson(join(dir,'execution-state.json'),state);committed=structuredClone(state);await onProgress(state);};
  await save();
  if(state.status==='completed'){await exportBatch(state,dir);return state;}
  active=typeof browser==='function'?await browser(state.browser,dir,async session=>{state.browser=structuredClone(session);await save();}):browser;
  if(!active?.page||!active.startKeyword||!active.nextSearchPage)throw Error('batch_browser_required');
  state.status='running';delete state.reason;delete state.accessIssue;await save();
  const search=async(topic,cursor,call)=>runSearchWithRetry({state,keyword:topic.keyword,cursor,call,save,
   onLimited:evidence=>{state.accessIssue=structuredClone(evidence);topic.pendingSearchPages=active.pendingSearchPages?.()||topic.pendingSearchPages;},
   wait:active.waitForSearchRetry,now:retryTiming.now,random:retryTiming.random});
  const advance=async topic=>{
   const current=topic.currentPage;
   const knownCodes=[...new Set([...current.items.map(item=>item.code),...Object.values(state.authors).flatMap(a=>a.sources.filter(s=>s.keyword===topic.keyword).map(s=>s.code))])];
   const next=await search(topic,current.cursor,()=>active.nextSearchPage({keyword:topic.keyword,searchKeyword:current.searchKeyword??topic.keyword,previousCursor:current.cursor,pendingPages:topic.pendingSearchPages,knownCodes}));
   if(!Array.isArray(next.items)||typeof next.hasMore!=='boolean'||next.hasMore&&(!next.cursor||next.cursor===current.cursor))throw Error('search_pagination_state_unknown');
   topic.currentPage=next;topic.pendingSearchPages=active.pendingSearchPages?.()||[];delete topic.advancePending;await save();
  };
  const checkedCount=()=>Object.values(state.authors).filter(a=>['completed','pending_review'].includes(a.verification?.status)).length;
  const complete=async reason=>{state.status='completed';state.completionReason=reason;state.searchExhausted=reason==='keywords_exhausted';await save();await exportBatch(state,dir);await active.finish?.();await save();return state;};
  while(state.topicIndex<state.topics.length){
   const topic=state.topics[state.topicIndex];
   active.context?.({keyword:topic.keyword,stage:'search',username:null,authorId:null});
   if(topic.advancePending)await advance(topic);
   if(!topic.currentPage){
    const first=await search(topic,null,()=>active.startKeyword(topic.keyword,topic.pendingSearchPages));topic.currentPage=first;
    if(!Array.isArray(first.items)||typeof first.hasMore!=='boolean'||first.hasMore&&!first.cursor)throw Error('search_pagination_state_unknown');
    topic.pendingSearchPages=active.pendingSearchPages?.()||[];await save();
   }
   const current=topic.currentPage;
   if(!topic.activePageState&&!topic.candidates){
    const seen=new Set(Object.keys(state.authors));
    const available=current.items.filter(item=>item.mediaType===2&&!seen.has(item.authorId)&&(seen.add(item.authorId),true));
    topic.candidates=available.slice(0,Math.max(0,(state.config.maxAuthors??Infinity)-checkedCount()));topic.limitDeferredCount=available.length-topic.candidates.length;
    for(const item of current.items){
     if(item.mediaType!==2)continue;
     const author=state.authors[item.authorId]??={authorId:item.authorId,username:item.username,profileUrl:`https://www.instagram.com/${item.username}/`,status:'pending',sources:[]};
     if(!author.sources.some(s=>s.keyword===topic.keyword&&s.id===item.id))author.sources.push({...item,keyword:topic.keyword,searchKeyword:current.searchKeyword??topic.keyword});
    }
    await save();
   }
   const progress=await processSearchPage({page:active.page,items:topic.candidates,conditions:state.config.conditions,window:state.config.window,state:topic.activePageState,runDir:dir,
    spaceId:active.session?.spaceId,emailLimits:state.config.emailLimits,context:active.context,assertHealthy:active.assertHealthy,readers:active.readers||{},
    onCheckpoint:async cp=>{topic.activePageState=cp;for(const [id,a] of Object.entries(cp.authors))state.authors[id]={...state.authors[id],...a};await save();}});
   if(progress.status==='paused'){state.status='paused';state.reason=progress.reason;await save();await exportBatch(state,dir);return state;}
   topic.history.push({cursor:current.cursor,hasMore:current.hasMore,itemCount:current.items.length,fullyProcessed:!topic.limitDeferredCount,searchKeyword:current.searchKeyword??topic.keyword});
   if(state.config.maxAuthors&&checkedCount()>=state.config.maxAuthors&&(current.hasMore||topic.limitDeferredCount>0||state.topicIndex<state.topics.length-1))return await complete('author_limit_reached');
   topic.activePageState=null;delete topic.candidates;
   if(current.hasMore===false){topic.completed=true;topic.currentPage=null;state.topicIndex++;await save();continue;}
   // Retain the completed page until its successor is durably committed.
   topic.advancePending=true;await save();
   await advance(topic);
  }
  return await complete('keywords_exhausted');
 }catch(e){
  if(!committed)throw e;
  const failed=structuredClone(committed);failed.status=e.storageFailure?'failed':e.pause||/control|ownership|delegat|closed|CDP|instagram_|search_/.test(e.message)?'paused':'failed';failed.reason=e.reason||e.message;
  if(!e.storageFailure&&e.searchEvidence){failed.accessIssue=structuredClone(e.searchEvidence);const topic=failed.topics[failed.topicIndex];if(topic)topic.pendingSearchPages=active?.pendingSearchPages?.()||topic.pendingSearchPages;}
  if(!e.storageFailure){try{await atomicJson(join(dir,'execution-state.json'),failed);await exportBatch(failed,dir);}catch(writeError){failed.status='failed';failed.reason=writeError.message;}}
  state=failed;return failed;
 }finally{try{await onFinish(state);}finally{await unlock();}}
}
