import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import {join} from 'node:path';
import {runInEgo} from './runtime.mjs';
import {atomicJson,projectRoot} from './batch.mjs';
async function temp(t){const d=await fs.mkdtemp(join(os.tmpdir(),'runtime-ins-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));return d;}
function fakeApi(){const calls=[],pages=new Map();return {calls,taskSpace:async id=>{calls.push(id);return {spaceId:1000,page(label){if(label!=='p1'&&!pages.has(label))throw Error('page_label_not_found: '+label);if(!pages.has(label)){let url='about:blank',events=[];const connection={edges:[],page_info:{has_next_page:false,end_cursor:null}};pages.set(label,{label,url:async()=>url,goto:async target=>{url=target;const keyword=new URL(target).searchParams.get('q');events=[{method:'Network.requestWillBeSent',params:{requestId:'1',request:{postData:'variables='+encodeURIComponent(JSON.stringify({query:keyword}))}}},{method:'Network.responseReceived',params:{requestId:'1',response:{url:'https://www.instagram.com/graphql/query',status:200}}}];},events:async()=>{const r=events;events=[];return r;},cdp:async method=>method==='Network.getResponseBody'?{body:JSON.stringify({data:{xdt_fbsearch__top_serp_graphql:connection}})}:{},waitForTimeout:async()=>{}});}return pages.get(label);},pages:async()=>[...pages.values()].length?[...pages.values()]:[{label:'p1'}],newPage:async()=>{const label='p'+(pages.size+2);pages.set(label,{label,url:async()=> 'about:blank'});calls.push('newPage:'+label);return pages.get(label);},finish:async()=>calls.push('finish')};},listTaskSpaces:async()=>[],claimTaskSpace:async()=>assert.fail('no claims')};}
test('runtime completes native empty search and records owned space closure',async t=>{
 const dir=await temp(t),api=fakeApi();const r=await runInEgo({runDir:dir,config:{keywords:['#one'],conditions:{requireEmail:true}}},api);
 assert.equal(r.status,'completed');assert.equal(api.calls.at(-1),'finish');const saved=JSON.parse(await fs.readFile(join(dir,'execution-state.json'),'utf8'));assert.equal(saved.browser.closed,true);
 assert.match(await fs.readFile(join(dir,'actions.jsonl'),'utf8'),/"action":"goto"/);
});
test('runtime refuses reserved original space before any browser API call',async t=>{
 const dir=await temp(t),api=fakeApi();await atomicJson(join(dir,'execution-state.json'),{schemaVersion:2,kind:'instagram_email_batch',projectRoot,config:{keywords:['#one'],conditions:{requireEmail:true},window:null,emailLimits:{}},status:'paused',topicIndex:0,authors:{},topics:[{keyword:'#one',history:[],pendingSearchPages:[],currentPage:null}],browser:{spaceId:19,owned:true}});
 const r=await runInEgo({runDir:dir,resume:true},api);assert.equal(r.status,'paused');assert.equal(r.reason,'unowned_or_reserved_space');assert.deepEqual(api.calls,[]);
});

test('runtime explicitly resumes a delegated space using takeover rather than a plain reference',async t=>{
 const dir=await temp(t),api=fakeApi();api.listTaskSpaces=async()=>[{id:1000,ownership:'agentDelegatedToUser'}];api.takeOverTaskSpace=async id=>{api.calls.push('takeover:'+id);return api.taskSpace(id);};
 await atomicJson(join(dir,'execution-state.json'),{schemaVersion:2,kind:'instagram_email_batch',projectRoot,config:{keywords:['#one'],conditions:{requireEmail:true},window:null,emailLimits:{}},status:'paused',topicIndex:0,authors:{},topics:[{keyword:'#one',history:[],pendingSearchPages:[],currentPage:null}],browser:{spaceId:1000,owned:true,pages:{}}});
 const r=await runInEgo({runDir:dir,resume:true},api);assert.equal(r.status,'completed');assert.ok(api.calls.includes('takeover:1000'));
});
