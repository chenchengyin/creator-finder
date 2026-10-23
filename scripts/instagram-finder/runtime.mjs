import fs from 'node:fs/promises';
import {join} from 'node:path';
import {runBatch} from './batch.mjs';
import {createSession} from './session.mjs';
import {createSearchPager} from './search.mjs';
import {collectReels} from './reels.mjs';

export async function runInEgo(options,api){
 return runBatch({...options,browser:async(saved,runDir,onSession)=>{
  let task,owned=false;
  if(saved?.spaceId){
   // Only spaces created by this preview batch may be reclaimed.
   if(!saved.owned||saved.spaceId===19)throw Object.assign(Error('unowned_or_reserved_space'),{pause:true});
   const entry=(await api.listTaskSpaces()).find(s=>s.id===saved.spaceId);
   if(!entry)throw Object.assign(Error('original_space_not_found'),{pause:true});
   if(entry.ownership==='agentDelegatedToUser'){
    if(!options.resume)throw Object.assign(Error('delegated_space_requires_explicit_resume'),{pause:true});
    task=await api.takeOverTaskSpace(saved.spaceId);
   }else task=['user','userOwned','inactive'].includes(entry.ownership)?await api.claimTaskSpace(saved.spaceId):await api.taskSpace(saved.spaceId);
   owned=true;
  }else{task=await api.taskSpace('INS邮箱协作-'+Date.now());owned=true;}
  const session={spaceId:task.spaceId,owned,pages:{...saved?.pages}};
  await onSession(session);
  const log=async event=>{try{await fs.appendFile(join(runDir,'actions.jsonl'),JSON.stringify(event)+'\n');}catch(e){e.storageFailure=true;throw e;}};
  const coordinator=createSession({log,lastActionAt:saved?.lastActionAt??null});
  const available=await task.pages();
  const getPage=async(role,initialLabel)=>{
   const label=session.pages[role]||initialLabel;
   if(label){
    if(!available.some(p=>p.label===label))throw Object.assign(Error('saved_page_missing: '+label),{pause:true});
    session.pages[role]=label;await onSession(session);return coordinator.wrap(task.page(label));
   }
   await log({phase:'before',action:'newPage',role,at:new Date().toISOString()});
   const page=await task.newPage();session.pages[role]=page.label;await onSession(session);
   await log({phase:'after',action:'newPage',role,page:page.label,at:new Date().toISOString()});
   return coordinator.wrap(page);
  };
  const search=await getPage('search','p1'),page=await getPage('profile'),detailPage=await getPage('detail');
  let pager,keyword;
  Object.defineProperty(session,'lastActionAt',{enumerable:true,get:()=>coordinator.state.lastActionAt});
  return {page,session,assertHealthy:coordinator.assertHealthy,context:value=>coordinator.context(value),
   async startKeyword(value){keyword=value;pager=createSearchPager({page:search,keyword});return pager.first();},
   async nextSearchPage({keyword:value,previousCursor,pendingPages}){
    if(!pager||keyword!==value){keyword=value;pager=createSearchPager({page:search,keyword,initialPages:pendingPages});}
    return pager.next({previousCursor,currentPageProcessed:true});
   },
   pendingSearchPages:()=>pager?.pendingPages()||[],
   readers:{averageViews:args=>collectReels({...args,page,detailPage})},
   async finish(){if(owned)await task.finish({keep:[]});session.closed=true;},
  };
 }});
}
