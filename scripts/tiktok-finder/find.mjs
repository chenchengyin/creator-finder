#!/usr/bin/env node
import fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {normalizeConfig,assertResumeCompatible} from './config.mjs';
export function parseArgs(argv){
 const options={};for(let i=0;i<argv.length;i++){
  const flag=argv[i];if(flag==='--help')return {help:true};
  if(['--dry-run','--resume','--status','--export'].includes(flag)){options[{'--dry-run':'dryRun','--resume':'resume','--status':'statusOnly','--export':'exportOnly'}[flag]]=true;continue;}
  assert(['--config','--config-json','--run-dir','--space'].includes(flag),'unknown option '+flag);const value=argv[++i];assert(value&&!value.startsWith('--'),'missing option value');options[{'--config':'configPath','--config-json':'configJson','--run-dir':'runDir','--space':'spaceId'}[flag]]=value;
 }
 assert(options.runDir,'--run-dir required');options.runDir=resolve(options.runDir);assert(!(options.configPath&&options.configJson),'choose one configuration input');
 if(options.spaceId!==undefined){options.spaceId=Number(options.spaceId);assert(Number.isSafeInteger(options.spaceId)&&options.spaceId>0,'invalid space ID');}return options;
}
export async function main(argv=process.argv.slice(2)){
 const options=parseArgs(argv);if(options.help){console.log('find.mjs --run-dir <新批次目录> --config <JSON文件> --space <已有Agent空间> [--dry-run]\n恢复: --run-dir <目录> --resume；查看: --status；只导出: --export');return;}
 if(options.statusOnly){console.log(await fs.readFile(join(options.runDir,'execution-state.json'),'utf8'));return;}
 let saved;try{saved=JSON.parse(await fs.readFile(join(options.runDir,'config.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const input=options.configJson?JSON.parse(options.configJson):options.configPath?JSON.parse(await fs.readFile(options.configPath,'utf8')):null;
 let config;if(saved){assert(options.resume||options.exportOnly||options.dryRun,'run exists; use --resume');config=input?assertResumeCompatible(saved,input):saved;}else{assert(input,'configuration required');config=normalizeConfig(input);}
 if(options.dryRun){console.log(JSON.stringify({mode:'dry_run',runDir:options.runDir,config,pageLabel:'p1'},null,2));return;}
 if(options.exportOnly){const state=JSON.parse(await fs.readFile(join(options.runDir,'execution-state.json'),'utf8'));assert(!state.runtimeRunning,'another writer is running; export after pausing');const {exportResults}=await import('./export.mjs');const results=JSON.parse(await fs.readFile(join(options.runDir,'results.json'),'utf8'));console.log(JSON.stringify(await exportResults({runDir:options.runDir,results:results.filter(r=>['confirmed','suspected'].includes(r.decision)),config})));return;}
 let state;try{state=JSON.parse(await fs.readFile(join(options.runDir,'execution-state.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 options.spaceId??=state?.browser?.spaceId;assert(Number.isSafeInteger(options.spaceId)&&options.spaceId>0,'--space required for a new task; create one Ego space first');
 const moduleUrl=new URL('./browser.mjs',import.meta.url).href;
 const code=`const {runInEgo}=await import(${JSON.stringify(moduleUrl)});const result=await runInEgo({...${JSON.stringify({config,runDir:options.runDir,spaceId:options.spaceId,resume:!!options.resume})},onProgress:progress=>console.log(JSON.stringify(progress))},{listTaskSpaces,taskSpace});console.log(JSON.stringify({status:result.status,counts:result.counts,stopReason:result.stopReason,currentKeywordIndex:result.currentKeywordIndex,output:result.output}));if(result.status!=='completed')process.exitCode=3;`;
 const result=spawnSync('ego-browser',['nodejs'],{input:code,stdio:['pipe','inherit','inherit']});if(result.error)throw result.error;process.exitCode=result.status??1;
}
if(process.argv[1]&&await fs.realpath(process.argv[1]).catch(()=>null)===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
