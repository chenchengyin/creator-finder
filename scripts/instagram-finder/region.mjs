import {responseProtectionReason,waitForDialogToClear} from './protection.mjs';
const COUNTRY_KEY='IG_ABOUT_THIS_ACCOUNT:about_this_account_country';
const countryNames=new Map();
for(const locale of ['en','zh-CN']){
 const names=new Intl.DisplayNames([locale],{type:'region'});
 for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){
  const code=String.fromCharCode(a,b),name=names.of(code);
  if(name!==code&&!['ZZ','EU','UN','UK','XA','XB'].includes(code)){
   if(!countryNames.has(name.toLowerCase()))countryNames.set(name.toLowerCase(),code);
   countryNames.set(code.toLowerCase(),code);
  }
 }
}
function countryValue(raw){
 const rawText=typeof raw==='string'?raw.trim():null;
 if(!rawText||/^(not shared|not available|未分享|未公开|不公开)$/i.test(rawText))return {status:'not_shared',rawText,countryCode:null};
 const countryCode=countryNames.get(rawText.toLowerCase())||null;
 return {status:countryCode?'observed':'unrecognized',rawText,countryCode};
}
const hasIdentity=(text,username)=>new RegExp('(^|[^a-z0-9_.])'+username.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^a-z0-9_.])','i').test(text);
export function parseCountryResponse(body,username){
 try{
  const data=JSON.parse(body.replace(/^for\s*\(;;\);/,''));
  const protection=responseProtectionReason(data);if(protection)return {status:'paused',reason:protection,countryCode:null,rawText:null};
  if(!hasIdentity(JSON.stringify(data),username))return null;
  const fields=data.payload?.layout?.bloks_payload?.data;
  if(!Array.isArray(fields))return null;
  if(fields.some(x=>x.data?.key===COUNTRY_KEY+'_visibility'&&x.data.initial===false))return countryValue(null);
  const matches=fields.filter(x=>x.data?.key===COUNTRY_KEY);
  if(!matches.length)return null;
  const values=[...new Set(matches.map(x=>x.data.initial))];
  return values.length===1?countryValue(values[0]):{status:'conflict',countryCode:null,rawText:null};
 }catch{return null;}
}
export function parseCountryDialog(text,username){
 const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
 if(!lines.some(x=>x.toLowerCase()===username.toLowerCase())||!lines.some(x=>/^(关于此个人主页|关于此账户|About this account|About this profile)$/i.test(x)))return null;
 const index=lines.findIndex(x=>/^(账户所在地|账号所在地|Account based in)$/i.test(x));
 return index<0?null:countryValue(/^(关闭|Close)$/i.test(lines[index+1]||'')?null:lines[index+1]);
}

export async function readAccountCountry({page,username,navigate=true}){
 if(typeof username!=='string'||!/^[A-Za-z0-9._]{1,30}$/.test(username))throw new Error('invalid_instagram_username');
 const profileUrl='https://www.instagram.com/'+username+'/';
 const result={username,profileUrl,status:'unknown',countryCode:null,rawText:null,source:null,meaning:'account_based_in',residenceVerified:false,capturedAt:null};
 let owned=false,lostControl=false;
 try{
  if(navigate)await page.goto(profileUrl);
  const current=new URL(await page.url());
  if(/^\/(accounts\/login|challenge|checkpoint)(\/|$)/.test(current.pathname))return {...result,status:'paused',reason:'instagram_login_or_challenge'};
  await page.waitForSelector('main header',{timeout:15000});
  if(current.hostname!=='www.instagram.com'||current.pathname.toLowerCase()!=='/'+username.toLowerCase()+'/')return {...result,reason:'profile_url_mismatch'};
  const state=await page.evaluate(({operation})=>({username:document.querySelector('main header h2,main header h1')?.textContent?.trim(),profileReady:!!document.querySelector('main header'),dialogCount:document.querySelectorAll('[role="dialog"]').length}),{operation:'inspect'});
  if(state.username?.toLowerCase()!==username.toLowerCase()||!state.profileReady)return {...result,reason:'profile_identity_mismatch'};
  if(state.dialogCount&&!await waitForDialogToClear(page))return {...result,reason:'existing_dialog'};
  await page.cdp('Network.enable',{});await page.events();
  await page.click('main header [role="button"]:has(svg[aria-label="选项"]),main header [role="button"]:has(svg[aria-label="Options"])',{label:'打开 Instagram 原生选项'});
  owned=true;
  await page.waitForFunction(()=>[...document.querySelectorAll('[role="dialog"] button,[role="dialog"] [role="button"]')].some(e=>/^(账户简介|账号简介|About this account|About this profile)$/i.test(e.textContent.trim())),undefined,{timeout:5000});
  const menu=await page.evaluate(({operation})=>{const entry=[...document.querySelectorAll('[role="dialog"] button,[role="dialog"] [role="button"]')].find(e=>/^(账户简介|账号简介|About this account|About this profile)$/i.test(e.textContent.trim()));entry?.setAttribute('data-creator-country-open','');return {entry:!!entry};},{operation:'menu'});
  if(!menu.entry)return {...result,reason:'about_entry_unavailable'};
  await page.evaluate(({operation})=>{document.body.setAttribute('data-creator-country-query','');const style=document.createElement('style');style.id='creator-country-query-style';style.textContent='body[data-creator-country-query] [role="dialog"]:has([data-bloks-name]){opacity:0!important}';document.head.appendChild(style);setTimeout(()=>{if(document.getElementById(style.id)===style){style.remove();document.body.removeAttribute('data-creator-country-query');}},15000);},{operation:'mask'});
  await page.click('[data-creator-country-open]',{label:'查询原生账户所在地'});
  await page.waitForTimeout(700);
  const earlyEvents=await page.events();
  for(const event of earlyEvents){
   const response=event.method==='Network.responseReceived'&&event.params.response;
   if(response&&new URL(response.url).origin==='https://www.instagram.com'&&new URL(response.url).pathname==='/async/wbloks/fetch/'&&[401,403,429].includes(response.status))return {...result,status:'paused',reason:'instagram_access_stopped_'+response.status};
  }
  await page.waitForFunction(()=>[...document.querySelectorAll('[role="dialog"]')].some(e=>/关于此个人主页|关于此账户|About this account|About this profile/i.test(e.textContent)),undefined,{timeout:10000});
  const dialog=await page.evaluate(({operation,username})=>{const node=[...document.querySelectorAll('[role="dialog"]')].find(e=>/关于此个人主页|关于此账户|About this account|About this profile/i.test(e.textContent));const close=[...node?.querySelectorAll('button,[role="button"]')||[]].find(e=>/^(关闭|Close)$/i.test(e.textContent.trim()));close?.setAttribute('data-creator-country-close','');return {text:node?.innerText||'',close:!!close};},{operation:'dialog',username});
  const dom=parseCountryDialog(dialog.text,username);
  if(!hasIdentity(dialog.text,username))return {...result,reason:'dialog_identity_mismatch'};
  let observed=null;
  for(const event of [...earlyEvents,...await page.events()]){
   if(event.method!=='Network.responseReceived')continue;
   const {response,requestId}=event.params;
   const url=new URL(response.url);
   if(url.origin!=='https://www.instagram.com'||url.pathname!=='/async/wbloks/fetch/')continue;
   if([401,403,429].includes(response.status))return {...result,status:'paused',reason:'instagram_access_stopped_'+response.status};
   if(response.status!==200)continue;
   let body;
   try{body=await page.cdp('Network.getResponseBody',{requestId});}catch{continue;}
   const parsed=parseCountryResponse(body.base64Encoded?Buffer.from(body.body,'base64').toString():body.body,username);
   if(parsed?.status==='paused')return {...result,...parsed};
   if(parsed)observed={...parsed,source:'instagram_about_this_account_response',fieldPath:'payload.layout.bloks_payload.data[].data.initial',requestUrl:url.origin+url.pathname};
  }
  if(observed&&dom&&observed.countryCode!==dom.countryCode)return {...result,status:'conflict',reason:'response_dialog_country_conflict'};
  const selected=observed||(dom&&{...dom,source:'instagram_about_this_account_dialog'});
  return {...result,...selected,capturedAt:new Date().toISOString(),...(!selected?{reason:'country_not_returned'}:{})};
 }catch(error){
  if(error.pause||error.storageFailure){lostControl=true;throw error;}
  if(/Control of this task space|delegat|ownership/i.test(error.message)){lostControl=true;throw error;}
  if(/^\/(accounts\/login|challenge|checkpoint)(\/|$)/.test(new URL(await page.url()).pathname))return {...result,status:'paused',reason:'instagram_login_or_challenge'};
  return {...result,reason:error.message};
 }finally{
  if(owned&&!lostControl){
   try{await page.click('[data-creator-country-close]',{label:'关闭本次账户资料卡'});await page.waitForFunction(()=>!document.querySelector('[data-creator-country-close]'),undefined,{timeout:5000});}catch(error){
    if(/Control of this task space|delegat|ownership/i.test(error.message))throw error;
    if(/intercepts pointer events/i.test(error.message)){
     await page.press('[data-creator-country-close]','Enter');
     await page.waitForFunction(()=>!document.querySelector('[data-creator-country-close]'),undefined,{timeout:5000});
    }else await page.keyboard.press('Escape');
   }
   await page.evaluate(({operation})=>{document.getElementById('creator-country-query-style')?.remove();document.body.removeAttribute('data-creator-country-query');document.querySelectorAll('[data-creator-country-open],[data-creator-country-close]').forEach(e=>{e.removeAttribute('data-creator-country-open');e.removeAttribute('data-creator-country-close');});},{operation:'cleanup'});
  }
 }
}
