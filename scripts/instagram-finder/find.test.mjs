import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join} from 'node:path';
let cli={};try{cli=await import('./find.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
test('CLI-001 help does not launch a browser',async()=>{
 assert.equal(typeof cli.main,'function');const printed=[];const code=await cli.main(['--help'],{print:v=>printed.push(v),launch:()=>assert.fail('help must not launch')});assert.equal(code,0);assert.ok(printed[0].includes('--config'));
});
test('CLI-001 original directory and a symlink outside preview runs are rejected',async t=>{
 assert.equal(typeof cli.assertRunDirectory,'function');await assert.rejects(cli.assertRunDirectory('/Users/vb/Projects/creator-finder/runs/new'),/preview_runs_required/);
 const base=new URL('../../runs/',import.meta.url).pathname,dir=await fs.mkdtemp(join(base,'cli-isolation-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.symlink('/tmp',join(dir,'outside'));
 await assert.rejects(cli.assertRunDirectory(join(dir,'outside','new')),/preview_runs_required/);
 await fs.symlink('/tmp/preview-target-not-created-123',join(dir,'dangling'));
 await assert.rejects(cli.assertRunDirectory(join(dir,'dangling','new')),/preview_runs_required/);
});
test('CLI-001 status and export read a saved batch without connecting browser',async t=>{
 assert.equal(typeof cli.main,'function');const {runBatch}=await import('./batch.mjs');
 const dir=await fs.mkdtemp(new URL('../../runs/cli-readonly-',import.meta.url).pathname);t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const config={keywords:['#one'],conditions:{requireEmail:false}};
 await runBatch({config,runDir:dir,browser:{page:{},session:{},startKeyword:async()=>({items:[],hasMore:false,cursor:null}),nextSearchPage:async()=>assert.fail('no next')}});
 for(const flag of ['--status','--export'])assert.equal(await cli.main([flag,'--run-dir',dir],{print:()=>{},launch:()=>assert.fail('read-only must not launch')}),0);
 await fs.writeFile(join(dir,'.lock'),'{}');await assert.rejects(cli.main(['--export','--run-dir',dir],{print:()=>{}}),/lock/);
});
