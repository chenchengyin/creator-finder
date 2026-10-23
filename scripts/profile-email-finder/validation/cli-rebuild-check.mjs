import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {runFinder} from '../finder.mjs';
const runDir=new URL('./cli-completed-replay/',import.meta.url).pathname;
await fs.mkdir(runDir,{recursive:true});
const url='https://www.tiktok.com/@fixture',capture={url,ready:true,complete:true,kind:'profile',platform:'tiktok',blocks:[{text:'fixture@example.org',location:'bio',visible:true}],links:[],issues:[]};
// Offline replay fixture: ID deliberately does not identify a live space.
await runFinder({config:{url},runDir,browser:{session:{spaceId:9999997,owned:true,pageLabel:'p1'},async readPage({onCapture}){await onCapture(capture);return {complete:true};},async finish(){}}});
await fs.unlink(new URL('results.json','file://'+runDir));
const result=spawnSync(process.execPath,[new URL('../find.mjs',import.meta.url).pathname,'--resume','--run-dir',runDir],{encoding:'utf8',timeout:20000});
await fs.writeFile(new URL('./cli-rebuild-output.log',import.meta.url),result.stdout+result.stderr);
assert.equal(result.status,0,result.error?.message||result.stderr);
const restored=JSON.parse(await fs.readFile(new URL('results.json','file://'+runDir),'utf8'));assert.equal(restored.completion,'completed');assert.equal(restored.emails[0].key,'fixture@example.org');console.log('CLI -> Ego child -> completed snapshot rebuild: passed; no browser space created');
