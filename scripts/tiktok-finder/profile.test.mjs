import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {candidate,capture,config} from './fixtures.mjs';
const api=await import('./profile.mjs').catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?{}:Promise.reject(e));
const fn=name=>{assert.equal(typeof api[name],'function','Missing implementation: '+name);return api[name];};
test('身份-ID-001 wrong author and unready data never count as no email',()=>{
 const c=capture();c.profile.authorId='1';const wrong=fn('evaluateCapture')({candidate:candidate(),capture:c,config});assert.equal(wrong.decision,'data_incomplete');assert.equal(wrong.authorId,'9999999999999999999');
 c.profile.ready=false;c.profile.bio='';assert.equal(fn('evaluateCapture')({candidate:candidate(),capture:c,config}).decision,'data_incomplete');
});
test('指标-METRIC-001 window boundaries, pinned and photo exclusions preserve exact mean',()=>{
 const c=capture(),item=c.pages[0].items[0];
 c.pages[0].items=[{...item,id:'1',createdAt:Date.parse(config.windowStart)/1000,views:60000,pinned:true},{...item,id:'2',createdAt:Date.parse(config.windowEndExclusive)/1000,views:900000},{...item,id:'3',mediaType:'photo',views:900000},{...item,id:'4',privateItem:true,views:900000}];
 const r=fn('evaluateCapture')({candidate:candidate(),capture:c,config});assert.equal(r.metrics.sampleSize,1);assert.equal(r.metrics.averageViews,60000);assert.equal(r.decision,'confirmed');
});
test('指标-METRIC-002 zero is real, missing views and incomplete/order/identity fail coverage',()=>{
 const evaluate=fn('evaluateCapture');let c=capture();c.pages[0].items[0].views=0;assert.equal(evaluate({candidate:candidate(),capture:c,config}).decision,'rejected');
 for(const mutate of [c=>delete c.pages[0].items[0].views,c=>c.pages[0].hasMore=true,c=>c.pages[0].items[0].authorId='2',c=>c.profile.latestOrderConfirmed=false,c=>c.pages[0].items[0].createdAt=NaN]){c=capture();mutate(c);assert.equal(evaluate({candidate:candidate(),capture:c,config}).decision,'data_incomplete');}
});
test('指标-METRIC-003 thresholds are configurable, latest valid duplicate observation counts once',()=>{
 const c=capture();c.pages.push({statusCode:0,hasMore:false,items:[{...c.pages[0].items[0],views:55000,capturedAt:'2026-10-21T05:00:00Z'}]});
 const r=fn('evaluateCapture')({candidate:candidate(),capture:c,config});assert.equal(r.metrics.sampleSize,1);assert.equal(r.metrics.averageViews,55000);
 assert.equal(fn('evaluateCapture')({candidate:candidate(),capture:c,config:{...config,minAverageViewsExclusive:55000}}).decision,'rejected');
 c.pages[1].items[0].createdAt++;assert.equal(fn('evaluateCapture')({candidate:candidate(),capture:c,config}).decision,'data_incomplete');
});
test('指标-METRIC-004 known empty window is not data incomplete',()=>{
 const c=capture();c.pages[0].items=[];const r=fn('evaluateCapture')({candidate:candidate(),capture:c,config});assert.equal(r.decision,'rejected');assert.equal(r.metrics.averageViews,null);assert.equal(r.reason,'no_eligible_videos');
});
test('内容-CONTENT-001 satire and combined tags qualify; historical topic dates retained',()=>{
 const c=capture();c.profile.bio='public@example.com';c.pages[0].items[0].description='#christiantiktok #satire #atheist #skit';
 const r=fn('evaluateCapture')({candidate:candidate(),capture:c,config});assert.equal(r.decision,'confirmed');assert.match(r.inclusionBasis,/locationCreated=US/);assert.match(r.inclusionBasis,/60000/);
 c.pages[0].items[0].description='hello';const q=candidate('example',c.profile.authorId,'#christianskit');q.sourceEvidence[0].publishedAt='2024-01-05T00:00:00Z';
 assert.match(fn('evaluateCapture')({candidate:q,capture:c,config}).inclusionBasis,/2024-01-05/);
});
test('内容-CONTENT-002/003 only content ambiguity can enter suspected output',()=>{
 const c=capture();c.profile.bio='public@example.com';c.pages[0].items[0].description='hello';const q=candidate('example',c.profile.authorId,'christian discussion');
 assert.equal(fn('evaluateCapture')({candidate:q,capture:c,config}).decision,'suspected');
 c.pages[0].items[0].views=50000;assert.equal(fn('evaluateCapture')({candidate:q,capture:c,config}).decision,'rejected');
 c.pages[0].items[0].views=60000;delete c.pages[0].items[0].locationCreated;assert.equal(fn('evaluateCapture')({candidate:q,capture:c,config}).decision,'data_incomplete');
});
test('地区-REGION-001/002 country is optional, explicit wrong region rejects',()=>{
 const c=capture();c.pages[0].items[0].locationCreated='GB';assert.equal(fn('evaluateCapture')({candidate:candidate(),capture:c,config}).decision,'rejected');
 delete c.pages[0].items[0].locationCreated;assert.equal(fn('evaluateCapture')({candidate:candidate(),capture:c,config:{...config,country:null}}).decision,'confirmed');
});
test('内容-CONTENT-001 separate input directions use OR, phrases keep theme plus format',()=>{
 const c=capture();c.profile.bio='public@example.com';c.pages[0].items[0].description='Christian discussion';const q=candidate('example',c.profile.authorId,'Christian discussion');
 assert.equal(fn('evaluateCapture')({candidate:q,capture:c,config:{...config,keywords:['christian','comedy']}}).decision,'confirmed');
 assert.equal(fn('evaluateCapture')({candidate:q,capture:c,config:{...config,keywords:['christian skits']}}).decision,'suspected');
});
test('恢复-RESUME-002 first page saves before blocked second page; resume keeps cached email',async()=>{
 let saved,steps=[];const c=capture();c.pages[0].hasMore=true;
 const browser={readProfile:async()=>{steps.push('profile');return structuredClone(c);},nextPosts:async()=>{assert(saved.pages.length);throw Object.assign(new Error('http_403'),{pause:true});}};
 await assert.rejects(fn('qualifyCandidate')({candidate:candidate(),config,browser,onCheckpoint:async value=>saved=structuredClone(value)}),/403/);
 assert.equal(saved.profile.bio,c.profile.bio);assert.equal(saved.pages.length,1);assert.equal(saved.checks.identity,'completed');assert.equal(saved.checks.email,'completed');assert.equal(saved.nextAction,'posts');
 browser.ensureProfile=async()=>{};browser.nextPosts=async()=>({statusCode:0,hasMore:false,items:[]});
 const r=await fn('qualifyCandidate')({candidate:candidate(),config,browser,cachedCapture:saved,onCheckpoint:async()=>{}});assert.equal(r.decision,'confirmed');assert.deepEqual(steps,['profile']);
});
test('邮箱-EMAIL-001 empty or complete no-email search signatures skip profile; visible truncation still verifies',async()=>{
 const qualify=fn('qualifyCandidate');let visits=0;
 const browser={readProfile:async()=>{visits++;return capture();}};
 for(const bioHint of [null,'','   ','Christian comedy creator']){
  const c={...candidate(),bioHint};
  const r=await qualify({candidate:c,config,browser});
  assert.equal(r.decision,'rejected');assert.equal(r.reason,'no_search_bio_email');assert.match(r.inclusionBasis,/可能存在无标记截断/);assert.equal(visits,0);
 }
 for(const bioHint of ['Christian comedy creator...','Christian comedy creator…','Christian comedy creator⋯','Christian comedy creator﹒﹒﹒']){
  const c={...candidate(),bioHint};
  const r=await qualify({candidate:c,config,browser});
  assert.equal(r.decision,'confirmed');
 }
 assert.equal(visits,4);
 const noProfileEmail={...capture(),profile:{...capture().profile,bio:'Christian comedy creator'}};
 const mismatch=await qualify({candidate:candidate(),config,browser:{readProfile:async()=>{visits++;return noProfileEmail;}}});
 assert.equal(mismatch.decision,'rejected');assert.equal(mismatch.reason,'no_profile_bio_email');assert.equal(visits,5);
 const cached=capture();
 const r=await qualify({candidate:{...candidate(),bioHint:''},config,browser:{readProfile:async()=>{throw Error('must reuse verified cache');}},cachedCapture:cached});
 assert.equal(r.decision,'confirmed');
 const optional=await qualify({candidate:{...candidate(),bioHint:''},config:{...config,requireBioEmail:false},browser:{readProfile:async()=>{visits++;return capture();}}});
 assert.equal(optional.decision,'confirmed');assert.equal(visits,6);
});
test('地区-REGION-001 cached list fields do not navigate; metrics failure skips detail',async()=>{
 const c=capture();let visits=0;const browser={readProfile:async()=>c,collectRegion:async()=>{visits++;throw Error('unnecessary');}};
 assert.equal((await fn('qualifyCandidate')({candidate:candidate(),config,browser})).decision,'confirmed');assert.equal(visits,0);
 c.pages[0].items[0].views=1;delete c.pages[0].items[0].locationCreated;assert.equal((await fn('qualifyCandidate')({candidate:candidate(),config,browser})).decision,'rejected');assert.equal(visits,0);
});
test('回放-REPLAY-001 old five-person captures independently reproduce sample means',async()=>{
 const evaluate=fn('evaluateCapture');
 for(const [username,count,average] of [['realjobrito',3,234771.66666666666],['r3alism_0fficial',30,185866.66666666666],['danielddwilliams',7,60045.142857142855],['timtim44441',3,116666.66666666667],['itssimannn',5,200020]]){
  const c=JSON.parse(await readFile(new URL('../../runs/2026-10-21-christian-skits-us-5/profile-'+username+'.json',import.meta.url),'utf8'));
  const r=evaluate({candidate:{...c.candidate,sourceEvidence:c.candidate.sourceEvidence||[]},capture:c,config});assert.equal(r.metrics.sampleSize,count,username);assert(Math.abs(r.metrics.averageViews-average)<1e-7,username);
 }
});
