#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {navigateWith403Retry,pace,isControlError} from '../tiktok-browser/access.mjs';

const searchUrl=keyword=>'https://www.tiktok.com/search/video?q='+encodeURIComponent(keyword);
const belongsToKeyword=(event,keyword)=>{try{const url=new URL(event.params.response.url);return url.pathname==='/api/search/item/full/'&&[url.searchParams.get('keyword'),url.searchParams.get('q')].includes(keyword);}catch{return false;}};
const protectionStatus=statuses=>statuses.find(s=>s===401||s===429)??statuses.find(s=>s===403);
const USAGE='node search.mjs --space <已有空间ID> --keyword <关键词> --run-dir <批次目录> [--batches 1..50] [--continue] [--dry-run]\n默认抓取1批；--continue 在原搜索页继续滚动。仅产生候选和来源，不冒充最终合格达人。403等待11秒后同址重试一次。';

export function parseArgs(argv){
  const config={batches:1,continueSearch:false,dryRun:false,pageLabel:'p3'};
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];
    if(flag==='--help')return {help:true};
    if(flag==='--continue'){config.continueSearch=true;continue;}
    if(flag==='--dry-run'){config.dryRun=true;continue;}
    assert(['--space','--keyword','--run-dir','--batches','--page'].includes(flag),'unknown option: '+flag);
    const value=argv[++i];assert(value&&!value.startsWith('--'),'missing option value: '+flag);
    config[{'--space':'spaceId','--keyword':'keyword','--run-dir':'runDir','--batches':'batches','--page':'pageLabel'}[flag]]=value;
  }
  config.spaceId=Number(config.spaceId);config.batches=Number(config.batches);
  assert(Number.isSafeInteger(config.spaceId)&&config.spaceId>0,'existing numeric --space required');
  assert(typeof config.keyword==='string'&&config.keyword.trim(),'--keyword required');config.keyword=config.keyword.trim();
  assert(config.runDir,'--run-dir required');config.runDir=resolve(config.runDir);
  assert(Number.isInteger(config.batches)&&config.batches>=1&&config.batches<=50,'--batches must be 1..50');
  assert(/^p\d+$/.test(config.pageLabel),'--page must be an existing managed page label');
  config.searchUrl=searchUrl(config.keyword);return config;
}

export function parseSearchResponse(data){
  return {statusCode:data.status_code,hasMore:[1,true].includes(data.has_more)?true:[0,false].includes(data.has_more)?false:null,cursor:data.cursor,
    items:(data.item_list||[]).map(i=>({videoId:i.id,description:i.desc||'',createdAt:i.createTime,
      authorId:i.author?.id,username:i.author?.uniqueId,bioHint:i.author?.signature??null,locationCreated:i.locationCreated}))};
}

export function mergeCandidates(existing,items,{keyword,sourceUrl,capturedAt}){
  const queue=structuredClone(existing);let added=0;
  for(const item of items){
    if(typeof item.username!=='string'||!/^[\w.][\w.-]*$/.test(item.username)||typeof item.videoId!=='string'||!/^\d+$/.test(item.videoId))continue;
    const authorId=typeof item.authorId==='string'&&/^\d+$/.test(item.authorId)?item.authorId:undefined;
    let candidate=authorId?queue.find(q=>q.authorIdHint===authorId):null;
    if(!candidate)candidate=queue.find(q=>q.username.toLowerCase()===item.username.toLowerCase()&&(!authorId||!q.authorIdHint));
    const url='https://www.tiktok.com/@'+item.username+'/video/'+item.videoId;
    if(!candidate){candidate={username:item.username,authorIdHint:authorId,keyword,source:'tiktok-video',sourceUrl,sourceLink:url,sourceText:item.description||'',status:'queued',sourceEvidence:[]};queue.push(candidate);added++;}
    else if(authorId&&candidate.authorIdHint===authorId&&candidate.username!==item.username){candidate.aliases=[...new Set([...(candidate.aliases||[]),candidate.username])];candidate.username=item.username;}
    if(authorId&&!candidate.authorIdHint)candidate.authorIdHint=authorId;
    if(item.bioHint)candidate.bioHint=item.bioHint;
    candidate.sourceEvidence??=[];
    if(!candidate.sourceEvidence.some(e=>e.videoId===item.videoId&&e.keyword===keyword))candidate.sourceEvidence.push({videoId:item.videoId,authorId,username:item.username,text:item.description||'',videoUrl:url,searchUrl:sourceUrl,keyword,capturedAt,source:'tiktok_native_video_search'});
  }
  return {queue,newCandidates:added};
}

export function readSearchPage(){
  let detail;
  try{detail=JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent).__DEFAULT_SCOPE__;}catch{}
  const status=performance.getEntriesByType('navigation')[0]?.responseStatus;
  const body=document.body?.innerText||'',denied=/HTTP (?:ERROR )?(401|403|429)\b/.exec(body);
  return {url:location.href,httpStatus:status>=400?status:(!detail&&denied?Number(denied[1]):status),
    captcha:!!document.querySelector('iframe[src*="captcha"],#captcha_container'),
    loginPrompt:[...document.querySelectorAll('[role="dialog"]')].some(e=>e.getClientRects().length&&/登录\s*TikTok|Log in to TikTok/i.test(e.innerText)),
    serverError:/服务器出现问题|something went wrong/.test(body),
    links:[...document.querySelectorAll('a[href*="/video/"]')].map(a=>({url:a.href,text:a.innerText}))};
}

const writeJson=async(path,value)=>{const tmp=path+'.tmp-'+process.pid;await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n');await fs.rename(tmp,path);};
async function readJson(path,fallback){try{return JSON.parse(await fs.readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return fallback;}}

export async function runSearch({page,config,beforeNavigate,sleep,onProgress=async()=>{}}){
  const {runDir,keyword,batches=1,continueSearch=false}=config,url=searchUrl(keyword);
  if(continueSearch){const current=new URL(await page.url());assert(current.hostname==='www.tiktok.com'&&current.pathname.startsWith('/search')&&current.searchParams.get('q')===keyword,'original search page/keyword mismatch; do not mix batches');}
  await fs.mkdir(runDir,{recursive:true});
  const queuePath=join(runDir,'candidate-queue.json'),statePath=join(runDir,'execution-state.json');
  let queue=await readJson(queuePath,[]),state=await readJson(statePath,{task:'TikTok keyword candidate discovery',keywordOrder:[keyword],browser:{spaceId:config.spaceId},counts:{}});
  assert(!state.runtimeRunning,'another operation is running for this batch');
  assert(state.keywordOrder?.includes(keyword),'saved campaign keyword mismatch');
  if(config.stopAtTarget!==false&&state.target&&state.counts?.qualified>=state.target)return {status:'target_reached',newCandidates:0};
  const paced=beforeNavigate||(()=>pace(join(runDir,'last-tiktok-nav.txt')));
  const attempts=attempt=>fs.appendFile(join(runDir,'access-attempts.jsonl'),JSON.stringify(attempt)+'\n');
  let heldEvents=[];
  const takeEvents=async()=>{const events=[...heldEvents,...await page.events()];heldEvents=[];return events;};
  const go=prior403=>navigateWith403Retry({page,url,prior403,read:async()=>{const access=await page.evaluate(readSearchPage);heldEvents.push(...await page.events());return {...access,httpStatus:protectionStatus([access.httpStatus,...heldEvents.filter(e=>e.method==='Network.responseReceived'&&belongsToKeyword(e,keyword)).map(e=>e.params.response.status)])??access.httpStatus};},sleep,
    beforeNavigate:async()=>{await paced();heldEvents=[];await page.events();},onAttempt:attempts});
  state.status='searching';state.runtimeRunning=true;state.activeProcessId=process.pid;await writeJson(statePath,state);
  const results=[];let stopReason=null,hardBlocked=false,exhausted=false,lastCursor=state.searchCheckpoints?.[keyword]?.cursor??(state.searchCheckpoint?.keyword===keyword?state.searchCheckpoint.cursor:undefined);
  try{
    await page.cdp('Network.enable',{});
    for(let batch=0;batch<batches;batch++){
      let access,retryUsed=false;
      if(batch===0&&!continueSearch){const nav=await go(false);access=nav.access;retryUsed=nav.retried;if(nav.error&&access.httpStatus!==403)stopReason='search_navigation_failed';}
      else{
        await paced();await page.events();
        const before=await page.evaluate(()=>[...document.querySelectorAll('a[href*="/video/"]')].at(-1)?.href||'');
        await page.evaluate(()=>{let root=document.querySelector('a[href*="/video/"]')?.parentElement;while(root&&!(root.clientHeight>100&&root.scrollHeight>root.clientHeight+100&&/auto|scroll/.test(getComputedStyle(root).overflowY)))root=root.parentElement;root=root||document.scrollingElement;root.scrollTop=root.scrollHeight;});
        try{await page.waitForFunction(old=>[...document.querySelectorAll('a[href*="/video/"]')].at(-1)?.href!==old||!!document.querySelector('iframe[src*="captcha"],#captcha_container'),before,{timeout:12000});}catch(e){if(isControlError(e))throw e;}
        access=await page.evaluate(readSearchPage);
        if(access.httpStatus===403&&!access.captcha&&!access.loginPrompt){access=(await go(true)).access;retryUsed=true;}
      }
      if(!stopReason&&![401,403,429].includes(access.httpStatus)&&!access.captcha&&!access.loginPrompt){
        try{await page.waitForSelector('a[href*="/video/"]',{state:'visible',timeout:12000});}catch(e){if(isControlError(e))throw e;}
        access=await page.evaluate(readSearchPage);
      }
      let events=await takeEvents();
      const matching=events.filter(e=>e.method==='Network.responseReceived'&&belongsToKeyword(e,keyword));
      if(!retryUsed&&matching.some(e=>e.params.response.status===403)&&!matching.some(e=>[401,429].includes(e.params.response.status))&&![401,429].includes(access.httpStatus)&&!access.captcha&&!access.loginPrompt&&access.httpStatus!==403){
        access=(await go(true)).access;
        if(access.httpStatus===200){try{await page.waitForSelector('a[href*="/video/"]',{state:'visible',timeout:12000});}catch(e){if(isControlError(e))throw e;}}
        events=await takeEvents();
      }
      const responses=events.filter(e=>e.method==='Network.responseReceived'&&belongsToKeyword(e,keyword));
      const denied=responses.find(e=>[401,403,429].includes(e.params.response.status));
      if(access.captcha||[401,403,429].includes(access.httpStatus)||denied){stopReason=access.captcha?'captcha_requires_user':'http_'+protectionStatus([access.httpStatus,...responses.map(e=>e.params.response.status)]);hardBlocked=true;}
      else if(access.loginPrompt)stopReason='login_prompt_needs_inspection';
      const capture={keyword,url,capturedAt:new Date().toISOString(),responses:[]};
      if(!stopReason){
        for(const event of responses){
          try{const body=await page.cdp('Network.getResponseBody',{requestId:event.params.requestId});const raw=JSON.parse(body.base64Encoded?Buffer.from(body.body,'base64').toString('utf8'):body.body);capture.responses.push({...parseSearchResponse(raw),httpStatus:event.params.response.status});}
          catch(e){if(isControlError(e))throw e;stopReason='search_response_unavailable';}
        }
        if(!capture.responses.length)stopReason='search_response_missing';
        if(capture.responses.some(r=>r.statusCode!==0))stopReason='search_response_error';
        const merged=mergeCandidates(queue,capture.responses.filter(r=>r.statusCode===0).flatMap(r=>r.items),{keyword,sourceUrl:url,capturedAt:capture.capturedAt});queue=merged.queue;
        const domItems=(access.links||[]).flatMap(link=>{const m=new URL(link.url).pathname.match(/^\/@([\w.-]+)\/video\/(\d+)$/);return m?[{username:m[1],videoId:m[2],description:link.text}]:[];});
        const dom=mergeCandidates(queue,domItems,{keyword,sourceUrl:url,capturedAt:capture.capturedAt});queue=dom.queue;
        exhausted=!stopReason&&capture.responses.length===responses.length&&capture.responses.length>0&&capture.responses.every(r=>r.statusCode===0)&&capture.responses.at(-1).hasMore===false;
        if(capture.responses.at(-1)?.cursor!==undefined)lastCursor=capture.responses.at(-1).cursor;
        results.push({batch,newCandidates:merged.newCandidates+dom.newCandidates,totalCandidates:queue.length,exhausted});
        await writeJson(queuePath,queue);await fs.appendFile(join(runDir,'tiktok-video-discovery.jsonl'),JSON.stringify(capture)+'\n');
        await onProgress(results.at(-1));
      }
      if(stopReason||exhausted)break;
    }
  }catch(e){stopReason=isControlError(e)?'control_lost':'search_step_needs_inspection';throw e;}
  finally{
    state.counts={...state.counts,uniqueCandidates:queue.length};state.runtimeRunning=false;state.activeProcessId=null;
    state.status=hardBlocked?'waiting_for_user_access_recovery':stopReason?'paused_for_inspection':'in_progress';state.stopReason=stopReason;
    state.sourceProgress??={};state.sourceProgress[keyword]??={};state.sourceProgress[keyword]['tiktok-video']=stopReason?'incomplete':exhausted?'exhausted':'active_search_results';
    state.searchCheckpoint={keyword,pageLabel:config.pageLabel||'p3',url,exhausted,cursor:lastCursor};
    state.searchCheckpoints??={};state.searchCheckpoints[keyword]=state.searchCheckpoint;
    state.browser={...state.browser,spaceId:config.spaceId,ownership:stopReason==='control_lost'?'user':hardBlocked?'handed_to_user':'agent'};
    await writeJson(statePath,state);
  }
  return {results,stopReason,hardBlocked,totalCandidates:queue.length,exhausted};
}

export async function runInEgo(config,{listTaskSpaces,taskSpace}){
  const space=(await listTaskSpaces()).find(s=>s.id===config.spaceId);
  assert(space&&['agent','agentOwned'].includes(space.ownership),'original Ego space requires user-confirmed Agent control');
  const task=await taskSpace(config.spaceId);
  const result=await runSearch({page:task.page(config.pageLabel||'p3'),config,onProgress:progress=>console.log(JSON.stringify(progress))});
  if(result.hardBlocked)await task.handOff();
  console.log(JSON.stringify(result));if(result.stopReason)process.exitCode=3;
  return result;
}

async function main(){
  const config=parseArgs(process.argv.slice(2));if(config.help){console.log(USAGE);return;}
  if(config.dryRun){console.log(JSON.stringify({mode:'dry_run',...config},null,2));return;}
  const code=`const {runInEgo}=await import(${JSON.stringify(import.meta.url)});await runInEgo(${JSON.stringify(config)},{listTaskSpaces,taskSpace});`;
  const result=spawnSync('ego-browser',['nodejs'],{input:code,stdio:['pipe','inherit','inherit']});if(result.error)throw result.error;process.exitCode=result.status??1;
}
if(process.argv[1]&&await fs.realpath(process.argv[1]).catch(()=>null)===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
