const {createEgoBrowser}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/browser.mjs');
const {extractCandidates}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/finder.mjs');
const fs=await import('node:fs/promises');
const t=await taskSpace(51),p=t.page('p1');
// Leave the previous About panel normally, then verify a fresh profile navigation.
await p.goto('https://example.org/');
const browser=createEgoBrowser({page:p,task:t,owned:false}),captures=[];
const result=await browser.readPage({url:'https://www.youtube.com/@YouTube',onCapture:async c=>captures.push(c)});
const record={result,captures,outputs:captures.map(extractCandidates)};
await fs.writeFile('/Users/vb/Projects/creator-finder/scripts/profile-email-finder/validation/youtube-round3-result.json',JSON.stringify(record,null,2));
console.log(JSON.stringify({result,rounds:captures.length,links:[...new Set(record.outputs.flatMap(o=>o.links.map(l=>l.url)))]}));
