import { classifyUrl, runFinder, messagingContactReason } from "./finder.mjs";
import {runYoutubeEmailFlow} from './youtube-email.mjs';
import {
  navigateWith403Retry,
  isControlError,
} from "../tiktok-browser/access.mjs";

// This function runs in the page. It reads rendered DOM only, not application state or cookies.
export function readRenderedPage(hint = {}) {
  const visible = (e) => {
    if (!e || e.nodeType !== 1) return false;
    for (let p = e; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (
        p.hidden === true || p.hasAttribute?.("hidden") ||
        s.display === "none" ||
        s.visibility === "hidden" ||
        s.visibility === "collapse" ||
        s.opacity === "0"
      )
        return false;
    }
    return e.getClientRects().length > 0;
  };
  const path = (e) => {
    const parts = [];
    for (let p = e; p && p !== document.documentElement; p = p.parentElement) {
      if (p.id) {
        parts.unshift("#" + CSS.escape(p.id));
        break;
      }
      let part = p.tagName.toLowerCase();
      const same = p.parentElement
        ? [...p.parentElement.children].filter((x) => x.tagName === p.tagName)
        : [];
      if (same.length > 1)
        part += ":nth-of-type(" + (same.indexOf(p) + 1) + ")";
      parts.unshift(part);
    }
    return parts.join(" > ");
  };
  const rawUrl = location.href,
    url = location.protocol === "chrome-error:" ? hint.url : rawUrl,
    host = location.hostname,
    allText = document.body?.innerText || "",
    dialogs = [
      ...document.querySelectorAll(
        '[role="dialog"],dialog[open],tp-yt-paper-dialog',
      ),
    ].filter(visible);
  let platform = null,
    kind = "webpage",
    scopes = [],
    ready = false,
    complete = true;
  const issues = [],
    actions = [];
  if (["tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(host)) {
    platform = "tiktok";
    kind = /^\/@[^/]+\/?$/.test(location.pathname)
      ? "profile"
      : "platform_other";
  } else if (
    ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)
  ) {
    platform = "youtube";
    kind = /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)\/?$/.test(location.pathname)
      ? "profile"
      : "platform_other";
  } else if (["instagram.com", "www.instagram.com"].includes(host)) {
    platform = "instagram";
    kind =
      /^\/[^/]+\/?$/.test(location.pathname) &&
      !/^\/(?:reels?|p|accounts|explore|direct|stories|about|legal)(?:\/|$)/.test(
        location.pathname,
      )
        ? "profile"
        : "platform_other";
  } else if (
    ["linktr.ee", "www.linktr.ee", "beacons.ai", "www.beacons.ai"].includes(
      host,
    )
  )
    kind = "hub";
  const select = (selector) =>
    [...document.querySelectorAll(selector)].filter(visible);
  const addAction = (e, type, waitFor) => {
    if (visible(e))
      actions.push({
        selector: path(e),
        label: (
          e.innerText ||
          e.getAttribute("aria-label") ||
          "展开资料"
        ).slice(0, 100),
        type,
        waitFor,
      });
  };
  if (kind === "profile" && platform === "tiktok") {
    const title = select('[data-e2e="user-title"]')[0],
      bio = select('[data-e2e="user-bio"]')[0];
    scopes = [
      title,
      ...select('[data-e2e="user-subtitle"]'),
      bio,
      ...select('[data-e2e="user-link"]'),
    ].filter(Boolean);
    ready = !!title && !!bio;
  } else if (kind === "profile" && platform === "instagram") {
    const header = select("main header,header")[0];
    scopes = header ? [header] : [];
    const identity = header?.querySelector('h1,h2,[role="heading"]');
    ready = !!identity && !!header?.innerText;
    const linkDialogs = dialogs.filter(
      (d) =>
        !d.querySelector('input[type="password"]') &&
        (/链接|links|简介|bio/i.test(d.innerText) ||
          d.querySelector('a[href*="l.instagram.com/"]')),
    );
    if (header)
      for (const e of header.querySelectorAll('button,[role="button"]')) {
        if (e.closest('menu,[role="menu"]')) continue;
        const t = (e.innerText || "").trim();
        if (linkDialogs.length && !/^(?:更多|展开|more)$/i.test(t)) continue;
        if (
          /^(?:更多|展开|more|and \d+ (?:other|more)|和另外|查看另外)|(?:另外|其他|more|other).{0,15}(?:链接|links?)/i.test(
            t,
          )
        )
          addAction(e, "profile_expand", '[role="dialog"]');
      }
    scopes.push(...linkDialogs);
  } else if (kind === "profile" && platform === "youtube") {
    const header = select(
        "yt-page-header-renderer,yt-page-header-view-model,ytd-c4-tabbed-header-renderer",
      )[0],
      about = select("ytd-about-channel-renderer")[0];
    scopes = about ? [about] : header ? [header] : [];
    ready = !!header && header.innerText.trim().length > 0;
    if (!about && header) {
      const expand = header.querySelector(
        "button.ytTruncatedTextAbsoluteButton",
      );
      if (expand)
        addAction(expand, "profile_expand", "ytd-about-channel-renderer");
      else issues.push("about_not_available");
    }
    if (about)
      for (const b of about.querySelectorAll('button,[role="button"]'))
        if (
          /^(?:查看电子?邮件地址|查看邮箱|View email address)$/i.test(
            b.innerText?.trim() || "",
          )
        )
          addAction(b, "contact_expand", null);
    complete = !!about;
  } else if (kind === "platform_other") {
    const main = select("main")[0] || document.body;
    const candidates = [
      ...main.querySelectorAll(
        platform === "youtube"
          ? "#owner a[href],ytd-video-owner-renderer a[href]"
          : platform === "tiktok"
            ? 'a[data-e2e*="author"][href]'
            : "a[href]",
      ),
    ]
      .filter(visible)
      .filter(
        (a) =>
          /^\/@[^/]+\/?$/.test(new URL(a.href).pathname) ||
          (platform === "instagram" && a.querySelector("h1,h2")),
      );
    scopes = candidates;
    ready = true;
    complete = false;
    if (!candidates.length) issues.push("unsupported_platform_page");
  } else {
    scopes = select("main");
    if (!scopes.length) scopes = [document.body].filter(Boolean);
    if (kind === "webpage") scopes = [document.body].filter(Boolean);
    ready =
      !!document.body &&
      (allText.trim().length > 0 || !!document.querySelector("a[href]"));
  }
  const status =
    Number(performance.getEntriesByType("navigation")[0]?.responseStatus) ||
    200;
  let httpStatus = status,
    access = "ok";
  if (location.protocol === "chrome-error:") {
    httpStatus = /HTTP ERROR 403/.test(allText) ? 403 : 502;
    access = "http_error";
    ready = false;
    issues.push(
      (allText.match(/(?:ERR_[A-Z_]+|HTTP ERROR \d+)/) || [
        "navigation_error",
      ])[0],
    );
  } else if (
    httpStatus === 429 ||
    (/too many requests|操作过于频繁|访问过于频繁/i.test(
      allText.slice(0, 1500),
    ) &&
      !ready)
  ) {
    access = "rate_limited";
    ready = false;
  } else if (
    dialogs.some((d) =>
      /verify you are human|captcha|验证码|完成验证/i.test(d.innerText),
    ) ||
    (!ready &&
      /verify you are human|captcha|验证码|security check|安全验证/i.test(
        allText.slice(0, 3000),
      ))
  ) {
    access = "captcha";
    ready = false;
  } else if (
    dialogs.some((d) => d.querySelector('input[type="password"]')) ||
    (!ready &&
      (/\/accounts\/login|\/signin|accounts\.google\./i.test(rawUrl) ||
        !!document.querySelector('input[type="password"]')))
  ) {
    access = "login_wall";
    ready = false;
  } else if (httpStatus >= 400) {
    access = "http_error";
    ready = false;
  }
  if (!ready) complete = false;
  const blocks = [],
    links = [],
    groups = new Map();
  let characters = 0,
    nodes = 0;
  const skip = (e) =>
    !!e.closest("script,style,template,noscript,input,textarea") ||
    (kind !== "webpage" && !!e.closest('nav,[role="navigation"]')) ||
    (kind === "profile" && !!e.closest('menu,[role="menu"]'));
  const bioRegion = (e) => {
    if (kind !== "profile") return null;
    if (platform === "tiktok") return e.closest('[data-e2e="user-bio"]');
    if (platform === "youtube")
      return e.closest(
        "#description-container,yt-description-preview-view-model",
      );
    if (
      platform === "instagram" &&
      !e.closest("a[href]") &&
      !dialogs.some((d) => d.contains(e))
    )
      return e.closest("header");
    return null;
  };
  for (const scope of [...new Set(scopes)]) {
    if (!visible(scope)) continue;
    const walker = document.createTreeWalker(
      scope,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    );
    let n;
    while ((n = walker.nextNode())) {
      const isBreak = n.nodeType === 1 && n.tagName === "BR";
      const parent = isBreak ? n : n.parentElement;
      if (
        (!isBreak && !n.nodeValue?.trim()) ||
        !visible(parent) ||
        skip(parent)
      )
        continue;
      if (++nodes > 20000) {
        issues.push("node_limit");
        break;
      }
      let group =
        parent.closest(
          "p,li,address,h1,h2,h3,td,th,dd,dt,pre,blockquote,figcaption,div,section",
        ) || parent;
      const bio = bioRegion(parent);
      if (bio && !bio.contains(group)) group = bio;
      if (kind === "profile" && !bio)
        group = parent.closest("a[href]") || group;
      if (!scope.contains(group) && group !== scope) {
        if (!groups.has(scope)) groups.set(scope, []);
        groups.get(scope).push(isBreak ? "\n" : n.nodeValue);
      } else {
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(isBreak ? "\n" : n.nodeValue);
      }
    }
  }
  for (const [element, pieces] of groups) {
    const text = pieces.join("");
    if (!text.trim()) continue;
    if (characters + text.length > 200000) {
      issues.push("text_limit");
      break;
    }
    characters += text.length;
    blocks.push({
      text,
      context: text,
      location: path(element),
      source:
        kind === "profile"
          ? bioRegion(element)
            ? "profile_bio"
            : "profile_content"
          : "visible_text",
      visible: true,
      siteWide: kind === "webpage" && !!element.closest('footer,nav,[role="navigation"]'),
    });
  }
  for (const scope of [...new Set(scopes)]) {
    const anchors = scope.matches?.("a[href]")
      ? [scope]
      : [...scope.querySelectorAll("a[href]")];
    for (const a of anchors) {
      if (!visible(a) || skip(a) || links.length >= 20000) continue;
      const raw = a.getAttribute("href");
      if (!raw || raw === "#") continue;
      let target;
      try {
        target = new URL(raw, location.href).href;
      } catch {
        continue;
      }
      if (
        kind === "profile" &&
        platform === "instagram" &&
        /\/(?:stories|p|reels?|explore|direct|accounts)\//.test(
          new URL(target).pathname,
        )
      )
        continue;
      const footer = !!a.closest("footer");
      const source =
        kind === "platform_other"
          ? "author_link"
          : kind === "profile" && platform === "youtube" && /^mailto:/i.test(target) && a.closest('ytd-about-channel-renderer')
            ? "profile_contact_email"
          : kind === "profile"
            ? "profile_link"
            : kind === "hub" && footer
              ? "brand_footer"
              : kind === "hub"
                ? "link_card"
                : footer
                  ? "footer"
                  : "page_link";
      links.push({
        url: target,
        text: a.innerText || "",
        label: a.getAttribute("aria-label") || a.title || "",
        context: (a.parentElement?.innerText || "").slice(0, 1500),
        location: path(a),
        source,
        visible: true,
        siteWide: kind === "webpage" && !!a.closest('footer,nav,[role="navigation"]'),
      });
    }
  }
  if (kind === "webpage" || kind === "hub")
    for (const e of document.querySelectorAll('button,[role="button"],iframe'))
      if (
        visible(e) &&
        /contact|e[ -]?mail|联系/i.test(
          (e.innerText || "") +
            " " +
            e.getAttribute("aria-label") +
            " " +
            e.getAttribute("title"),
        ) &&
        !e.closest("form") &&
        !e.closest('a[href^="mailto:"]')
      )
        issues.push("unread_contact_control");
  if (kind === "profile" && ready === false && !issues.length)
    issues.push("unsupported_layout");
  return {
    url,
    requestedUrl: hint.url || url,
    title: document.title,
    kind,
    platform,
    ready,
    complete: complete && !actions.length && !issues.length,
    httpStatus,
    access,
    blocks,
    links,
    actions,
    issues: [...new Set(issues)],
    phase: actions.length ? "needs_expand" : "read",
    capturedAt: new Date().toISOString(),
  };
}
const pause = (reason) =>
  Object.assign(new Error(reason), { pause: true, reason });
export function createEgoBrowser({
  page,
  task,
  config = {},
  owned = false,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
}) {
  let lastNav = null,
    finished = false;
  const pace = async (url) => {
    const min = classifyUrl(url).platform === "tiktok" ? 10500 : 2000;
    if (lastNav !== null) {
      const delay = Math.max(0, min - (now() - lastNav));
      if (delay) await sleep(delay);
    }
    lastNav = now();
  };
  const read = async (url) => {
    try {
      const actual = await page.url();
      const classified = classifyUrl(actual);
      if (messagingContactReason(actual)) return {
        url:actual, requestedUrl:url, ready:false, complete:false, skipped:true,
        issues:["messaging_contact_ignored"], blocks:[], links:[]
      };
      if (
        !classified.excludedReason &&
        ["linktr.ee", "www.linktr.ee"].includes(new URL(actual).hostname)
      )
        return {
          url: actual,
          requestedUrl: url,
          ready: false,
          complete: false,
          skipped: true,
          issues: ["linktree_temporarily_skipped"],
          blocks: [],
          links: [],
        };
      if (classified.excludedReason && !actual.startsWith("chrome-error:"))
        return {
          url: actual,
          requestedUrl: url,
          ready: false,
          complete: false,
          issues: [classified.excludedReason],
          blocks: [],
          links: [],
        };
      return await page.evaluate(readRenderedPage, {
        url,
        ...classifyUrl(url),
      });
    } catch (e) {
      if (e.storageFailure || e.pause) throw e;
      if (
        isControlError(e) ||
        /CDP|connection|target|session|closed|inactive|unresponsive|evaluate timed out|execution.*stopped/i.test(
          e.message,
        )
      )
        throw pause("browser_unavailable: " + e.message);
      throw e;
    }
  };
  const b = {
    session: {
      spaceId: task?.spaceId || config.spaceId || null,
      pageLabel: page.label || "p1",
      owned,
    },
    async readPage({ url, checkpoint = {}, onCapture }) {
      const info = classifyUrl(url);
      if (info.excludedReason)
        return { complete: false, issues: [info.excludedReason] };
      let navError = null;
      let current;
      try {
        current = classifyUrl(await page.url());
      } catch (e) {
        if (e.storageFailure || e.pause) throw e;
        if (isControlError(e)) throw pause("user_control_lost");
        throw pause("browser_unavailable: " + e.message);
      }
      const resolved = checkpoint.resolvedUrl && classifyUrl(checkpoint.resolvedUrl);
      if (resolved && (info.kind !== "webpage" || resolved.kind !== "webpage" ||
          resolved.excludedReason)) throw pause("redirect_checkpoint_invalid");
      if (resolved && current.key !== resolved.key)
        throw pause("redirect_page_changed_before_resume");
      if (current.key === info.key || resolved ||
          (info.platform === "youtube" && info.kind === "profile" &&
           current.platform === "youtube" && current.kind === "profile" &&
           current.profileKey === info.profileKey)) {
        // The caller may have just navigated; pace the next navigation from this observation.
        lastNav = now();
      } else {
        await pace(url);
        try {
          await page.goto(url);
        } catch (e) {
          if (e.storageFailure || e.pause) throw e;
          if (isControlError(e)) throw pause("user_control_lost");
          if (
            /CDP|Target\.|unresponsive|target.*(?:closed|detached)|session.*(?:closed|invalid)/i.test(
              e.message,
            )
          )
            throw pause("browser_unavailable: " + e.message);
          const committed = e.message.match(/navigation committed at "([^"]+)" with document\.readyState="interactive"/);
          if (!committed || await page.url() !== committed[1]) navError = e;
        }
      }
      if (navError && !info.platform)
        return {
          complete: true,
          skipped: true,
          issues: ["external_navigation_failed: " + navError.message],
          checkpoint,
        };
      if (!navError && page.waitForFunction)
        try {
          await page.waitForFunction(
            ({ platform, kind }) => {
              if (platform === "tiktok" && kind === "profile")
                return !!document.querySelector('[data-e2e="user-title"]');
              if (platform === "instagram" && kind === "profile")
                return !!document.querySelector("main header,header");
              if (platform === "youtube" && kind === "profile")
                return !!document
                  .querySelector(
                    "yt-page-header-renderer,yt-page-header-view-model,ytd-c4-tabbed-header-renderer",
                  )
                  ?.innerText?.trim();
              return document.readyState !== "loading" && !!document.body;
            },
            info,
            { timeout: 10000 },
          );
        } catch (e) {
          if (e.storageFailure || e.pause) throw e;
          if (isControlError(e)) throw pause("user_control_lost");
        }
      let c = await read(url);
      let stopRequested = false;
      const stoppedResult = () => ({ complete: true, issues: [], checkpoint });
      const persist = async (value) => {
        value.checkpoint = { ...checkpoint, phase: value.phase };
        const directive = await onCapture(value);
        if (directive?.stop) stopRequested = true;
        return directive;
      };
      const protect = (value) => {
        if (
          ["captcha", "rate_limited"].includes(value.access) ||
          (value.access === "login_wall" && classifyUrl(value.url).platform) ||
          value.httpStatus === 429
        )
          throw pause(value.access || "rate_limited");
      };
      if(info.platform==='youtube'&&info.kind==='profile'&&page.mouse?.click&&page.snapshot){
        return runYoutubeEmailFlow({page,initial:c,read:()=>read(url),checkpoint,now,onCapture:async(value,nextCheckpoint)=>{checkpoint=nextCheckpoint;return persist(value);}});
      }
      const initialCommit = await persist(c);
      if (initialCommit?.stop) return stoppedResult();
      protect(c);
      if (c.skipped)
        return { complete: true, skipped: true, issues: c.issues, checkpoint };
      if (!c.ready && c.httpStatus === 403 && info.platform === "tiktok") {
        if (
          checkpoint.ordinary403Retried &&
          !/reload_button/.test(checkpoint.screen || "")
        )
          throw pause("http_403_retry_exhausted");
        let cached = c;
        const wrapper = {
          goto: async (target) => {
            await page.goto(target);
            cached = null;
          },
          snapshot: () => page.snapshot(),
          url: () => page.url(),
          click: async (selector) => {
            await page.click(selector);
            cached = null;
          },
          reload: async () => {
            await page.reload();
            cached = null;
          },
        };
        const result = await navigateWith403Retry({
          page: wrapper,
          url,
          prior403: true,
          priorReloadClicks: checkpoint.reloadClicks || 0,
          sleep,
          beforeNavigate: () => pace(url),
          read: async () => {
            try {
              cached ??= await read(url);
            } catch (e) {
              // The shared helper rethrows control failures. Preserve a browser
              // pause instead of letting it consume more navigation attempts.
              if (e.pause || e.storageFailure)
                e.message = "browser control unavailable: " + e.message;
              throw e;
            }
            c = cached;
            return {
              httpStatus: c.httpStatus,
              captcha: c.access === "captcha",
              loginPrompt: c.access === "login_wall",
            };
          },
          onAttempt: async (attempt) => {
            checkpoint = {
              ...checkpoint,
              ordinary403Retried:
                attempt.number >= 2 || checkpoint.ordinary403Retried,
              reloadClicks:
                attempt.reloadClicks ?? checkpoint.reloadClicks ?? 0,
              screen: attempt.screen || null,
            };
            await persist(c);
          },
        });
        await persist(c);
        protect(c);
        if (stopRequested) return stoppedResult();
        if (c.httpStatus === 401) throw pause("http_401");
        if (result.error || c.httpStatus === 403)
          throw pause("http_403_retry_exhausted");
      } else if (!c.ready && info.platform && [401, 403].includes(c.httpStatus))
        throw pause("http_" + c.httpStatus);
      else if (!c.ready && navError && c.httpStatus !== 403) {
        await sleep(2000);
        await pace(url);
        try {
          await page.goto(url);
        } catch (e) {
          if (e.storageFailure || e.pause) throw e;
          if (isControlError(e)) throw pause("user_control_lost");
        }
        c = await read(url);
        await persist(c);
        protect(c);
        if (stopRequested) return stoppedResult();
      }
      if (!c.ready)
        return {
          complete: !info.platform,
          skipped: !info.platform,
          issues: [
            ...(c.issues || []),
            c.httpStatus >= 400
              ? "http_" + c.httpStatus
              : c.access && c.access !== "ok"
                ? c.access
                : "page_not_ready",
          ],
          checkpoint,
        };
      const done = new Set(),
        actionAttempts = new Map();
      for (let count = 0; count < 8; count++) {
        const action = (c.actions || []).find(
          (a) =>
            ["profile", "hub"].includes(c.kind) &&
            ["profile_expand", "contact_expand"].includes(a.type) &&
            !done.has(a.selector),
        );
        if (!action) break;
        done.add(action.selector);
        actionAttempts.set(
          action.selector,
          (actionAttempts.get(action.selector) || 0) + 1,
        );
        try {
          // YouTube's animated About overlay can obscure its originating button
          // during pointer dispatch. Activate the same native button with Enter.
          if (
            c.platform === "youtube" &&
            action.type === "profile_expand" &&
            page.press
          )
            await page.press(action.selector, "Enter");
          else await page.click(action.selector, { label: "展开公开联系资料" });
          if (action.waitFor && page.waitForSelector)
            await page.waitForSelector(action.waitFor, {
              state: "visible",
              timeout: 10000,
            });
        } catch (e) {
          if (e.storageFailure || e.pause) throw e;
          if (isControlError(e) || /CDP|closed|session/i.test(e.message))
            throw pause("browser_unavailable: " + e.message);
          // A timed-out click can still have opened the requested panel.
          // Observe and commit its public contents before declaring failure.
          c = await read(url);
          await persist(c);
          protect(c);
          if (stopRequested) return stoppedResult();
          if (
            c.ready &&
            c.complete &&
            !(c.actions || []).length &&
            !(c.issues || []).length
          )
            break;
          if (
            c.ready &&
            /timed out|intercepts pointer/i.test(e.message) &&
            actionAttempts.get(action.selector) < 2 &&
            (c.actions || []).some(
              (a) => a.selector === action.selector && a.type === action.type,
            )
          ) {
            done.delete(action.selector);
            continue;
          }
          return {
            complete: false,
            issues: [...(c.issues || []), "profile_expand_failed"],
            checkpoint: {
              ...checkpoint,
              expandError: String(e.message).slice(0, 500),
            },
          };
        }
        c = await read(url);
        await persist(c);
        protect(c);
        if (stopRequested) return stoppedResult();
      }
      const remaining = (c.actions || []).some(
        (a) =>
          ["profile", "hub"].includes(c.kind) &&
          ["profile_expand", "contact_expand"].includes(a.type),
      );
      const issues = [
        ...(c.issues || []),
        ...(remaining ? ["unread_contact_control"] : []),
      ];
      return {
        complete: c.complete !== false && !issues.length,
        issues,
        checkpoint,
      };
    },
    async finish() {
      if (finished) return;
      if (owned && task) {
        await task.finish({ keep: [] });
        finished = true;
      } else await task?.handOff();
    },
    async handOff() {
      await task?.handOff();
    },
  };
  return b;
}
export async function runInEgo(options, api) {
  return await runFinder({
    config: options.config,
    runDir: options.runDir,
    resume: !!options.resume,
    onProgress: (p) => console.log(JSON.stringify({ progress: p })),
    browser: async (saved) => {
      let task,
        owned = false;
      const id = options.spaceId || saved?.spaceId;
      if (id) {
        const entry = (await api.listTaskSpaces()).find((s) => s.id === id);
        if (!entry) throw pause("original_space_not_found");
        if (entry.ownership === "agentDelegatedToUser") {
          if (!options.resume) throw pause("space_requires_user_authorization");
          task = await api.takeOverTaskSpace(id);
        } else if (["user", "userOwned", "inactive"].includes(entry.ownership)) {
          if (!options.resume) throw pause("space_requires_user_authorization");
          task = await api.claimTaskSpace(id);
        } else task = await api.taskSpace(id);
        owned = !!saved?.owned;
      } else {
        task = await api.taskSpace("主页邮箱查验-" + Date.now());
        owned = true;
      }
      return createEgoBrowser({
        page: task.page(saved?.pageLabel || "p1"),
        task,
        owned,
        config: options.config,
      });
    },
  });
}
