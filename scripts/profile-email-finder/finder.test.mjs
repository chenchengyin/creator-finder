import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
const load = async (name) => {
  const url = new URL(name, import.meta.url);
  try {
    return await import(url);
  } catch (e) {
    if (e.code === "ERR_MODULE_NOT_FOUND" && e.url === url.href) return {};
    throw e;
  }
};
const core = await load("./finder.mjs"),
  cli = await load("./find.mjs");
const call = (name, ...args) => {
  assert.equal(typeof core[name], "function", `新功能尚未实现: ${name}`);
  return core[name](...args);
};
const classify = (...a) => call("classifyUrl", ...a),
  extract = (c) => call("extractCandidates", c);
const root = "https://www.tiktok.com/@alpha";
const capture = (url, text = "", links = [], extra = {}) => ({
  url,
  requestedUrl: url,
  title: "Public profile",
  kind: /tiktok\.com|instagram\.com|youtube\.com/.test(url)
    ? "profile"
    : /linktr\.ee|beacons\.ai/.test(url)
      ? "hub"
      : "webpage",
  platform: url.includes("tiktok.com")
    ? "tiktok"
    : url.includes("instagram.com")
      ? "instagram"
      : url.includes("youtube.com")
        ? "youtube"
        : null,
  ready: true,
  complete: true,
  httpStatus: 200,
  phase: "initial",
  capturedAt: "2026-10-22T08:00:00.000Z",
  blocks: [
    {
      text,
      location: "p:nth-of-type(1)",
      source: /tiktok\.com|instagram\.com|youtube\.com/.test(url)
        ? "profile_bio"
        : "content",
      visible: true,
    },
  ],
  links: links.map((value, i) =>
    typeof value === "string"
      ? {
          url: value,
          text: "Link",
          location: "a:nth-of-type(" + (i + 1) + ")",
          source: "profile_link",
          visible: true,
        }
      : value,
  ),
  issues: [],
  ...extra,
});
const emails = (c) => extract(c).emails;
const config = (extra) => call("normalizeConfig", { url: root, ...extra });
async function temp(t) {
  const dir = await fs.mkdtemp(join(os.tmpdir(), "profile-email-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
function graph(
  pages,
  session = { spaceId: 999, pageLabel: "p1", owned: true },
) {
  const reads = [],
    events = [];
  return {
    reads,
    events,
    session,
    async readPage({ url, onCapture, checkpoint }) {
      reads.push(url);
      const p = pages[url];
      assert.ok(p, "Unexpected navigation " + url);
      if (p instanceof Error) throw p;
      for (const round of p.rounds || [p]) {
        const directive = await onCapture(round);
        if (directive?.stop) return { complete: true, issues: [], checkpoint };
      }
      if (p.error) throw p.error;
      return {
        complete: p.complete !== false,
        issues: p.issues || [],
        checkpoint,
      };
    },
    async finish() {
      events.push("finish");
    },
    async handOff() {
      events.push("handOff");
    },
  };
}
const paused = (reason) =>
  Object.assign(new Error(reason), { pause: true, reason });
async function run(t, pages, options = {}) {
  const dir = options.runDir || (await temp(t)),
    browser = graph(pages, options.session);
  const result = await call("runFinder", {
    runDir: dir,
    config: config(options.limits),
    browser,
    ...options,
  });
  return { result, browser, dir };
}

test("输入-INPUT-001 精确区分主页、聚合和普通网页", () => {
  for (const [url, want] of [
    ["https://www.tiktok.com/@a", "profile"],
    ["https://instagram.com/a/", "profile"],
    ["https://youtube.com/@a", "profile"],
    ["https://youtube.com/channel/UC1", "profile"],
    ["https://youtube.com/c/a", "profile"],
    ["https://youtube.com/user/a", "profile"],
    ["https://linktr.ee/a", "hub"],
    ["https://beacons.ai/a", "hub"],
    ["https://example.org/", "webpage"],
  ])
    assert.equal(classify(url).kind, want);
  assert.equal(classify("www.tiktok.com/@a").platform, "tiktok");
});
test("输入-INPUT-002 非主页和危险地址不误识别", () => {
  assert.equal(classify("https://youtube.com.evil.org/@a").kind, "webpage");
  assert.equal(
    classify("https://youtube.com/watch?v=1").kind,
    "platform_other",
  );
  assert.equal(
    classify("https://instagram.com/reel/abc").kind,
    "platform_other",
  );
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://127.0.0.1/a",
    "http://192.168.1.1/",
    "http://[::1]/",
    "https://u:p@example.org/",
  ])
    assert.ok(classify(url).excludedReason, url);
});
test("输入-INPUT-003 不默认截断且拒绝无效额度", () => {
  assert.equal(config().maxDepth, null);
  assert.equal(config().maxPages, null);
  assert.equal(config({ maxDepth: 0, maxPages: 20 }).maxDepth, 0);
  for (const o of [
    { maxPages: 0 },
    { maxPages: -1 },
    { maxDepth: -1 },
    { maxPages: 1.5 },
  ])
    assert.throws(() => config(o));
});
test("输入-INPUT-004 CLI校验与只读模式不启动浏览器", async (t) => {
  assert.equal(typeof cli.main, "function", "新功能尚未实现: CLI");
  let starts = 0,
    out = [];
  assert.equal(
    await cli.main(["--help"], {
      launch: () => starts++,
      print: (s) => out.push(s),
    }),
    0,
  );
  assert.equal(starts, 0);
  assert.match(out.join(" "), /--url/);
  assert.throws(() => cli.parseArgs(["--url"]));
  const dir = await temp(t);
  await fs.writeFile(
    join(dir, "execution-state.json"),
    JSON.stringify({ completion: "paused" }),
  );
  assert.equal(
    await cli.main(["--status", "--run-dir", dir], {
      launch: () => starts++,
      print: (s) => out.push(s),
    }),
    0,
  );
  assert.equal(starts, 0);
});
test("提取-EMAIL-001 去重不丢来源与+tag", () => {
  const e = emails(
    capture(
      root,
      "Hello A+tag@Example.org, a+tag@example.org; second@demo.studio.",
    ),
  );
  assert.equal(e.length, 2);
  assert.equal(e[0].key, "a+tag@example.org");
  assert.equal(e[0].status, "confirmed_public");
  assert.ok(e[0].evidence.length >= 2);
  assert.ok(e.some((x) => x.key === "second@demo.studio"));
});
test("提取-EMAIL-002 确定性清理全角和零宽字符", () => {
  const e = emails(capture(root, "hello＠exa\u200bmple．org"));
  assert.equal(e[0].key, "hello@example.org");
  assert.equal(e[0].evidence[0].raw, "hello＠exa\u200bmple．org");
  assert.ok(e[0].evidence[0].normalization.length);
});
test("提取-EMAIL-003 mailto只取收件人不取正文", () => {
  const e = emails(
    capture(root, "", [
      {
        url: "mailto:first%40example.org,second@example.org?subject=wrong@example.org&body=bad@example.org",
        location: "a",
        visible: true,
      },
    ]),
  );
  assert.deepEqual(e.map((x) => x.key).sort(), [
    "first@example.org",
    "second@example.org",
  ]);
});
test("提取-EMAIL-004 联系线索不分大小写或要求固定空格", () => {
  for (const hint of [
    "Contact",
    "CONTACT",
    "ContactTo",
    "Contact-us",
    "Contact%20Us",
    "emailto",
    "Booking",
    "Get in touch",
  ]) {
    const c = capture("https://example.org/", hint, [
      { url: "/help", text: hint, location: "a", visible: true },
    ]);
    assert.equal(extract(c).links[0].url, "https://example.org/help", hint);
  }
});
test("提取-EMAIL-005 没有contact也扫描邮箱", () =>
  assert.equal(
    emails(capture("https://example.org/", "Write hello@example.org"))[0]
      .status,
    "confirmed_public",
  ));
test("提取-EMAIL-006 上下文围绕命中截断", () => {
  const c = capture(
    root,
    "x".repeat(2000) + " hello@example.org " + "y".repeat(2000),
  );
  const evidence = emails(c).find((x) => x.key === "hello@example.org")
    .evidence[0];
  assert.ok(evidence.context.length <= 1500);
  assert.match(evidence.context, /hello@example.org/);
});
test("提取-EMAIL-007 @提及不抑制混淆邮箱", () => {
  const e = emails(
    capture(root, "@creator Contact name [at] domain [dot] com"),
  );
  assert.equal(e[0].key, "name@domain.com");
  assert.equal(e[0].status, "needs_review");
});
test("提取-EMAIL-008 contactto前缀不擅删", () => {
  const e = emails(
    capture(root, "Contacttofoo@example.org", [
      { url: "mailto:foo@example.org", location: "a", visible: true },
    ]),
  );
  assert.ok(
    e.some(
      (x) =>
        x.key === "contacttofoo@example.org" && x.status === "needs_review",
    ),
  );
  assert.ok(
    e.some(
      (x) => x.key === "foo@example.org" && x.status === "confirmed_public",
    ),
  );
});
test("提取-EMAIL-009 排除脚本/占位与@提及", () => {
  const c = capture(root, "@creator");
  c.blocks.push(
    {
      text: "bad@example.org",
      source: "script",
      location: "script",
      visible: false,
    },
    {
      text: "you@example.com",
      source: "placeholder",
      location: "input",
      visible: true,
    },
  );
  assert.equal(emails(c).length, 0);
});
test("提取-EMAIL-010 归属未知或另一达人也保留", () => {
  const e = emails(
    capture("https://someone.org/", "Someone another@example.org"),
  );
  assert.equal(e[0].status, "confirmed_public");
  assert.equal(e[0].evidence[0].sourceUrl, "https://someone.org/");
});
test("提取-EMAIL-011 文本上限保留缺口且重复块不重复计数", () => {
  const c = capture(root, "a".repeat(110000));
  c.blocks.push({ ...c.blocks[0] });
  assert.equal(extract(c).issues.length, 0);
  c.blocks.push({ text: "b".repeat(110000), location: "p2", visible: true });
  assert.ok(extract(c).issues.includes("text_limit"));
});
test("提取-EMAIL-012 空白还原待复核不跨块拼接", () => {
  const c = capture(root, "first @ example.org");
  c.blocks.push(
    { text: "second", location: "p2", visible: true },
    { text: "@example.org", location: "p3", visible: true },
  );
  const e = emails(c);
  assert.ok(
    e.some((x) => x.key === "first@example.org" && x.status === "needs_review"),
  );
  assert.ok(!e.some((x) => x.key === "second@example.org"));
});
test("提取-EMAIL-013 to/cc与百分号只解码一次", () => {
  const e = emails(
    capture(root, "", [
      {
        url: "mailto:?To=foo+tag%40example.org&cc=other%40example.org&body=bad@example.org",
        location: "a",
        visible: true,
      },
    ]),
  );
  assert.ok(
    e.some(
      (x) => x.key === "foo+tag@example.org" && x.status === "confirmed_public",
    ),
  );
  assert.ok(
    e.some((x) => x.key === "other@example.org" && x.status === "needs_review"),
  );
  assert.ok(!e.some((x) => x.key === "bad@example.org"));
});
test("提取-EMAIL-014 同地址各次语境独立保留", () => {
  const c = capture(root, "Management same@example.org");
  c.blocks.push({
    text: "Support SAME@example.org",
    location: "footer",
    visible: true,
  });
  const e = emails(c);
  assert.equal(e.length, 1);
  assert.equal(e[0].evidence.length, 2);
  assert.ok(e[0].evidence.some((v) => /Support/.test(v.context)));
});
test("提取-EMAIL-015 复杂邮箱不截短为看似合法地址", () => {
  const c = capture(root, '"first last"@example.org 非常复杂@example.org');
  const e = emails(c);
  assert.ok(!e.some((x) => x.key === "last@example.org"));
  assert.ok(e.some((x) => x.status === "needs_review"));
});
test("链接-LINK-001 A到聚合页B到另一主页C逐个处理", async (t) => {
  const b = "https://beacons.ai/alpha",
    c = "https://www.instagram.com/other/";
  const { result, browser } = await run(t, {
    [root]: capture(root, "", [b]),
    [b]: capture(b, "", [c]),
    [c]: capture(c, "c@example.org", [], {
      kind: "profile",
      platform: "instagram",
    }),
  });
  assert.deepEqual(browser.reads, [root, b, c]);
  assert.equal(result.completion, "completed");
  assert.deepEqual(result.emails.map((e) => e.key).sort(), ["c@example.org"]);
  assert.deepEqual(
    result.emails.find((e) => e.key === "c@example.org").evidence[0].path,
    [root, b, c],
  );
});
test("链接-LINK-002 相对链接/query与hash路由保留", () => {
  assert.equal(
    classify("/Contact?a=1&a=2", "https://example.org/base").url,
    "https://example.org/Contact?a=1&a=2",
  );
  assert.equal(
    classify("https://example.org/#/contact").url,
    "https://example.org/#/contact",
  );
  assert.equal(
    classify("https://example.org/#footer").url,
    "https://example.org/",
  );
});
test("链接-LINK-003 环和重定向别名不重复扫描", async (t) => {
  const b = "https://beacons.ai/alpha",
    alias = "https://example.org/go";
  const { browser, result } = await run(t, {
    [root]: capture(root, "", [b, alias]),
    [b]: capture(b, "b@example.org", [root]),
    [alias]: capture(b, "b@example.org", []),
  });
  assert.deepEqual(browser.reads, [root, b, alias]);
  assert.equal(result.emails.length, 1);
  assert.equal(result.completion, "completed");
});
test("链接-LINK-004 主页Bio有邮箱不再访问挂链", async (t) => {
  const b = "https://b.example.org/";
  const { browser, result } = await run(t, {
    [root]: capture(root, "a@example.org", [b]),
    [b]: capture(b, "b@example.org"),
  });
  assert.equal(browser.reads.length, 1);
  assert.equal(result.emails.length, 1);
});
test("链接-LINK-005 默认超过3跳20页仍继续，显式额度保留队列", async (t) => {
  const pages = {};
  for (let i = 0; i < 23; i++) {
    const u = i ? `https://beacons.ai/creator${i}` : root;
    pages[u] = capture(
      u,
      i === 22 ? "last@example.org" : "",
      i < 22 ? [`https://beacons.ai/creator${i + 1}`] : [],
    );
  }
  const a = await run(t, pages);
  assert.equal(a.browser.reads.length, 23);
  assert.equal(a.result.completion, "completed");
  const b = await run(t, pages, { limits: { maxPages: 2 } });
  assert.equal(b.browser.reads.length, 2);
  assert.equal(b.result.completion, "partial");
  assert.ok(b.result.pending.length);
});
test("链接-LINK-006 最终页重新分派，不读取危险重定向", async (t) => {
  const { result } = await run(t, {
    [root]: capture("http://127.0.0.1/", "secret@example.org"),
  });
  assert.equal(result.emails.length, 0);
  assert.equal(result.completion, "partial");
});
test("链接-LINK-007 自己Footer Contact可递归，商品导航不爬", () => {
  const c = capture("https://example.org/", "", [
    {
      url: "/Contact",
      text: "Contact",
      source: "footer",
      location: "footer a",
      visible: true,
    },
    {
      url: "/shop",
      text: "Shop",
      source: "navigation",
      location: "nav a",
      visible: true,
    },
  ]);
  assert.deepEqual(
    extract(c).links.map((x) => x.url),
    ["https://example.org/Contact"],
  );
  const hub = capture("https://linktr.ee/a", "", [
    {
      url: "https://linktr.ee/privacy",
      text: "Privacy",
      source: "platform_navigation",
      location: "footer",
      visible: true,
    },
    {
      url: "https://shop.example.org/",
      text: "Shop",
      source: "link_card",
      location: "main a",
      visible: true,
    },
  ]);
  assert.deepEqual(
    extract(hub).links.map((x) => x.url),
    ["https://shop.example.org/"],
  );
});
test("链接-LINK-008 普通文字社交链接不要求图标", () => {
  assert.equal(
    extract(
      capture("https://example.org/", "", [
        {
          url: root,
          text: "My videos",
          source: "page_link",
          location: "a",
          visible: true,
        },
      ]),
    ).links[0].url,
    root,
  );
});
test("链接-LINK-010 简介中的明确文本网址也递归", () => {
  const c = capture(
    root,
    "See https://example.org/contact and www.demo.org/ or linktr.ee/name. foo@example.org @someone",
  );
  const u = extract(c).links.map((x) => x.url);
  assert.ok(u.includes("https://example.org/contact"));
  assert.ok(u.includes("https://www.demo.org/"));
  assert.ok(u.includes("https://linktr.ee/name"));
  assert.ok(!u.includes("https://example.org/"));
});
test("链接-LINK-011 不破坏签名或合并不同query", () => {
  const a = "https://example.org/?a=1&a=2&sig=ab%2Bcd&utm_x=A",
    b = "https://example.org/?a=2&sig=ab%2Bcd";
  assert.equal(classify(a).url, a);
  assert.notEqual(classify(a).url, classify(b).url);
});
test("状态-STATE-001 后续失败不丢已有邮箱", async (t) => {
  const start = "https://www.example.org/";
  const b = "https://example.org/contact";
  const { result } = await run(
    t,
    {
      [start]: capture(start, "a@example.org", [b]),
      [b]: Object.assign(new Error("http_404"), { partial: true }),
    },
    { config: { url: start } },
  );
  assert.equal(result.completion, "completed");
  assert.equal(result.pages.find((p) => p.url === b).status, "skipped");
  assert.equal(result.emails[0].key, "a@example.org");
});
test("状态-STATE-002 完整无邮箱与未读完整分开", async (t) => {
  assert.equal(
    (await run(t, { [root]: capture(root) })).result.completion,
    "completed",
  );
  assert.equal(
    (
      await run(t, {
        [root]: capture(root, "", [], {
          complete: false,
          issues: ["unsupported_layout"],
        }),
      })
    ).result.completion,
    "partial",
  );
});
test("状态-STATE-003 状态指针已提交后可重建摘要，不重抓成功页", async (t) => {
  const dir = await temp(t),
    a = await run(
      t,
      { [root]: capture(root, "a@example.org") },
      { runDir: dir },
    );
  await fs.unlink(join(dir, "results.json"));
  const browser = graph({});
  const result = await call("runFinder", {
    runDir: dir,
    resume: true,
    browser,
  });
  assert.equal(browser.reads.length, 0);
  assert.equal(result.emails[0].key, "a@example.org");
  assert.ok(
    JSON.parse(await fs.readFile(join(dir, "results.json"), "utf8")).emails
      .length,
  );
});
test("状态-STATE-004 活跃写锁和损坏状态不能覆盖旧数据", async (t) => {
  const dir = await temp(t);
  await fs.writeFile(join(dir, ".lock"), JSON.stringify({ pid: process.pid }));
  await assert.rejects(
    () =>
      call("runFinder", { runDir: dir, config: config(), browser: graph({}) }),
    /writer|lock/i,
  );
  assert.equal(
    JSON.parse(await fs.readFile(join(dir, ".lock"), "utf8")).pid,
    process.pid,
  );
});
test("状态-STATE-005 续跑补失败页，不重采成功页", async (t) => {
  const start = "https://www.example.org/";
  const b = "https://example.org/contact",
    dir = await temp(t);
  await run(
    t,
    { [start]: capture(start, "a@example.org", [b]), [b]: paused("captcha") },
    { runDir: dir, config: { url: start } },
  );
  const browser = graph({ [b]: capture(b, "b@example.org") });
  const r = await call("runFinder", { runDir: dir, resume: true, browser });
  assert.deepEqual(browser.reads, [b]);
  assert.equal(r.completion, "completed");
  assert.equal(r.emails.length, 2);
});
test("状态-STATE-006 本页先读到邮箱，后展开失败仍提交", async (t) => {
  const start = "https://www.example.org/";
  const p = capture(start);
  p.rounds = [capture(start, "early@example.org")];
  p.error = paused("captcha");
  const { result, dir } = await run(
    t,
    { [start]: p },
    { config: { url: start } },
  );
  assert.equal(result.completion, "paused");
  assert.equal(result.emails[0].key, "early@example.org");
  assert.match(
    await fs.readFile(join(dir, "execution-state.json"), "utf8"),
    /scanning|paused/,
  );
});
test("输出-OUTPUT-001 跨账号同邮箱保留全部来源", async (t) => {
  const b = "https://beacons.ai/other",
    c = "https://www.instagram.com/other/";
  const { result } = await run(t, {
    [root]: capture(root, "", [b]),
    [b]: capture(b, "SAME@example.org", [c]),
    [c]: capture(c, "same@example.org"),
  });
  assert.equal(result.emails.length, 1);
  assert.equal(
    new Set(result.emails[0].evidence.map((e) => e.sourceUrl)).size,
    2,
  );
  assert.ok(result.emails[0].evidence.every((e) => e.capturedAt && e.path));
});
test("输出-OUTPUT-002 不保存浏览器凭证和非公开字段", async (t) => {
  const p = capture(root, "public@example.org");
  p.cookies = "PRIVATE_SECRET";
  p.accessToken = "PRIVATE_TOKEN";
  const { dir } = await run(t, { [root]: p });
  for (const file of ["execution-state.json", "pages.json", "results.json"])
    assert.doesNotMatch(
      await fs.readFile(join(dir, file), "utf8"),
      /PRIVATE_SECRET|PRIVATE_TOKEN/,
    );
  for (const name of await fs.readdir(join(dir, "evidence")))
    assert.doesNotMatch(
      await fs.readFile(join(dir, "evidence", name), "utf8"),
      /PRIVATE_SECRET|PRIVATE_TOKEN/,
    );
});
test("输出-OUTPUT-003 输出失败保留提交，续跑只重建输出", async (t) => {
  const dir = await temp(t);
  await fs.mkdir(join(dir, "results.json"));
  const browser = graph({ [root]: capture(root, "safe@example.org") });
  const r = await call("runFinder", { config: config(), runDir: dir, browser });
  assert.equal(r.completion, "failed");
  assert.equal(browser.events.includes("finish"), false);
  await fs.rmdir(join(dir, "results.json"));
  const next = graph({});
  const final = await call("runFinder", {
    runDir: dir,
    resume: true,
    browser: next,
  });
  assert.equal(next.reads.length, 0);
  assert.equal(final.emails[0].key, "safe@example.org");
});
export { capture, graph };

test("提取-EMAIL-011 长无邮箱正文不会阻塞进程", async () => {
  const { spawnSync } = await import("node:child_process");
  const moduleUrl = new URL("./finder.mjs", import.meta.url).href;
  const code = `const {extractCandidates}=await import(${JSON.stringify(moduleUrl)});extractCandidates({url:'https://example.org/',blocks:[{text:'a'.repeat(110000),location:'p'}],links:[]});`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    timeout: 1000,
  });
  assert.equal(r.status, 0, r.error?.code || r.stderr.toString());
});

test("链接-LINK-009 只解包已知平台实际挂载跳转且保留原地址", () => {
  const targets = [
    [
      "https://www.tiktok.com/link/v2?target=https%3A%2F%2Flinktr.ee%2Fa",
      "https://linktr.ee/a",
    ],
    [
      "https://www.youtube.com/redirect?q=https%3A%2F%2Finstagram.com%2Fother",
      "https://instagram.com/other",
    ],
    [
      "https://l.instagram.com/?u=https%3A%2F%2Fexample.org%2FContact",
      "https://example.org/Contact",
    ],
  ];
  for (const [wrapper, target] of targets) {
    const found = extract(capture(root, "", [wrapper]));
    assert.equal(found.links[0].url, target);
    assert.equal(found.links[0].rawUrl, wrapper);
  }
  assert.ok(
    classify("https://www.youtube.com/redirect?q=http%3A%2F%2F127.0.0.1%2F")
      .excludedReason,
  );
  assert.equal(
    classify("https://example.org/redirect?q=https%3A%2F%2Flinktr.ee%2Fa").kind,
    "webpage",
  );
});
test("状态-STATE-007 evidence写入失败停止队列且只返回已提交事实", async (t) => {
  const dir = await temp(t),
    next = "https://example.org/contact";
  let reads = 0;
  const browser = graph({});
  browser.readPage = async ({ onCapture }) => {
    reads++;
    await fs.rmdir(join(dir, "evidence"));
    await fs.writeFile(join(dir, "evidence"), "fault");
    await onCapture(capture(root, "uncommitted@example.org", [next]));
    return { complete: true };
  };
  const result = await call("runFinder", {
    config: config(),
    runDir: dir,
    browser,
  });
  assert.equal(reads, 1);
  assert.equal(result.completion, "failed");
  assert.equal(result.emails.length, 0);
  assert.equal(browser.events.length, 0);
  assert.equal(
    JSON.parse(await fs.readFile(join(dir, "execution-state.json"), "utf8"))
      .emails.length,
    0,
  );
});
test("状态-STATE-008 已完成且关闭空间的任务重建输出不连接浏览器", async (t) => {
  const { dir } = await run(t, { [root]: capture(root, "a@example.org") });
  await fs.unlink(join(dir, "results.json"));
  let starts = 0;
  const result = await call("runFinder", {
    runDir: dir,
    resume: true,
    browser: () => {
      starts++;
      throw new Error("old space no longer exists");
    },
  });
  assert.equal(result.completion, "completed");
  assert.equal(starts, 0);
  assert.equal(result.emails[0].key, "a@example.org");
  assert.equal(
    JSON.parse(await fs.readFile(join(dir, "execution-state.json"), "utf8"))
      .browser.closed,
    true,
  );
});
test("状态-STATE-009 原浏览器不可用留暂停和可恢复状态", async (t) => {
  const dir = await temp(t);
  const result = await call("runFinder", {
    config: config(),
    runDir: dir,
    browser: () => {
      throw paused("original_space_not_found");
    },
  });
  assert.equal(result.completion, "paused");
  assert.match(
    await fs.readFile(join(dir, "execution-state.json"), "utf8"),
    /original_space_not_found/,
  );
});

test("提取-EMAIL-016 长@段落与损坏域名有界且不截取超长邮箱", async () => {
  const { spawnSync } = await import("node:child_process");
  const moduleUrl = new URL("./finder.mjs", import.meta.url).href;
  const code = `const {extractCandidates}=await import(${JSON.stringify(moduleUrl)});for(const text of ['a'.repeat(100000)+'@mention','a'.repeat(100000)+'@example.org','a'.repeat(100000)+' [at] example [dot] org']){const r=extractCandidates({url:'https://example.org/',blocks:[{text,location:'p'}],links:[]});if(r.emails.some(e=>e.status==='confirmed_public'))throw new Error('invalid long email accepted');}`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    timeout: 1500,
  });
  assert.equal(r.status, 0, r.error?.code || r.stderr.toString());
});

test("链接-LINK-012 普通网页大容器中的Contact不把商店文章都纳入", () => {
  const c = capture("https://example.org/", "", [
    {
      url: "/Contact",
      text: "Contact",
      context: "Contact Shop Articles",
      location: "a1",
      visible: true,
    },
    {
      url: "/shop",
      text: "Shop",
      context: "Contact Shop Articles",
      location: "a2",
      visible: true,
    },
    {
      url: "/articles",
      text: "Articles",
      context: "Contact Shop Articles",
      location: "a3",
      visible: true,
    },
  ]);
  assert.deepEqual(
    extract(c).links.map((x) => x.url),
    ["https://example.org/Contact"],
  );
});

test("输出-OUTPUT-004 每份邮箱证据包含实际页型和标题", () => {
  const c = capture(root, "a@example.org");
  const e = extract(c).emails[0].evidence[0];
  assert.equal(e.pageKind, "profile");
  assert.equal(e.platform, "tiktok");
  assert.equal(e.pageTitle, "Public profile");
});

test("链接-LINK-014 runner复用完成页向适配器明确返回stop", async (t) => {
  const b = "https://beacons.ai/a",
    alias = "https://example.org/alias",
    dir = await temp(t),
    browser = graph({
      [root]: capture(root, "", [b, alias]),
      [b]: capture(b, "b@example.org"),
    });
  let signal;
  const normal = browser.readPage;
  browser.readPage = async (args) => {
    if (args.url !== alias) return normal(args);
    signal = await args.onCapture(capture(b));
    return { complete: true };
  };
  const result = await call("runFinder", {
    config: config(),
    runDir: dir,
    browser,
  });
  assert.equal(result.completion, "completed");
  assert.deepEqual(signal, { stop: true });
});

test("状态-STATE-010 损坏队列引用在写盘前拒绝并保护原状态", async (t) => {
  const { dir } = await run(t, { [root]: capture(root) });
  const path = join(dir, "execution-state.json"),
    saved = JSON.parse(await fs.readFile(path, "utf8"));
  saved.queue = ["missing-page"];
  const raw = JSON.stringify(saved);
  await fs.writeFile(path, raw);
  await assert.rejects(
    () => call("runFinder", { runDir: dir, resume: true, browser: graph({}) }),
    /invalid saved state/,
  );
  assert.equal(await fs.readFile(path, "utf8"), raw);
});
test("提取-EMAIL-017 异常点号邮箱与未解完mailto不冒充明确结果", () => {
  const found = extract(
    capture(root, "first..last@example.org", [
      { url: "mailto:first%2540example.org", location: "a", visible: true },
    ]),
  );
  assert.ok(!found.emails.some((e) => e.status === "confirmed_public"));
  assert.ok(found.emails.some((e) => e.status === "needs_review"));
  assert.ok(found.issues.includes("unparsed_mailto_recipient"));
});

test("输出-OUTPUT-005 同位置展开后的新语境不能被旧证据吞掉", async (t) => {
  const start = "https://www.example.org/";
  const a = capture(start, "same@example.org");
  a.blocks[0].context = "Management same@example.org";
  const b = capture(start, "same@example.org");
  b.blocks[0].context = "Support same@example.org";
  const { result } = await run(
    t,
    { [start]: { rounds: [a, b] } },
    { config: { url: start } },
  );
  assert.equal(result.emails[0].evidence.length, 2);
  assert.ok(
    result.emails[0].evidence.some((e) => e.context.startsWith("Support")),
  );
});

test("提取-EMAIL-018 URL用户信息和图片文件名不冒充公开邮箱", () => {
  const result = extract(
    capture(
      root,
      "See https://user@example.org/path and https://cdn.example.org/avatar@2x.png ; avatar@2x.png ; real@example.org",
    ),
  );
  assert.deepEqual(
    result.emails
      .filter((e) => e.status === "confirmed_public")
      .map((e) => e.key),
    ["real@example.org"],
  );
  assert.ok(
    result.emails.some(
      (e) => e.key === "avatar@2x.png" && e.status === "needs_review",
    ),
  );
});

test("提取-EMAIL-019 emoji之前的UTF16位移不破坏邮箱原文证据", () => {
  const result = extract(capture(root, "📩 👨‍💻 hello＠exa\u200bmple．org ✨"));
  const e = result.emails.find((e) => e.key === "hello@example.org");
  assert.ok(e);
  assert.equal(e.evidence[0].raw, "hello＠exa\u200bmple．org");
});

test("跳过-SKIP-001 Linktree不访问，其他链接继续且续跑不重试跳过项", async (t) => {
  const start = "https://www.example.org/";
  const linktree = "https://linktr.ee/blocked",
    next = "https://example.org/contact";
  const { result, browser, dir } = await run(
    t,
    {
      [start]: capture(start, "first@example.org", [linktree, next]),
      [next]: capture(next, "next@example.org"),
    },
    { config: { url: start } },
  );
  assert.deepEqual(browser.reads, [start, next]);
  assert.equal(result.completion, "completed");
  assert.equal(result.pages.find((p) => p.url === linktree).status, "skipped");
  assert.ok(
    result.issues.some(
      (i) => i.url === linktree && i.reason === "linktree_temporarily_skipped",
    ),
  );
  assert.equal(result.emails.length, 2);
  const resumed = graph({});
  const again = await call("runFinder", {
    runDir: dir,
    resume: true,
    browser: resumed,
  });
  assert.equal(again.completion, "completed");
  assert.deepEqual(resumed.reads, []);
  assert.equal(again.emails.length, 2);
});
test("跳过-SKIP-002 外站被拒后继续下一分支，保留原邮箱和跳过原因", async (t) => {
  const start = "https://www.example.org/";
  const blocked = "https://example.org/contact",
    next = "https://www.instagram.com/next/";
  const dir = await temp(t),
    browser = graph({
      [start]: capture(start, "first@example.org", [blocked, next]),
      [next]: capture(next, "next@example.org"),
    });
  const normal = browser.readPage;
  browser.readPage = async (args) =>
    args.url === blocked
      ? { complete: true, skipped: true, issues: ["http_403"] }
      : normal(args);
  const result = await call("runFinder", {
    config: { url: start },
    runDir: dir,
    browser,
  });
  assert.equal(result.completion, "completed");
  assert.equal(result.pages.find((p) => p.url === blocked).status, "skipped");
  assert.equal(result.emails.length, 2);
  assert.deepEqual(browser.reads, [start, next]);
  assert.ok(result.issues.some((i) => i.reason === "http_403"));
});
test("跳过-SKIP-003 程序错误不被当作普通访问受阻吞掉", async (t) => {
  const start = "https://www.example.org/";
  const u = "https://example.org/contact";
  const { result } = await run(
    t,
    {
      [start]: capture(start, "a@example.org", [u]),
      [u]: new TypeError("invalid capture"),
    },
    { config: { url: start } },
  );
  assert.equal(result.completion, "partial");
  assert.equal(result.pages.find((p) => p.url === u).status, "failed");
});

test("简介-BIO-001 三平台简介有明确邮箱则不访问挂链", async (t) => {
  for (const url of [
    root,
    "https://www.youtube.com/@alpha",
    "https://www.instagram.com/alpha/",
  ]) {
    const next = "https://www.instagram.com/another/",
      browser = graph({ [url]: capture(url, "bio@example.org", [next]) });
    const result = await call("runFinder", {
      config: { url },
      runDir: await temp(t),
      browser,
    });
    assert.deepEqual(browser.reads, [url]);
    assert.equal(result.completion, "completed");
    assert.equal(result.emails[0].key, "bio@example.org");
    assert.ok(!result.pages.some((p) => p.url === next));
  }
});
test("简介-BIO-002 疑难Bio或仅mailto地址不会抑制挂链", async (t) => {
  const next = "https://www.instagram.com/another/";
  const { result, browser } = await run(t, {
    [root]: capture(root, "name [at] domain [dot] org", [
      { url: "mailto:name@domain.org", source: "profile_link", visible: true },
      next,
    ]),
    [next]: capture(next, "clear@example.org"),
  });
  assert.deepEqual(browser.reads, [root, next]);
  assert.ok(
    result.emails.some(
      (e) =>
        e.key === "name@domain.org" &&
        e.evidence.some(
          (v) => v.source === "profile_bio" && v.status === "needs_review",
        ),
    ),
  );
  assert.ok(result.emails.some((e) => e.key === "clear@example.org"));
});
test("简介-BIO-003 首轮出链先暂存，展开Bio得邮箱后不启动其分支", async (t) => {
  const dir = await temp(t),
    next = "https://example.org/contact",
    browser = graph({});
  browser.readPage = async ({ onCapture }) => {
    await onCapture(capture(root, "", [next]));
    const saved = JSON.parse(
      await fs.readFile(join(dir, "execution-state.json"), "utf8"),
    );
    assert.ok(!saved.queue.includes(next));
    const directive = await onCapture(
      capture(root, "full@example.org", [next]),
    );
    assert.equal(directive.stop, true);
    return { complete: false, issues: ["unread_contact_control"] };
  };
  const result = await call("runFinder", {
    config: config(),
    runDir: dir,
    browser,
  });
  assert.equal(result.completion, "completed");
  assert.equal(result.emails[0].key, "full@example.org");
  assert.ok(!result.pages.some((p) => p.url === next));
});
test("简介-BIO-004 当前主页有邮箱只截断自身分支，其他已发现主页继续", async (t) => {
  const a = "https://www.instagram.com/a/",
    b = "https://www.youtube.com/@b",
    deeper = "https://example.org/contact";
  const { result, browser } = await run(t, {
    [root]: capture(root, "", [a, b]),
    [a]: capture(a, "a@example.org", [deeper]),
    [b]: capture(b, "b@example.org"),
  });
  assert.deepEqual(browser.reads, [root, a, b]);
  assert.equal(result.completion, "completed");
  assert.deepEqual(result.emails.map((e) => e.key).sort(), [
    "a@example.org",
    "b@example.org",
  ]);
});
test("简介-BIO-005 未完成主页的暂存链接可续跑，不提前访问也不丢失", async (t) => {
  const dir = await temp(t),
    next = "https://example.org/contact",
    browser = graph({});
  browser.readPage = async ({ onCapture }) => {
    await onCapture(capture(root, "", [next]));
    throw paused("captcha");
  };
  const first = await call("runFinder", {
    config: config(),
    runDir: dir,
    browser,
  });
  assert.equal(first.completion, "paused");
  assert.deepEqual(
    first.pending.map((p) => p.url),
    [root],
  );
  const resumed = graph({
    [root]: capture(root),
    [next]: capture(next, "next@example.org"),
  });
  const result = await call("runFinder", {
    runDir: dir,
    resume: true,
    browser: resumed,
  });
  assert.deepEqual(resumed.reads, [root, next]);
  assert.equal(result.completion, "completed");
  assert.equal(result.emails[0].key, "next@example.org");
});

test("简介-BIO-008 已提交Bio命中后意外中断，续跑不重新挖该页", async (t) => {
  const dir = await temp(t),
    next = "https://example.org/contact",
    browser = graph({});
  browser.readPage = async ({ onCapture }) => {
    await onCapture(capture(root, "bio@example.org", [next]));
    throw paused("user_control_lost");
  };
  const first = await call("runFinder", {
    config: config(),
    runDir: dir,
    browser,
  });
  assert.equal(first.completion, "paused");
  assert.equal(first.emails[0].key, "bio@example.org");
  const resumed = graph({});
  const result = await call("runFinder", {
    runDir: dir,
    resume: true,
    browser: resumed,
  });
  assert.deepEqual(resumed.reads, []);
  assert.equal(result.completion, "completed");
  assert.equal(result.emails[0].key, "bio@example.org");
});

test("简介-BIO-009 损坏的Bio命中标志不能让无邮箱主页直接完成", async (t) => {
  const { dir } = await run(t, { [root]: capture(root) });
  const path = join(dir, "execution-state.json"),
    saved = JSON.parse(await fs.readFile(path, "utf8"));
  saved.pages[Object.keys(saved.pages)[0]].bioEmailFound = "false";
  saved.pages[Object.keys(saved.pages)[0]].status = "pending";
  saved.queue = [Object.keys(saved.pages)[0]];
  const raw = JSON.stringify(saved);
  await fs.writeFile(path, raw);
  await assert.rejects(
    () => call("runFinder", { runDir: dir, resume: true, browser: graph({}) }),
    /invalid saved state/,
  );
  assert.equal(await fs.readFile(path, "utf8"), raw);
});

test('messaging contacts: WhatsApp is recorded as skipped without browsing its service pages',async t=>{
 const dir=await temp(t),wa='https://wa.me/message/abc',site='https://example.com/contact';
 const b=graph({[root]:capture(root,'',[wa,site]),[wa]:capture(wa,'',['https://whatsappbusiness.com/']),[site]:capture(site,'work@example.com')});
 const r=await call('runFinder',{config:config(),runDir:dir,browser:b});
 assert.deepEqual(b.reads,[root,site]);assert.equal(r.pages.find(p=>p.url===wa).status,'skipped');assert.equal(r.emails[0].email,'work@example.com');
});
test('messaging contacts: resumed WhatsApp descendants stop while unrelated website continues',async t=>{
 const dir=await temp(t),wa='https://wa.me/message/abc',service='https://whatsappbusiness.com/contact',site='https://example.com/contact';
 const page=(url,path,status)=>({url,key:classify(url).key,depth:path.length-1,path,status,attempted:status!=='pending',captures:[],issues:[],checkpoint:{}});
 const pages=[page(root,[root],'complete'),page(wa,[root,wa],'complete'),page(service,[root,wa,service],'paused'),page(site,[root,site],'pending')];
 await fs.writeFile(join(dir,'execution-state.json'),JSON.stringify({schemaVersion:1,config:config(),completion:'paused',pages:Object.fromEntries(pages.map(p=>[p.key,p])),queue:[service,site],emails:[],edges:[{from:root,to:wa},{from:wa,to:service},{from:root,to:site}],browser:null}));
 const b=graph({[service]:capture(service,'support@whatsapp.com'),[site]:capture(site,'owner@example.com')});
 const r=await call('runFinder',{runDir:dir,resume:true,browser:b});assert.deepEqual(b.reads,[site]);assert.equal(r.pages.find(p=>p.url===service).status,'skipped');assert.equal(r.pages.find(p=>p.url===wa).status,'skipped');assert.equal(r.emails[0].email,'owner@example.com');
});

test('contact scope: business management and collaboration articles are not contact links',()=>{
 const c=capture('https://news.example/magazine/','',[
  {url:'/how-business-works/',text:'How business works',source:'page_link'},
  {url:'/project-management/',text:'Project management',source:'page_link'},
  {url:'/collaboration-tips/',text:'Collaboration tips',source:'page_link'},
  {url:'/contact/',text:'Contact us',source:'page_link'},
  {url:'/business-inquiries/',text:'Business inquiries',source:'page_link'},
 ]);
 assert.deepEqual(extract(c).links.map(l=>l.url),['https://news.example/contact/','https://news.example/business-inquiries/']);
});
test('contact scope: queued article descendants are ignored on resume while valid contact continues',async t=>{
 const dir=await temp(t),mag='https://news.example/magazine/',article='https://news.example/business-news/',contact='https://news.example/contact/';
 const rootCapture=capture(root,'',[mag]),magCapture=capture(mag,'',[{url:article,text:'Business news',source:'page_link'},{url:contact,text:'Contact us',source:'page_link'}]);
 await fs.mkdir(join(dir,'evidence'));await fs.writeFile(join(dir,'evidence/root.json'),JSON.stringify(rootCapture));await fs.writeFile(join(dir,'evidence/mag.json'),JSON.stringify(magCapture));
 const page=(url,path,status,captures=[])=>({url,key:classify(url).key,depth:path.length-1,path,status,attempted:status!=='pending',captures,issues:[],checkpoint:{}});
 const pages=[page(root,[root],'complete',['root.json']),page(mag,[root,mag],'complete',['mag.json']),page(article,[root,mag,article],'paused'),page(contact,[root,mag,contact],'pending')];
 await fs.writeFile(join(dir,'execution-state.json'),JSON.stringify({schemaVersion:1,config:config(),completion:'paused',pages:Object.fromEntries(pages.map(p=>[p.key,p])),queue:[article,contact],emails:[],edges:[{from:root,to:mag},{from:mag,to:article},{from:mag,to:contact}],browser:null}));
 const b=graph({[article]:capture(article,'irrelevant@example.com'),[contact]:capture(contact,'desk@example.com')});const r=await call('runFinder',{runDir:dir,resume:true,browser:b});
 assert.deepEqual(b.reads,[contact]);assert.equal(r.pages.find(p=>p.url===article).status,'skipped');assert.equal(r.emails[0].email,'desk@example.com');
});
