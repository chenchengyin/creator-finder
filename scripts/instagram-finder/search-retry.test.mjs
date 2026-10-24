import test from 'node:test';
import assert from 'node:assert/strict';
import {runSearchWithRetry,validateSearchRetry,retryDeadline} from './search-retry.mjs';
const reason='instagram_access_stopped_rate_limit';
const limited=(extra={})=>Object.assign(Error(reason),{pause:true,searchEvidence:{reason,scope:'target',keyword:'#one',requestKeyword:'#one',requestCursor:null,httpStatus:429,...extra}});
function fixture(){
 let time=1000;const state={},saves=[],waits=[];
 return {state,saves,waits,now:()=>time,random:()=>0,keyword:'#one',cursor:null,pendingPages:()=>[{saved:true}],save:async()=>saves.push(structuredClone(state)),wait:async until=>{waits.push(until);time=until;}};
}
test('two confirmed retries are serial, persisted before wait and dispatch, then stop',async()=>{
 const f=fixture();let calls=0;
 await assert.rejects(runSearchWithRetry({...f,call:async()=>{calls++;throw limited();}}),e=>e.message===reason&&e.reason==='search_retry_exhausted');
 assert.equal(calls,3);assert.deepEqual(f.waits,[61000,181000]);assert.equal(f.state.searchRetry.attempts,2);assert.equal(f.state.searchRetry.phase,'exhausted');
 assert.equal(f.saves[0].searchRetry.attempts,0);assert.equal(f.saves[0].searchRetry.phase,'waiting');assert.equal(f.saves[1].searchRetry.attempts,1);assert.equal(f.saves[1].searchRetry.phase,'dispatching');
});
test('Retry-After supports seconds/date, never shortens server deadlines, invalid falls back',()=>{
 assert.equal(retryDeadline('200',1000,0,()=>0),201000);
 assert.equal(retryDeadline('Thu, 01 Jan 1970 00:05:00 GMT',1000,0,()=>0),300000);
 for(const value of ['-1','Infinity','1.5','bad'])assert.equal(retryDeadline(value,1000,0,()=>0),61000);
 assert.throws(()=>retryDeadline('999999999999999999999',1000,0,()=>0),/deadline_invalid/);
 assert.equal(retryDeadline('0',1000,0,()=>1),67000);
});
test('unrelated, unknown, authentication, mismatched cursor/keyword and storage errors never retry',async()=>{
 for(const error of [Error('instagram_login_or_challenge'),Object.assign(Error('instagram_access_stopped_unknown'),{pause:true}),limited({scope:'other'}),limited({keyword:'#two'}),limited({requestKeyword:'#two'}),limited({requestCursor:'other'}),Object.assign(limited(),{storageFailure:true})]){
  const f=fixture();let n=0;await assert.rejects(runSearchWithRetry({...f,call:async()=>{n++;throw error;}}),e=>e===error);assert.equal(n,1);assert.equal(f.waits.length,0);
 }
});
test('long server wait pauses with a saved deadline; resume does not reset it or spend another retry',async()=>{
 const f=fixture();let n=0;
 await assert.rejects(runSearchWithRetry({...f,call:async()=>{n++;throw limited({retryAfter:'3600'});}}),e=>e.reason==='search_retry_deferred');
 assert.equal(n,1);assert.equal(f.waits.length,0);assert.equal(f.state.searchRetry.nextRetryAt,3601000);
 await assert.rejects(runSearchWithRetry({...f,call:async()=>assert.fail('deadline not elapsed')}),e=>e.reason==='search_retry_deferred');
 assert.equal(f.state.searchRetry.attempts,0);
 const result=await runSearchWithRetry({...f,now:()=>3601000,call:async()=>42});assert.equal(result,42);assert.equal(f.state.searchRetry.attempts,1);assert.equal(f.state.searchRetry.phase,'idle');
});
test('crash while waiting resumes same reservation; crash during dispatch never silently replays',async()=>{
 const f=fixture();await assert.rejects(runSearchWithRetry({...f,call:async()=>{throw limited();},wait:async()=>{throw Error('interrupted');}}),/interrupted/);
 assert.equal(f.state.searchRetry.phase,'waiting');assert.equal(await runSearchWithRetry({...f,call:async()=>42}),42);assert.equal(f.state.searchRetry.attempts,1);
 f.state.searchRetry.phase='dispatching';f.state.searchRetry.nextRetryAt=61000;await assert.rejects(runSearchWithRetry({...f,call:async()=>assert.fail('ambiguous dispatch')}),e=>e.reason==='search_retry_dispatch_interrupted');
});
test('budget survives success, subsequent cursors and restart; exhausted state sends no request',async()=>{
 const f=fixture();let n=0;await runSearchWithRetry({...f,call:async()=>{if(++n===1)throw limited();return 42;}});
 let next=0;await assert.rejects(runSearchWithRetry({...f,cursor:'c1',call:async()=>{next++;throw limited({requestCursor:'c1'});}}),e=>e.reason==='search_retry_exhausted');assert.equal(next,2);
 await assert.rejects(runSearchWithRetry({...f,cursor:'c1',call:async()=>assert.fail('budget reset')}),e=>e.reason==='search_retry_exhausted');
});
test('checkpoint failure prevents waiting or dispatch',async()=>{
 const f=fixture();await assert.rejects(runSearchWithRetry({...f,call:async()=>{throw limited();},save:async()=>{throw Error('disk_full');}}),/disk_full/);assert.equal(f.waits.length,0);
 assert.equal(f.state.searchRetry.attempts,0);assert.equal(f.state.searchRetry.phase,'waiting');
});
test('corrupt retry records are rejected and cannot be used to bypass a budget',()=>{
 for(const r of [{},{attempts:-1},{attempts:3,phase:'idle'},{attempts:0,phase:'waiting',keyword:'#one',cursor:null,nextRetryAt:NaN}, {attempts:0,phase:'dispatching',keyword:'#one',cursor:null,nextRetryAt:61000}])assert.throws(()=>validateSearchRetry(r),/invalid_search_retry/);
 assert.doesNotThrow(()=>validateSearchRetry(undefined));
});

test('wait uses at most 15-second sleeps, checks health and clears progress even on interruption',async()=>{
 const {waitForSearchRetry}=await import('./search-retry.mjs');let time=0;const sleeps=[],events=[];
 await waitForSearchRetry(61000,{now:()=>time,onWait:e=>events.push(e),assertHealthy:()=>{},sleep:async ms=>{sleeps.push(ms);time+=ms;}});
 assert.deepEqual(sleeps,[15000,15000,15000,15000,1000]);assert.deepEqual(events,[{until:61000,reason:'search_rate_limit'},null]);
 await assert.rejects(waitForSearchRetry(100000,{now:()=>time,onWait:e=>events.push(e),assertHealthy:()=>{throw Error('disk_failed');}}),/disk_failed/);assert.equal(events.at(-1),null);
});
test('unrepresentable server deadline pauses after preserving evidence; no wait or request replay',async()=>{
 const f=fixture();let n=0;await assert.rejects(runSearchWithRetry({...f,call:async()=>{n++;throw limited({retryAfter:'999999999999999999999'});}}),e=>e.reason==='search_retry_deadline_invalid');assert.equal(n,1);assert.equal(f.state.searchRetry.phase,'stopped');assert.equal(f.saves.length,1);assert.equal(f.waits.length,0);
});

test('a non-rate failure after dispatch leaves a valid stopped record; storage failure causes no extra save',async()=>{
 const f=fixture();let n=0;await assert.rejects(runSearchWithRetry({...f,call:async()=>{if(++n===1)throw limited();throw Error('search_response_failed');}}),/search_response_failed/);assert.equal(f.state.searchRetry.phase,'stopped');assert.doesNotThrow(()=>validateSearchRetry(f.state.searchRetry));
 const g=fixture();let m=0;const error=Object.assign(Error('disk_failed'),{storageFailure:true});await assert.rejects(runSearchWithRetry({...g,call:async()=>{if(++m===1)throw limited();throw error;}}),e=>e===error);assert.equal(g.saves.length,2);
});


test('重试-HASH-005 prefixed requests use original keyword budget but unrelated effective queries never retry',async()=>{
 const f=fixture();let calls=0;
 const value=await runSearchWithRetry({...f,keyword:'one',call:async()=>{if(++calls===1)throw limited({keyword:'one',searchKeyword:'#one',requestKeyword:'#one'});return 42;}});
 assert.equal(value,42);assert.equal(calls,2);assert.equal(f.state.searchRetry.keyword,'one');
 const foreign=fixture();let attempts=0;
 await assert.rejects(runSearchWithRetry({...foreign,keyword:'one',call:async()=>{attempts++;throw limited({keyword:'one',searchKeyword:'#other',requestKeyword:'#other'});}}));assert.equal(attempts,1);assert.equal(foreign.waits.length,0);
});
