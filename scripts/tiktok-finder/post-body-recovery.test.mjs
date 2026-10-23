import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('./post-body-recovery.mjs').catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?{}:Promise.reject(e));
test('missing post body replays only current profile once, archives evidence and preserves Bio/context',async()=>{
 assert.equal(typeof api.recoverPostBodies,'function');let profiles=0,saved;
 const browser={ensureProfile:async()=>{},nextPosts:async()=>{throw Error('response_body_unavailable');},readProfile:async()=>{profiles++;return {profile:{ready:true,bio:'public@example.com'},pages:[{cursor:10,items:[{id:'fresh'}]}],postAttemptComplete:true};}};
 const current={profile:{ready:true,bio:'public@example.com'},verificationContext:{runId:'one'},pages:[{cursor:90,items:[{id:'old'}]}],access:{partialBodies:[],retry:{reloadClicks:0,status:200}},checks:{email:'completed'}};
 api.recoverPostBodies(browser,{save:async(c,value)=>saved=structuredClone(value),log:async()=>{}});
 const restored=await browser.ensureProfile({username:'fixture'},current);
 assert.deepEqual(restored.pages,[]);assert.equal(profiles,1);assert.deepEqual(current.pages,[{cursor:10,items:[{id:'fresh'}]}]);assert.equal(current.postBodyReplay.previousPages[0].cursor,90);assert.equal(saved.profile.bio,'public@example.com');assert.equal(saved.verificationContext.runId,'one');assert.equal(saved.checks.email,'completed');
 await assert.rejects(browser.nextPosts({username:'fixture'},current,async()=>{}),/post_body_recovery_exhausted/);assert.equal(profiles,1);
});
test('a first live pagination body failure restarts the page without reporting false cursor progress',async()=>{
 assert.equal(typeof api.recoverPostBodies,'function');const current={pages:[{cursor:10}],access:{},profile:{bio:'public@example.com'}};
 const browser={ensureProfile:async()=>{},nextPosts:async()=>{throw Error('response_body_unavailable');},readProfile:async()=>({profile:{bio:'public@example.com'},pages:[{cursor:10}],postAttemptComplete:true})};
 api.recoverPostBodies(browser,{save:async()=>{},log:async()=>{}});const result=await browser.nextPosts({username:'fixture'},current,async()=>{});assert.equal(result.restarted,true);assert.deepEqual(current.pages,[{cursor:10}]);
});
test('403 and control errors pass through without using the post-body replay budget',async()=>{
 assert.equal(typeof api.recoverPostBodies,'function');for(const message of ['http_403','control_lost']){
  const capture={pages:[{cursor:10}],access:{}},browser={ensureProfile:async()=>{},nextPosts:async()=>{throw Error(message);},readProfile:async()=>assert.fail('must not navigate')};
  api.recoverPostBodies(browser,{save:async()=>{},log:async()=>{}});await assert.rejects(browser.nextPosts({},capture,async()=>{}),new RegExp(message));assert.equal(capture.postBodyReplay,undefined);
 }
});
