const fs = await import("node:fs/promises");
const { default: assert } = await import("node:assert/strict");
const { createEgoBrowser } = await import("file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/browser.mjs");
const { runFinder } = await import("file:///Users/vb/Projects/creator-finder/scripts/profile-email-finder/finder.mjs");
const task = await taskSpace(51);
const page = task.page("p1");
const url = "https://www.instagram.com/fayeknightly_/";
const base = "/Users/vb/Projects/creator-finder/scripts/profile-email-finder/validation/reuse-open-page-20261022";

// Set up the same situation as a caller that has already opened the profile.
if ((await page.url()) !== url) await page.goto(url);
await page.waitForSelector("main header", { state: "visible", timeout: 15000 });
const before = await page.evaluate(() => ({ url: location.href, timeOrigin: performance.timeOrigin }));
const actions = [];
const borrowedPage = new Proxy(page, {
  get(target, prop) {
    const value = target[prop];
    if (typeof value !== "function") return value;
    return (...args) => {
      if (["goto", "reload", "close"].includes(prop)) actions.push({ method: prop, url: args[0] });
      return value.apply(target, args);
    };
  },
});
try {
  // The caller owns the TaskSpace lifecycle; this adapter only borrows its Page.
  const browser = createEgoBrowser({ page: borrowedPage, config: { spaceId: 51 } });
  const result = await runFinder({ config: { url }, runDir: base + "/online-run", browser });
  const after = await page.evaluate(() => ({ url: location.href, timeOrigin: performance.timeOrigin }));
  assert.equal(result.completion, "completed");
  assert.ok(result.emails.some(e => e.email === "TeamFaye@stregagroup.com"));
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].stopReason, "profile_bio_email_found");
  assert.deepEqual(actions, []);
  assert.equal(after.url, before.url);
  assert.equal(after.timeOrigin, before.timeOrigin);
  const proof = { completion: result.completion, emails: result.emails.map(e => e.email), pages: result.pages.length, actions, before, after, stopReason: result.pages[0].stopReason };
  await fs.writeFile(base + "/online-proof.json", JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} finally {
  await task.handOff();
}
