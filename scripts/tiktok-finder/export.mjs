import fs from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {verificationContextFor} from './config.mjs';
import {sameVerificationContext} from './profile.mjs';
async function artifact(){
 try{return await import('@oai/artifact-tool');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
 const moduleRoot=process.env.CREATOR_FINDER_NODE_MODULES||join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
 const require=createRequire(join(moduleRoot,'package.json'));
 return import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
}
const text=value=>typeof value==='string'&&value.startsWith('=')?"'"+value:value;
const linkStatus=value=>({present:'已挂链',none:'未挂链',unknown:'未核实'}[value]||'未核实');
const linkSource=link=>(link?.evidence||[]).map(e=>`${e.fieldPath}: ${e.rawValue??''}${e.href?'；'+e.href:''}`).join('\n');
const shanghaiDate=value=>new Date(new Date(value).getTime()+8*3600000);
const inclusionSummary=(r,config)=>[
 `内容：${r.content.decision==='passed'?'公开Bio/作品/歌单与关键词主题匹配':'方向有歧义，待人工复核'}（${r.sourceKeywords.join('、')}）；完整原文见“主页证据”。`,
 `邮箱：${r.emails.join('；')||'本批未要求邮箱'}；来自公开Bio（${r.profileUrl}）。`,
 `播放：上海${shanghaiDate(config.windowStart).toISOString().slice(0,10)}至${shanghaiDate(config.windowEndExclusive).toISOString().slice(0,10)}（结束不含），完整窗口${r.metrics.sampleSize}条，均播${r.metrics.averageViews.toFixed(2)}，严格大于${config.minAverageViewsExclusive}；逐条见“视频证据”。`,
 `地区：${config.country?'最新公开视频locationCreated='+r.location.country+'；字段不证明本人现居地':'本批未筛选地区'}。`,
 `挂链：${linkStatus(r.profile.externalLink?.status)}，仅记录，不替代Bio邮箱。`,
 `判定：${r.decision==='confirmed'?'已确认，必备数据条件已核实':'疑似符合，待人工复核内容方向'}。`
].join('\n');
export async function exportResults({runDir,results,config,render=true}){
 let taskState;try{taskState=JSON.parse(await fs.readFile(join(runDir,'execution-state.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(config.forceProfileFirstN){assert(taskState?.runId,'missing current run verification context');results=results.filter(r=>sameVerificationContext(r.capture,verificationContextFor(config,taskState.runId)));}
 const {Workbook,SpreadsheetFile}=await artifact();const outputDir=join(runDir,'outputs');await fs.mkdir(outputDir,{recursive:true});
 const unique=new Set();for(const r of results){assert(['confirmed','suspected'].includes(r.decision),'non-qualifying export row');assert(!unique.has(r.authorId),'duplicate author');unique.add(r.authorId);assert(r.metrics.coverageComplete&&r.metrics.sampleSize>0&&r.metrics.averageViews>config.minAverageViewsExclusive,'unverified metrics');assert(r.inclusionBasis,'missing inclusion basis');}
 const wb=Workbook.create(),main=wb.worksheets.add('达人名单'),profiles=wb.worksheets.add('主页证据'),videos=wb.worksheets.add('视频证据');
 main.getRange('A1').values=[['TikTok达人查找结果']];
 main.getRange('A2').values=[[`统计窗口（上海）：${shanghaiDate(config.windowStart).toISOString().slice(0,10)} 至 ${shanghaiDate(config.windowEndExclusive).toISOString().slice(0,10)}（结束不含）；均播须严格大于${config.minAverageViewsExclusive}。`]];
 main.getRange('A3').values=[[`已确认${results.filter(r=>r.decision==='confirmed').length}位；疑似${results.filter(r=>r.decision==='suspected').length}位，待人工核验；目标${config.targetCount??'未设定'}。视频地区字段不证明本人现居地。`]];
 const limitLabel=taskState?.completionReason==='target_reached'?'达到唯一达人目标':taskState?.completionReason==='keyword_limit_reached'?'达到关键词数量上限':null;
 main.getRange('A4').values=[[taskState?limitLabel?`本轮已停止：${limitLabel}；完整完成${taskState.keywords.filter(k=>k.stage==='completed').length}/${config.keywords.length}个关键词，剩余词及候选已保留。`:taskState.currentKeywordIndex===config.keywords.length?'全部关键词搜索及筛选已完成。':`阶段结果：已完成${taskState.currentKeywordIndex}/${config.keywords.length}个关键词，任务尚未完成；${taskState.stopReason||taskState.status}。`:'仅导出已核验候选；任务搜索进度未提供。']];
 main.getRange('A6:O6').values=[['账号','作者ID','主页公开邮箱','窗口视频数','窗口总播放','窗口均播','视频地区','来源关键词','复核状态','主页链接','采集时间（上海）','收录依据','主页挂链','挂链状态','挂链来源依据']];
 profiles.getRange('A1:J1').values=[['账号','作者ID','公开Bio原文','内容方向证据','地区字段证据','主页链接','采集时间（上海）','主页挂链','挂链状态','挂链来源依据']];
 videos.getRange('A1:J1').values=[['账号','作者ID','作品ID','发布时间（上海）','播放量','计入窗口','是否置顶','作品链接','采集时间（上海）','数据来源']];
 const videoRows=[];
 for(const r of results)for(const i of r.metrics.items){assert.equal(i.authorId,r.authorId,'video identity mismatch');videoRows.push(['@'+r.username,i.authorId,i.id,shanghaiDate(i.createdAt*1000),Number.isSafeInteger(i.views)?i.views:null,r.metrics.sample.some(s=>s.id===i.id)?1:0,i.pinned?'是':'否',i.url,shanghaiDate(i.capturedAt||r.profileCapturedAt),i.source||'ego_passive_profile_item_list']);}
 if(videoRows.length)videos.getRangeByIndexes(1,0,videoRows.length,10).values=videoRows.map(row=>row.map(text));
 const end=Math.max(2,videoRows.length+1);
 const profileRows=results.map(r=>['@'+r.username,r.authorId,r.profile.bio,(r.content.evidence||[]).map(e=>`${e.publishedAt||''} ${e.text} ${e.url||''}`).join('\n'),r.location.evidence.map(e=>`${e.fieldPath}: ${e.rawValue}; ${e.videoUrl}; ${e.capturedAt}`).join('\n'),r.profile.profileUrl,shanghaiDate(r.profileCapturedAt),r.profile.externalLink?.url||'',linkStatus(r.profile.externalLink?.status),linkSource(r.profile.externalLink)]);
 if(profileRows.length)profiles.getRangeByIndexes(1,0,profileRows.length,10).values=profileRows.map(row=>row.map(text));
 for(let n=0;n<results.length;n++){
  const r=results[n],row=n+7;
  main.getRangeByIndexes(row-1,0,1,15).values=[['@'+r.username,r.authorId,text(r.emails.join('; ')),null,null,null,r.location.country||'未核验',r.sourceKeywords.join('；'),r.decision==='confirmed'?'已确认':'疑似符合，待人工复核',r.profileUrl,shanghaiDate(r.profileCapturedAt),inclusionSummary(r,config),r.profile.externalLink?.url||'',linkStatus(r.profile.externalLink?.status),linkSource(r.profile.externalLink)].map(text)];
  main.getRange(`D${row}:F${row}`).formulas=[[
   `=COUNTIFS('视频证据'!$A$2:$A$${end},A${row},'视频证据'!$F$2:$F$${end},1)`,
   `=SUMIFS('视频证据'!$E$2:$E$${end},'视频证据'!$A$2:$A$${end},A${row},'视频证据'!$F$2:$F$${end},1)`,
   `=IF(D${row}>0,E${row}/D${row},"")`]];
 }
 const widths=[[150,195,290,110,130,130,110,220,210,320,175,700,380,110,520],[150,195,380,650,500,320,175,380,110,520],[150,195,210,175,120,100,100,380,175,240]];
 for(const [index,sheet] of [main,profiles,videos].entries()){
  sheet.showGridLines=false;sheet.getUsedRange().format.font={name:'Arial',size:10,color:'#17212F'};sheet.getUsedRange().format.rowHeight=24;sheet.getUsedRange().format.verticalAlignment='center';
  const header=index===0?'A6:O6':index===1?'A1:J1':'A1:J1';sheet.getRange(header).format={fill:'#253B60',font:{name:'Arial',bold:true,size:10,color:'#FFFFFF'},rowHeight:32};
  widths[index].forEach((width,column)=>sheet.getRangeByIndexes(0,column,Math.max(1,sheet.getUsedRange().values.length),1).format.columnWidthPx=width);
  sheet.freezePanes.freezeRows(index===0?6:1);
 }
 main.getRange('A1').format.font={size:16,bold:true};main.getRange('A2:L3').format.rowHeight=28;
 if(results.length){main.getRange(`D7:E${results.length+6}`).setNumberFormat('#,##0');main.getRange(`F7:F${results.length+6}`).setNumberFormat('#,##0.00');main.getRange(`B7:B${results.length+6}`).setNumberFormat('@');main.getRange(`K7:K${results.length+6}`).setNumberFormat('yyyy-mm-dd hh:mm');main.getRange(`C7:O${results.length+6}`).format.wrapText=true;main.getRange(`A7:O${results.length+6}`).format.autofitRows();profiles.getRange(`B2:B${results.length+1}`).setNumberFormat('@');profiles.getRange(`C2:J${results.length+1}`).format.wrapText=true;profiles.getRange(`A2:J${results.length+1}`).format.autofitRows();profiles.getRange(`G2:G${results.length+1}`).setNumberFormat('yyyy-mm-dd hh:mm');}
 if(videoRows.length){videos.getRange(`B2:C${end}`).setNumberFormat('@');videos.getRange(`D2:D${end}`).setNumberFormat('yyyy-mm-dd hh:mm');videos.getRange(`I2:I${end}`).setNumberFormat('yyyy-mm-dd hh:mm');videos.getRange(`E2:F${end}`).setNumberFormat('#,##0');}
 for(let row=7;row<results.length+7;row++)main.getRange(`A${row}:O${row}`).format.rowHeight+=12;
 for(let row=2;row<results.length+2;row++)profiles.getRange(`A${row}:J${row}`).format.rowHeight+=8;
 if(results.length)main.getRange(`G7:I${results.length+6}`).format.horizontalAlignment='center';
 wb.recalculate();
 if(results.length){const computed=main.getRange(`D7:F${results.length+6}`).values;results.forEach((r,i)=>{assert.equal(computed[i][0],r.metrics.sampleSize,'export count mismatch');assert.equal(computed[i][1],r.metrics.totalViews,'export total mismatch');assert(Math.abs(computed[i][2]-r.metrics.averageViews)<1e-7,'export mean mismatch');});}
 const inspection=await wb.inspect({kind:'table',range:`'达人名单'!A6:O${Math.max(7,results.length+6)}`,include:'values,formulas',tableMaxRows:Math.min(10,results.length+1),tableMaxCols:15,maxChars:12000});
 const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#NULL!',options:{useRegex:true,maxResults:100},maxChars:4000});
 const previews=[];if(render)for(const [sheetName,range] of [['达人名单',`A1:O${Math.min(results.length+6,9)}`],['主页证据',`A1:J${Math.max(2,Math.min(results.length+1,4))}`],['视频证据',`A1:J${Math.max(2,Math.min(end,10))}`]]){const preview=await wb.render({sheetName,range,scale:1,format:'png'});const path=join(outputDir,sheetName+'-预览.png');await fs.writeFile(path,new Uint8Array(await preview.arrayBuffer()));previews.push(path);}
 const path=join(outputDir,'TikTok-达人查找结果.xlsx');await (await SpreadsheetFile.exportXlsx(wb)).save(path);
 const verification={passed:true,creatorCount:results.length,shortfall:config.targetCount?Math.max(0,config.targetCount-results.length):0};
 const auditPath=join(outputDir,'导出核对.json');await fs.writeFile(auditPath,JSON.stringify({verification,authors:results.map(r=>({authorId:r.authorId,decision:r.decision,sampleSize:r.metrics.sampleSize,averageViews:r.metrics.averageViews})),profileLinks:results.map(r=>({authorId:r.authorId,status:r.profile.externalLink?.status||'unknown',url:r.profile.externalLink?.url||null,evidence:r.profile.externalLink?.evidence||[]})),inspection:inspection.ndjson,errorScan:errors.ndjson},null,2));
 return {path,previews,auditPath,verification};
}
