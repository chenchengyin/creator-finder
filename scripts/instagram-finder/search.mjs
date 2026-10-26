import {parseSearchConnection} from './workflow.mjs';
import {analyzeSearchResponse} from './search-response.mjs';
import {instagramSearchKeyword} from './keyword.mjs';

// A page is released only after its native response is verified; scrolling never proves exhaustion.
export function createSearchPager({page,keyword,searchKeyword:savedSearchKeyword,initialPages=[],onEvidence=async()=>{}}){
 if(typeof keyword!=='string'||!keyword.trim()||keyword!==keyword.trim()||keyword.length>200||/[\x00-\x1f]/.test(keyword))throw new Error('invalid_search_keyword');
 const restoredQueries=[...new Set([...initialPages.map(p=>p.searchKeyword??p.keyword),...(savedSearchKeyword===undefined?[]:[savedSearchKeyword])])];
 if(restoredQueries.length>1||restoredQueries.some(q=>q!==keyword&&q!==instagramSearchKeyword(keyword)))throw new Error('restored_search_query_mismatch');
 let searchKeyword=restoredQueries[0]??instagramSearchKeyword(keyword);
 let stage='restored';
 const history=new Map(),pending=new Map(),queue=initialPages.map(p=>{if(p.keyword!==keyword)throw new Error('restored_search_topic_mismatch');return {...p,searchKeyword,...parseSearchConnection(p.connection)};}),seen=new Set();
 const saveEvidence=async evidence=>{try{await onEvidence({...evidence,keyword,searchKeyword});}catch(error){error.storageFailure=true;throw error;}};
 const stop=(reason,evidence)=>{throw Object.assign(new Error(reason),{pause:true,searchEvidence:evidence});};
 const checkTopic=async({restoring=false}={})=>{const u=new URL(await page.url());if(/^\/(accounts\/login|challenge|checkpoint)(\/|$)/.test(u.pathname))throw new Error('instagram_login_or_challenge');
  // A legacy cursor belongs to its original plain query, not a newly prefixed one.
  if(restoring&&!restoredQueries.length&&u.searchParams.get('q')===keyword)searchKeyword=keyword;
  if(u.hostname!=='www.instagram.com'||u.searchParams.get('q')!==searchKeyword)throw new Error('search_topic_mismatch');};
 const view=()=>page.evaluate(()=>({url:location.href,codes:[...document.querySelectorAll('main a[href*="/p/"],main a[href*="/reel/"]')].map(a=>a.getAttribute('href').split('/')[2]),text:document.querySelector('main')?.innerText||''}));
 const drain=async({final=false}={})=>{
  const events=await page.events();
  for(const event of events)if(event.method==='Network.requestWillBeSent')history.set(event.params.requestId,{...event.params,stage});
  for(const event of events){
   if(event.method!=='Network.responseReceived')continue;
   const response=event.params.response;let url;try{url=new URL(response.url);}catch{continue;}
   if(url.hostname==='www.instagram.com'&&/graphql/.test(url.pathname))pending.set(event.params.requestId,response);
  }
  let blocker=null;
  for(const [id,response] of pending){
   let raw;
   try{raw=await page.cdp('Network.getResponseBody',{requestId:id});}
   catch(error){
    if(error.pause||error.storageFailure||/control|ownership|delegat|closed|detached|execution.*stopped/i.test(error.message))throw error;
    if(!final&&response.status>=200&&response.status<300)continue;
   }
   pending.delete(id);
   const documents=[];
   for(const line of (raw?(raw.base64Encoded?Buffer.from(raw.body,'base64').toString():raw.body):'').replace(/^for\s*\(;;\);/,'').split('\n')){try{documents.push(JSON.parse(line));}catch{}}
   if(!documents.length)documents.push(null);
   for(const data of documents){
    const result=analyzeSearchResponse({keyword:searchKeyword,stage,requestId:id,request:history.get(id),response,data});
    result.evidence={...result.evidence,keyword,searchKeyword};
    await saveEvidence(result.evidence);
    if(result.reason){
     // A retryable error must not hide a separate failure that requires a pause.
     const priority=reason=>reason==='instagram_login_or_challenge'?4:reason==='instagram_access_stopped_protection'?3:reason==='instagram_access_stopped_rate_limit'?1:reason?2:0;
     if(priority(result.reason)>priority(blocker?.reason))blocker=result;
     continue;
    }
    if(!result.page)continue;
    const parsed={...result.page,keyword,searchKeyword},key=JSON.stringify([parsed.requestCursor,parsed.cursor,parsed.items.map(i=>i.id)]);
    if(seen.has(key))continue;seen.add(key);queue.push(parsed);
   }
  }
  if(blocker)stop(blocker.reason,blocker.evidence);
 };
 const take=cursor=>{const i=queue.findIndex(p=>p.requestCursor===cursor);if(i<0)return null;const p=queue.splice(i,1)[0];if(p.hasMore&&p.cursor===cursor)throw new Error('search_cursor_did_not_advance');return p;};
 return {
  pendingPages:()=>structuredClone(queue),
  async first(){
   if(queue.some(p=>p.requestCursor===null)){await checkTopic();await saveEvidence({keyword,action:'restored',observedStage:stage,capturedAt:new Date().toISOString()});return take(null);}
   await page.cdp('Network.enable',{maxPostDataSize:65536});await page.events();
   stage='homepage';await page.goto('https://www.instagram.com/');
   const checkAccess=async()=>{
    const u=new URL(await page.url());
    if(/^\/(accounts\/login|challenge|checkpoint)(\/|$)/.test(u.pathname))throw new Error('instagram_login_or_challenge');
    if(u.hostname!=='www.instagram.com')throw new Error('search_topic_mismatch');
   };
   await checkAccess();await drain();
   const searchEntry='a[href="/explore/"]';
   const searchInput='input[aria-label="搜索输入"], input[aria-label="Search input"], input[placeholder="搜索"], input[placeholder="Search"]';
   await page.waitForSelector(searchEntry,{state:'visible',timeout:15000});
   stage='explore';await page.click(searchEntry,{label:'点击官网搜索入口'});
   await checkAccess();
   await page.waitForSelector(searchInput,{state:'visible',timeout:15000});
   // Explore renders a button over the input until the search panel is opened.
   if(await page.evaluate(()=>{const button=document.querySelector('main input + [role="button"]');return !!button?.getClientRects().length;}))await page.click('main input + [role="button"]',{label:'展开搜索输入面板'});
   await page.click(searchInput,{label:'点击关键词输入框'});
   await drain();stage='suggestions';await page.fill(searchInput,searchKeyword);
   await page.waitForFunction(({selector,value})=>document.activeElement?.matches(selector)&&document.activeElement.value===value,{selector:searchInput,value:searchKeyword},{timeout:5000});
   await drain();stage='submit';await page.keyboard.press('Enter');
   let resultLinkClicked=false;
   for(let tick=0;tick<30;tick++){
    await checkAccess();await drain();
    const current=new URL(await page.url());
    if(current.pathname.startsWith('/explore/search/')&&current.searchParams.get('q')===searchKeyword){const found=take(null);if(found)return found;}
    else if(!resultLinkClicked){
     const links=await page.evaluate(value=>[...document.querySelectorAll('main a[href]')].filter(a=>{
      try{
       const u=new URL(a.href),tag=u.pathname.match(/^\/explore\/tags\/([^/]+)\/?$/);
       const matches=u.pathname.startsWith('/explore/search/')&&u.searchParams.get('q')===value||value.startsWith('#')&&tag&&'#'+decodeURIComponent(tag[1])===value;
       return a.getClientRects().length&&u.origin==='https://www.instagram.com'&&matches;
      }catch{return false;}
     }).map(a=>({href:a.href})),searchKeyword);
     if(Array.isArray(links)&&links.length===1){stage='results';await page.click('loc=href:'+links[0].href,{label:'确认官网关键词结果'});resultLinkClicked=true;}
    }
    await page.waitForTimeout(500);
   }
   await drain({final:true});
   const current=new URL(await page.url());
   if(!current.pathname.startsWith('/explore/search/')||current.searchParams.get('q')!==searchKeyword){const evidence={keyword,searchKeyword,observedStage:stage,url:current.origin+current.pathname,reason:'search_confirmation_unavailable',action:'pause',capturedAt:new Date().toISOString()};await saveEvidence(evidence);stop(evidence.reason,evidence);}
   const found=take(null);if(found)return found;
   throw new Error('initial_search_response_missing');
  },
  async next({previousCursor,currentPageProcessed,knownCodes=[]}){
   if(currentPageProcessed!==true)throw new Error('current_page_not_processed');
   if(typeof previousCursor!=='string'||!previousCursor)throw new Error('previous_search_cursor_missing');
   const known=new Set(knownCodes),restoring=stage==='restored';stage='pagination';await checkTopic({restoring});await page.cdp('Network.enable',{maxPostDataSize:65536});
   for(let attempt=0;attempt<3;attempt++){
    await drain();let found=take(previousCursor);if(found)return found;
    const before=await view();
    await page.waitForTimeout(10500);await page.mouse.move(1100,700);await page.mouse.wheel(0,1700,{label:'本批处理完后继续当前话题'});
    for(let tick=0;tick<24;tick++){await page.waitForTimeout(500);await checkTopic();await drain();found=take(previousCursor);if(found)return found;}
    const after=await view();
    if(after.codes.some(c=>!before.codes.includes(c)&&!known.has(c)))throw new Error('search_results_loaded_without_verified_response');
   }
   await drain({final:true});
   const found=take(previousCursor);if(found)return found;
   throw new Error('search_pagination_stalled_end_unconfirmed');
  }
 };
}
