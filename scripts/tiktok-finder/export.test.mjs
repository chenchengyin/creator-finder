import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {candidate,capture,config,temp} from './fixtures.mjs';
const api=await import('./export.mjs').catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?{}:Promise.reject(e));
const fn=name=>{assert.equal(typeof api[name],'function','Missing implementation: '+name);return api[name];};
test('导出-EXPORT-001 actual XLSX preserves identifiers, sources, suspected and formulas',async t=>{
 const profile=await import('./profile.mjs');const c=capture();c.profile.bio='=public@example.com';
 const r=profile.evaluateCapture({candidate:candidate(),capture:c,config});r.sourceKeywords=config.keywords;r.decision='suspected';r.content.uncertainty='待人工复核';
 const out=await fn('exportResults')({runDir:await temp(t),results:[r],config,render:true});assert.equal(out.verification.passed,true);assert.equal(out.verification.creatorCount,1);assert((await stat(out.path)).size>1000);assert.equal(out.previews.length,3);
 const audit=JSON.parse(await readFile(out.auditPath,'utf8'));assert.equal(audit.authors[0].authorId,'9999999999999999999');assert.equal(audit.authors[0].averageViews,60000);assert.equal(audit.authors[0].decision,'suspected');
});
test('导出-EXPORT-002 zero results still produce headers and target shortfall',async t=>{
 const out=await fn('exportResults')({runDir:await temp(t),results:[],config});assert.equal(out.verification.passed,true);assert.equal(out.verification.creatorCount,0);assert.equal(out.verification.shortfall,1);
});
test('输出-EXPORT-001 appended mounted-link columns preserve old metric formulas and source status',async t=>{
 const {evaluateCapture}=await import('./profile.mjs'),c=capture();
 c.profile.externalLink={status:'present',url:'https://example.com/?a=1&b=two',capturedAt:c.profile.capturedAt,evidence:[{fieldPath:'__DEFAULT_SCOPE__["webapp.user-detail"].userInfo.user.bioLink.link',rawValue:'https://example.com/?a=1&b=two'}]};
 const row=evaluateCapture({candidate:candidate(),capture:c,config});
 const out=await fn('exportResults')({runDir:await temp(t),results:[row],config,render:false});
 const audit=JSON.parse(await readFile(out.auditPath,'utf8'));
 assert.equal(audit.profileLinks[0].status,'present');assert.equal(audit.profileLinks[0].url,'https://example.com/?a=1&b=two');
 assert.match(audit.inspection,/主页挂链/);assert.match(audit.inspection,/example.com/);assert.equal(audit.authors[0].averageViews,60000);assert.equal(audit.authors[0].authorId,'9999999999999999999');
 const xml=spawnSync('/usr/bin/unzip',['-p',out.path,'xl/worksheets/sheet1.xml'],{encoding:'utf8'});assert.equal(xml.status,0,xml.stderr);
 const sheetXml=xml.stdout.replace(/(<\/?)x:/g,'$1');
 assert.match(sheetXml,/<c r="B7"[^>]*t="str"><v>9999999999999999999<\/v>/);
 assert.match(sheetXml,/<c r="D7"[^>]*><f[^>]*>COUNTIFS\([\s\S]*?<v>1<\/v>/);
 assert.match(sheetXml,/<c r="F7"[^>]*><f[^>]*>IF\([\s\S]*?<v>60000<\/v>/);
});
test('输出-EXPORT-001 export-only omits imported eligibility without current-run verification',async t=>{
 const {writeFile}=await import('node:fs/promises'),{join}=await import('node:path'),{evaluateCapture}=await import('./profile.mjs');
 const dir=await temp(t),cfg={...config,forceProfileFirstN:10};
 await writeFile(join(dir,'execution-state.json'),JSON.stringify({runId:'new-run',status:'paused',currentKeywordIndex:0,keywords:[]}));
 const row=evaluateCapture({candidate:candidate(),capture:capture(),config});
 const out=await fn('exportResults')({runDir:dir,results:[row],config:cfg,render:false});assert.equal(out.verification.creatorCount,0);
});
test('输出-EXPORT-001 current-run forced profile flows through real workbook exporter',async t=>{
 const {runCampaign}=await import('./workflow.mjs'),c=capture();c.profile.externalLink={status:'none',url:null,evidence:[],capturedAt:c.profile.capturedAt};
 const out=await runCampaign({config:{...config,keywords:['christian skits'],forceProfileFirstN:10},runDir:await temp(t),browser:{discoverBatch:async()=>({items:[{videoId:'1',authorId:c.profile.authorId,username:c.profile.username,bioHint:''}],hasMore:false,valid:true}),readProfile:async()=>c,finish:async()=>{}}});
 assert.equal(out.status,'completed');assert.equal(out.output.verification.creatorCount,1);assert.equal(out.keywords[0].forcedProfiles.completed,1);
 const audit=JSON.parse(await readFile(out.output.auditPath,'utf8'));assert.equal(audit.profileLinks[0].status,'none');assert.equal(audit.authors[0].averageViews,60000);
});
test('主表依据 stays compact while full public content remains in profile evidence',async t=>{
 const {evaluateCapture}=await import('./profile.mjs'),c=capture();c.pages[0].items[0].description='#christianskit '+('PUBLIC_CONTENT_DETAIL '.repeat(100));
 const row=evaluateCapture({candidate:candidate(),capture:c,config});const out=await fn('exportResults')({runDir:await temp(t),results:[row],config,render:false});
 const xml=name=>spawnSync('/usr/bin/unzip',['-p',out.path,name],{encoding:'utf8'}).stdout.replace(/(<\/?)x:/g,'$1');
 const main=xml('xl/worksheets/sheet1.xml'),evidence=xml('xl/worksheets/sheet2.xml');const basis=main.match(/<c r="L7"[^>]*>[\s\S]*?<v>([\s\S]*?)<\/v>/)?.[1];
 assert(basis?.length<1000);for(const value of ['内容','邮箱','60000','地区','US','主页证据'])assert(basis.includes(value));assert(!basis.includes('PUBLIC_CONTENT_DETAIL'));assert(evidence.includes('PUBLIC_CONTENT_DETAIL'));
});
