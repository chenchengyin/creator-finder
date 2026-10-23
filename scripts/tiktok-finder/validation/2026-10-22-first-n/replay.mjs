// Offline validation only: real historical searches, unavailable profiles stay unknown.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCampaign} from '../../workflow.mjs';
import {readProfilePage} from '../../browser.mjs';
import {evaluateCapture} from '../../profile.mjs';
import {exportResults} from '../../export.mjs';
import {capture,candidate,config} from '../../fixtures.mjs';

const here=fileURLToPath(new URL('.',import.meta.url)),root=resolve(here,'../../../..');
const old=join(root,'runs/2026-10-21-ai-keywords-round-1-us-100');
const json=async path=>JSON.parse(await fs.readFile(path,'utf8'));
const records=(await fs.readFile(join(old,'tiktok-video-discovery.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse);
const word='christian sketch comedy',pages=records.filter(x=>x.keyword===word);
assert.equal(pages.length,9);assert.equal(pages.at(-1).responses.at(-1).hasMore,false);
const runDir=join(here,'search-replay');await fs.rm(runDir,{recursive:true,force:true});
const opened=[];let offset=0;const previousFetch=globalThis.fetch;
globalThis.fetch=()=>{throw Error('offline: network forbidden');};
let result;
try{
 result=await runCampaign({config:{...config,keywords:[word],forceProfileFirstN:10},runDir,exporter:async()=>({verification:{passed:true}}),browser:{
  discoverBatch:async()=>{const responses=pages[offset++].responses;return {valid:true,hasMore:responses.at(-1).hasMore,cursor:responses.at(-1).cursor,items:responses.flatMap(r=>r.items)};},
  readProfile:async c=>{
   opened.push(c.authorIdHint);
   // Do not manufacture link/metric evidence for authors whose historical profile is absent.
   return {profile:{username:c.username,authorId:c.authorIdHint,profileUrl:'https://www.tiktok.com/@'+c.username,ready:false,identityVerified:false,externalLink:{status:'unknown',url:null,reason:'offline_profile_not_available'}},pages:[],postAttemptComplete:true};
  },finish:async()=>{}
 }});
}finally{globalThis.fetch=previousFetch;}
assert.equal(result.status,'completed');assert.equal(offset,9);assert.equal(result.counts.uniqueCandidates,60);
const prefix=['7497299912649851947','6672090545286955013','7377543241314911278','6742287939734848518','6717640498913641478','7493990898050417707','6845068444633089029','7415635631052047402','7596471365089248269','7673146931430573064'];
assert.deepEqual(opened.slice(0,10),prefix);assert.equal(new Set(opened).size,opened.length);assert.equal(result.output.verification.passed,true);
assert.equal(result.counts.confirmed,0);assert.equal(result.counts.suspected,0);

const realLink=await json(join(root,'runs/2026-10-22-profile-links-research/trarags-profile-links.json'));
const previous={document:globalThis.document,location:globalThis.location};
globalThis.location={origin:'https://www.tiktok.com',pathname:'/@trarags'};
globalThis.document={getElementById:()=>({textContent:JSON.stringify({__DEFAULT_SCOPE__:{'webapp.user-detail':{statusCode:0,userInfo:{user:{id:realLink.authorId,uniqueId:realLink.username,signature:realLink.bio,bioLink:{link:realLink.fieldUrl}}}}}})}),querySelectorAll:selector=>selector.includes('/link/v2')?realLink.uiLinks:[]};
let extracted;try{extracted=readProfilePage().externalLink;}finally{globalThis.document=previous.document;globalThis.location=previous.location;}
assert.equal(extracted.status,'present');assert.equal(extracted.url,'https://youtube.com/@trarags?si=tiNqhlUuUi9mGwta');assert.equal(extracted.evidence.length,2);

// A clearly synthetic row validates the changed workbook views; it is not a real creator result.
const c=capture('fixture_first_n'),q=candidate('fixture_first_n');
c.profile.bio='OFFLINE FIXTURE public@example.com';c.profile.externalLink={status:'present',url:'https://example.com/?fixture=1&source=first-n',capturedAt:c.profile.capturedAt,evidence:[{fieldPath:'fixture.bioLink.link',rawValue:'https://example.com/?fixture=1&source=first-n'}]};
const row=evaluateCapture({candidate:q,capture:c,config});row.inclusionBasis='离线虚构测试账号，仅用于验证导出。\n'+row.inclusionBasis;
const workbook=await exportResults({runDir:join(here,'workbook-fixture'),results:[row],config,render:true});
const report={mode:'offline_only',historicalSearch:{keyword:word,batches:offset,scrollsAfterInitial:offset-1,rawVideoRows:101,uniqueAuthors:60,openedProfiles:opened.length,forcedFirstTen:prefix,forcedCompleted:result.keywords[0].forcedProfiles.completed,note:'Historical search replay; profile responses deliberately unavailable. No real candidate eligibility inferred.'},realLinkReplay:{authorId:realLink.authorId,url:extracted.url,status:extracted.status,sources:extracted.evidence.length},fixtureWorkbook:workbook,liveAcceptance:false};
await fs.writeFile(join(here,'replay-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
