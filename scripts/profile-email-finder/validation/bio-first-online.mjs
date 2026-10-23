const {createEgoBrowser}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/browser.mjs');
const {runFinder}=await import('file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/finder.mjs');
const assert=(await import('node:assert/strict')).default;
const task=await taskSpace(51),page=task.page('p1');
const result=await runFinder({config:{url:'https://www.tiktok.com/@r3alism_0fficial'},runDir:'/Users/vb/Projects/creator-finder/scripts/profile-email-finder/validation/bio-first-online-run',browser:createEgoBrowser({page,task,owned:false})});
assert.equal(result.completion,'completed');assert.equal(result.pages.length,1);assert.equal(result.pages[0].stopReason,'profile_bio_email_found');assert.ok(result.emails.some(e=>e.key==='r3alism.yt@gmail.com'));assert.equal(result.edges.length,0);
console.log(JSON.stringify({completion:result.completion,pages:result.pages.length,emails:result.emails.map(e=>e.email),stopReason:result.pages[0].stopReason,followedLinks:result.edges.length}));
