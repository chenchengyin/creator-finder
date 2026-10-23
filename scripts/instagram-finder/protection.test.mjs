import test from 'node:test';
import assert from 'node:assert/strict';
import {responseProtectionReason,queryOperation,ignorableQueryFailure} from './protection.mjs';
test('recognizes HTTP-200 GraphQL rate limits and API authentication protection',()=>{
 assert.equal(responseProtectionReason({errors:[{message:'Rate limit exceeded'}],data:null}),'instagram_access_stopped_rate_limit');
 assert.equal(responseProtectionReason({status:'fail',message:'Please wait a few minutes before you try again.'}),'instagram_access_stopped_rate_limit');
 assert.equal(responseProtectionReason({status:'fail',message:'login_required'}),'instagram_login_or_challenge');
});
test('ordinary field errors and user captions do not become protection signals',()=>{
 assert.equal(responseProtectionReason({errors:[{message:'field_exception'}]}),null);
 assert.equal(responseProtectionReason({data:{caption:{text:'Rate limit exceeded'}}}),null);
});
test('only the observed unrelated suggested-users rate limit may be ignored',()=>{
 const data={errors:[{message:'Rate limit exceeded'}]};const operation='PolarisProfileSuggestedUsersWithPreloadableQuery';
 assert.equal(ignorableQueryFailure(operation,200,data),true);
 for(const name of ['PolarisProfilePostsQuery','PolarisProfilePageContentQuery',null])assert.equal(ignorableQueryFailure(name,200,data),false);
 assert.equal(ignorableQueryFailure(operation,429,data),false);assert.equal(ignorableQueryFailure(operation,200,{message:'login_required'}),false);
});
test('query operation is correlated by request ID without exposing request credentials',()=>{
 const events=[{method:'Network.requestWillBeSent',params:{requestId:'one',request:{postData:'fb_api_req_friendly_name=PolarisProfilePostsQuery&fb_dtsg=private'}}}];
 assert.equal(queryOperation(events,'one'),'PolarisProfilePostsQuery');assert.equal(queryOperation(events,'other'),null);
});
