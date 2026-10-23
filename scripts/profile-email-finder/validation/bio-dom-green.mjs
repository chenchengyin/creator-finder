const {readRenderedPage}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/browser.mjs');
const {extractCandidates}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/finder.mjs');
const assert=(await import('node:assert/strict')).default,fs=await import('node:fs/promises');
const entry=(await listTaskSpaces()).find(s=>s.id===51);assert.equal(entry?.ownership,'agent','validation space must already be agent-owned');
const task=await taskSpace(51),page=task.page('p1');
const cases=[
 ['tiktok','https://www.tiktok.com/@r3alism_0fficial','<h1 data-e2e="user-title">fixture_creator</h1><h2 data-e2e="user-subtitle">Fixture</h2><h2 data-e2e="user-bio">Bio bio@example.org</h2><a data-e2e="user-link" href="https://beacons.ai/fixture">linklabel@example.org</a>'],
 ['youtube','https://www.youtube.com/@YouTube','<yt-page-header-renderer style="display:block"><h1>Fixture</h1></yt-page-header-renderer><ytd-about-channel-renderer style="display:block"><div id="description-container">Bio bio@example.org</div><div id="link-list-container"><div><a href="https://beacons.ai/fixture">linklabel@example.org</a></div></div></ytd-about-channel-renderer>'],
 ['instagram','https://www.instagram.com/youtube/','<main><header><h1>fixture_creator</h1><div><span>Bio bio@example.org</span></div><a href="https://beacons.ai/fixture">linklabel@example.org</a></header></main>']
];
try{
 for(const [platform,url,html] of cases){
  await page.goto(url);await page.evaluate(html=>{document.body.innerHTML=html;document.body.style.cssText='display:block;visibility:visible;opacity:1';},html);
  const capture=await page.evaluate(readRenderedPage,{url}),out=extractCandidates(capture);
  const bio=out.emails.find(e=>e.key==='bio@example.org'),link=out.emails.find(e=>e.key==='linklabel@example.org');
  assert.ok(bio?.evidence.some(e=>e.source==='profile_bio'),platform+' bio missing');assert.ok(link?.evidence.every(e=>e.source!=='profile_bio'),platform+' link label must not qualify as bio');
  console.log(JSON.stringify({platform,result:'passed',bioSource:bio.evidence[0].source,linkSource:link.evidence[0].source}));
 }
}finally{await page.goto('https://www.tiktok.com/@r3alism_0fficial');}
