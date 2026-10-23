import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export const input={keywords:['christian skits','bible comedy'],country:'US',days:10,minAverageViewsExclusive:50000,requireBioEmail:true,targetCount:1};
export const now='2026-10-21T04:00:00Z';
export const config={...input,windowStart:'2026-10-10T16:00:00.000Z',windowEndExclusive:'2026-10-20T16:00:00.000Z',timezone:'Asia/Shanghai',createdAt:new Date(now).toISOString(),schemaVersion:1};
export const candidate=(username='example',id='9999999999999999999',text='#christianskit')=>({username,authorIdHint:id,bioHint:'public@example.com',keyword:'christian skits',sourceEvidence:[{videoId:'7777777777777777777',authorId:id,username,text,videoUrl:`https://www.tiktok.com/@${username}/video/7777777777777777777`,keyword:'christian skits',capturedAt:now}]});
export function capture(username='example',id='9999999999999999999'){
 return {profile:{username,authorId:id,profileUrl:'https://www.tiktok.com/@'+username,bio:'Comedy #christianskit public@example.com',ready:true,identityVerified:true,statusCode:0,privateAccount:false,latestOrderConfirmed:true,capturedAt:now,playlists:[]},pages:[{statusCode:0,hasMore:false,cursor:1,items:[{id:'7777777777777777777',authorId:id,username,createdAt:Date.parse('2026-10-15T00:00:00Z')/1000,views:60000,description:'#christianskit',mediaType:'video',locationCreated:'US',capturedAt:now,url:`https://www.tiktok.com/@${username}/video/7777777777777777777`}]}]};
}
export async function temp(t){const dir=await mkdtemp(join(tmpdir(),'finder-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
