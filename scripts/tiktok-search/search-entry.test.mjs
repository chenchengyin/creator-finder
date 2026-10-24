import test from 'node:test';
import assert from 'node:assert/strict';
import {searchViaHomepage,readSearchPageWithDismiss} from './search.mjs';

test('入口-SEARCH-001 dismisses an optional login popup before opening the search drawer and submitting with Enter',async()=>{
 let login=true,url='',filled='';const actions=[];
 const page={goto:async value=>{actions.push(['goto',value]);url=value;},url:async()=>url,
  waitForSelector:async()=>{},evaluate:async fn=>fn.name==='readSearchPage'?{url,httpStatus:200,loginPrompt:login,captcha:false}:'视频',
  snapshot:async()=>login?'root\n  dialog "登录 TikTok"\n  button "关闭" [ref=7]':'root',
  click:async selector=>{actions.push(['click',selector]);if(selector==='@7')login=false;if(selector.includes('role:button[name="视频"]'))url='https://www.tiktok.com/search/video?q='+encodeURIComponent(filled);},
  fill:async(selector,value)=>{filled=value;actions.push(['fill',value]);},waitForFunction:async()=>{},
  keyboard:{press:async key=>{actions.push(['key',key]);url='https://www.tiktok.com/search?q='+encodeURIComponent(filled);}}};
 assert.equal(await searchViaHomepage(page,'christian skits'),'https://www.tiktok.com/search/video?q=christian%20skits');
 assert.deepEqual(actions.filter(a=>a[0]==='goto'),[['goto','https://www.tiktok.com/']]);
 assert(actions.findIndex(a=>a[1]==='@7')<actions.findIndex(a=>a[0]==='fill'));
 assert(actions.findIndex(a=>a[0]==='key'&&a[1]==='Enter')<actions.findIndex(a=>a[1].includes('role:button[name="视频"]')));
});
test('关闭-LOGIN-007 a login popup over an HTTP429 response remains paused without clicking',async()=>{
 const page={evaluate:async()=>({httpStatus:429,loginPrompt:true,captcha:false}),click:async()=>assert.fail('must not click')};
 assert.equal((await readSearchPageWithDismiss(page)).loginPrompt,true);
});
test('关闭-LOGIN-009 no login popup continues after one page read without close actions or extra waits',async()=>{
 let reads=0;const access={httpStatus:200,loginPrompt:false,captcha:false};
 const page={evaluate:async()=>{reads++;return access;},snapshot:async()=>assert.fail('no popup needs no close-button inspection'),
  click:async()=>assert.fail('no popup must not click'),waitForFunction:async()=>assert.fail('no popup must not wait')};
 assert.equal(await readSearchPageWithDismiss(page),access);assert.equal(reads,1);
});
