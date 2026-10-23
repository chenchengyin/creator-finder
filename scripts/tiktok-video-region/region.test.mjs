import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';

const api=await import('./region.mjs').catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?{}:Promise.reject(e));
const cli=await import('./read-region.mjs').catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?{}:Promise.reject(e));
const fn=name=>{assert.equal(typeof api[name],'function',`Missing implementation: ${name}`);return api[name];};
const authorId='6759145282514699269', username='tussalty';
const now='2026-10-21T03:00:00.000Z';
const item=(id,time,extra={})=>({id,authorId,username,createdAt:time,url:`https://www.tiktok.com/@${username}/video/${id}`,capturedAt:now,...extra});
const newest=item('7698785135864384782',1792540000);
const middle=item('7698416115965299981',1792450000);
const oldest=item('7696537596033273102',1792000000);
const capture=(items=[oldest,newest,middle])=>({profile:{authorId,username,capturedAt:now,identityVerified:true,latestOrderConfirmed:true},pages:[{statusCode:0,items:structuredClone(items)}]});
const observation=(target=newest,value='US',extra={})=>({url:target.url,httpStatus:200,capturedAt:now,statusCode:0,item:{id:target.id,authorId,username,createdAt:target.createdAt,locationCreated:value},...extra});

test('latest selection uses publish time rather than pinned position and keeps a genuinely newest pinned post',()=>{
 const c=capture([{...oldest,pinned:true},{...newest,pinned:true},middle]);
 assert.deepEqual(fn('selectRecentVideos')(c,3).map(i=>i.id),[newest.id,middle.id,oldest.id]);
});
test('private posts and photo routes are excluded, duplicate video IDs count once',()=>{
 const c=capture([oldest,newest,newest,{...middle,privateItem:true},item('7691111111111111111',1792500000,{url:`https://www.tiktok.com/@${username}/photo/7691111111111111111`})]);
 assert.deepEqual(fn('selectRecentVideos')(c,3).map(i=>i.id),[newest.id,oldest.id]);
});
test('photo media is excluded even when the profile collector supplied a video-shaped URL',()=>{
 const c=capture([{...newest,mediaType:'photo'},middle]);
 assert.deepEqual(fn('selectRecentVideos')(c,1).map(i=>i.id),[middle.id]);
});
test('unknown latest order, wrong authors, unsafe numeric IDs and conflicting duplicates fail before navigation',()=>{
 for(const mutate of [c=>c.profile.latestOrderConfirmed=false,c=>c.pages[0].items[0].authorId='different',c=>c.pages[0].items[0].id=7696537596033273102,c=>c.pages[0].items.push({...oldest,createdAt:1})]){
  const c=capture();mutate(c);assert.throws(()=>fn('selectRecentVideos')(c,3));
 }
});
test('future/invalid dates and an invalid limit fail selection',()=>{
 for(const createdAt of [NaN,0,Date.parse(now)/1000+1000])assert.throws(()=>fn('selectRecentVideos')(capture([{...newest,createdAt}]),1));
 assert.throws(()=>fn('selectRecentVideos')(capture(),2));
});
test('browser extraction reads only the video object, never app-context region or unrelated private data',()=>{
 const hydration={__DEFAULT_SCOPE__:{'webapp.app-context':{region:'SG'},'webapp.video-detail':{statusCode:0,itemInfo:{itemStruct:{id:newest.id,author:{id:authorId,uniqueId:username},createTime:newest.createdAt,locationCreated:'US',secretCanary:'do-not-store'}}}}};
 const context={document:{getElementById:()=>({textContent:JSON.stringify(hydration)}),querySelector:()=>null,querySelectorAll:()=>[],title:'TikTok',body:{innerText:''}},location:{href:newest.url},performance:{getEntriesByType:()=>[{responseStatus:200}]},Date};
 const result=runInNewContext(`(${fn('readVideoPage').toString()})()`,context);
 assert.equal(result.item.locationCreated,'US');assert.equal(result.item.id,newest.id);
 assert(!JSON.stringify(result).includes('do-not-store'));assert(!JSON.stringify(result).includes('SG'));
});
test('ordinary video caption mentioning HTTP ERROR 403 does not override a successful navigation',()=>{
 const hydration={__DEFAULT_SCOPE__:{'webapp.video-detail':{statusCode:0,itemInfo:{itemStruct:{id:newest.id,author:{id:authorId,uniqueId:username},createTime:newest.createdAt,locationCreated:'US'}}}}};
 const context={document:{getElementById:()=>({textContent:JSON.stringify(hydration)}),querySelector:()=>null,querySelectorAll:()=>[],body:{innerText:'A tutorial about HTTP ERROR 403'}},location:{href:newest.url},performance:{getEntriesByType:()=>[{responseStatus:200}]},Date};
 assert.equal(runInNewContext(`(${fn('readVideoPage').toString()})()`,context).httpStatus,200);
});
test('US is saved with exact source, video identity and time, without asserting residence',()=>{
 const result=fn('extractVideoRegion')(observation(),newest);
 assert.equal(result.status,'observed');assert.equal(result.regionCode,'US');assert.equal(result.rawValue,'US');
 assert.equal(result.videoId,newest.id);assert.equal(result.videoUrl,newest.url);assert.equal(result.publishedAt,new Date(newest.createdAt*1000).toISOString());
 assert(result.fieldPath.endsWith('.itemInfo.itemStruct.locationCreated'));
 assert.equal(result.creatorResidenceVerified,false);
});
test('absent, blank or non-string fields remain pending and never fall back to browser region',()=>{
 for(const value of [undefined,null,'',{},'USA','ZZ']){
  const data=observation(newest,value,{appContextRegion:'US'});data.item.locationCreated=value;
  const result=fn('extractVideoRegion')(data,newest);
  assert.equal(result.status,'pending');assert.equal(result.regionCode,null);
 }
});
test('mismatched video, author, page route and publish time are rejected',()=>{
 for(const change of [o=>o.item.id=middle.id,o=>o.item.authorId='wrong',o=>o.item.username='wrong',o=>o.url=middle.url,o=>o.item.createdAt=1]){
  const o=observation();change(o);const r=fn('extractVideoRegion')(o,newest);assert.equal(r.status,'pending');assert.equal(r.reason,'identity_mismatch');assert.equal(r.regionCode,null);
 }
});
test('HTTP protection and captcha stop collection even if stale hydration exists',()=>{
 for(const extra of [{httpStatus:401},{httpStatus:403},{httpStatus:429},{captcha:true}])assert.equal(fn('extractVideoRegion')(observation(newest,'US',extra),newest).status,'blocked');
});
test('server failures cannot turn stale hydration into usable region evidence',()=>{
 const r=fn('extractVideoRegion')(observation(newest,'US',{httpStatus:500}),newest);
 assert.equal(r.status,'pending');assert.equal(r.regionCode,null);assert.equal(r.reason,'http_500');
});
test('an optional login prompt and missing hydration pause for inspection instead of asserting a forced login wall',()=>{
 assert.equal(fn('extractVideoRegion')(observation(newest,'US',{loginPrompt:true}),newest).reason,'login_prompt_needs_inspection');
 assert.equal(fn('extractVideoRegion')({...observation(),item:null},newest).status,'pending');
});
test('single-video, three-video, conflicting and incomplete evidence receive distinct summaries',()=>{
 const ex=fn('extractVideoRegion'), summarize=fn('summarizeRegions');
 const us=[newest,middle,oldest].map(i=>ex(observation(i),i));
 assert.equal(summarize(us.slice(0,1),1).status,'single_video');
 assert.equal(summarize(us,3).status,'recent_videos_consistent');
 assert.equal(summarize([...us.slice(0,2),ex(observation(oldest,'GB'),oldest)],3).status,'conflicting');
 assert.equal(summarize(us.slice(0,2),3).status,'incomplete');
 assert.equal(summarize([ex(observation(newest,null),newest),...us.slice(1)],3).regionCode,null);
});
test('collection stops after one delayed 403 retry without navigating the next video',async()=>{
 let calls=0,reloads=0,saves=0;
 const page={url:async()=>newest.url,goto:async()=>{calls++;},reload:async()=>{reloads++;},evaluate:async()=>observation(newest,'US',{httpStatus:403})};
 const waits=[];const report=await fn('collectVideoRegions')({page,capture:capture(),limit:3,sleep:async ms=>waits.push(ms),beforeNavigate:async()=>{},save:async()=>saves++});
 assert.equal(calls,0);assert.equal(reloads,1);assert.deepEqual(waits,[11000]);assert(saves>=1);assert.equal(report.stopped,true);assert.equal(report.stopReason,'http_403');assert.equal(report.navigationAttempts.length,2);assert.equal(report.navigationAttempts[1].action,'reload');
});
test('goto failure with confirmed 403 gets a single retry and preserves both denial attempts',async()=>{
 let calls=0,inspections=0;
 const page={goto:async()=>{calls++;throw Error('net::ERR_HTTP_RESPONSE_CODE_FAILURE');},evaluate:async()=>{inspections++;return observation(newest,'US',{httpStatus:403});}};
 const report=await fn('collectVideoRegions')({page,capture:capture(),limit:3,sleep:async()=>{}});
 assert.equal(calls,2);assert.equal(inspections,2);assert.equal(report.navigationAttempts.length,2);assert.equal(report.stopReason,'http_403');
});
test('a saved 403 already recovered before resume keeps the successful US evidence without another navigation',async()=>{
 let calls=0,reloads=0,reads=0;const waits=[];
 const page={url:async()=>newest.url,goto:async()=>calls++,reload:async()=>reloads++,evaluate:async()=>observation(newest,'US',{httpStatus:reads++===0?403:200})};
 const r=await fn('collectVideoRegions')({page,capture:capture(),limit:1,sleep:async ms=>waits.push(ms)});
 assert.equal(r.stopped,false);assert.equal(r.summary.regionCode,'US');assert.deepEqual(waits,[]);assert.equal(calls,0);assert.equal(reloads,0);assert.equal(r.navigationAttempts.length,2);assert.equal(r.navigationAttempts[1].action,'inspect');
});
test('a chrome error page recovers by clicking TikTok’s visible reload button',async()=>{
 let currentUrl='chrome-error://chromewebdata/',calls=0,clicks=0,reads=0;const waits=[];
 const page={url:async()=>currentUrl,goto:async u=>{calls++;currentUrl=u;},snapshot:async()=>"访问 www.tiktok.com 的请求遭到拒绝 HTTP ERROR 403 重新加载",click:async()=>{clicks++;currentUrl=newest.url;},evaluate:async()=>observation(newest,'US',{httpStatus:reads++===0?403:200})};
 const report=await fn('collectVideoRegions')({page,capture:capture(),limit:1,sleep:async ms=>waits.push(ms)});
 assert.equal(report.stopped,false);assert.equal(report.summary.regionCode,'US');assert.deepEqual(waits,[10000]);assert.equal(calls,1);assert.equal(clicks,1);assert.equal(report.navigationAttempts[1].action,'reload_button');
});
test('an Ego blocked region page records thirty visible reload clicks before pausing',async()=>{
 let currentUrl='chrome-error://chromewebdata/',clicks=0;
 const page={url:async()=>currentUrl,goto:async()=>{},snapshot:async()=>"www.tiktok.com 已被屏蔽 此页面已被 ego 屏蔽 ERR_BLOCKED_BY_CLIENT 重新加载",
  click:async()=>clicks++,evaluate:async()=>({url:currentUrl,httpStatus:0,statusCode:null,item:null,capturedAt:now})};
 const report=await fn('collectVideoRegions')({page,capture:capture(),limit:1,sleep:async()=>{}});
 assert.equal(clicks,30);assert.equal(report.navigationAttempts.length,31);assert.equal(report.navigationAttempts[0].action,'goto');
 assert(report.navigationAttempts.slice(1).every(attempt=>attempt.action==='reload_button'));
 assert.equal(report.stopped,true);assert.equal(report.observations[0].reason,'video_data_unavailable');
});
test('a matching already-loaded video is read without a redundant navigation',async()=>{
 let calls=0;const page={url:async()=>newest.url,goto:async()=>calls++,evaluate:async()=>observation()};
 const r=await fn('collectVideoRegions')({page,capture:capture(),limit:1});assert.equal(calls,0);assert.equal(r.summary.regionCode,'US');
});
test('an already-loaded 403 with a captcha or login prompt never starts the delayed retry',async()=>{
 for(const extra of [{captcha:true},{loginPrompt:true}]){
  let calls=0;const waits=[];
  const page={url:async()=>newest.url,goto:async()=>calls++,evaluate:async()=>observation(newest,'US',{httpStatus:403,...extra})};
  const report=await fn('collectVideoRegions')({page,capture:capture(),limit:1,sleep:async ms=>waits.push(ms)});
  assert.equal(calls,0);assert.deepEqual(waits,[]);assert.equal(report.stopped,true);assert.equal(report.summary.regionCode,null);
 }
});
test('a successful page waits for the video object before classifying missing data',async()=>{
 let ready=false;
 const page={goto:async()=>{},waitForFunction:async()=>{ready=true;},evaluate:async()=>ready?observation():{...observation(),item:null}};
 const r=await fn('collectVideoRegions')({page,capture:capture(),limit:1});
 assert.equal(r.stopped,false);assert.equal(r.summary.regionCode,'US');
});
test('a failed navigation cannot reuse previously loaded matching hydration as a successful observation',async()=>{
 const page={goto:async()=>{throw Error('net::ERR_CONNECTION_RESET');},evaluate:async()=>observation()};
 const r=await fn('collectVideoRegions')({page,capture:capture(),limit:1});
 assert.equal(r.stopped,true);assert.equal(r.observations[0].status,'pending');assert.equal(r.summary.regionCode,null);
});
test('control loss propagates without trying another page or inspection',async()=>{
 let inspections=0;
 const page={goto:async()=>{throw Error('space is user-owned');},evaluate:async()=>inspections++};
 await assert.rejects(fn('collectVideoRegions')({page,capture:capture(),limit:3}),/user-owned/);assert.equal(inspections,0);
});
test('a normal profile-list field avoids an extra detail navigation',async()=>{
 const c=capture([{...newest,locationCreated:'US'}]);let calls=0;
 const report=await fn('collectVideoRegions')({page:{goto:async()=>calls++},capture:c,limit:1});
 assert.equal(calls,0);assert.equal(report.observations[0].source,'profile_item_list.locationCreated');
 assert.equal(report.summary.regionCode,'US');
});
test('CLI rejects malformed options and cannot overwrite the input capture',()=>{
 assert.equal(typeof cli.parseArgs,'function');
 const args=['--space','328','--profile','/tmp/profile.json','--output','/tmp/region.json'];
 assert.equal(cli.parseArgs(args).limit,1);
 for(const more of [['--limit','2'],['--unknown','x']])assert.throws(()=>cli.parseArgs([...args,...more]));
 assert.throws(()=>cli.parseArgs(['--space','328','--profile','/tmp/same.json','--output','/tmp/same.json']));
});
test('dry-run selects targets without touching Ego and the runner refuses a space delegated to the user',async()=>{
 assert.equal(typeof cli.runInEgo,'function');
 const dir=await mkdtemp(join(tmpdir(),'tiktok-region-test-')),profilePath=join(dir,'profile.json'),outputPath=join(dir,'region.json');
 await writeFile(profilePath,JSON.stringify(capture()));let opened=0;
 const config={spaceId:328,profilePath,outputPath,limit:1,pacePath:join(dir,'pace.txt')};
 await assert.rejects(cli.runInEgo(config,{listTaskSpaces:async()=>[{id:328,ownership:'agentDelegatedToUser'}],taskSpace:async()=>opened++}),/control/);
 assert.equal(opened,0);
 const {spawnSync}=await import('node:child_process');
 const run=spawnSync(process.execPath,[new URL('./read-region.mjs',import.meta.url).pathname,'--space','328','--profile',profilePath,'--output',outputPath,'--dry-run'],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);const plan=JSON.parse(run.stdout);assert.equal(plan.mode,'dry_run');assert.equal(plan.targets[0].id,newest.id);
});
test('runner in an Agent-owned space writes a complete reusable JSON report from a normal captured list field',async()=>{
 assert.equal(typeof cli.runInEgo,'function');
 const dir=await mkdtemp(join(tmpdir(),'tiktok-region-runner-')),profilePath=join(dir,'profile.json'),outputPath=join(dir,'region.json');
 await writeFile(profilePath,JSON.stringify(capture([{...newest,locationCreated:'US'}])));
 let navigations=0,handOffs=0;
 const result=await cli.runInEgo({spaceId:328,profilePath,outputPath,limit:1,pacePath:join(dir,'pace.txt')},{
  listTaskSpaces:async()=>[{id:328,ownership:'agent'}],
  taskSpace:async()=>({page:()=>({goto:async()=>navigations++}),handOff:async()=>handOffs++})
 });
 assert.equal(navigations,0);assert.equal(handOffs,0);assert.equal(result.summary.regionCode,'US');
 assert.equal(JSON.parse(await readFile(outputPath,'utf8')).observations[0].rawValue,'US');
});
test('CLI entrypoint remains usable through the compatibility directory symlink',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tiktok-region-link-'));
 await symlink(new URL('.',import.meta.url).pathname,join(dir,'alias'),'dir');
 const {spawnSync}=await import('node:child_process');
 const run=spawnSync(process.execPath,[join(dir,'alias/read-region.mjs'),'--help'],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/locationCreated/);
});
