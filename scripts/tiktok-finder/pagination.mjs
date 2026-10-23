const pause=reason=>Object.assign(Error(reason),{pause:true});

export function readScrollState(){
 let root=document.querySelector('[data-e2e="user-post-item"],a[href*="/video/"]')?.parentElement;
 while(root&&!(root.clientHeight>100&&root.scrollHeight>root.clientHeight+100&&/auto|scroll/.test(getComputedStyle(root).overflowY)))root=root.parentElement;
 root=root||document.scrollingElement;
 if(!root)return {blocked:true};
 const rect=root===document.scrollingElement?{left:0,right:innerWidth,top:0,bottom:innerHeight}:root.getBoundingClientRect();
 const left=Math.max(0,rect.left),right=Math.min(innerWidth,rect.right),top=Math.max(0,rect.top),bottom=Math.min(innerHeight,rect.bottom);
 const x=(left+right)/2,y=(top+bottom)/2,hit=document.elementFromPoint(x,y);
 const links=[...document.querySelectorAll('a[href*="/video/"]')];
 return {blocked:right-left<20||bottom-top<100||!hit||!root.contains(hit)||!!hit.closest?.('[role="dialog"],[aria-modal="true"]'),
  x,y,viewportHeight:Math.min(root.clientHeight,bottom-top),position:root.scrollTop,
  signature:[root.scrollTop,root.scrollHeight,links.length,links[0]?.href,links.at(-1)?.href].join('|')};
}

// One collector owns the destructive page.events() drain, including time spent in cooldowns.
export function createPaginationCollector({page,scopeMatches,now}){
 let scope,records=new Map(),sequence=0,rejected=false;
 const parse=value=>{try{return new URL(value);}catch{return null;}};
 const matching=url=>url?.origin===parse(scope.url)?.origin&&url?.pathname===scope.endpoint&&(!scope.keyword||[url.searchParams.get('keyword'),url.searchParams.get('q')].includes(scope.keyword));
 const matchesRequest=record=>scopeMatches(record.request.documentURL,scope.url)&&(!record.request.request?.url||matching(parse(record.request.request.url)));
 return {
  configure(next,continuation){if(!continuation||JSON.stringify(next)!==JSON.stringify(scope)){records=new Map();rejected=false;}scope=next;},
  async reset(){await page.events();records=new Map();rejected=false;},
  async drain(){
   if(!scope)return [];
   for(const event of await page.events()){
    const p=event.params||{},id=p.requestId;
    if(event.method==='Network.requestWillBeSent'){
     const url=parse(p.request?.url);
     if(url&&url.pathname!==scope.endpoint)continue;
     records.set(id,{id,request:p,order:sequence++,observedAt:now(),used:false});
    }else if(event.method==='Network.responseReceived'){
     const url=parse(p.response?.url);if(!matching(url))continue;
     const record=records.get(id);
     if(record&&matchesRequest(record)){record.response=p.response;record.relevant=true;}
     else if(!record)rejected=true;
    }else if(records.has(id)){
     if(event.method==='Network.loadingFinished')records.get(id).finished=true;
     if(event.method==='Network.loadingFailed')records.get(id).failed=true;
    }
   }
   return this.pending();
  },
  pending(){return [...records.values()].filter(r=>!r.used&&(r.relevant||(r.request.request?.url&&matching(parse(r.request.request.url))&&matchesRequest(r)))).sort((a,b)=>a.order-b.order);},
  get rejected(){return rejected;},
  commit(batch){for(const record of batch)record.used=true;},
 };
}

export function validatePaginationChain(records,bodies,{keyword,expectedCursor}){
 let expected=expectedCursor,ended=false;const seen=new Map(),accepted=[];
 for(let i=0;i<bodies.length;i++){
  const request=records[i].request.request;let input;
  try{input=new URL(request?.url).searchParams.get('cursor')??undefined;}catch{}
  const body=bodies[i],status=keyword?body.status_code:body.statusCode;
  const more=keyword?body.has_more:body.hasMore;
  if(status!==0||![0,1,true,false].includes(more))throw pause('pagination_response_invalid');
  const fingerprint=JSON.stringify([body.cursor,more,((keyword?body.item_list:body.itemList)||[]).map(item=>item.id)]);
  if(input!==undefined&&seen.has(input)){
   const previous=seen.get(input);if(previous.fingerprint!==fingerprint)throw pause('pagination_chain_conflict');
   accepted[previous.index]=body;continue;
  }
  if(ended)throw pause('pagination_chain_after_end');
  if(input!==undefined&&expected!==undefined&&expected!==null&&String(expected)!==input)throw pause('pagination_chain_mismatch');
  if([1,true].includes(more)&&body.cursor===undefined)throw pause('pagination_cursor_missing');
  if(input!==undefined)seen.set(input,{fingerprint,index:accepted.length});
  accepted.push(body);ended=[0,false].includes(more);
  expected=body.cursor;
 }
 return accepted;
}
