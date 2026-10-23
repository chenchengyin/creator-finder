#!/usr/bin/env node
import {readFile,writeFile,mkdir,rename,realpath} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {selectRecentVideos,collectVideoRegions} from './region.mjs';
import {pace} from '../tiktok-browser/access.mjs';

const USAGE=`读取 TikTok 最新视频的 locationCreated（只记录视频地区字段）
node read-region.mjs --space <现有Ego空间ID> --profile <主页采集JSON> --output <结果JSON> [--limit 1|3] [--dry-run] [--resume-403]
默认 limit=1。--dry-run 仅列出目标作品，不调用浏览器。
只操作 Agent 当前持有的现有空间。普通403等待11秒后同址恢复一次；地区详情错误页出现可见“重新加载”按钮时等待11秒后最多点击10次，恢复/保护提示/按钮消失后停止；不创建新空间。`;

export function parseArgs(argv){
  const args={limit:1,dryRun:false};
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];
    if(flag==='--help')return {help:true};
    if(flag==='--dry-run'){args.dryRun=true;continue;}
    if(flag==='--resume-403'){args.prior403=true;continue;}
    assert(['--space','--profile','--output','--limit'].includes(flag),'unknown option: '+flag);
    const value=argv[++i];assert(value&&!value.startsWith('--'),'missing option value: '+flag);
    args[{'--space':'spaceId','--profile':'profilePath','--output':'outputPath','--limit':'limit'}[flag]]=value;
  }
  args.spaceId=Number(args.spaceId);args.limit=Number(args.limit);
  assert(Number.isSafeInteger(args.spaceId)&&args.spaceId>0,'--space must be an existing numeric space ID');
  assert([1,3].includes(args.limit),'--limit must be 1 or 3');
  assert(args.profilePath&&args.outputPath,'--profile and --output are required');
  args.profilePath=resolve(args.profilePath);args.outputPath=resolve(args.outputPath);
  assert(args.profilePath!==args.outputPath,'output must not overwrite the profile capture');
  args.pacePath=resolve(dirname(args.profilePath),'last-tiktok-nav.txt');
  return args;
}

async function saveJson(path,data){
  await mkdir(dirname(path),{recursive:true});
  const temporary=path+'.tmp-'+process.pid;
  await writeFile(temporary,JSON.stringify(data,null,2)+'\n');await rename(temporary,path);
}

export async function runInEgo(config,{listTaskSpaces,taskSpace}){
  const space=(await listTaskSpaces()).find(s=>s.id===config.spaceId);
  assert(space&&['agent','agentOwned'].includes(space.ownership),'Ego space requires user-confirmed Agent control; resume the original space first');
  const capture=JSON.parse(await readFile(config.profilePath,'utf8'));
  selectRecentVideos(capture,config.limit);
  const task=await taskSpace(config.spaceId),page=task.page('p1');
  const report=await collectVideoRegions({page,capture,limit:config.limit,prior403:config.prior403,
    beforeNavigate:()=>pace(config.pacePath),save:report=>saveJson(config.outputPath,report)});
  if(report.observations.some(o=>o.status==='blocked'))await task.handOff();
  console.log(JSON.stringify({output:config.outputPath,summary:report.summary,stopped:report.stopped,stopReason:report.stopReason}));
  if(report.stopped)process.exitCode=3;
  return report;
}

async function main(){
  const config=parseArgs(process.argv.slice(2));
  if(config.help){console.log(USAGE);return;}
  const capture=JSON.parse(await readFile(config.profilePath,'utf8'));
  const targets=selectRecentVideos(capture,config.limit);
  if(config.dryRun){console.log(JSON.stringify({mode:'dry_run',spaceId:config.spaceId,selectionSnapshotAt:capture.profile.capturedAt,targets},null,2));return;}
  const code=`const {runInEgo}=await import(${JSON.stringify(import.meta.url)}); await runInEgo(${JSON.stringify(config)},{listTaskSpaces,taskSpace});`;
  const result=spawnSync('ego-browser',['nodejs'],{input:code,stdio:['pipe','inherit','inherit']});
  if(result.error)throw result.error;
  process.exitCode=result.status??1;
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>null)===fileURLToPath(import.meta.url)){
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
