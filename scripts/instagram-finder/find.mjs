#!/usr/bin/env node
import fs from 'node:fs/promises';
import {resolve,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {projectRoot,readBatch,exportSavedBatch,normalizeBatchConfig} from './batch.mjs';
import {readProgress,watchChild} from './progress.mjs';

export async function assertRunDirectory(input){
 const base=await fs.realpath(join(projectRoot,'runs')),dir=resolve(projectRoot,input);
 const inside=p=>p!==base&&!relative(base,p).startsWith('..'+sep)&&relative(base,p)!=='..'&&!relative(base,p).startsWith(sep);
 if(!inside(dir))throw Error('preview_runs_required');
 let part=base;
 for(const component of relative(base,dir).split(sep)){
  part=join(part,component);
  let stat;try{stat=await fs.lstat(part);}catch(e){if(e.code==='ENOENT')break;throw e;}
  if(stat.isSymbolicLink()){let actual;try{actual=await fs.realpath(part);}catch{throw Error('preview_runs_required');}if(!inside(actual))throw Error('preview_runs_required');}
  else if(!stat.isDirectory())throw Error('preview_runs_required');
 }
 return dir;
}
export async function main(args=process.argv.slice(2),{print=console.log,launch}={}){
 const options={};
 for(let i=0;i<args.length;i++){
  const flag=args[i];if(flag==='--help'){print('Instagram找人与邮箱协作\n--config <配置JSON> --run-dir <preview/runs下新目录>\n--resume | --status | --export --run-dir <原目录>\n邮箱条件：requireEmail；挂链明确公开邮箱可用。');return 0;}
  const key={'--config':'configPath','--run-dir':'runDir','--resume':'resume','--status':'status','--export':'exportOnly'}[flag];
  if(!key||options[key]!==undefined)throw Error('invalid_or_duplicate_option: '+flag);
  if(['resume','status','exportOnly'].includes(key))options[key]=true;
  else{const value=args[++i];if(!value||value.startsWith('--'))throw Error('missing_value: '+flag);options[key]=value;}
 }
 if(!options.runDir)throw Error('run_dir_required');
 if([options.resume,options.status,options.exportOnly].filter(Boolean).length>1)throw Error('conflicting_modes');
 options.runDir=await assertRunDirectory(options.runDir);
 if(options.status||options.exportOnly){print(JSON.stringify(options.status?{...await readBatch(options.runDir),runtime:await readProgress(options.runDir)}:await exportSavedBatch(options.runDir),null,2));return 0;}
 if(options.configPath)options.config=normalizeBatchConfig(JSON.parse(await fs.readFile(resolve(projectRoot,options.configPath),'utf8')));
 if(options.resume){
  const state=await readBatch(options.runDir);
  if(options.config&&JSON.stringify(options.config)!==JSON.stringify(state.config))throw Error('resume_input_mismatch');
  if(state.status==='completed'){print(JSON.stringify(await exportSavedBatch(options.runDir),null,2));return 0;}
 }else{
  if(!options.config)throw Error('config_required');
  try{await fs.access(join(options.runDir,'execution-state.json'));throw Error('run_exists_use_resume');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 try{await fs.access(join(options.runDir,'.lock'));throw Error('batch_lock_exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(launch)return launch(options);
 options.executionId=randomUUID();
 const moduleUrl=new URL('./runtime.mjs',import.meta.url).href;
 // Ego maps nonzero worker codes to 1; the host translates a verified pause to CLI code 3.
 const script=`const {runInEgo}=await import(${JSON.stringify(moduleUrl)});const r=await runInEgo(${JSON.stringify(options)},{taskSpace,listTaskSpaces,claimTaskSpace,takeOverTaskSpace});console.log(JSON.stringify({status:r.status,reason:r.reason,authors:Object.keys(r.authors||{}).length}));process.exitCode=['completed','paused'].includes(r.status)?0:1;`;
 const child=spawn('ego-browser',['nodejs'],{stdio:['pipe','inherit','inherit']});
 const monitored=watchChild(child,{runDir:options.runDir,runId:options.executionId,print,workerPausedExitCode:0});
 child.stdin.on('error',()=>{});child.stdin.end(script);
 return monitored;
}
if(process.argv[1]&&(await fs.realpath(process.argv[1]).catch(()=>null))===fileURLToPath(import.meta.url))main().then(code=>{process.exitCode=code;}).catch(e=>{console.error(e.message);process.exitCode=1;});
