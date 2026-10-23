import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBioLinks,parseProfilePayload,bioEmails,readProfile,mergeVisibleProfile} from './profile.mjs';
test('integrated profile read stops before opening links when shared parser confirms a Bio email',async()=>{
 const values=[false,'target',[JSON.stringify({user:{username:'target',id:'123',biography:'hello＠example.com',bio_links:[]}})],{username:'target',biography:'hello＠example.com',truncated:false,hasMultiLinks:true}];
 const page={evaluate:async()=>{assert.ok(values.length,'link inspection must stop after Bio hit');return values.shift();},url:async()=> 'https://www.instagram.com/target/',cdp:async()=>{},events:async()=>[],click:async()=>assert.fail('must not expand links'),waitForSelector:async()=>{},waitForTimeout:async()=>{}};
 const r=await readProfile({page,username:'target',stopOnBioEmail:true});assert.deepEqual(r.emails,['hello@example.com']);
});
test('emails come only from the supplied biography and retain plus tags',()=>{
 assert.deepEqual(bioEmails('💌 One+work@Example.co\nOne+work@example.co'),['One+work@Example.co']);
 assert.deepEqual(bioEmails('No email here'),[]);
});
test('external links decode Instagram redirect once and retain functional query',()=>{
 const url='https://example.com/a?token=a%2Fb&x=1';
 assert.deepEqual(normalizeBioLinks([{url:'https://l.instagram.com/?u='+encodeURIComponent(url),title:'Site'}]).map(x=>x.url),[url]);
});
test('explicit bio links retain social links, reject unsafe schemes and deduplicate exact targets',()=>{
 const links=normalizeBioLinks(['javascript:alert(1)','https://www.instagram.com/foo/','https://www.threads.com/@foo','https://example.com/a','https://example.com/a','https://example.com/b'].map(url=>({url})));
 assert.equal(links.length,4);
});
test('profile parser finds only exact author and keeps empty bio distinct from missing',()=>{
 const p=parseProfilePayload({viewer:{username:'viewer',biography:'secret@example.com'},data:{user:{username:'target',id:'123',biography:'',bio_links:[]}}},'target');
 assert.equal(p.biography,'');assert.deepEqual(p.emails,[]);assert.equal(p.linksComplete,true);assert.equal(p.authorId,'123');
 assert.equal(parseProfilePayload({user:{username:'other',biography:'wrong'}},'target'),null);
 assert.equal(parseProfilePayload({user:{username:'target'}},'target'),null);
});
test('all bio links are retained without adding external_url as a duplicate',()=>{
 const p=parseProfilePayload({data:{user:{username:'target',biography:'mail@sample.com',external_url:'https://example.com/first',bio_links:[{title:'First',url:'https://example.com/first'},{title:'Second',url:'https://example.com/second'}]}}},'target');
 assert.equal(p.links.length,2);assert.deepEqual(p.emails,['mail@sample.com']);assert.equal(p.linksComplete,true);
});
test('missing list does not claim every link was collected',()=>{
 const p=parseProfilePayload({user:{username:'target',biography:'Bio',external_url:'https://example.com/'}},'target');
 assert.equal(p.linksComplete,false);assert.equal(p.links.length,1);
});
test('empty native link list cannot erase external_url or a visible DOM link',()=>{
 const p=parseProfilePayload({username:'target',biography:'',bio_links:[],external_url:'https://contact.example/'},'target');
 assert.equal(p.links[0]?.url,'https://contact.example/');
 const merged=mergeVisibleProfile({...p,links:[]},{username:'target',biography:'',truncated:false,links:[{url:'https://contact.example/'}],hasMultiLinks:false},'target');
 assert.equal(merged.links[0]?.url,'https://contact.example/');
});
test('malformed bio links preserve valid entries without claiming completeness',()=>{
 const p=parseProfilePayload({user:{username:'target',biography:'Bio',bio_links:[null,{url:'javascript:alert(1)'},{url:'https://example.com/'}]}},'target');
 assert.equal(p.links.length,1);assert.equal(p.linksComplete,false);
});
test('an existing user dialog prevents navigation or collection',async()=>{
 const page={evaluate:async()=>true,waitForFunction:async()=>{throw Error('timeout');},goto:async()=>assert.fail('must preserve user dialog')};
 const result=await readProfile({page,username:'target'});
 assert.equal(result.reason,'existing_dialog');assert.equal(result.emails,null);
});
test('a transient dialog may disappear by itself before normal profile reading',async()=>{
 const values=[true,false,'target',[JSON.stringify({user:{username:'target',id:'123',biography:'work@example.com',bio_links:[]}})],null,null];let waited=0;
 const page={evaluate:async()=>values.shift(),waitForFunction:async()=>waited++,url:async()=> 'https://www.instagram.com/target/',cdp:async()=>{},events:async()=>[],waitForSelector:async()=>{},waitForTimeout:async()=>{}};
 const r=await readProfile({page,username:'target'});assert.equal(r.status,'observed');assert.equal(waited,1);assert.deepEqual(r.emails,['work@example.com']);
});
test('login redirects pause instead of being interpreted as missing email',async()=>{
 const page={evaluate:async()=>false,cdp:async()=>{},events:async()=>[],goto:async()=>{},url:async()=> 'https://www.instagram.com/accounts/login/'};
 const result=await readProfile({page,username:'target'});
 assert.equal(result.status,'paused');assert.equal(result.emails,null);
});
test('network protection stops profile parsing and preserves unknown fields',async()=>{
 let reads=0;
 const page={evaluate:async()=>++reads===1?false:reads===2?'target':undefined,cdp:async()=>{},events:async()=>reads<2?[]:[{method:'Network.responseReceived',params:{response:{url:'https://www.instagram.com/api/graphql',status:429}}}],goto:async()=>{},url:async()=> 'https://www.instagram.com/target/',waitForSelector:async()=>{},waitForTimeout:async()=>{}};
 const result=await readProfile({page,username:'target'});
 assert.equal(result.status,'paused');assert.equal(result.reason,'instagram_access_stopped_429');assert.equal(result.emails,null);
});
test('HTTP-200 rate limit in profile response pauses before reading other authors',async()=>{
 let reads=0;
 const page={evaluate:async()=>++reads===1?false:reads===2?'target':undefined,cdp:async method=>method==='Network.getResponseBody'?{body:JSON.stringify({data:null,errors:[{message:'Rate limit exceeded'}]})}:{},events:async()=>reads<2?[]:[{method:'Network.responseReceived',params:{requestId:'1',response:{url:'https://www.instagram.com/api/graphql',status:200}}}],goto:async()=>{},url:async()=> 'https://www.instagram.com/target/',waitForSelector:async()=>{},waitForTimeout:async()=>{}};
 const r=await readProfile({page,username:'target'});assert.equal(r.status,'paused');assert.equal(r.reason,'instagram_access_stopped_rate_limit');assert.equal(r.emails,null);
});
test('full visible biography takes priority; truncated or wrong-author text cannot replace loaded data',()=>{
 const cached={biography:'older@example.com',emails:['older@example.com'],links:[],linksComplete:true};
 const dom={username:'target',biography:'visible@example.com',truncated:false,links:[],hasMultiLinks:false};
 assert.equal(mergeVisibleProfile(cached,dom,'target').biography,'visible@example.com');
 assert.equal(mergeVisibleProfile(cached,{...dom,truncated:true},'target').biography,cached.biography);
 assert.equal(mergeVisibleProfile(cached,{...dom,username:'viewer'},'target').biography,cached.biography);
});
test('already-loaded profile uses DOM and cached links without navigating or inspecting unrelated network errors',async()=>{
 const calls=[];const hydrated={data:{user:{username:'target',id:'123',biography:'old@example.com',bio_links:[{url:'https://example.com/'}]}}};
 const values=[false,'target',[JSON.stringify(hydrated)],{username:'target',biography:'visible@example.com',truncated:false,links:[],hasMultiLinks:false},null];
 const page={evaluate:async()=>values.shift(),url:async()=> 'https://www.instagram.com/target/',cdp:async()=>{},events:async()=>{calls.push('events');return [];},goto:async()=>assert.fail('must reuse loaded page'),waitForSelector:async()=>{},waitForTimeout:async()=>{}};
 const r=await readProfile({page,username:'target'});assert.equal(r.status,'observed');assert.deepEqual(r.emails,['visible@example.com']);assert.equal(r.links.length,1);assert.equal(r.source,'instagram_profile_dom');assert.equal(r.freshness,'loaded_page_not_revalidated');assert.equal(calls.length,1);
});
test('a complete loaded link list avoids reopening the native multi-link dialog',async()=>{
 const hydrated={data:{user:{username:'target',id:'123',biography:'work@example.com',bio_links:[{url:'https://one.example/'},{url:'https://two.example/'}]}}};
 const values=[false,'target',[JSON.stringify(hydrated)],{username:'target',biography:'work@example.com',truncated:false,hasMultiLinks:true},{expectedCount:2}];
 const page={evaluate:async()=>values.shift(),url:async()=> 'https://www.instagram.com/target/',cdp:async()=>{},events:async()=>[],click:async()=>assert.fail('complete cached links must not trigger a dialog'),waitForSelector:async()=>{},waitForTimeout:async()=>{}};
 const r=await readProfile({page,username:'target'});assert.equal(r.status,'observed');assert.equal(r.links.length,2);
});
test('visible multi-link count mismatch requires reading the dialog instead of trusting stale links',async()=>{
 const hydrated={user:{username:'target',biography:'work@example.com',bio_links:[{url:'https://one.example/'}]}};const dialog=[{url:'https://one.example/'},{url:'https://two.example/'}];let clicked=0;
 const values=[false,'target',[JSON.stringify(hydrated)],{username:'target',biography:'work@example.com',truncated:false,hasMultiLinks:true},{expectedCount:2},dialog,false];
 const page={evaluate:async()=>values.shift(),url:async()=> 'https://www.instagram.com/target/',cdp:async()=>{},events:async()=>[],click:async()=>clicked++,waitForSelector:async()=>{},waitForTimeout:async()=>{}};
 const r=await readProfile({page,username:'target'});assert.equal(clicked,1);assert.equal(r.links.length,2);assert.equal(r.linksSource,'instagram_native_links_dialog');
});
