import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {dismissTikTokLoginPopup,inspectReloadScreen} from './access.mjs';

const popup='root\n  button "关闭" [ref=2]\n  container\n    dialog "登录 TikTok"\n      heading "登录 TikTok"\n    button "关闭" [ref=54]';
function fixture(snapshot=popup){
 let visible=true;const clicks=[];
 const page={snapshot:async()=>visible?snapshot:'root',click:async selector=>{clicks.push(selector);visible=false;},
  waitForFunction:async fn=>assert.equal(vm.runInNewContext('('+fn.toString()+')()',{
   document:{querySelectorAll:()=>visible?[{getClientRects:()=>[{}],innerText:'登录 TikTok'}]:[]}
  }),true)};
 return {page,clicks};
}
test('关闭-LOGIN-001 closes the login popup rather than the earlier search-panel close button',async()=>{
 const f=fixture();assert.equal(await dismissTikTokLoginPopup(f.page),true);assert.deepEqual(f.clicks,['@54']);
 assert.equal(await dismissTikTokLoginPopup(f.page),false);assert.equal(f.clicks.length,1);
});
test('关闭-LOGIN-002 a login page without a visible close control is left for inspection',async()=>{
 const f=fixture('root\n  dialog "Log in to TikTok"');assert.equal(await dismissTikTokLoginPopup(f.page),false);assert.deepEqual(f.clicks,[]);
});
test('关闭-LOGIN-003 CAPTCHA retains priority over popup dismissal',async()=>{
 const f=fixture(popup+'\n  iframe "验证码"');assert.equal(await dismissTikTokLoginPopup(f.page),false);assert.deepEqual(f.clicks,[]);
});
test('关闭-LOGIN-004 a close action that does not dismiss the popup cannot report success',async()=>{
 const f=fixture();f.page.waitForFunction=async()=>{throw Error('popup still visible');};
 await assert.rejects(dismissTikTokLoginPopup(f.page),/still visible/);assert.deepEqual(f.clicks,['@54']);
});
test('关闭-LOGIN-005 loss of user control stops the close action',async()=>{
 const f=fixture();f.page.click=async()=>{throw Error('user-owned control lost');};
 await assert.rejects(dismissTikTokLoginPopup(f.page),/control lost/);
});
test('关闭-LOGIN-006 shared screen inspection rechecks after dismissing the login popup',async()=>{
 const f=fixture();assert.equal(await inspectReloadScreen(f.page),null);assert.deepEqual(f.clicks,['@54']);
});
test('关闭-LOGIN-008 no login dialog leaves the search-panel close button untouched without waiting',async()=>{
 const f=fixture('root\n  heading "搜索"\n  button "关闭" [ref=2]');
 f.page.waitForFunction=async()=>assert.fail('no popup must not wait for dismissal');
 assert.equal(await dismissTikTokLoginPopup(f.page),false);
 assert.equal(await inspectReloadScreen(f.page),null);assert.deepEqual(f.clicks,[]);
});
