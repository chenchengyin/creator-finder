const {readRenderedPage}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/browser.mjs');
const {extractCandidates}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/finder.mjs');
const assert=(await import('node:assert/strict')).default;
const t=await taskSpace(51),p=t.page('p1');
await p.goto('https://www.instagram.com/youtube/');
await p.waitForSelector('main header',{state:'visible',timeout:10000});
// Controlled DOM fixture only. No application event handlers, API writes or credentials.
try{
 await p.evaluate(()=>{document.body.innerHTML='<main><header><h1>fixture_creator</h1><p>public@example.org</p><button>and 2 more</button></header></main><div role="dialog"><h2>Links</h2><a href="https://www.tiktok.com/@other">Other creator</a><a href="https://example.org/Contact">Contact</a></div>';document.body.style.cssText='display:block;visibility:visible;opacity:1';});
 const c=await p.evaluate(readRenderedPage,{url:'https://www.instagram.com/youtube/'}),out=extractCandidates(c);
 assert.equal(c.actions.length,0);assert.equal(c.complete,true);assert.ok(out.links.some(l=>l.url==='https://www.tiktok.com/@other'));
 console.log('Instagram already-open links dialog: passed (controlled DOM, not live profile data)');
}finally{await p.goto('https://www.instagram.com/youtube/');}
