import {parseSearchConnection} from './workflow.mjs';
import {responseProtectionReason,queryOperation,ignorableQueryFailure} from './protection.mjs';

// A page is released only after its native response is verified; scrolling never proves exhaustion.
export function createSearchPager({page,keyword,initialPages=[]}){
 if(typeof keyword!=='string'||!keyword.trim()||keyword!==keyword.trim()||keyword.length>200||/[\x00-\x1f]/.test(keyword))throw new Error('invalid_search_keyword');
 const history=[],pending=new Map(),queue=initialPages.map(p=>{if(p.keyword!==keyword)throw new Error('restored_search_topic_mismatch');return {...p,...parseSearchConnection(p.connection)};}),seen=new Set();
 const checkTopic=async()=>{const u=new URL(await page.url());if(/^\/(accounts\/login|challenge|checkpoint)(\/|$)/.test(u.pathname))throw new Error('instagram_login_or_challenge');if(u.hostname!=='www.instagram.com'||u.searchParams.get('q')!==keyword)throw new Error('search_topic_mismatch');};
 const view=()=>page.evaluate(()=>({url:location.href,codes:[...document.querySelectorAll('main a[href*="/p/"],main a[href*="/reel/"]')].map(a=>a.getAttribute('href').split('/')[2]),text:document.querySelector('main')?.innerText||''}));
 const drain=async()=>{
  const events=await page.events();history.push(...events.filter(e=>e.method==='Network.requestWillBeSent'));
  for(const e of events){
   if(e.method!=='Network.responseReceived')continue;
   const u=new URL(e.params.response.url);if(u.hostname!=='www.instagram.com'||!/graphql/.test(u.pathname))continue;
   if([401,403,429].includes(e.params.response.status))throw new Error('instagram_access_stopped_'+e.params.response.status);
   pending.set(e.params.requestId,e.params.response);
  }
  for(const [id,response] of pending){
   let raw;try{raw=await page.cdp('Network.getResponseBody',{requestId:id});}catch{continue;}pending.delete(id);
   for(const line of (raw.base64Encoded?Buffer.from(raw.body,'base64').toString():raw.body).replace(/^for\s*\(;;\);/,'').split('\n')){
    let data;try{data=JSON.parse(line);}catch{continue;}
    const operation=queryOperation(history,id),protection=responseProtectionReason(data);
    if(protection){if(ignorableQueryFailure(operation,response.status,data))continue;throw new Error(protection);}
    const connection=data.data?.xdt_fbsearch__top_serp_graphql;if(!connection)continue;
    const request=history.find(e=>e.params.requestId===id)?.params.request;const params=new URLSearchParams(request?.postData||'');
    let variables;try{variables=JSON.parse(params.get('variables'));}catch{throw new Error('search_response_source_unverified');}
    if(variables?.query!==keyword)continue;
    if(data.errors?.length)throw new Error('search_response_failed');
    const parsed=parseSearchConnection(connection);
    if(typeof parsed.hasMore!=='boolean'||parsed.hasMore&&(typeof parsed.cursor!=='string'||!parsed.cursor))throw new Error('search_pagination_state_unknown');
    const requestCursor=variables.after??variables.cursor??null;
    const key=JSON.stringify([requestCursor,parsed.cursor,parsed.items.map(i=>i.id)]);if(seen.has(key))continue;seen.add(key);
    queue.push({...parsed,keyword,connection,requestCursor,operation,capturedAt:new Date().toISOString()});
   }
  }
 };
 const take=cursor=>{const i=queue.findIndex(p=>p.requestCursor===cursor);if(i<0)return null;const p=queue.splice(i,1)[0];if(p.hasMore&&p.cursor===cursor)throw new Error('search_cursor_did_not_advance');return p;};
 return {
  pendingPages:()=>structuredClone(queue),
  async first(){
   await page.cdp('Network.enable',{maxPostDataSize:65536});await page.events();
   await page.goto('https://www.instagram.com/explore/search/keyword/?q='+encodeURIComponent(keyword));
   for(let tick=0;tick<30;tick++){
    await checkTopic();await drain();const found=take(null);if(found)return found;
    await page.waitForTimeout(500);
   }
   throw new Error('initial_search_response_missing');
  },
  async next({previousCursor,currentPageProcessed}){
   if(currentPageProcessed!==true)throw new Error('current_page_not_processed');
   if(typeof previousCursor!=='string'||!previousCursor)throw new Error('previous_search_cursor_missing');
   await checkTopic();await page.cdp('Network.enable',{maxPostDataSize:65536});
   for(let attempt=0;attempt<3;attempt++){
    await drain();let found=take(previousCursor);if(found)return found;
    const before=await view();
    await page.waitForTimeout(10500);await page.mouse.move(1100,700);await page.mouse.wheel(0,1700,{label:'本批处理完后继续当前话题'});
    for(let tick=0;tick<24;tick++){await page.waitForTimeout(500);await checkTopic();await drain();found=take(previousCursor);if(found)return found;}
    const after=await view();
    if(after.codes.some(c=>!before.codes.includes(c)))throw new Error('search_results_loaded_without_verified_response');
   }
   throw new Error('search_pagination_stalled_end_unconfirmed');
  }
 };
}
