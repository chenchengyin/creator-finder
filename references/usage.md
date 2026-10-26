# 使用说明

## 安装后与使用前

> 请先在 Ego Lite 中登录你想搜索的对应平台账号（如 TikTok、Instagram 或 LinkedIn）。已经登录的账号可以直接复用。

安装完成的引导和每次使用技能时，助手都会提示这项准备工作；已指定平台时会提示对应平台名称。请在 **Ego Lite** 中完成登录，在 Chrome 或其他浏览器登录不代表 Ego Lite 已登录。

安装提示需在后续打包时接入安装宿主的完成回复或首次引导，当前文档没有安装完成自动通知钩子。查看已保存进度和导出结果无需为此重新登录；LinkedIn 公开摘要搜索本身也不要求先登录 LinkedIn。

## 直接用自然语言下任务

不需要先学命令行。调用 `creator-finder` 后，可以直接告诉助手要找什么人。

| 想做什么 | 可以这样说 |
|---|---|
| 了解功能 | “creator-finder 怎么用？” |
| 找 Instagram 达人 | “帮我找美国做美妆的 Instagram 达人，需要公开邮箱。” |
| 找 TikTok 达人 | “找美国做健身内容的 TikTok 达人，近 10 天平均播放量大于 5 万，需要主页公开邮箱，目标 20 人。” |
| 搜领英人员 | “搜 LinkedIn，美国的 sourcing manager，目标 30 人，需要公开邮箱。” |
| 搜其他网站 | “在 example.org 找 engineer 的公开资料和邮箱线索。” |
| 查已有主页邮箱 | “从这个 Instagram 主页和公开挂链里找联系邮箱：〈主页链接〉。” |
| 查看/继续/导出 | “查看上次任务进度”“继续上次任务”“导出已有结果”。 |

这些条件是示例，不是每次运行的默认条件。只询问用法时不会启动搜索；已经提供条件时会沿用上下文，只补问必要缺项。

## 提供哪些信息

- **平台或网站、找人关键词**：例如 Instagram 的美妆内容、LinkedIn 的 sourcing manager。已有链接查邮箱时，直接提供主页或网页链接。
- **地区**：需要限制时说明。当前 LinkedIn/通用摘要模块的地区配置支持美国和英国；不配置地区为全球，不按地区排除。其他国家条件不能直接承诺支持。
- **目标人数**：需要达到多少人时说明；LinkedIn 不设目标则执行到配置查询耗尽。
- **额外条件**：如公开邮箱、平均播放量、统计时间窗口等。各平台可核验的字段不同，助手会根据模块能力检查条件，不保证任意筛选项都能自动执行。

LinkedIn 默认经 Google 搜索公开摘要，邮箱搜索词由程序提供，不需要自己编写。可以明确指定 Bing；原引擎受阻时不会自动切换引擎。

## 运行环境与结果

执行需要 Node.js 20+、`ego-browser` CLI 和运行中的 Ego Lite。脚本复用浏览器实际登录状态；目标站点要求登录或验证时，需要在原浏览器里处理。

每个任务使用项目 `runs/` 下独立目录，保存配置、候选、来源证据、进度和断点。不要覆盖已有任务目录；修改搜索条件应新建任务，续跑沿用原条件。

LinkedIn/通用摘要模块可输出 JSON、CSV 和 HTML，包含候选、邮箱原文、来源、查询、地区证据与待核验项；TikTok、Instagram 和主页邮箱模块按各自格式交付。助手会提供本次实际生成的文件链接。

公开邮箱只表示来源中出现该地址，不证明邮箱归属或可投递性。Google/Bing 搜索摘要不等于读取 LinkedIn 主页；视频地区字段也不证明作者现居地。没有达到目标人数会如实报告已找到数量和结束原因。

遇验证码会保留原页与结果，说明人工处理步骤。Google 验证流程每 20 秒持续检测；Ego 人工接管期间只能观察控制权，完成后需点“交还给 Agent”，再核验原结果后继续。其他模块按其暂停规则续跑。验证检查不计入采集量。

## 给 Agent 的命令参考

以下命令在 `SKILL.md` 所在的实际项目根目录执行。示例运行目录仅用于展示，新任务需要改成未使用的唯一目录；不用历史机器的绝对路径。

### 查看用法和预览配置

```bash
node scripts/find-people.mjs --help
node scripts/find-people.mjs --site linkedin --keyword "sourcing manager" --country US --target 30 --check-config
```

`--check-config` 只预览配置，不启动浏览器，也不需要 `--run-dir`。它属于统一入口，专用模块参数以各自 `--help` 为准。

### 新建 LinkedIn 搜索任务

```bash
node scripts/find-people.mjs --site linkedin --keyword "sourcing manager" --country US --target 30 --run-dir runs/linkedin-new
```

多个关键词重复 `--keyword`；美国使用 `US`，英国使用 `UK`。显式使用 Bing 时加 `--engine bing`。其他网站用实际目标域名替换 `linkedin`。不要把生成的搜索 URL 当成浏览器入口，脚本仍需从正常搜索框提交。

### TikTok 与 Instagram

专用模块有各自的业务条件结构。先读取对应说明与配置示例，按本次需求生成配置，不直接运行示例业务条件：

- [TikTok 说明](../scripts/tiktok-finder/README.md) / [配置示例](../scripts/tiktok-finder/config.example.json)：包含统计窗口、均播、地区、Bio 邮箱及停止策略。新任务先按 Ego 流程创建本批空间，模块入口传 `--space` 和实际空间 ID。
- [Instagram 说明](../scripts/instagram-finder/README.md) / [配置示例](../scripts/instagram-finder/config.example.json)：使用 `conditions` 结构描述邮箱、地区和均播要求。

Instagram 专用入口示例：

```bash
node scripts/instagram-finder/find.mjs --config runs/task-configs/instagram-new.json --run-dir runs/instagram-new
```

上面的配置文件须先根据真实条件创建。TikTok 的目标人数和停止策略需要按其配置说明设置，不能只照搬统一入口的 `--target`。Instagram 的目标人数不要直接照搬 LinkedIn 的 `targetCount`，先核对模块支持情况。

### 从已有主页查邮箱

```bash
node scripts/profile-email-finder/find.mjs --help
```

实际运行使用 `--url` 提供真实主页链接，并用 `--run-dir` 指定新目录。主页简介已有完整邮箱时，不再为该主页继续挖掘挂链；其他规则见 [主页邮箱说明](../scripts/profile-email-finder/README.md)。

### 查看、续跑和导出

经统一入口创建的任务：

```bash
node scripts/find-people.mjs --status --run-dir runs/linkedin-new
node scripts/find-people.mjs --resume --run-dir runs/linkedin-new
node scripts/find-people.mjs --export --run-dir runs/linkedin-new
```

续跑、进度和导出时只使用原目录，不重新传平台、关键词、地区或目标。`--status` 与 `--export` 不启动浏览器；`--resume` 会先核对保存状态及原页面。

直接由专用模块创建的旧任务缺少统一路由记录，应使用原来的模块入口。主页邮箱模块支持 `--status` / `--resume`，结果保存在原目录，不支持上述统一入口的 `--export`。

## 当前交付范围

这份说明与 `SKILL.md` 是项目内的技能文档，尚不等于已安装到某个 AI 软件或完成跨软件验收。打包时需一起保留被引用的运行脚本、配置示例和模块文档，并检查目标软件的浏览器、系统通知和对话进度接口。
