const {createEgoBrowser}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/browser.mjs');
const {extractCandidates}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/finder.mjs');
const fs=await import('node:fs/promises');
const task=await taskSpace(51),page=task.page('p1');
const browser=createEgoBrowser({page,task,owned:false});
for(const [name,url] of [['tiktok','https://www.tiktok.com/@r3alism_0fficial'],['youtube','https://www.youtube.com/@YouTube'],['instagram','https://www.instagram.com/youtube/']]){
 const captures=[];
 try{
  const result=await browser.readPage({url,onCapture:async c=>{captures.push(c);await fs.writeFile('/Users/vb/Projects/creator-finder/scripts/profile-email-finder/validation/online-'+name+'.json',JSON.stringify({captures},null,2));}});
  const outputs=captures.map(extractCandidates);
  const record={url,result,rounds:captures.length,emails:[...new Set(outputs.flatMap(o=>o.emails.map(e=>e.key)))],links:[...new Set(outputs.flatMap(o=>o.links.map(l=>l.url)))]};
  await fs.writeFile('/Users/vb/Projects/creator-finder/scripts/profile-email-finder/validation/online-'+name+'-summary.json',JSON.stringify(record,null,2));
  console.log(JSON.stringify({name,...record}));
 }catch(e){console.log(JSON.stringify({name,error:e.message,pause:e.pause,rounds:captures.length}));if(e.pause)break;}
}
