#!/usr/bin/env node
import fs from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { normalizeConfig } from "./finder.mjs";
export function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--help") return { help: true };
    if (["--resume", "--status"].includes(flag)) {
      options[flag === "--resume" ? "resume" : "statusOnly"] = true;
      continue;
    }
    const key = {
      "--url": "url",
      "--run-dir": "runDir",
      "--space": "spaceId",
      "--max-depth": "maxDepth",
      "--max-pages": "maxPages",
    }[flag];
    assert(key, "unknown option " + flag);
    const value = args[++i];
    assert(value && !value.startsWith("--"), "missing value for " + flag);
    assert(options[key] === undefined, "duplicate option " + flag);
    options[key] = ["spaceId", "maxDepth", "maxPages"].includes(key)
      ? Number(value)
      : value;
  }
  assert(options.runDir, "--run-dir required");
  options.runDir = resolve(options.runDir);
  if (options.spaceId !== undefined)
    assert(
      Number.isSafeInteger(options.spaceId) && options.spaceId > 0,
      "invalid space ID",
    );
  if (!options.resume && !options.statusOnly)
    options.config = normalizeConfig(options);
  return options;
}
export async function main(
  args = process.argv.slice(2),
  { print = console.log, launch } = {},
) {
  const o = parseArgs(args);
  if (o.help) {
    print(
      "主页邮箱递归查找\nnode find.mjs --url <主页或网页URL> --run-dir <新目录> [--space <Ego空间ID>] [--max-depth N] [--max-pages N]\n续跑: --resume --run-dir <原目录>；进度: --status --run-dir <目录>\n默认遍历至范围内队列耗尽；普通网页只检查联系线索/@/mailto。",
    );
    return 0;
  }
  if (o.statusOnly) {
    print(await fs.readFile(join(o.runDir, "execution-state.json"), "utf8"));
    return 0;
  }
  let state;
  try {
    state = JSON.parse(
      await fs.readFile(join(o.runDir, "execution-state.json"), "utf8"),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (state) {
    assert(o.resume, "run exists; use --resume");
    o.config = normalizeConfig({
      ...state.config,
      ...Object.fromEntries(
        ["url", "maxDepth", "maxPages"]
          .filter((k) => o[k] !== undefined)
          .map((k) => [k, o[k]]),
      ),
    });
    o.spaceId ??= state.browser?.spaceId;
  } else assert(!o.resume, "saved run not found");
  try {
    await fs.access(join(o.runDir, ".lock"));
    throw new Error(
      "another writer or stale lock exists: " + join(o.runDir, ".lock"),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (launch) return await launch(o);
  const moduleUrl = new URL("./browser.mjs", import.meta.url).href;
  const script = `const {runInEgo}=await import(${JSON.stringify(moduleUrl)});const r=await runInEgo(${JSON.stringify(o)},{taskSpace,listTaskSpaces,claimTaskSpace,takeOverTaskSpace});console.log(JSON.stringify(r,null,2));process.exitCode=({completed:0,partial:2,paused:3,failed:1})[r.completion]??1;`;
  return await new Promise((resolveRun, reject) => {
    const child = spawn("ego-browser", ["nodejs"], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) => resolveRun(code ?? 1));
    child.stdin.on("error", () => {});
    child.stdin.end(script);
  });
}
if (
  process.argv[1] &&
  (await fs.realpath(process.argv[1]).catch(() => null)) ===
    fileURLToPath(import.meta.url)
)
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
