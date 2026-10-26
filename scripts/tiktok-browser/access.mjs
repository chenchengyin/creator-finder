import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

export const isControlError=error=>/control of (?:this )?task space|user now controls this task space|user control (?:lost|unavailable)|user-owned|inactive|unassigned|ownership|delegated/i.test(error.message);
export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function dismissTikTokLoginPopup(page,snapshot){
  if(!page.snapshot||!page.click||!page.waitForFunction)return false;
  snapshot??=await page.snapshot();
  const loginIndex=snapshot.search(/^\s*dialog[^\n]*(?:登录\s*TikTok|Log in to TikTok)/mi);
  if(/captcha|验证码/i.test(snapshot)||loginIndex<0)return false;
  const buttons=[...snapshot.slice(loginIndex).matchAll(/^\s*button "(?:关闭|Close|Close dialog)"[^\n]*\[ref=(\d+)/gmi)];
  if(buttons.length!==1)return false;
  await page.click('@'+buttons[0][1],{label:'关闭 TikTok 登录弹窗'});
  await page.waitForFunction(()=>![...document.querySelectorAll('[role="dialog"]')].some(e=>e.getClientRects().length&&/登录\s*TikTok|Log in to TikTok/i.test(e.innerText)),undefined,{timeout:3000});
  return true;
}

export async function inspectReloadScreen(page){
  if(!page.snapshot)return null;
  let snapshot=(await page.snapshot()).replace(/^\s*text "(.*)"$/gm,'$1');
  if(/captcha|验证码/i.test(snapshot))return 'captcha';
  if(/^\s*dialog[^\n]*(?:登录\s*TikTok|Log in to TikTok)/mi.test(snapshot)&&await dismissTikTokLoginPopup(page,snapshot))snapshot=(await page.snapshot()).replace(/^\s*text "(.*)"$/gm,'$1');
  if(/Log in to TikTok|登录\s*TikTok/i.test(snapshot))return 'login';
  if(/Please wait|请稍候/i.test(snapshot))return 'waiting';
  const chrome403=/访问\s*www\.tiktok\.com\s*的请求遭到拒绝[\s\S]{0,500}HTTP ERROR 403/i.test(snapshot);
  const egoBlocked=/此页面已被 ego 屏蔽[\s\S]{0,500}ERR_BLOCKED_BY_CLIENT/i.test(snapshot);
  return (chrome403||egoBlocked)&&/重新加载/.test(snapshot)&&page.click?'reload_button':null;
}

export async function pace(path){
  let last=0;
  try{last=Number(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  assert(Number.isFinite(last)&&last>=0&&last<=Date.now()+1000,'invalid shared navigation timestamp');
  const wait=Math.max(0,10500-(Date.now()-last));if(wait)await sleep(wait);
  await writeFile(path,String(Date.now()));
}

// HTTP 403 keeps its single delayed retry. A visible TikTok error-page button may be clicked up to thirty times.
export async function navigateWith403Retry({page,url,read,beforeNavigate=async()=>{},sleep:wait=sleep,onAttempt=async()=>{},prior403=false,resumeReloadPage=false,priorReloadClicks=0,retryUsingReload=false}){
  assert(Number.isSafeInteger(priorReloadClicks)&&priorReloadClicks>=0&&priorReloadClicks<=30,'invalid saved reload-button attempt count');
  const attempts=[];
  if(prior403){const prior={number:1,url,httpStatus:403,source:'previously_observed_403',capturedAt:new Date().toISOString()};attempts.push(prior);await onAttempt(prior);}
  let access=null,error=null,reloadClicks=priorReloadClicks;
  const markScreen=(value,screen)=>screen==='captcha'?{...value,captcha:true}:screen==='login'?{...value,loginPrompt:true}:value;
  const protectedAccess=value=>value?.captcha||value?.loginPrompt||[401,429].includes(value?.httpStatus);
  const successfulAccess=value=>value?.httpStatus>=200&&value.httpStatus<400;
  const record=async(action,screen,attemptError=null)=>{
    access=markScreen(access,screen);
    const attempt={number:attempts.length+1,url,action,httpStatus:access?.httpStatus??null,captcha:!!access?.captcha,loginPrompt:!!access?.loginPrompt,
      ...(screen?{screen}:{}),...(reloadClicks?{reloadClicks}:{}),error:attemptError,capturedAt:new Date().toISOString()};
    attempts.push(attempt);await onAttempt(attempt);return attempt;
  };
  const readCurrent=async()=>{
    try{access=await read();}
    catch(cause){if(cause.pause||isControlError(cause))throw cause;access={httpStatus:null};error=cause.message;}
  };
  const settledReloadScreen=async()=>{
    let screen=await inspectReloadScreen(page);
    if(screen==='waiting'){
      await wait(5000);await readCurrent();screen=await inspectReloadScreen(page);
    }
    return screen;
  };
  const clickVisibleButtons=async({clicked=0}={})=>{
    if(clicked>=30)return;
    for(let count=clicked;count<30;count++){
      await wait(10000);
      await beforeNavigate();
      let screen=await settledReloadScreen();
      if(screen==='captcha'||screen==='login'){access=markScreen(access,screen);break;}
      if(screen!=='reload_button')break;
      error=null;let clickError=null;
      try{await page.click("loc=role:button[name='重新加载']");}
      catch(cause){if(cause.pause||isControlError(cause))throw cause;clickError=cause.message;}
      await readCurrent();
      screen=await settledReloadScreen();
      reloadClicks++;
      await record('reload_button',screen,clickError||error);
      if(protectedAccess(access)||screen==='captcha'||screen==='login')break;
      if(successfulAccess(access))break;
      if(screen!=='reload_button')break;
    }
  };

  if(!prior403&&!resumeReloadPage){
    await beforeNavigate();
    try{await page.goto(url);}catch(cause){if(cause.pause||isControlError(cause))throw cause;error=cause.message;}
    await readCurrent();
    let screen=await settledReloadScreen();
    access=markScreen(access,screen);
    await record('goto',screen,error);
    if(screen==='reload_button'&&!protectedAccess(access)){
      await clickVisibleButtons({clicked:reloadClicks});
      return {access,error,attempts,retried:attempts.length>1};
    }
    if(screen==='waiting')return {access,error,attempts,retried:attempts.length>1};
    if(access?.httpStatus!==403||protectedAccess(access))return {access,error,attempts,retried:false};
  }else{
    await readCurrent();
    const screen=await settledReloadScreen();
    access=markScreen(access,screen);
    if(screen==='reload_button'&&!protectedAccess(access)){
      await clickVisibleButtons({clicked:reloadClicks});
      return {access,error,attempts,retried:attempts.length>1};
    }
    if(screen==='captcha'||screen==='login'||screen==='waiting'||protectedAccess(access)||successfulAccess(access)){
      access=markScreen(access,screen);await record('inspect',screen);
      return {access,error,attempts,retried:true};
    }
    if(resumeReloadPage){await record('inspect',screen);return {access,error,attempts,retried:true};}
  }

  error=null;await wait(11000);
  await beforeNavigate();
  let action='goto',inspectOnly=false,screen=null,retryError=null;
  try{
    screen=await settledReloadScreen();
    access=markScreen(access,screen);
    if(screen==='captcha'||screen==='login'||screen==='waiting'||protectedAccess(access)||successfulAccess(access)){
      action='inspect';inspectOnly=true;
    }else if(screen==='reload_button'){
      action='reload_button';await page.click("loc=role:button[name='重新加载']");
    }else if(retryUsingReload){
      if(page.reload&&page.url&&await page.url()===url){action='reload';await page.reload();}
      else await page.goto(url);
    }else await page.goto(url);
  }catch(cause){if(cause.pause||isControlError(cause))throw cause;retryError=cause.message;error=retryError;}
  if(!inspectOnly)await readCurrent();
  screen=await settledReloadScreen();
  if(action==='reload_button')reloadClicks++;
  await record(action,screen,retryError||error);
  if(screen==='reload_button'&&!protectedAccess(access)){
    await clickVisibleButtons({clicked:reloadClicks});
  }
  return {access,error,attempts,retried:attempts.length>1};
}
