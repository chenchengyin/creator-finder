const {createEgoBrowser}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/browser.mjs');
const {extractCandidates}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/finder.mjs');
const assert=(await import('node:assert/strict')).default,fs=await import('node:fs/promises');
const t=await taskSpace(51),p=t.page('p1'),browser=createEgoBrowser({page:p,task:t,owned:false}),captures=[];
const result=await browser.readPage({url:'https://www.youtube.com/@YouTube',onCapture:async c=>captures.push(c)});
const outputs=captures.map(extractCandidates),links=[...new Set(outputs.flatMap(o=>o.links.map(l=>l.url)))];
await fs.writeFile('/Users/vb/Projects/creator-finder/scripts/profile-email-finder/validation/youtube-final-retry-result.json',JSON.stringify({result,captures,outputs},null,2));
assert.equal(result.complete,true);assert.ok(links.includes('https://instagram.com/youtube'));assert.ok(links.includes('https://www.tiktok.com/@youtube'));assert.ok(!links.some(l=>/%E[0-9A-F]/.test(l)));
console.log(JSON.stringify({complete:result.complete,rounds:captures.length,links}));
