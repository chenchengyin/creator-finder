import fs from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { isIP } from "node:net";
import assert from "node:assert/strict";

const contactPattern =
  /contact|e[ -]?mail|emailto|business|booking|management|collab|inquir|reach[ -]?out|get[ -]?in[ -]?touch|work[ -]?with|合作|联系|聯絡|kontakt|contato/i;
// Contact context can be broad; crawl destinations must not match generic business articles.
const contactLinkPattern = /contact|e[ -]?mail|emailto|booking|inquir|reach[ -]?out|get[ -]?in[ -]?touch|work[ -]?with|合作|联系|聯絡|kontakt|contato/i;
const decode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
export const isContact = (value) =>
  contactPattern.test(decode(String(value || "")));
const socialHosts = {
  "tiktok.com": "tiktok",
  "www.tiktok.com": "tiktok",
  "m.tiktok.com": "tiktok",
  "youtube.com": "youtube",
  "www.youtube.com": "youtube",
  "m.youtube.com": "youtube",
  "instagram.com": "instagram",
  "www.instagram.com": "instagram",
};
const hubs = new Set([
  "linktr.ee",
  "www.linktr.ee",
  "beacons.ai",
  "www.beacons.ai",
]);
const privateHost = (host) => {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local"))
    return true;
  if (isIP(h) === 6) return /^(::|::1$|::ffff:|f[cd]|fe[89ab])/i.test(h);
  if (isIP(h) === 4) {
    const [a, b] = h.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return false;
};
export function messagingContactReason(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol === "whatsapp:") return "messaging_contact_ignored";
    if (["wa.me", "www.wa.me", "api.whatsapp.com", "web.whatsapp.com", "chat.whatsapp.com"].includes(u.hostname) ||
        ["whatsapp.com", "www.whatsapp.com"].includes(u.hostname) && /^\/(send|message|channel)(\/|$)/.test(u.pathname)) return "messaging_contact_ignored";
  } catch {}
  return null;
}
function markIgnoredPages(state, ignored, reason) {
  for (const key of ignored) {
    const p = state.pages[key];
    if (!p) continue;
    p.ignoredPreviousStatus ??= p.status;
    p.status = "skipped";
    p.issues = [reason];
    p.pendingProfileLinks = [];
  }
  state.queue = state.queue.filter(key => !ignored.has(key));
  for (const email of state.emails) {
    const excluded = email.evidence.filter(e => ignored.has(classifyUrl(e.sourceUrl).key));
    if (excluded.length) {
      state.ignoredEmails ??= [];
      state.ignoredEmails.push({...email, evidence:excluded, excludedReason:reason});
      email.evidence = email.evidence.filter(e => !ignored.has(classifyUrl(e.sourceUrl).key));
    }
  }
  state.emails = state.emails.filter(e => e.evidence.length);
}
function ignoreSavedMessagingBranches(state) {
  const roots = new Set(Object.entries(state.pages).filter(([,p]) => messagingContactReason(p.url) || messagingContactReason(p.finalUrl)).map(([key]) => key));
  if (!roots.size) return;
  const walk = (starts, blocked = new Set()) => {
    const seen = new Set(), queue = [...starts];
    while (queue.length) {
      const key = queue.shift();
      if (seen.has(key) || blocked.has(key)) continue;
      seen.add(key);
      for (const edge of state.edges) if (classifyUrl(edge.from).key === key) queue.push(classifyUrl(edge.to).key);
    }
    return seen;
  };
  const allowed = walk([classifyUrl(state.config.url).key], roots), descendants = walk(roots);
  const ignored = new Set([...descendants].filter(key => roots.has(key) || !allowed.has(key)));
  markIgnoredPages(state, ignored, "messaging_contact_ignored");
}
async function reconcileSavedContactScope(state, dir) {
  const allowed = new Map();
  for (const [key, page] of Object.entries(state.pages)) {
    if (!page.captures.length || page.issues.includes("messaging_contact_ignored")) continue;
    const links = new Set();
    for (const name of page.captures) {
      assert(typeof name === "string" && basename(name) === name, "invalid saved evidence filename");
      const capture = JSON.parse(await fs.readFile(join(dir, "evidence", name), "utf8"));
      if (capture.ready !== false) for (const link of extractCandidates(capture).links) links.add(link.key);
    }
    const identity = classifyUrl(page.url).key;
    allowed.set(identity, new Set([...(allowed.get(identity) || []), ...links]));
  }
  const invalid = new Set(state.edges.filter(edge => allowed.has(classifyUrl(edge.from).key) && !allowed.get(classifyUrl(edge.from).key).has(classifyUrl(edge.to).key)));
  if (!invalid.size) return;
  const walk = filtered => {
    const seen = new Set(), pending = [classifyUrl(state.config.url).key];
    while (pending.length) {
      const key = pending.shift();
      if (seen.has(key)) continue;
      seen.add(key);
      for (const edge of state.edges) if ((!filtered || !invalid.has(edge)) && classifyUrl(edge.from).key === key) pending.push(classifyUrl(edge.to).key);
    }
    return seen;
  };
  const reachable = walk(true), ignored = new Set([...walk(false)].filter(key => !reachable.has(key)));
  for (const edge of invalid) edge.ignoredReason = "outside_contact_link_scope";
  markIgnoredPages(state, ignored, "outside_contact_link_scope");
}
export function classifyUrl(raw, base) {
  try {
    let value = String(raw || "").trim();
    if (!value) return { excludedReason: "empty_url" };
    if (/^(mailto|emailto):/i.test(value))
      return {
        url: value,
        key: value,
        kind: "email",
        nonstandard: /^emailto:/i.test(value),
      };
    if (
      !/^[a-z][a-z0-9+.-]*:/i.test(value) &&
      /^(?:www\.|(?:tiktok\.com|instagram\.com|youtube\.com|linktr\.ee|beacons\.ai)\/)/i.test(
        value,
      )
    )
      value = "https://" + value;
    let u = new URL(value, base);
    const wrappers = new Set();
    for (let depth = 0; depth < 6; depth++) {
      if (!["http:", "https:"].includes(u.protocol))
        return { excludedReason: "unsupported_protocol" };
      if (u.username || u.password || privateHost(u.hostname))
        return { excludedReason: "private_or_credential_url" };
      const field =
        ["tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(u.hostname) &&
        u.pathname === "/link/v2"
          ? "target"
          : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(
                u.hostname,
              ) && u.pathname === "/redirect"
            ? "q"
            : u.hostname === "l.instagram.com" && u.pathname === "/"
              ? "u"
              : null;
      if (!field || !u.searchParams.has(field)) break;
      if (depth === 5 || wrappers.has(u.href))
        return { excludedReason: "redirect_wrapper_loop" };
      wrappers.add(u.href);
      const target = u.searchParams.get(field);
      if (!/^https?:\/\//i.test(target))
        return { excludedReason: "unsupported_wrapper_target" };
      u = new URL(target);
    }
    if (u.username || u.password || privateHost(u.hostname))
      return { excludedReason: "private_or_credential_url" };
    if (!/^#(?:\/|!\/)/.test(u.hash)) u.hash = "";
    const platform = socialHosts[u.hostname],
      path = u.pathname.replace(/\/$/, "");
    let kind = "webpage";
    if (platform) {
      kind = "platform_other";
      if (platform === "tiktok" && /^\/@[^/]+$/.test(path)) kind = "profile";
      if (
        platform === "youtube" &&
        /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)$/.test(path)
      )
        kind = "profile";
      if (
        platform === "instagram" &&
        /^\/[^/]+$/.test(path) &&
        !/^\/(?:p|reel|reels|explore|accounts|direct|stories|about|legal|privacy)$/i.test(
          path,
        )
      )
        kind = "profile";
    } else if (hubs.has(u.hostname)) kind = "hub";
    const identityPath = ["instagram", "tiktok"].includes(platform) ? path.toLowerCase() : path;
    const key = kind === "profile"
      ? "https://www." + platform + ".com" + identityPath + u.search + u.hash
      : u.href;
    return {
      url: u.href,
      key,
      kind,
      platform: platform || null,
      profileKey: kind === "profile" ? path : null,
    };
  } catch {
    return { excludedReason: "invalid_url" };
  }
}
export function normalizeConfig(input) {
  assert(input && typeof input === "object", "configuration required");
  const classified = classifyUrl(input.url);
  assert(
    !classified.excludedReason && classified.kind !== "email",
    "valid public HTTP(S) URL required",
  );
  const out = {
    schemaVersion: 1,
    url: classified.url,
    maxDepth: input.maxDepth ?? null,
    maxPages: input.maxPages ?? null,
  };
  for (const [key, min] of [
    ["maxDepth", 0],
    ["maxPages", 1],
  ])
    assert(
      out[key] === null || (Number.isSafeInteger(out[key]) && out[key] >= min),
      "invalid " + key,
    );
  return out;
}
function normalise(text) {
  const chars = [],
    map = [];
  let pos = 0;
  for (const c of text) {
    if (!/[\u200B-\u200D\uFEFF\u2060\u00AD]/.test(c)) {
      const n =
        { "＠": "@", "．": ".", "。": ".", "＿": "_", "－": "-" }[c] || c;
      // RegExp indices and String.slice use UTF-16 code units, including emoji.
      for (let offset = 0; offset < n.length; offset++) {
        chars.push(n[offset]);
        map.push(pos + offset);
      }
    }
    pos += c.length;
  }
  return { text: chars.join(""), map };
}
const emailRE =
  /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}/gi;
export function mailRecipientConflict(address, context, linkText) {
  const labelled = [...normalise(String(linkText || "")).text.matchAll(emailRE)];
  const visible = labelled.length ? labelled : [...normalise(String(context || "")).text.matchAll(emailRE)];
  return visible.length > 0 && !visible.some(match => match[0].toLowerCase() === address.toLowerCase());
}
const evidenceKey = (e) =>
  JSON.stringify([
    e.sourceUrl,
    e.location,
    e.raw,
    e.status,
    e.recipientField,
    e.href,
    e.context,
    e.linkText,
  ]);
function mergeEmail(into, email) {
  let target = into.find((e) => e.key === email.key);
  if (!target) {
    target = {
      email: email.email,
      key: email.key,
      status: email.status,
      variants: [],
      evidence: [],
    };
    into.push(target);
  }
  if (email.status === "confirmed_public") target.status = "confirmed_public";
  for (const variant of email.variants || [email.email])
    if (!target.variants.includes(variant)) target.variants.push(variant);
  const known = new Set(target.evidence.map(evidenceKey));
  for (const e of email.evidence)
    if (!known.has(evidenceKey(e))) {
      target.evidence.push(e);
      known.add(evidenceKey(e));
    }
  return target;
}
export function extractCandidates(capture) {
  const page = classifyUrl(capture.url || capture.requestedUrl);
  const out = {
    emails: [],
    links: [],
    exclusions: [],
    issues: [...(capture.issues || [])],
  };
  if (page.excludedReason) {
    out.issues.push(page.excludedReason);
    return out;
  }
  const seenLinks = new Set(),
    seenBlocks = new Set();
  let chars = 0,
    nodes = 0;
  const addLink = (raw, node = {}) => {
    const c = classifyUrl(raw, page.url);
    if (c.kind === "email") return;
    if (c.excludedReason) {
      out.exclusions.push({ url: String(raw), reason: c.excludedReason });
      return;
    }
    if (c.key === page.key) return;
    const source = node.source || "",
      accept =
        page.kind === "profile"
          ? ![
              "platform_navigation",
              "recommendation",
              "post",
              "comment",
            ].includes(source)
          : page.kind === "hub"
            ? !["platform_navigation", "brand_footer"].includes(source)
            : page.kind === "platform_other"
              ? source === "author_link"
              : c.kind === "profile" ||
                c.kind === "hub" ||
                contactLinkPattern.test(decode([raw, node.text, node.label].join(" ")));
    if (!accept) {
      out.exclusions.push({ url: c.url, reason: "outside_link_scope" });
      return;
    }
    if (!seenLinks.has(c.key)) {
      seenLinks.add(c.key);
      out.links.push({
        ...c,
        source: source || "text_link",
        location: node.location || "text",
        rawUrl: String(raw),
      });
    }
  };
  const addEmail = (
    value,
    raw,
    node,
    status = "confirmed_public",
    reason = null,
    field = null,
    href = null,
  ) => {
    const email = value.replace(/[.,;:!?]+$/, "");
    if (!email || email.length > 254 || email.split("@")[0].length > 64) return;
    const key = email.toLowerCase();
    const local = email.slice(0, email.lastIndexOf("@"));
    if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
      status = "needs_review";
      reason = "unsupported_address";
    }
    if (/@\d+x\.(?:png|jpe?g|gif|webp|svg|ico)$/i.test(email)) {
      status = "needs_review";
      reason = "possible_asset_filename";
    }
    if (/^contact(?:to)?[a-z0-9]/i.test(email)) {
      status = "needs_review";
      reason = "ambiguous_prefix";
    }
    if (status === "confirmed_public" && href && ["path", "to"].includes(field) &&
        mailRecipientConflict(email, node.context, node.text)) {
      status = "needs_review";
      reason = "mailto_visible_recipient_conflict";
    }
    const context = String(node.context || node.text || raw);
    const index = Math.max(
      0,
      context.toLowerCase().indexOf(String(raw).toLowerCase()),
    );
    const start = context.length > 1500 ? Math.max(0, index - 600) : 0;
    mergeEmail(out.emails, {
      email,
      key,
      status,
      evidence: [
        {
          sourceUrl: page.url,
          pageKind: page.kind,
          platform: page.platform,
          pageTitle: capture.title || null,
          capturedAt: capture.capturedAt || new Date().toISOString(),
          source: node.source || "visible_text",
          location: node.location || "text",
          raw,
          context: context.slice(start, start + 1500),
          contextTruncated: context.length > 1500,
          status,
          reason,
          recipientField: field,
          href,
          linkText: href ? node.text || null : undefined,
          siteWide: node.siteWide === true,
          contactHint: isContact(context),
          normalization: email !== raw ? [{ from: raw, to: email }] : [],
        },
      ],
    });
  };
  const scan = (
    raw,
    node,
    status = "confirmed_public",
    reason = null,
    field = null,
    href = null,
  ) => {
    const n = normalise(String(raw));
    if (!n.text.includes("@")) return;
    const urls = [...n.text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map((m) => [
      m.index,
      m.index + m[0].length,
    ]);
    let urlIndex = 0;
    for (const m of n.text.matchAll(emailRE)) {
      while (urlIndex < urls.length && urls[urlIndex][1] <= m.index) urlIndex++;
      if (urlIndex < urls.length && urls[urlIndex][0] <= m.index) continue;
      const before = n.text[m.index - 1] || "",
        after = n.text.slice(m.index + m[0].length);
      if (
        /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~"\\-]/u.test(before) ||
        /^[\p{L}\p{N}_-]|^\.[\p{L}\p{N}]/u.test(after)
      )
        continue;
      const start = n.map[m.index],
        end = n.map[m.index + m[0].length - 1] + 1;
      addEmail(
        m[0],
        String(raw).slice(start, end),
        node,
        status,
        reason,
        field,
        href,
      );
    }
    for (const m of n.text.matchAll(
      /"[^"\n]{1,64}"@(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}/gi,
    ))
      addEmail(
        m[0],
        m[0],
        node,
        "needs_review",
        "unsupported_address",
        field,
        href,
      );
    if (/[^\x00-\x7f]/.test(n.text))
      for (const m of n.text.matchAll(
        /[\p{L}\p{N}._%+-]{0,63}[^\x00-\x7f\s][\p{L}\p{N}._%+-]{0,63}@(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}/giu,
      ))
        addEmail(
          m[0],
          m[0],
          node,
          "needs_review",
          "unsupported_address",
          field,
          href,
        );
  };
  const scanMail = (link, node) => {
    const nonstandard = /^emailto:/i.test(link),
      parts = link.slice(link.indexOf(":") + 1).split("?"),
      fields = [["path", parts.shift()]];
    for (const pair of parts.join("?").split("&")) {
      const i = pair.indexOf("=");
      if (i >= 0)
        fields.push([
          decode(pair.slice(0, i)).toLowerCase(),
          pair.slice(i + 1),
        ]);
    }
    for (const [name, value] of fields) {
      if (!["path", "to", "cc", "bcc"].includes(name)) continue;
      let decoded;
      try {
        decoded = decodeURIComponent(value);
      } catch {
        out.issues.push("malformed_mailto");
        continue;
      }
      const review =
        nonstandard ||
        ["cc", "bcc"].includes(name) ||
        /%[0-9a-f]{2}/i.test(decoded);
      if (decoded && !decoded.includes("@"))
        out.issues.push("unparsed_mailto_recipient");
      scan(
        decoded,
        node,
        review ? "needs_review" : "confirmed_public",
        review ? "mailto_recipient_review" : null,
        name,
        link,
      );
    }
  };
  for (const block of capture.blocks || []) {
    if (
      block.visible === false ||
      [
        "script",
        "style",
        "template",
        "placeholder",
        "input",
        "comment",
      ].includes(block.source)
    )
      continue;
    const raw = String(block.text || ""),
      identity = JSON.stringify([block.location, raw]);
    if (seenBlocks.has(identity)) continue;
    seenBlocks.add(identity);
    if (++nodes > 20000 || chars + raw.length > 200000) {
      out.issues.push(nodes > 20000 ? "node_limit" : "text_limit");
      break;
    }
    chars += raw.length;
    scan(raw, block);
    if (/[\[(]\s*at\s*[\])]/i.test(raw))
      for (const m of raw.matchAll(
        /([a-z0-9._%+-]{1,64})\s*[\[(]\s*at\s*[\])]\s*([a-z0-9-]{1,63}(?:\s*[\[(]\s*dot\s*[\])]\s*[a-z0-9-]{1,63})+)/gi,
      ))
        if (!/[\w.%+-]/.test(raw[m.index - 1] || ""))
          addEmail(
            m[1] + "@" + m[2].replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, "."),
            m[0],
            block,
            "needs_review",
            "obfuscated",
          );
    if (raw.includes("@"))
      for (const m of raw.matchAll(
        /([a-z0-9._%+-]{1,64})\s*@\s*((?:[a-z0-9-]{1,63}\s*\.\s*)+[a-z]{2,63})/gi,
      ))
        if (/\s/.test(m[0]) && !/[\w.%+-]/.test(raw[m.index - 1] || ""))
          addEmail(
            m[1] + "@" + m[2].replace(/\s/g, ""),
            m[0],
            block,
            "needs_review",
            "whitespace_reconstruction",
          );
    for (const m of raw.matchAll(
      /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|(?:linktr\.ee|beacons\.ai|(?:www\.)?(?:tiktok\.com|instagram\.com|youtube\.com))\/[^\s<>"']+/gi,
    )) {
      if (m.index && /[\w@.]/.test(raw[m.index - 1])) continue;
      addLink(m[0].replace(/[.,;!?)\]}]+$/, ""), {
        ...block,
        source:
          page.kind === "profile"
            ? "profile_link"
            : page.kind === "hub"
              ? "link_card"
              : "text_link",
      });
    }
  }
  for (const node of (capture.links || []).slice(0, 20000)) {
    if (node.visible === false) continue;
    const raw = node.url || node.href || "";
    if (/^(mailto|emailto):/i.test(raw)) scanMail(raw, node);
    else addLink(raw, node);
  }
  if ((capture.links || []).length > 20000) out.issues.push("link_limit");
  out.issues = [...new Set(out.issues)];
  return out;
}
const copy = (value) => JSON.parse(JSON.stringify(value));
const profileEmailFound = page => page.bioEmailFound;
const atomic = async (path, value) => {
  const tmp = path + ".tmp-" + randomUUID();
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2));
    await fs.rename(tmp, path);
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});
    e.storageFailure = true;
    throw e;
  }
};
const cleanCapture = (c) => ({
  url: c.url,
  requestedUrl: c.requestedUrl,
  kind: c.kind,
  platform: c.platform,
  title: c.title,
  ready: c.ready,
  complete: c.complete,
  phase: c.phase,
  capturedAt: c.capturedAt,
  httpStatus: c.httpStatus,
  issues: c.issues || [],
  checkpoint: c.checkpoint || {},
  blocks: (c.blocks || []).map((b) => ({
    text: b.text,
    context: b.context,
    source: b.source,
    location: b.location,
    visible: b.visible,
    siteWide: b.siteWide,
  })),
  links: (c.links || []).map((l) => ({
    url: l.url || l.href,
    text: l.text,
    label: l.label,
    context: l.context,
    source: l.source,
    location: l.location,
    visible: l.visible,
    siteWide: l.siteWide,
  })),
});
function report(state, completion = state.completion, error = null) {
  return {
    schemaVersion: 1,
    rootUrl: state.config.url,
    completion,
    error,
    browser: state.browser,
    emails: copy(state.emails),
    pages: Object.values(state.pages).map(copy),
    pending: state.queue.map((k) => ({
      url: state.pages[k].url,
      status: state.pages[k].status,
      depth: state.pages[k].depth,
    })),
    issues: Object.values(state.pages).flatMap((p) =>
      (p.issues || []).map((reason) => ({ url: p.url, reason })),
    ),
    edges: copy(state.edges),
    ignoredEmails: copy(state.ignoredEmails || []),
    updatedAt: new Date().toISOString(),
  };
}
async function lockRun(dir) {
  const path = join(dir, ".lock");
  let handle;
  try {
    handle = await fs.open(path, "wx");
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
    );
    await handle.close();
  } catch (e) {
    if (handle) await handle.close().catch(() => {});
    if (e.code === "EEXIST")
      throw new Error("another writer or stale lock exists: " + path);
    throw e;
  }
  return () => fs.unlink(path);
}
export async function runFinder({
  config,
  runDir,
  resume = false,
  browser,
  onProgress = () => {},
}) {
  assert(runDir, "runDir required");
  const dir = resolve(runDir);
  await fs.mkdir(dir, { recursive: true });
  const unlock = await lockRun(dir);
  let state, committed, activeBrowser;
  try {
    const statePath = join(dir, "execution-state.json");
    let saved;
    try {
      saved = JSON.parse(await fs.readFile(statePath, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (saved) {
      assert(resume, "run exists; use --resume");
      assert(
        saved.schemaVersion === 1 &&
          saved.config &&
          saved.pages &&
          Array.isArray(saved.edges) &&
          Array.isArray(saved.queue) &&
          Array.isArray(saved.emails) &&
          new Set(saved.queue).size === saved.queue.length &&
          saved.queue.every(
            (key) => typeof key === "string" && Object.hasOwn(saved.pages, key),
          ) &&
          Object.entries(saved.pages).every(
            ([key, p]) =>
              p &&
              p.key === key &&
              typeof p.url === "string" &&
              Number.isSafeInteger(p.depth) &&
              p.depth >= 0 &&
              Array.isArray(p.captures) &&
              Array.isArray(p.issues) &&
              Array.isArray(p.path) &&
              (p.pendingProfileLinks === undefined ||
                Array.isArray(p.pendingProfileLinks)) &&
              (p.bioEmailFound === undefined ||
                typeof p.bioEmailFound === "boolean") &&
              [
                "pending",
                "scanning",
                "complete",
                "alias",
                "partial",
                "failed",
                "paused",
                "skipped",
              ].includes(p.status),
          ),
        "invalid saved state",
      );
      normalizeConfig(saved.config);
      state = saved;
      if (config) {
        const next = normalizeConfig(config);
        assert(
          classifyUrl(next.url).key === classifyUrl(state.config.url).key,
          "resume URL mismatch",
        );
        for (const key of ["maxPages", "maxDepth"]) {
          const old = state.config[key],
            value = next[key];
          assert(
            (old === null && value === null) ||
              (old !== null && (value === null || value >= old)),
            "resume cannot reduce " + key,
          );
        }
        state.config = next;
      }
      for (const [key, p] of Object.entries(state.pages))
        if (
          !["complete", "alias", "skipped"].includes(p.status) &&
          !state.queue.includes(key)
        )
          state.queue.push(key);
    } else {
      assert(!resume, "saved run not found");
      const cfg = normalizeConfig(config),
        c = classifyUrl(cfg.url);
      state = {
        schemaVersion: 1,
        config: cfg,
        completion: "running",
        pages: {
          [c.key]: {
            url: c.url,
            key: c.key,
            depth: 0,
            path: [c.url],
            status: "pending",
            attempted: false,
            captures: [],
            issues: [],
            checkpoint: {},
          },
        },
        queue: [c.key],
        emails: [],
        edges: [],
        browser: null,
      };
      await atomic(join(dir, "config.json"), cfg);
    }
    ignoreSavedMessagingBranches(state);
    await reconcileSavedContactScope(state, dir);
    committed = copy(state);
    await fs.mkdir(join(dir, "evidence"), { recursive: true });
    const save = async () => {
      state.updatedAt = new Date().toISOString();
      await atomic(statePath, state);
      committed = copy(state);
      await onProgress({
        completion: state.completion,
        checked: Object.values(state.pages).filter((p) =>
          ["complete", "alias"].includes(p.status),
        ).length,
        pending: state.queue.length,
        emails: state.emails.length,
        current: state.queue[0] ? state.pages[state.queue[0]].url : null,
      });
    };
    await save();
    const enqueue = (link, parent) => {
      let p = state.pages[link.key] || Object.values(state.pages).find(page => classifyUrl(page.url).key === link.key);
      if (!p) {
        p = {
          url: link.url,
          key: link.key,
          depth: parent.depth + 1,
          path: [...parent.path, link.url],
          status: "pending",
          attempted: false,
          captures: [],
          issues: [],
          checkpoint: {},
        };
        state.pages[link.key] = p;
        state.queue.push(link.key);
      }
      const edge = {
        from: parent.url,
        to: link.url,
        rawUrl: link.rawUrl,
        source: link.source,
        location: link.location,
      };
      if (!state.edges.some((e) => JSON.stringify(e) === JSON.stringify(edge)))
        state.edges.push(edge);
    };
    if(resume){
      for(const p of Object.values(state.pages)){
        if(p.stopReason!=="profile_contact_email_found"||p.bioEmailFound)continue;
        for(const name of p.captures){
          assert(typeof name==="string"&&basename(name)===name,"invalid saved evidence filename");
          const c=JSON.parse(await fs.readFile(join(dir,"evidence",name),"utf8"));
          if(c.ready!==false)for(const link of extractCandidates(c).links)enqueue(link,p);
        }
        p.previousStopReason=p.stopReason;
        delete p.stopReason;
        p.pendingProfileLinks=[];
      }
      await save();
    }
    if (state.queue.length || !state.browser?.closed) {
      activeBrowser =
        typeof browser === "function" ? await browser(state.browser) : browser;
      assert(activeBrowser?.readPage, "browser.readPage required");
      if (activeBrowser.session) state.browser = copy(activeBrowser.session);
    }
    state.completion = "running";
    await save();
    while (state.queue.length) {
      const index = state.queue.findIndex((key) => {
        const p = state.pages[key];
        return (
          (state.config.maxDepth === null ||
            p.depth <= state.config.maxDepth) &&
          (p.attempted ||
            state.config.maxPages === null ||
            Object.values(state.pages).filter((x) => x.attempted).length <
              state.config.maxPages)
        );
      });
      if (index < 0) break;
      const key = state.queue[index],
        p = state.pages[key];
      if (messagingContactReason(p.url)) {
        p.status = "skipped";
        p.issues = ["messaging_contact_ignored"];
        state.queue.splice(index, 1);
        await save();
        continue;
      }
      if (profileEmailFound(p)) {
        p.status = "complete";
        p.issues = [];
        p.pendingProfileLinks = [];
        state.queue.splice(index, 1);
        await save();
        continue;
      }
      if (["linktr.ee", "www.linktr.ee"].includes(new URL(p.url).hostname)) {
        p.status = "skipped";
        p.issues = ["linktree_temporarily_skipped"];
        state.queue.splice(index, 1);
        await save();
        continue;
      }
      // Saved runs can still contain separate keys for old host aliases.
      const completedAlias = Object.values(state.pages).find(other => other !== p && other.status === "complete" && classifyUrl(other.finalUrl || other.url).key === classifyUrl(p.url).key);
      if (completedAlias) {
        p.status = "alias";
        p.aliasOf = completedAlias.key;
        p.finalKey = classifyUrl(completedAlias.finalUrl || completedAlias.url).key;
        p.finalUrl = completedAlias.finalUrl || completedAlias.url;
        state.queue.splice(index, 1);
        await save();
        continue;
      }
      p.attempted = true;
      p.status = "scanning";
      p.issues = [];
      await save();
      try {
        const final = await activeBrowser.readPage({
          url: p.url,
          checkpoint: p.checkpoint,
          onCapture: async (raw) => {
            const c = cleanCapture(raw),
              classified = classifyUrl(c.url || p.url);
            if (classified.excludedReason) {
              p.issues.push(classified.excludedReason);
              return;
            }
            const other = Object.values(state.pages).find(
              (x) =>
                x !== p &&
                x.status === "complete" &&
                classifyUrl(x.finalUrl || x.url).key === classified.key,
            );
            if (other) {
              p.aliasOf = other.key;
              p.status = "alias";
              p.finalKey = classified.key;
              p.finalUrl = classified.url;
              await save();
              return { stop: true };
            }
            p.finalKey = classified.key;
            p.finalUrl = classified.url;
            p.checkpoint = c.checkpoint || p.checkpoint;
            if (c.ready !== false) {
              const found = extractCandidates(c);
              for (const e of found.emails) {
                for (const v of e.evidence)
                  v.path = [...p.path.slice(0, -1), classified.url];
                mergeEmail(state.emails, e);
              }
              p.issues = [...new Set(found.issues)];
              if (classified.kind === "profile") {
                p.pendingProfileLinks ??= [];
                if (
                  found.emails.some((e) =>
                    e.evidence.some(
                      (v) =>
                        v.source === "profile_bio" &&
                        v.status === "confirmed_public",
                    ),
                  )
                ) {
                  p.bioEmailFound = true;
                  p.stopReason = "profile_bio_email_found";
                  p.pendingProfileLinks = [];
                  p.issues = [];
                } else
                  for (const link of found.links)
                    if (
                      !p.pendingProfileLinks.some(
                        (saved) => saved.key === link.key,
                      )
                    )
                      p.pendingProfileLinks.push(link);
              } else for (const link of found.links) enqueue(link, p);
            } else
              p.issues = [...new Set([...(c.issues || []), "page_not_ready"])];
            const digest = createHash("sha256")
                .update(JSON.stringify(c))
                .digest("hex")
                .slice(0, 24),
              name = digest + ".json";
            if (!p.captures.includes(name)) {
              await atomic(join(dir, "evidence", name), c);
              p.captures.push(name);
            }
            await save();
            return profileEmailFound(p)
              ? { stop: true, reason: p.stopReason }
              : null;
          },
        });
        if (profileEmailFound(p)) {
          p.issues = [];
        } else {
          for (const link of p.pendingProfileLinks || []) enqueue(link, p);
          p.pendingProfileLinks = [];
          p.issues = [...new Set([...p.issues, ...(final?.issues || [])])];
        }
        p.checkpoint = final?.checkpoint || p.checkpoint;
        if (p.status !== "alias")
          p.status = profileEmailFound(p)
            ? "complete"
            : final?.skipped
              ? "skipped"
              : final?.complete !== false && !p.issues.length
                ? "complete"
                : "partial";
        state.queue.splice(state.queue.indexOf(key), 1);
        await save();
      } catch (e) {
        if (e.storageFailure || /ENOSPC|EACCES|EROFS/.test(e.code || ""))
          throw e;
        p.issues = [...new Set([...p.issues, e.reason || e.message])];
        if (e.pause) {
          p.status = "paused";
          state.completion = "paused";
          await save();
          break;
        }
        const externalBlocked =
          !classifyUrl(p.url).platform &&
          (/^http_(?!429\b)[45]\d{2}\b/.test(e.reason || e.message) ||
            ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].includes(e.code));
        p.status = externalBlocked ? "skipped" : "failed";
        state.queue.splice(state.queue.indexOf(key), 1);
        await save();
      }
    }
    if (state.completion !== "paused")
      state.completion =
        state.queue.length ||
        Object.values(state.pages).some((p) =>
          ["partial", "failed", "paused"].includes(p.status),
        )
          ? "partial"
          : "completed";
    await save();
    const result = report(state);
    await atomic(join(dir, "pages.json"), result.pages);
    await atomic(join(dir, "results.json"), result);
    assert(
      JSON.parse(await fs.readFile(join(dir, "results.json"), "utf8"))
        .completion === result.completion,
      "output verification failed",
    );
    if (result.completion === "completed" && activeBrowser?.finish) {
      await activeBrowser.finish();
      if (state.browser?.owned) {
        state.browser.closed = true;
        await save();
        result.browser = copy(state.browser);
        await atomic(join(dir, "results.json"), result);
      }
    } else if (result.completion === "partial")
      await activeBrowser?.handOff?.();
    return result;
  } catch (e) {
    if (!committed) throw e;
    if (e.pause) {
      const paused = copy(committed);
      paused.completion = "paused";
      const current = paused.pages[paused.queue[0]];
      if (current) {
        current.status = "paused";
        current.issues = [
          ...new Set([...(current.issues || []), e.reason || e.message]),
        ];
      }
      const result = report(paused, "paused", e.reason || e.message);
      try {
        await atomic(join(dir, "execution-state.json"), paused);
        await atomic(join(dir, "pages.json"), result.pages);
        await atomic(join(dir, "results.json"), result);
      } catch {}
      return result;
    }
    return report(committed, "failed", e.message);
  } finally {
    await unlock().catch(() => {});
  }
}
