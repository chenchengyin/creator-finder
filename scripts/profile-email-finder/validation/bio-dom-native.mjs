const {readRenderedPage}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/browser.mjs');
const {extractCandidates}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/finder.mjs');
const assert=(await import('node:assert/strict')).default;
const entry=(await listTaskSpaces()).find(s=>s.id===51);assert.equal(entry?.ownership,'agent');
const task=await taskSpace(51),page=task.page('p1');
const bio={tag:'span',text:'Bio bio@example.org'},link={tag:'a',attrs:{href:'https://beacons.ai/fixture'},text:'linklabel@example.org'};
const cases=[
 ['tiktok','https://www.tiktok.com/@r3alism_0fficial',[{tag:'h1',attrs:{'data-e2e':'user-title'},text:'fixture_creator'},{tag:'h2',attrs:{'data-e2e':'user-bio'},children:[bio]},{...link,attrs:{...link.attrs,'data-e2e':'user-link'}}]],
 ['youtube','https://www.youtube.com/@YouTube',[{tag:'yt-page-header-renderer',attrs:{style:'display:block'},children:[{tag:'h1',text:'Fixture'}]},{tag:'ytd-about-channel-renderer',attrs:{style:'display:block'},children:[{tag:'div',attrs:{id:'description-container'},children:[bio]},{tag:'div',attrs:{id:'link-list-container'},children:[{tag:'div',children:[link]}]}]}]],
 ['instagram','https://www.instagram.com/youtube/',[{tag:'main',children:[{tag:'header',children:[{tag:'h1',text:'fixture_creator'},{tag:'div',children:[bio]},link]}]}]]
];
try{
 for(const [platform,url,nodes] of cases){
  await page.goto(url);
  await page.evaluate(nodes=>{const build=n=>{const e=document.createElement(n.tag);for(const [k,v]of Object.entries(n.attrs||{}))e.setAttribute(k,v);if(n.text)e.textContent=n.text;for(const child of n.children||[])e.append(build(child));return e;};document.body.replaceChildren(...nodes.map(build));document.body.style.cssText='display:block;visibility:visible;opacity:1';},nodes);
  const c=await page.evaluate(readRenderedPage,{url}),out=extractCandidates(c);
  const b=out.emails.find(e=>e.key==='bio@example.org'),l=out.emails.find(e=>e.key==='linklabel@example.org');
  assert.ok(b?.evidence.some(e=>e.source==='profile_bio'),platform+' bio source');assert.ok(l?.evidence.every(e=>e.source!=='profile_bio'),platform+' link source');console.log(JSON.stringify({platform,result:'passed',bioSource:b.evidence[0].source,linkSource:l.evidence[0].source}));
 }
}finally{await page.goto('https://www.tiktok.com/@r3alism_0fficial');}
