const {createEgoBrowser}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/browser.mjs');
const {runFinder}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/finder.mjs');
const fs=await import('node:fs/promises');
const task=await taskSpace(51),page=task.page('p1');
const actual=createEgoBrowser({page,task,owned:false});
// This harness retains task ownership across the bounded verification cases;
// it deliberately manages handOff/finish at the end of the whole validation.
const browser={...actual,async finish(){},async handOff(){}};
const runDir='/Users/vb/Projects/creator-finder/scripts/profile-email-finder/validation/online-run-tiktok';
const r=await runFinder({config:{url:'https://www.tiktok.com/@r3alism_0fficial'},runDir,browser,onProgress:console.log});
console.log(JSON.stringify({completion:r.completion,emails:r.emails.map(e=>({email:e.email,source:e.evidence[0].sourceUrl})),pages:r.pages.map(p=>({url:p.url,status:p.status,issues:p.issues})),pending:r.pending}));
const captures=[];const webResult=await actual.readPage({url:'https://blog.youtube/creator-and-artist-stories/',onCapture:async c=>captures.push(c)});
await fs.writeFile('/Users/vb/Projects/creator-finder/scripts/profile-email-finder/validation/online-webpage.json',JSON.stringify({result:webResult,captures},null,2));
console.log(JSON.stringify({webpage:webResult,rounds:captures.length,characters:captures.at(-1)?.blocks.reduce((n,b)=>n+b.text.length,0)}));
