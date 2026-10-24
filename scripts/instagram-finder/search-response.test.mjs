import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('./search-response.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const connection={edges:[{node:{items:[{pk:'1',code:'ABC',media_type:2,user:{pk:'123',username:'example'}}]}}],page_info:{has_next_page:false,end_cursor:null}};
function analyze(extra={}){assert.equal(typeof api.analyzeSearchResponse,'function','search response analyzer missing');return api.analyzeSearchResponse({keyword:'book',stage:'results',requestId:'r1',request:{request:{postData:new URLSearchParams({fb_api_req_friendly_name:'PolarisKeywordSearchExploreQuery',variables:JSON.stringify({query:'book'}),fb_dtsg:'SECRET'}).toString()},timestamp:10},response:{url:'https://www.instagram.com/graphql/query?token=SECRET',status:200,headers:{}},data:{data:{xdt_fbsearch__top_serp_graphql:connection}},...extra});}
test('归属-SEARCH-001 optional old feed failure does not become target search rate limit',()=>{
 const r=analyze({request:{stage:'homepage',request:{postData:'fb_api_req_friendly_name=PolarisFeedQuery'}},data:{message:'Rate limit exceeded'}});assert.equal(r.reason,null);assert.equal(r.evidence.scope,'other');assert.equal(r.evidence.action,'warning');
});
test('信号-SEARCH-002 target 429 preserves Retry-After and request evidence',()=>{
 const r=analyze({response:{url:'https://www.instagram.com/graphql/query',status:429,headers:{'Retry-After':'120'}},data:null});assert.equal(r.reason,'instagram_access_stopped_rate_limit');assert.equal(r.evidence.retryAfter,'120');assert.equal(r.evidence.requestId,'r1');
});
test('信号-SEARCH-002 ambiguous wait is unknown access, explicit login wins over rate words',()=>{
 assert.equal(analyze({data:{message:'Please wait a few minutes before you try again.'}}).reason,'instagram_access_stopped_unknown');
 assert.equal(analyze({data:{message:'rate limit login_required'}}).reason,'instagram_login_or_challenge');
});
test('信号-SEARCH-002 explicit session verification stops even on an unrelated request',()=>{
 assert.equal(analyze({request:null,data:{message:'checkpoint_required'}}).reason,'instagram_login_or_challenge');
});
test('归属-SEARCH-001 different keyword cannot be ingested',()=>{
 const r=analyze({request:{request:{postData:'fb_api_req_friendly_name=PolarisKeywordSearchExploreQuery&variables='+encodeURIComponent(JSON.stringify({query:'other'}))}}});assert.equal(r.page,null);assert.equal(r.evidence.scope,'other');
});
test('数据-SEARCH-003 nonessential field failure retains validated native data',()=>{
 const r=analyze({data:{data:{xdt_fbsearch__top_serp_graphql:connection},errors:[{message:'image unavailable',path:['xdt_fbsearch__top_serp_graphql','edges',0,'node','items',0,'user','profile_pic_url']}]}});assert.equal(r.reason,null);assert.equal(r.page.items[0].authorId,'123');assert.equal(r.evidence.action,'accepted_with_warning');
});
test('数据-SEARCH-003 required-field errors and missing identities never become valid empty results',()=>{
 assert.equal(analyze({data:{data:{xdt_fbsearch__top_serp_graphql:connection},errors:[{message:'field failed',path:['xdt_fbsearch__top_serp_graphql','page_info']}]}}).reason,'search_response_failed');
 const broken=structuredClone(connection);delete broken.edges[0].node.items[0].user;
 assert.equal(analyze({data:{data:{xdt_fbsearch__top_serp_graphql:broken}}}).reason,'search_result_identity_unverified');
});
test('数据-SEARCH-003 missing body and missing pagination remain incomplete',()=>{
 assert.equal(analyze({data:null}).reason,'search_response_body_unavailable');
 const broken=structuredClone(connection);delete broken.page_info;
 assert.equal(analyze({data:{data:{xdt_fbsearch__top_serp_graphql:broken}}}).reason,'search_pagination_state_unknown');
});
test('证据-SEARCH-004 only allowlisted evidence is retained and secrets are redacted',()=>{
 const r=analyze({data:{message:'Please wait a few minutes token=SECRET sessionid=TOPSECRET https://www.instagram.com/?access_token=SECRET'}});const text=JSON.stringify(r.evidence);assert.ok(!text.includes('SECRET'));assert.ok(!text.includes('fb_dtsg'));assert.ok(!text.includes('postData'));assert.equal(r.evidence.url,'https://www.instagram.com/graphql/query');
});

test('数据-SEARCH-003 optional field rate wording cannot override a complete necessary search result',()=>{
 const r=analyze({data:{data:{xdt_fbsearch__top_serp_graphql:connection},errors:[{message:'Rate limit exceeded',path:['xdt_fbsearch__top_serp_graphql','edges',0,'node','items',0,'user','profile_pic_url']}]}});assert.equal(r.reason,null);assert.equal(r.evidence.action,'accepted_with_warning');
});
test('归属-SEARCH-001 same keyword search-box suggestions are not a formal keyword search',()=>{
 const r=analyze({request:{request:{postData:new URLSearchParams({fb_api_req_friendly_name:'PolarisSearchBoxRefetchableQuery',variables:JSON.stringify({query:'book'})}).toString()}},data:{message:'Please wait a few minutes'}});assert.equal(r.reason,null);assert.equal(r.evidence.scope,'other');
});

test('信号-SEARCH-002 structured error messages and codes are retained without borrowing Graph API quota rules',()=>{
 const r=analyze({data:{error:{message:'login_required',code:190,error_subcode:463,is_transient:false}}});assert.equal(r.reason,'instagram_login_or_challenge');assert.equal(r.evidence.errors[0].code,'190');assert.equal(r.evidence.errors[0].subcode,'463');assert.equal(r.evidence.errors[0].isTransient,false);
});

test('证据-SEARCH-004 bearer headers and JSON-quoted credentials are fully redacted',()=>{
 for(const message of ['Please wait a few minutes Authorization: Bearer DEMO_SECRET','Please wait a few minutes {"sessionid":"DEMO_SECRET"}','Please wait a few minutes Cookie: a=DEMO_SECRET; b=OTHER_SECRET']){
  const r=analyze({data:{message}});assert.ok(!JSON.stringify(r.evidence).includes('SECRET'));
 }
});
