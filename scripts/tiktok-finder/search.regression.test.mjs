import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runSearch} from '../tiktok-search/search.mjs';
import {temp} from './fixtures.mjs';
function fixture({status=200,apiStatuses=[200],old=false,fail=false}){
 let nav=0,buffer=[];const url='https://www.tiktok.com/search/video?q=christian%20skits';
 return {get nav(){return nav;},page:{goto:async()=>{nav++;buffer=apiStatuses.map((s,i)=>({method:'Network.responseReceived',params:{requestId:String(i),response:{url:'https://www.tiktok.com/api/search/item/full/?keyword='+(old?'old':'christian%20skits'),status:nav>1?200:s}}}));},evaluate:async()=>({url,httpStatus:nav>1?200:status,links:[]}),events:async()=>{const out=buffer;buffer=[];return out;},waitForSelector:async()=>{},cdp:async(method,arg)=>{if(method==='Network.enable')return {};if(fail&&arg.requestId==='1')throw Error('body unavailable');return {body:JSON.stringify({status_code:0,has_more:0,cursor:1,item_list:[{id:'1',author:{id:'2',uniqueId:'example'}}]})};}}};
}
test('访问-ACCESS-003 actual legacy caller never retries document429 plus API403',async t=>{const p=fixture({status:429,apiStatuses:[403]}),r=await runSearch({page:p.page,config:{runDir:await temp(t),keyword:'christian skits'},beforeNavigate:async()=>{},sleep:async()=>{}});assert.equal(p.nav,1);assert.equal(r.stopReason,'http_429');});
test('完成-DONE-003 actual legacy caller keeps partial body failures incomplete',async t=>{const runDir=await temp(t),p=fixture({apiStatuses:[200,200],fail:true}),r=await runSearch({page:p.page,config:{runDir,keyword:'christian skits'},beforeNavigate:async()=>{}});assert.equal(r.exhausted,false);assert.equal(JSON.parse(await readFile(join(runDir,'execution-state.json'),'utf8')).sourceProgress['christian skits']['tiktok-video'],'incomplete');});
test('来源-SOURCE-001 actual legacy caller ignores mismatched query responses',async t=>{const p=fixture({old:true}),r=await runSearch({page:p.page,config:{runDir:await temp(t),keyword:'christian skits'},beforeNavigate:async()=>{}});assert.equal(r.totalCandidates,0);assert.equal(r.exhausted,false);});
