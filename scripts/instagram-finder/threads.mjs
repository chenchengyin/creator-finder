export function analyzeThreadsLinks(links,username){
 const base={status:'not_observed',hasThreads:null,accountUsername:null,url:null,source:'instagram_profile_threads_badge',meaning:'instagram_linked_threads_account'};
 for(const link of links){
  if(!link.nativeBadge)continue;
  let url;try{url=new URL(link.url);}catch{continue;}
  if(url.protocol!=='https:'||!['threads.com','www.threads.com','threads.net','www.threads.net'].includes(url.hostname))continue;
  const match=url.pathname.match(/^\/@([A-Za-z0-9._]{1,30})\/?$/);
  if(!match||match[1].toLowerCase()!==username.toLowerCase())continue;
  return {...base,status:'observed',hasThreads:true,accountUsername:match[1],url:link.url,linkText:link.text};
 }
 return {...base,reason:'linked_badge_not_observed_not_proof_of_no_account'};
}

export async function readThreadsAccount({page,username,navigate=true}){
 if(typeof username!=='string'||!/^[A-Za-z0-9._]{1,30}$/.test(username))throw new Error('invalid_instagram_username');
 const base={username,profileUrl:'https://www.instagram.com/'+username+'/',status:'unknown',hasThreads:null,url:null,capturedAt:null};
 try{
  if(navigate)await page.goto(base.profileUrl);
  const current=new URL(await page.url());
  if(/^\/(accounts\/login|challenge|checkpoint)(\/|$)/.test(current.pathname))return {...base,status:'paused',reason:'instagram_login_or_challenge'};
  if(current.hostname!=='www.instagram.com'||current.pathname.toLowerCase()!=='/'+username.toLowerCase()+'/')return {...base,reason:'profile_url_mismatch'};
  await page.waitForSelector('main header',{timeout:15000});
  const observation=await page.evaluate(()=>({username:document.querySelector('main header h2,main header h1')?.textContent?.trim(),links:[...document.querySelectorAll('main header a[href]')].map(a=>({url:a.href,text:a.textContent?.trim(),nativeBadge:!!a.querySelector('svg[aria-label="Threads"],img[alt="Threads"]')}))}));
  if(observation.username?.toLowerCase()!==username.toLowerCase())return {...base,reason:'profile_identity_mismatch'};
  return {...base,...analyzeThreadsLinks(observation.links,username),capturedAt:new Date().toISOString()};
 }catch(error){
  if(error.pause||error.storageFailure)throw error;
  if(/Control of this task space|delegat|ownership/i.test(error.message))throw error;
  return {...base,reason:error.message};
 }
}
