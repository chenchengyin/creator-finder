import test from "node:test";
import assert from "node:assert/strict";
const url = new URL("./browser.mjs", import.meta.url);
let mod = {};
try {
  mod = await import(url);
} catch (e) {
  if (!(e.code === "ERR_MODULE_NOT_FOUND" && e.url === url.href)) throw e;
}
function create(opts) {
  assert.equal(
    typeof mod.createEgoBrowser,
    "function",
    "新功能尚未实现: createEgoBrowser",
  );
  return mod.createEgoBrowser(opts);
}
const root = "https://www.tiktok.com/@alpha";
const cap = (u = root, extra = {}) => ({
  url: u,
  requestedUrl: u,
  kind: /tiktok\.com|instagram\.com|youtube\.com/.test(u)
    ? "profile"
    : "webpage",
  platform: u.includes("tiktok.com") ? "tiktok" : null,
  ready: true,
  complete: true,
  httpStatus: 200,
  phase: "initial",
  title: "Alpha",
  blocks: [
    {
      text: "hello@example.org",
      location: "p",
      visible: true,
      source: "profile_bio",
    },
  ],
  links: [],
  issues: [],
  actions: [],
  capturedAt: "2026-10-22T08:00:00Z",
  ...extra,
});
function pageFor(rounds, { gotoError } = {}) {
  let i = 0,
    u = root;
  const actions = [];
  return {
    actions,
    label: "p1",
    async goto(next) {
      u = next;
      actions.push(["goto", next]);
      if (gotoError) throw gotoError;
    },
    async evaluate() {
      const r = rounds[Math.min(i++, rounds.length - 1)];
      return structuredClone({ ...r, url: r.url || u });
    },
    async waitForFunction() {},
    async snapshot() {
      return "root";
    },
    async url() {
      return u;
    },
    async click(s) {
      actions.push(["click", s]);
    },
    async reload() {
      actions.push(["reload"]);
    },
  };
}
async function read(page, url = root, extras = {}) {
  const captured = [],
    browser = create({ page, config: {}, sleep: async () => {}, ...extras });
  const result = await browser.readPage({
    url,
    checkpoint: {},
    onCapture: async (c) => captured.push(c),
  });
  return { result, captured, browser };
}

test("主页-PROFILE-001 无Bio邮箱仍返回挂载链接", async () => {
  const c = cap(root, {
    blocks: [],
    links: [
      { url: "https://linktr.ee/a", source: "profile_link", visible: true },
    ],
  });
  const { captured } = await read(pageFor([c]));
  assert.equal(captured[0].links[0].url, "https://linktr.ee/a");
});
test("主页-PROFILE-002 展开INS资料并逐轮保存", async () => {
  const u = "https://www.instagram.com/a/",
    first = cap(u, {
      platform: "instagram",
      actions: [{ selector: "#more", label: "More", type: "profile_expand" }],
    }),
    second = cap(u, {
      platform: "instagram",
      blocks: [{ text: "full@example.org", location: "bio", visible: true }],
    });
  const p = pageFor([first, second]),
    { captured } = await read(p, u);
  assert.equal(captured.length, 2);
  assert.equal(captured[1].blocks[0].text, "full@example.org");
  assert.equal(p.actions.filter((a) => a[0] === "click").length, 1);
});
test("主页-PROFILE-003 YouTube邮箱只读不启动mailto", async () => {
  const u = "https://youtube.com/@a",
    p = pageFor([
      cap(u, {
        platform: "youtube",
        links: [
          { url: "mailto:a@example.org", source: "contact", visible: true },
        ],
      }),
    ]);
  const { captured } = await read(p, u);
  assert.equal(captured[0].links[0].url, "mailto:a@example.org");
  assert.equal(p.actions.filter((a) => a[0] === "click").length, 0);
});
test("主页-PROFILE-004 私密或未知资料页不假空", async () => {
  const { result } = await read(
    pageFor([
      cap(root, {
        ready: false,
        complete: false,
        issues: ["unsupported_layout"],
      }),
    ]),
  );
  assert.equal(result.complete, false);
  assert.ok(result.issues.includes("unsupported_layout"));
});
test("主页-PROFILE-005 采集器只读目标资料区协议", async () => {
  const c = cap(root, {
    links: [
      { url: "https://example.org/", source: "profile_link", visible: true },
    ],
    issues: [],
  });
  const { captured } = await read(pageFor([c]));
  assert.equal(captured[0].kind, "profile");
  assert.equal(captured[0].links.length, 1);
});
test("浏览-BROWSER-001 导航串行并执行不同平台节奏", async () => {
  let now = 0;
  const waits = [],
    p = pageFor([cap(root), cap("https://example.org/")]);
  const b = create({
    page: p,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    now: () => now,
  });
  await b.readPage({ url: root, onCapture: async () => {} });
  await b.readPage({ url: "https://example.org/", onCapture: async () => {} });
  assert.ok(waits.some((ms) => ms >= 2000));
});
test("浏览-BROWSER-002 TikTok普通403仅等待后原址一次重试", async () => {
  const p = pageFor([
    cap(root, { ready: false, httpStatus: 403, access: "http_error" }),
    cap(),
  ]);
  const waits = [];
  const { captured } = await read(p, root, {
    sleep: async (ms) => waits.push(ms),
  });
  assert.equal(p.actions.filter((a) => a[0] === "goto").length, 2);
  assert.ok(waits.some((ms) => ms >= 11000));
  assert.ok(captured.some((c) => c.ready));
});
test("浏览-BROWSER-003 验证码限流及控制丢失暂停", async () => {
  for (const access of ["captcha", "rate_limited", "login_wall"]) {
    const p = pageFor([
      cap(root, {
        ready: false,
        access,
        httpStatus: access === "rate_limited" ? 429 : 200,
      }),
    ]);
    await assert.rejects(
      () => read(p),
      (e) => e.pause === true,
      access,
    );
    assert.equal(p.actions.filter((a) => a[0] === "goto").length, 1);
  }
});
test("浏览-BROWSER-004 导航超时但正文已好直接读取", async () => {
  const p = pageFor([cap()], { gotoError: new Error("navigation timed out") });
  const { captured } = await read(p);
  assert.equal(captured[0].ready, true);
  assert.equal(p.actions.filter((a) => a[0] === "goto").length, 1);
});
test("浏览-BROWSER-005 生命周期不关闭调用方空间", async () => {
  const events = [],
    task = {
      async finish() {
        events.push("finish");
      },
      async handOff() {
        events.push("handOff");
      },
    };
  const b = create({
    page: pageFor([cap()]),
    task,
    owned: false,
    sleep: async () => {},
  });
  await b.finish();
  assert.deepEqual(events, ["handOff"]);
});
test("浏览-BROWSER-006 普通页面不自动滚动或通用展开", async () => {
  const u = "https://example.org/",
    p = pageFor([
      cap(u, { actions: [{ selector: "#more", type: "generic_expand" }] }),
    ]);
  const { captured } = await read(p, u);
  assert.equal(captured.length, 1);
  assert.equal(p.actions.filter((a) => a[0] === "click").length, 0);
});
test("浏览-BROWSER-007 未知/复制/表单动作不执行，留缺口", async () => {
  const u = "https://example.org/",
    p = pageFor([
      cap(u, {
        issues: ["unread_contact_control"],
        actions: [
          { selector: "#copy", type: "copy" },
          { selector: "#submit", type: "submit" },
        ],
      }),
    ]);
  const { result } = await read(p, u);
  assert.equal(p.actions.filter((a) => a[0] === "click").length, 0);
  assert.equal(result.complete, false);
});
test("浏览-BROWSER-008 外站403不套用TikTok重试", async () => {
  const u = "https://example.org/contact",
    p = pageFor([
      cap(u, { ready: false, access: "http_error", httpStatus: 403 }),
    ]);
  const { result } = await read(p, u);
  assert.equal(result.skipped, true);
  assert.equal(p.actions.filter((a) => a[0] === "goto").length, 1);
});
test("浏览-BROWSER-009 可读主页有登录邀请不误停", async () => {
  const { captured, result } = await read(
    pageFor([cap(root, { loginInvitation: true })]),
  );
  assert.equal(captured[0].ready, true);
  assert.equal(result.complete, true);
});
test("联系-CONTACT-001 capture保存先于下一步展开", async () => {
  const p = pageFor([
    cap(root, { actions: [{ selector: "#contact", type: "profile_expand" }] }),
    cap(),
  ]);
  const b = create({ page: p, sleep: async () => {} });
  let saved = false;
  const original = p.click;
  p.click = async (s) => {
    assert.equal(saved, true);
    return original.call(p, s);
  };
  await b.readPage({
    url: root,
    onCapture: async () => {
      saved = true;
    },
  });
  assert.equal(saved, true);
});
test("写盘失败必须阻止下一步浏览操作", async () => {
  const p = pageFor([
    cap(root, { actions: [{ selector: "#more", type: "profile_expand" }] }),
  ]);
  const b = create({ page: p, sleep: async () => {} });
  await assert.rejects(
    () =>
      b.readPage({
        url: root,
        onCapture: async () => {
          throw new Error("storage failed");
        },
      }),
    /storage failed/,
  );
  assert.equal(p.actions.filter((a) => a[0] === "click").length, 0);
});

test("浏览-BROWSER-010 普通外站登录墙只留分支缺口", async () => {
  const u = "https://example.org/contact";
  const { result } = await read(
    pageFor([cap(u, { ready: false, complete: false, access: "login_wall" })]),
    u,
  );
  assert.equal(result.skipped, true);
  assert.ok(result.issues.includes("login_wall"));
});

test("主页-PROFILE-006 展开报错先观察已呈现资料，不丢新内容", async () => {
  const u = "https://www.youtube.com/@a",
    first = cap(u, {
      platform: "youtube",
      complete: false,
      actions: [{ selector: "#more", type: "profile_expand" }],
    }),
    second = cap(u, {
      platform: "youtube",
      blocks: [{ text: "new@example.org", location: "about", visible: true }],
      actions: [],
    });
  const p = pageFor([first, second]);
  p.click = async () => {
    throw new Error("click timed out; dialog intercepts pointer events");
  };
  const { captured, result } = await read(p, u);
  assert.equal(result.complete, true);
  assert.equal(captured.length, 2);
  assert.equal(captured[1].blocks[0].text, "new@example.org");
});

test("浏览-BROWSER-011 重定向到明显内网地址不读取DOM", async () => {
  const p = pageFor([cap()]);
  let evaluations = 0;
  p.url = async () => "http://127.0.0.1/";
  p.evaluate = async () => {
    evaluations++;
    throw new Error("private DOM must not be read");
  };
  const { result } = await read(p);
  assert.equal(result.complete, false);
  assert.equal(evaluations, 0);
  assert.ok(result.issues.includes("private_or_credential_url"));
});
test("链接-LINK-013 已完成别名的capture要求停止时不再展开", async () => {
  const p = pageFor([
    cap(root, { actions: [{ selector: "#more", type: "profile_expand" }] }),
  ]);
  const b = create({ page: p, sleep: async () => {} });
  await b.readPage({ url: root, onCapture: async () => ({ stop: true }) });
  assert.equal(p.actions.filter((a) => a[0] === "click").length, 0);
});

test("主页-PROFILE-007 YouTube简介使用原生按钮键盘激活", async () => {
  const u = "https://www.youtube.com/@a",
    p = pageFor([
      cap(u, {
        platform: "youtube",
        actions: [{ selector: "#more", type: "profile_expand" }],
      }),
      cap(u, { platform: "youtube" }),
    ]);
  const keys = [];
  p.press = async (selector, key) => keys.push([selector, key]);
  await read(p, u);
  assert.deepEqual(keys, [["#more", "Enter"]]);
  assert.equal(p.actions.filter((a) => a[0] === "click").length, 0);
});

test("浏览-BROWSER-012 Page无法确认停止执行时暂停队列", async () => {
  const p = pageFor([cap()]);
  p.evaluate = async () => {
    throw new Error(
      "page.evaluate timed out after 15000ms and the Page is still unresponsive. Execution could not be confirmed stopped; reload or close the Page before continuing.",
    );
  };
  await assert.rejects(
    () => read(p),
    (e) => e.pause === true,
  );
  assert.equal(p.actions.filter((a) => a[0] === "goto").length, 1);
});

test("主页-PROFILE-008 展开超时后先落盘观察，原按钮最多再试一次", async () => {
  const u = "https://www.youtube.com/@a",
    first = cap(u, {
      platform: "youtube",
      complete: false,
      actions: [
        { selector: "#more", type: "profile_expand", waitFor: "about" },
      ],
    }),
    last = cap(u, { platform: "youtube", actions: [] });
  const p = pageFor([first, first, last]);
  let presses = 0,
    waits = 0;
  p.press = async () => {
    presses++;
  };
  p.waitForSelector = async () => {
    if (++waits === 1) throw new Error("page.waitForSelector timed out");
  };
  const { result, captured } = await read(p, u);
  assert.equal(presses, 2);
  assert.equal(captured.length, 3);
  assert.equal(result.complete, true);
  const stuck = pageFor([first]);
  let attempts = 0;
  stuck.press = async () => {
    attempts++;
  };
  stuck.waitForSelector = async () => {
    throw new Error("page.waitForSelector timed out");
  };
  assert.equal((await read(stuck, u)).result.complete, false);
  assert.equal(attempts, 2);
});

test("浏览-BROWSER-013 等待期间用户接管立即停，不再读取DOM", async () => {
  const p = pageFor([cap()]);
  let evaluations = 0;
  p.waitForFunction = async () => {
    throw new Error("task space is user-owned");
  };
  p.evaluate = async () => {
    evaluations++;
    return cap();
  };
  await assert.rejects(
    () => read(p),
    (e) => e.pause === true,
  );
  assert.equal(evaluations, 0);
});

test("浏览-BROWSER-014 TikTok重试后401与浏览器异常保留真正暂停原因", async () => {
  const first = cap(root, {
      ready: false,
      httpStatus: 403,
      access: "http_error",
    }),
    unauthorized = cap(root, {
      ready: false,
      httpStatus: 401,
      access: "http_error",
    });
  await assert.rejects(
    () => read(pageFor([first, unauthorized])),
    (e) => e.pause === true && e.reason === "http_401",
  );
  const p = pageFor([first]);
  let reads = 0;
  p.evaluate = async () => {
    if (++reads > 1)
      throw new Error(
        "Page is unresponsive; execution could not be confirmed stopped",
      );
    return first;
  };
  await assert.rejects(
    () => read(p),
    (e) => e.pause === true && e.reason.includes("browser_unavailable"),
  );
});

test("浏览-BROWSER-015 普通外站导航失败不重试也不读上一页DOM", async () => {
  for (const message of [
    "net::ERR_CONNECTION_REFUSED",
    "navigation timed out",
  ]) {
    const u = "https://example.org/contact",
      p = pageFor([cap()], { gotoError: new Error(message) });
    let reads = 0;
    p.evaluate = async () => {
      reads++;
      throw new Error("must not read previous document");
    };
    const { result } = await read(p, u);
    assert.equal(result.skipped, true);
    assert.equal(reads, 0);
    assert.equal(p.actions.filter((a) => a[0] === "goto").length, 1);
    assert.ok(result.issues.some((i) => i.includes(message)));
  }
});
test("浏览-BROWSER-016 普通网页验证码与控制丢失继续暂停", async () => {
  const u = "https://example.org/contact";
  for (const access of ["captcha", "rate_limited"])
    await assert.rejects(
      () => read(pageFor([cap(u, { ready: false, access })]), u),
      (e) => e.pause === true,
    );
  for (const message of [
    "task space is user-owned",
    "CDP session closed",
    "Target.getTargets timed out after 15000ms",
  ]) {
    const p = pageFor([cap(u)], { gotoError: new Error(message) });
    await assert.rejects(
      () => read(p, u),
      (e) => e.pause === true,
    );
  }
});

test("浏览-BROWSER-017 普通短链跳转到Linktree后不读取其DOM", async () => {
  const u = "https://example.org/go",
    p = pageFor([cap(u)]);
  let reads = 0;
  p.url = async () => "https://linktr.ee/blocked";
  p.evaluate = async () => {
    reads++;
    throw new Error("Linktree DOM must not be read");
  };
  const { result } = await read(p, u);
  assert.equal(result.skipped, true);
  assert.equal(reads, 0);
  assert.ok(result.issues.includes("linktree_temporarily_skipped"));
});

test("简介-BIO-006 展开后回调要求停止时不再进行第二个链接展开", async () => {
  const p = pageFor([
    cap(root, { actions: [{ selector: "#bio", type: "profile_expand" }] }),
    cap(root, { actions: [{ selector: "#links", type: "profile_expand" }] }),
  ]);
  const b = create({ page: p, sleep: async () => {} });
  let rounds = 0;
  const result = await b.readPage({
    url: root,
    onCapture: async () => (++rounds === 2 ? { stop: true } : null),
  });
  assert.equal(result.complete, true);
  assert.deepEqual(
    p.actions.filter((a) => a[0] === "click").map((a) => a[1]),
    ["#bio"],
  );
  assert.equal(rounds, 2);
});
test("简介-BIO-007 展开超时后的观察命中邮箱，遵守回调停止信号", async () => {
  const p = pageFor([
    cap(root, { actions: [{ selector: "#bio", type: "profile_expand" }] }),
    cap(root, { actions: [{ selector: "#links", type: "profile_expand" }] }),
  ]);
  p.click = async (selector) => {
    p.actions.push(["click", selector]);
    throw new Error("click timed out");
  };
  const b = create({ page: p, sleep: async () => {} });
  let rounds = 0;
  const result = await b.readPage({
    url: root,
    onCapture: async () => (++rounds === 2 ? { stop: true } : null),
  });
  assert.equal(result.complete, true);
  assert.equal(rounds, 2);
  assert.equal(p.actions.filter((a) => a[0] === "click").length, 1);
});
