import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const api=await import('./access.mjs').catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?{}:Promise.reject(e));
const navigate=options=>{assert.equal(typeof api.navigateWith403Retry,'function','403 retry implementation missing');return api.navigateWith403Retry(options);};
const url='https://www.tiktok.com/@example/video/7698495015676300575';
const chromeErrorSnapshot=await readFile(new URL('./fixtures/chromium-403-split-text.txt',import.meta.url),'utf8');

test('the real Chromium split-text error snapshot and compact title both enter button recovery',async()=>{
 for(const snapshot of [chromeErrorSnapshot,'访问www.tiktok.com的请求遭到拒绝 HTTP ERROR 403 重新加载']){
  let clicks=0;const waits=[];
  const page={goto:async()=>assert.fail('resume must not navigate'),snapshot:async()=>clicks?'TikTok video page':snapshot,click:async()=>clicks++};
  const r=await navigate({page,url,prior403:true,resumeReloadPage:true,read:async()=>({httpStatus:clicks?200:403}),sleep:async ms=>waits.push(ms)});
  assert.equal(clicks,1);assert.deepEqual(waits,[10000]);assert.equal(r.access.httpStatus,200);
 }
});

test('a transient 403 waits eleven seconds and retries the identical URL once',async()=>{
 const actions=[],observations=[{httpStatus:403},{httpStatus:200}];
 const r=await navigate({page:{goto:async u=>actions.push(u)},url,read:async()=>observations.shift(),sleep:async ms=>actions.push(ms)});
 assert.deepEqual(actions,[url,11000,url]);assert.equal(r.access.httpStatus,200);assert.equal(r.attempts.length,2);assert.equal(r.retried,true);
});
test('video-detail recovery reloads the same page after the delayed 403 retry',async()=>{
 const actions=[],observations=[{httpStatus:403},{httpStatus:200}];
 const page={url:async()=>url,goto:async u=>actions.push(['goto',u]),reload:async()=>actions.push('reload')};
 const r=await navigate({page,url,retryUsingReload:true,read:async()=>observations.shift(),sleep:async ms=>actions.push(ms)});
 assert.deepEqual(actions,[['goto',url],11000,'reload']);assert.equal(r.access.httpStatus,200);assert.equal(r.attempts[1].action,'reload');
});
test('a visible 403 reload button is clicked even when the URL still matches the video',async()=>{
 const actions=[],observations=[{httpStatus:403},{httpStatus:200}];
 const page={url:async()=>url,goto:async u=>actions.push(['goto',u]),reload:async()=>actions.push('url_reload'),
  snapshot:async()=>"访问 www.tiktok.com 的请求遭到拒绝 HTTP ERROR 403 重新加载",
  click:async locator=>actions.push(['click',locator])};
 const r=await navigate({page,url,retryUsingReload:true,read:async()=>observations.shift(),sleep:async ms=>actions.push(ms)});
 assert.deepEqual(actions,[['goto',url],10000,['click',"loc=role:button[name='重新加载']"]]);
 assert.equal(r.access.httpStatus,200);assert.equal(r.attempts[1].action,'reload_button');
});
test('a successful TikTok page mentioning the error text is never treated as a browser error page',async()=>{
 let clicks=0;const page={goto:async()=>{},snapshot:async()=>"Video caption: HTTP ERROR 403. 重新加载 is discussed in the video.",click:async()=>clicks++};
 const r=await navigate({page,url,retryUsingReload:true,read:async()=>({httpStatus:200}),sleep:async()=>{}});
 assert.equal(clicks,0);assert.equal(r.attempts.length,1);assert.equal(r.access.httpStatus,200);
});
test('observed 401 or 429 wins over a visible reload button',async()=>{
 for(const httpStatus of [401,429]){
  let clicks=0;const page={goto:async()=>{},snapshot:async()=>"HTTP ERROR 403 重新加载",click:async()=>clicks++};
  const r=await navigate({page,url,retryUsingReload:true,read:async()=>({httpStatus}),sleep:async()=>assert.fail('protected status must not wait/retry')});
  assert.equal(clicks,0);assert.equal(r.attempts.length,1);
 }
});
test('a 403 recovery that reveals the reload button stops after its first successful click',async()=>{
 let snapshots=0,clicks=0,reads=0;const page={url:async()=>url,goto:async()=>{},reload:async()=>{},
  snapshot:async()=>++snapshots===1?'HTTP ERROR 403':clicks?'TikTok video page':"访问 www.tiktok.com 的请求遭到拒绝 HTTP ERROR 403 重新加载",click:async()=>clicks++};
 const r=await navigate({page,url,retryUsingReload:true,read:async()=>({httpStatus:reads++===0?403:200}),sleep:async()=>{}});
 assert.equal(clicks,1);assert.equal(r.access.httpStatus,200);assert.equal(r.attempts.length,2);
});
test('video-detail recovery navigates to the exact URL if the current page differs',async()=>{
 const actions=[],observations=[{httpStatus:403},{httpStatus:200}];
 const page={url:async()=>url+'/other',goto:async u=>actions.push(['goto',u]),reload:async()=>actions.push('reload')};
 await navigate({page,url,retryUsingReload:true,read:async()=>observations.shift(),sleep:async ms=>actions.push(ms)});
 assert.deepEqual(actions,[['goto',url],11000,['goto',url]]);
});
test('a TikTok 403 browser error page clicks its visible reload button for any navigation caller',async()=>{
 const actions=[],observations=[{httpStatus:403},{httpStatus:200}];
 const page={url:async()=>"chrome-error://chromewebdata/",goto:async u=>actions.push(['goto',u]),snapshot:async()=>"访问 www.tiktok.com 的请求遭到拒绝 HTTP ERROR 403 重新加载",click:async locator=>actions.push(['click',locator])};
 const r=await navigate({page,url,read:async()=>observations.shift(),sleep:async ms=>actions.push(ms)});
 assert.deepEqual(actions,[['goto',url],10000,["click","loc=role:button[name='重新加载']"]]);assert.equal(r.access.httpStatus,200);assert.equal(r.attempts[1].action,'reload_button');
});
test('a successful button click clears a prior inspection error',async()=>{
 let clicks=0,reads=0;const page={goto:async()=>{},snapshot:async()=>clicks?'TikTok video page':"访问 www.tiktok.com 的请求遭到拒绝 HTTP ERROR 403 重新加载",click:async()=>clicks++};
 const r=await navigate({page,url,read:async()=>{if(++reads===1)throw Error('response_missing');return {httpStatus:200};},sleep:async()=>{}});
 assert.equal(clicks,1);assert.equal(r.access.httpStatus,200);assert.equal(r.error,null);
});
test('a saved 403 resumes through the visible reload button instead of navigating again',async()=>{
 const actions=[];let clicks=0;
 const page={url:async()=>"chrome-error://chromewebdata/",goto:async u=>actions.push(['goto',u]),
  snapshot:async()=>clicks?"TikTok video page":"访问 www.tiktok.com 的请求遭到拒绝 HTTP ERROR 403 重新加载",
  click:async locator=>{clicks++;actions.push(['click',locator]);}};
 const r=await navigate({page,url,prior403:true,read:async()=>({httpStatus:clicks?200:403}),sleep:async ms=>actions.push(ms)});
 assert.deepEqual(actions,[10000,["click","loc=role:button[name='重新加载']"]]);assert.equal(r.access.httpStatus,200);assert.equal(r.attempts.at(-1).action,'reload_button');
});
test('an Ego-blocked TikTok page clicks its visible reload button up to thirty times for any navigation caller',async()=>{
 const actions=[],saved=[];let clicks=0,pacedActions=0;
 const page={goto:async u=>actions.push(['goto',u]),snapshot:async()=>"www.tiktok.com 已被屏蔽 此页面已被 ego 屏蔽 ERR_BLOCKED_BY_CLIENT 重新加载",click:async locator=>{clicks++;actions.push(['click',locator]);}};
 const r=await navigate({page,url,read:async()=>({httpStatus:0}),beforeNavigate:async()=>pacedActions++,sleep:async ms=>actions.push(ms),onAttempt:async a=>saved.push(a)});
 assert.equal(clicks,30);assert.deepEqual(actions.slice(0,2),[['goto',url],10000]);assert.equal(actions.filter(a=>Array.isArray(a)&&a[0]==='click').length,30);
 assert.equal(pacedActions,31);assert.equal(r.attempts.length,31);assert.equal(saved.length,31);assert.equal(r.attempts.at(-1).action,'reload_button');
});
test('every visible reload retry waits ten seconds after checking the previous result even without caller pacing',async()=>{
 let tick=0,checks=0;const clicks=[],waits=[];
 const page={goto:async()=>{},snapshot:async()=>clicks.length<3?'访问www.tiktok.com的请求遭到拒绝 HTTP ERROR 403 重新加载':'TikTok video page',click:async()=>{clicks.push({at:tick,afterCheck:checks});}};
 const result=await navigate({page,url,beforeNavigate:async()=>{},sleep:async ms=>{waits.push(ms);tick+=ms;},read:async()=>{checks++;tick+=200;return {httpStatus:clicks.length>=3?200:403};}});
 assert.equal(result.access.httpStatus,200);assert.equal(clicks.length,3);
 assert.deepEqual(waits,[10000,10000,10000]);
 for(let i=1;i<clicks.length;i++){assert(clicks[i].at-clicks[i-1].at>=10200);assert(clicks[i].afterCheck>clicks[i-1].afterCheck);}
});
test('a resumed page with an exhausted thirty-click budget stops without another wait or click',async()=>{
 let clicks=0;const waits=[];const page={goto:async()=>{},snapshot:async()=>"此页面已被 ego 屏蔽 ERR_BLOCKED_BY_CLIENT 重新加载",click:async()=>clicks++};
 const r=await navigate({page,url,prior403:true,priorReloadClicks:30,read:async()=>({httpStatus:0}),sleep:async ms=>waits.push(ms)});
 assert.equal(clicks,0);assert.deepEqual(waits,[]);assert.equal(r.attempts.length,1);
});
test('visible reload attempts stop as soon as the TikTok page recovers',async()=>{
 let clicks=0,reads=0;const page={goto:async()=>{},snapshot:async()=>clicks>=3?'TikTok video page':"www.tiktok.com 已被屏蔽 此页面已被 ego 屏蔽 ERR_BLOCKED_BY_CLIENT 重新加载",click:async()=>clicks++};
 const r=await navigate({page,url,retryUsingReload:true,read:async()=>({httpStatus:++reads===1?0:clicks>=3?200:0}),sleep:async()=>{}});
 assert.equal(clicks,3);assert.equal(r.access.httpStatus,200);assert.equal(r.attempts.length,4);
});
test('a CAPTCHA that appears after a reload click stops further attempts',async()=>{
 let clicks=0;const page={goto:async()=>{},snapshot:async()=>clicks?'验证码 challenge':"www.tiktok.com 已被屏蔽 此页面已被 ego 屏蔽 ERR_BLOCKED_BY_CLIENT 重新加载",click:async()=>clicks++};
 const r=await navigate({page,url,retryUsingReload:true,read:async()=>({httpStatus:0}),sleep:async()=>{}});
 assert.equal(clicks,1);assert.equal(r.access.captcha,true);assert.equal(r.attempts.length,2);
});
test('a Please wait page settles before the retry flow decides whether to stop',async()=>{
 let clicks=0,settled=false;const waits=[];
 const page={goto:async()=>{},snapshot:async()=>settled?'TikTok video page':clicks?'Please wait...':"此页面已被 ego 屏蔽 ERR_BLOCKED_BY_CLIENT 重新加载",click:async()=>clicks++};
 const r=await navigate({page,url,read:async()=>({httpStatus:settled?200:0}),sleep:async ms=>{waits.push(ms);if(ms===5000)settled=true;}});
 assert.equal(clicks,1);assert.deepEqual(waits,[10000,5000]);assert.equal(r.access.httpStatus,200);
});
test('two 403s exhaust the retry and never navigate a third time',async()=>{
 const actions=[];const r=await navigate({page:{goto:async u=>actions.push(u)},url,read:async()=>({httpStatus:403}),sleep:async ms=>actions.push(ms)});
 assert.deepEqual(actions,[url,11000,url]);assert.equal(r.access.httpStatus,403);assert.equal(r.attempts.length,2);
});
test('401, 429 and a captcha do not enter the 403 retry path',async()=>{
 for(const access of [{httpStatus:401},{httpStatus:429},{httpStatus:403,captcha:true},{httpStatus:403,loginPrompt:true}]){
  let calls=0;const r=await navigate({page:{goto:async()=>calls++},url,read:async()=>access,sleep:async()=>assert.fail('must not wait/retry')});
  assert.equal(calls,1);assert.equal(r.retried,false);
 }
});
test('control loss during the retry propagates without inspecting or taking over the page',async()=>{
 let calls=0,reads=0;
 await assert.rejects(navigate({page:{goto:async()=>{if(++calls===2)throw Error('space is user-owned');}},url,read:async()=>{reads++;return {httpStatus:403};},sleep:async()=>{}}),/user-owned/);
 assert.equal(calls,2);assert.equal(reads,1);
});
test('a failed navigation is inspected, allowing an observed 403 to receive its single retry',async()=>{
 let calls=0;const r=await navigate({page:{goto:async()=>{if(++calls===1)throw Error('net::ERR_HTTP_RESPONSE_CODE_FAILURE');}},url,read:async()=>({httpStatus:calls===1?403:200}),sleep:async()=>{}});
 assert.equal(r.access.httpStatus,200);assert.equal(r.attempts[0].httpStatus,403);assert(r.attempts[0].error);assert.equal(r.error,null);
});
test('a previously recorded 403 consumes the original attempt and permits only one delayed navigation',async()=>{
 const actions=[];const r=await navigate({page:{goto:async u=>actions.push(u)},url,prior403:true,read:async()=>({httpStatus:403}),sleep:async ms=>actions.push(ms)});
 assert.deepEqual(actions,[11000,url]);assert.equal(r.attempts.length,2);assert.equal(r.access.httpStatus,403);
});
test('attempt callbacks preserve both failure and recovery evidence',async()=>{
 const saved=[];let n=0;
 await navigate({page:{goto:async()=>n++},url,read:async()=>({httpStatus:n===1?403:200}),sleep:async()=>{},onAttempt:async attempt=>saved.push(attempt.httpStatus)});
 assert.deepEqual(saved,[403,200]);
});
