const unavailable=e=>/control of (?:this )?task space|user now controls this task space|user control (?:lost|unavailable)|ownership|delegat|CDP|closed|detached|unresponsive|inactive|execution.*stopped/i.test(e.message);
export function createSession({log,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),lastActionAt=null,onWait=()=>{}}){
 let current={},failure=null,nextActionAt=null;
 const state={lastActionAt};
 const assertHealthy=()=>{if(failure)throw failure;};
 const guard=async call=>{assertHealthy();try{return await call();}catch(e){if(unavailable(e)&&!e.storageFailure){e.pause=true;e.reason='browser_unavailable: '+e.message;}if(e.pause||e.storageFailure)failure=e;throw e;}};
 const record=async event=>{try{await log({...current,...event,at:new Date(now()).toISOString()});}catch(e){e.storageFailure=true;failure=e;throw e;}};
 const pace=async(action,target)=>{
  assertHealthy();
  const min=action==='goto'&&/^https:\/\/(www\.)?tiktok\.com\//.test(target)?10500:8000;
  const until=nextActionAt!==null&&min===8000?nextActionAt:state.lastActionAt+min;
  const delay=state.lastActionAt===null?0:Math.max(0,until-now());
  if(delay){onWait({until:now()+delay,reason:'action_pacing'});try{await sleep(delay);}finally{onWait(null);}}
  assertHealthy();
 };
 const execute=async(page,action,target,call)=>{
  let beforeUrl;
  assertHealthy();
  try{
   beforeUrl=await page.url();
   await pace(action,target);
   await record({phase:'before',page:page.label,action,target,beforeUrl});
   state.lastActionAt=now();nextActionAt=null;
   const value=await call();
   await record({phase:'after',page:page.label,action,target,beforeUrl,afterUrl:await page.url()});
   return value;
  }catch(e){
   if(!e.storageFailure)await record({phase:'error',page:page.label,action,target,beforeUrl,error:e.message});
   if(unavailable(e)&&!e.storageFailure){e.pause=true;e.reason='browser_unavailable: '+e.message;}
   if(e.pause||e.storageFailure)failure=e;
   throw e;
  }
 };
 return {state,assertHealthy,context(value){current={...current,...value};},wrap(raw){
  return new Proxy(raw,{get(target,key){
   if(key==='countryProfileReady')return ()=>guard(async()=>{await record({phase:'confirmed',page:raw.label,action:'country_profile_ready'});nextActionAt=now()+2000;});
   if(key==='countryMenuReady')return ()=>guard(async()=>{await record({phase:'confirmed',page:raw.label,action:'country_menu_ready'});nextActionAt=now()+500;});
   if(key==='countryDialogRead')return ()=>guard(async()=>{await record({phase:'confirmed',page:raw.label,action:'country_dialog_read'});nextActionAt=now()+500;});
   if(key==='countryDialogClosed')return ()=>guard(async()=>{await record({phase:'confirmed',page:raw.label,action:'country_dialog_closed'});nextActionAt=now()+1000;});
   if(key==='waitForTimeout')return ms=>guard(async()=>{onWait({until:now()+ms,reason:'page_delay'});try{return await raw.waitForTimeout(ms);}finally{onWait(null);}});
   // Let a coordinate action inspect its target only after the shared pacing wait.
   if(key==='prepareAction')return (action,target='')=>guard(()=>pace(action,target));
   if(['goto','click','reload','close','press'].includes(key)&&typeof raw[key]==='function')return (...args)=>execute(raw,key,String(args[0]||''),()=>raw[key](...args));
   if(['mouse','keyboard'].includes(key)&&raw[key])return new Proxy(raw[key],{get(device,method){const value=device[method];if(typeof value!=='function')return value;if(method==='wheel'||method==='press'||method==='click')return (...args)=>execute(raw,`${key}.${String(method)}`,String(args[0]||''),()=>value.apply(device,args));return (...args)=>guard(()=>value.apply(device,args));}});
   const value=Reflect.get(target,key,target);return typeof value==='function'? (...args)=>guard(()=>value.apply(target,args)):value;
  }});
 }};
}
