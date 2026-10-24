import test from 'node:test';
import assert from 'node:assert/strict';
let api={};try{api=await import('./session.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
function setup(){let time=1000;const actions=[],logs=[],waits=[];const s=()=>{assert.equal(typeof api.createSession,'function','session coordinator not implemented');return api.createSession({log:async e=>logs.push(e),now:()=>time,sleep:async ms=>{waits.push(ms);time+=ms;}});};return {actions,logs,waits,s,raw(label){let url='about:blank';return {label,url:async()=>url,goto:async u=>{actions.push(label+':goto');url=u;},click:async()=>actions.push(label+':click'),mouse:{wheel:async()=>actions.push(label+':wheel'),move:async()=>{}}};}};}
test('SESSION-001 different pages share pacing and action logs, including TikTok navigation',async()=>{
 const f=setup(),session=f.s(),a=session.wrap(f.raw('p1')),b=session.wrap(f.raw('p2'));session.context({authorId:'123',stage:'email'});
 await a.goto('https://www.instagram.com/example/');await b.goto('https://www.tiktok.com/@example');await a.click('button');
 assert.deepEqual(f.waits,[10500,8000]);assert.equal(f.logs.length,6);assert.equal(f.logs.at(-1).stage,'email');assert.equal(f.logs.at(-1).afterUrl,'https://www.instagram.com/example/');
});
test('SESSION-002 logging failure stops before any browser action',async()=>{
 const f=setup();assert.equal(typeof api.createSession,'function');const s=api.createSession({log:async()=>{throw Error('disk_full');}});
 await assert.rejects(s.wrap(f.raw('p1')).goto('https://example.com/'),/disk_full/);assert.deepEqual(f.actions,[]);
});
test('SESSION-002 closed page produces a pause instead of an empty result',async()=>{
 assert.equal(typeof api.createSession,'function');const s=api.createSession({log:async()=>{}});
 await assert.rejects(s.wrap({url:async()=>{throw Error('Target closed');},goto:async()=>assert.fail('closed page must not navigate')}).goto('https://example.com/'),e=>e.pause===true);
});
test('SESSION-002 a swallowed fatal error cannot permit a later read or action',async()=>{
 const f=setup();assert.equal(typeof api.createSession,'function');const s=api.createSession({log:async()=>{throw Error('disk_full');}}),raw=f.raw('p1');let reads=0;raw.evaluate=async()=>reads++;
 const page=s.wrap(raw);try{await page.goto('https://example.com/');}catch{}
 await assert.rejects(page.evaluate(()=>true),/disk_full/);assert.equal(reads,0);
});

test('邮箱-YT-005 mouse clicks use the shared action pacing and logging',async()=>{
 const f=setup(),s=f.s(),raw=f.raw('p1');raw.mouse.click=async()=>f.actions.push('mouse:click');const page=s.wrap(raw);
 await page.goto('https://www.youtube.com/@owner');await page.mouse.click(20,30,{label:'打开原生联系资料'});
 assert.deepEqual(f.waits,[8000]);assert.equal(f.logs.at(-1).action,'mouse.click');assert.equal(f.actions.at(-1),'mouse:click');
});

test('邮箱-YT-008 pacing can complete before the final coordinate inspection',async()=>{
 const f=setup(),s=f.s(),raw=f.raw('p1');let inspectedAfterWait=false;raw.evaluate=async()=>{inspectedAfterWait=f.waits.reduce((a,b)=>a+b,0)>=8000;};raw.mouse.click=async()=>assert.equal(inspectedAfterWait,true);const page=s.wrap(raw);
 await page.goto('https://www.youtube.com/@owner');assert.equal(typeof page.prepareAction,'function');await page.prepareAction('mouse.click','#submit');await page.evaluate(()=>{});await page.mouse.click(20,30);assert.equal(f.logs.at(-1).action,'mouse.click');
});

test('状态-PROGRESS-005 pacing waits expose a deadline and always clear it',async()=>{
 let time=0;const waits=[];const s=createSessionForProgress();
 function createSessionForProgress(){return api.createSession({log:async()=>{},now:()=>time,lastActionAt:0,sleep:async ms=>{time+=ms;},onWait:value=>waits.push(value)});}
 const page=s.wrap({url:async()=> 'https://www.instagram.com/',click:async()=>{}});await page.click('button');assert.deepEqual(waits,[{until:8000,reason:'action_pacing'},null]);
});
test('状态-PROGRESS-005 explicit browser waits clear their state even when interrupted',async()=>{
 const waits=[],s=api.createSession({log:async()=>{},now:()=>1000,onWait:value=>waits.push(value)});const page=s.wrap({waitForTimeout:async()=>{throw Error('interrupted');}});await assert.rejects(page.waitForTimeout(60000),/interrupted/);assert.deepEqual(waits,[{until:61000,reason:'page_delay'},null]);
});
