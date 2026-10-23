# 主页邮箱递归查找

在 Ego Lite 中读取公开主页和页面，按纯脚本规则提取邮箱、来源原文和发现路径；不需要模型 API。

主页简介有明确邮箱时立即输出该主页结果，不再挖掘其挂链；没有明确邮箱时才沿挂链继续。疑难候选不算命中，每个递归遇到的主页都适用。

## 运行

需要 Node.js 20+ 和已安装的 `ego-browser` CLI。Ego Lite 正常运行即可，复用其当前网站登录状态。

```bash
node /Users/vb/Projects/creator-finder_preview/scripts/profile-email-finder/find.mjs \
  --url 'https://www.tiktok.com/@账号' \
  --run-dir '/Users/vb/Projects/creator-finder_preview/runs/profile-email-001'
```

`--run-dir` 每次新任务使用新目录。默认创建一个 Ego 任务空间，整条递归链复用同一个页面。

```bash
# 只查看进度，不启动浏览器
node /Users/vb/Projects/creator-finder_preview/scripts/profile-email-finder/find.mjs \
  --status --run-dir '/Users/vb/Projects/creator-finder_preview/runs/profile-email-001'

# 继续未完成页面和队列；不重新采集已经成功的主页
node /Users/vb/Projects/creator-finder_preview/scripts/profile-email-finder/find.mjs \
  --resume --run-dir '/Users/vb/Projects/creator-finder_preview/runs/profile-email-001'
```

默认没有深度/页数上限，直到范围内的队列耗尽。需要有限运行时，显式加 `--max-pages 20` 或 `--max-depth 3`；达到额度会保存未处理链接，返回 `partial`。续跑可以提高对应额度。设置过的有限额度不因为 `--resume` 自动取消。

可用 `--space 任务ID` 连接调用方的任务空间；脚本不会关闭该空间。用户接管/验证码等暂停后，用户处理完成，再显式执行 `--resume` 继续原空间。原空间消失时会暂停，不另建空间掩盖失败。自建空间仅在全部完成且输出验证后关闭。

## 复用接入方已打开的主页

每次读取前先检查传入 `page` 的当前地址：与目标的现有规范化URL键一致，就直接等待资料加载并读取，不调用 `goto` 或刷新；不一致才走原来的导航流程。兼容主页尾斜杠和普通页内锚点；query、`#/` 路由及不同账号仍区分，不猜测它们是同一内容。只复用传入的当前Page，不搜索或切换其他标签页；`/reels/` 自动转主页仍是另一个待处理项。

同级脚本在同一个Ego进程内可以借用自己的Page，并保留空间生命周期控制：

```js
const browser = createEgoBrowser({ page, config: { spaceId: task.spaceId } });
const result = await runFinder({ config: { url: profileUrl }, runDir, browser });
```

这里 `createEgoBrowser` 来自 `browser.mjs`，`runFinder` 来自 `finder.mjs`。接入方管理空间时，不把 `task` 传给这个借用适配器；正常返回后由接入方继续后续工作，遇暂停仍应停止。独立CLI的空间完成/交还行为保持原约定。

复用后继续沿用简介命中停止、资料展开、访问节奏、验证码和控制权检查。若继续递归挂链，仍会导航这个Page；接入方需串行执行，在后续均播/国家核验前恢复原主页或使用自己管理的独立Page。本次只完成邮箱模块的页面复用能力，尚未修改INS/TikTok找人流程。

## 查验范围

- TikTok、Instagram、YouTube 主页：先读取简介/About。简介已有明确邮箱就结束该主页的挂链挖掘；否则再处理挂载链接，即使链接属于另一达人。其他已发现分支照常继续。
- Beacons 聚合页：当前公开文字与主体挂载列表；服务品牌页脚不作为达人挂链递归。Linktree 按用户最新要求暂时直接跳过，不发起访问。
- 其他网页：当前已加载可见文字中的邮箱、`@`、不分大小写的 Contact/Email/Booking 等词及 `mailto/emailto`；只继续明确的联系链接、三平台主页和已识别聚合入口。导航、文章、商品不整站遍历。
- TikTok/YouTube/Instagram 的已知跳转包装会解开其明确目标参数，原始地址留在证据/链路中。相对 URL、query 和 hash 路由按原语义保留。

普通网页不自动滚动或操作通用折叠/弹窗，不遍历 iframe、不识图、不解析 PDF。未读取的交互联系控件、布局不支持、页面截断等会保留缺口。首版聚合列表适配为Beacons；Linktree暂时跳过，其他链接页按普通网页规则检查。

普通网页访问失败（连接拒绝、超时、HTTP错误、外站登录墙等）不重试，记录 `pages[].status = "skipped"` 和原因后继续其他链接。短链跳转到Linktree时也跳过，不读取其DOM。跳过项在 `--resume` 时不重新访问；以后需要重新检查时新建运行，Linktree则需先取消临时跳过规则。验证码、429限流、用户接管、Ego/CDP异常仍暂停；写盘失败仍停止。

## 看结果

终端最终输出 JSON，运行目录包含：

| 文件 | 内容 |
|---|---|
| `results.json` | 邮箱、来源证据、递归边、页面状态和总体完成状态 |
| `pages.json` | 每页 URL、检查结果、缺口与检查点 |
| `execution-state.json` | 唯一有效断点；输出摘要失败时可由它重建 |
| `evidence/*.json` | 不可变版本的公开文字和链接快照 |
| `config.json` | 初始参数；续跑实际配置以断点内 `config` 为准 |

主页挂链在资料读取过程中先暂存；展开后才读到明确Bio邮箱时，也不会启动暂存分支。结果页的 `stopReason = "profile_bio_email_found"` 表明因简介命中结束；证据中的 `profile_bio` 与 `profile_content` 区分简介和其他资料文字。历史已完成页面仍使用原快照，不回删之前已采结果。

`emails[]` 按邮箱小写键去重，保留大小写变体和每份证据。证据含 `sourceUrl/pageKind/pageTitle/location/raw/context/path/capturedAt`；`edges[]` 含原始跳转地址与目的地址。

`confirmed_public` 只表示页面明确公开出现，不能证明邮箱归属或能投递。`needs_review` 是混淆写法、空白还原、黏连前缀、异常点号或非标准收件人等候选，需要人工复核。不会擅自把 `contacttofoo@...` 改成 `foo@...`。

`completed` 表示按当前策略处理完队列，可以包含明确记录的 `skipped` 页面；不能把跳过解释成已查无邮箱。

退出码：`0 completed`、`2 partial`、`3 paused`、`1 failed`。任何非零结果仍可能含已保存邮箱；不能只根据是否有邮箱判断任务是否完成。写盘失败会停止后续浏览操作，控制台返回最后已提交事实；断点可能仍显示出错前的状态。`.lock` 防止同目录多进程写入；进程崩溃遗留锁需核实对应进程结束后人工清理。

## 验证与已知限制

2026-10-22：三平台真实公开主页分别验证了资料/挂链提取；TikTok 示例实际提取到公开邮箱；YouTube About 两阶段展开和已知跳转链接验证通过；普通网页和真实 Chromium DOM 夹具已验证。Linktree此前访问受阻；用户已确认暂时跳过，不再作为当前交付阻塞，未声称其内容已被读取。简介优先规则此前模块92/92、相关回归154/154通过，真实TikTok样本命中Bio后仅处理1页、跟进链接0条。最新当前页复用变更：模块100/100、项目脚本全量389/389通过；真实Instagram已打开主页提取到邮箱，采集阶段goto/reload/close均为0，前后performance.timeOrigin一致。证据见 `validation/reuse-open-page-20261022/`。

A→B→C 跨账号、长链、循环、断点、额度和故障行为由自动测试验证；这不等于跨平台完整在线链路已验收。平台改版仍可能产生 `partial`；验证码、限流、用户接管、浏览器无响应会暂停并保留已提交结果。

```bash
cd /Users/vb/Projects/creator-finder_preview
node --test scripts/profile-email-finder/*.test.mjs
```

[设计](docs/2026-10-22-主页邮箱递归查找-设计.md) · [测试契约](docs/2026-10-22-主页邮箱递归查找-测试用例.md) · [计划](docs/2026-10-22-主页邮箱递归查找-实现计划.md) · [实现 Review 与验证记录](docs/2026-10-22-主页邮箱递归查找-开发验证与实现Review.md)

## INS 找人模块接入（preview副本）

新增 `integration.mjs` 的 `findProfileEmail({page, profile, runDir, spaceId, browser, limits})`。profile包含身份已核验的username/profileUrl、biography、links和linksComplete。可完整判断的主页快照直接交给邮箱核心；Bio命中不再读挂链，资料不全时借用当前Page补读。runDir必须按作者隔离；存在子断点时恢复，禁止复用给其他作者。

返回原始完整报告，并附 acceptedEmails / matches（三态）。Bio与挂链明确邮箱可满足条件；跨其他主页的邮箱仅保留待归属核验。无命中但有skipped/partial/疑难邮箱为null。调用方负责汇总资格和其他检查。借用适配器不接收task、不关闭/交还调用方空间；递归可能改变Page URL，调用方后续应检查位置。

`browser.mjs` 现在会透传协调器的pause/storageFailure，避免把全局停止错误记录为普通外站跳过。独立CLI保留原用法。此次接入及全量离线回归见同级INS模块的协作文档；未追加在线采集。

2026-10-22 实测规则补充：WhatsApp应用联系入口（wa.me、api/web/chat.whatsapp.com，以及whatsapp.com的send/message/channel入口）只保留链接并记skipped/messaging_contact_ignored，不访问、不递归。短链跳到此类入口也不读取其DOM。旧断点中仅从该分支到达的后代停止跟进，原始页面证据、边保留；有其他独立有效路径的网页不受影响。

实测范围修复：普通网页继续出链使用较严格的联系词；business、management、collaboration单独出现不再视为联系入口，避免新闻文章扩散。恢复时按已保存capture重新核对出链，仅经错误出链到达的页面停止跟进，独立合法路径不受影响，旧证据与边保留。


## 2026-10-23 指定优化

共用邮箱核心统一Instagram、TikTok、YouTube已知主页主机别名的身份键，保留实际访问URL和原始证据。IG/TikTok账号大小写归一；YouTube频道ID大小写、业务query和路由hash仍区分。旧断点不强制迁移：规范身份复用完整主页，原记录保留。TikTok找人候选原本按作者ID/用户名去重；本次修的是独立邮箱模块的URL去重。

独立邮箱入口对agentDelegatedToUser仅在明确--resume时调用takeOverTaskSpace；未明确恢复不接管。

集成返回acceptedEmails与reviewEmails，公开出现和采纳分开。深层内容入口转到站点其他联系页、缺少作者关联时待归属；直接挂载的联系页、官网到其联系页、直接正文及有效关联证据仍可用。mailto收件人与锚点可见邮箱冲突时待复核；优先使用锚点本身文字，再回退父容器上下文，不猜改地址。独立可见文字中的明确邮箱仍是单独有效证据。原始emails/evidence保留，reviewEmails附reviewReason。

普通网页捕获为页脚/导航文字和链接保留siteWide语义，避免CSS路径以id开头时丢失语义。历史证据缺少该标记时只能利用已有source/location，不声称可以还原未保存的DOM。

本轮保留多邮箱挖掘，不实施首个挂链邮箱后提前结束。8个累计挂链页面预算仍待用户确认计数口径，当前配置不变。

## 2026-10-23 YouTube 原生业务邮箱

新增 `youtube-email.mjs`：主页更多 → 查看电子邮件地址 → 普通可见勾选 → 确认通过 → 提交 → 读取 About 内 `mailto:`。支持入口、验证iframe延迟加载及可访问名称，兼容自定义元素hidden特殊值；未知控件、登录、401/403、限流、图片挑战或控制异常会保存暂停。勾选最多一次，提交最多两次，已展示邮箱不重复操作。

原生邮箱证据为 `profile_contact_email`，接入层 `acceptedEmails[].sourceType` 为 `profile_contact`。原生入口命中后继续检查挂链；仅Bio明确邮箱保留既有优先结束规则及全部原始证据。无原生入口时按既有规则挖掘挂链；自由简介提到邮箱不等于原生入口存在。

接入方管理空间时只传借用的 Page（不要传 task），由接入方根据自身目标保存结果、结束或交还。实测目标若限定 YouTube 原生邮箱，挂链邮箱不能视为完成。

2026-10-23：项目脚本全量466/466通过；空间88真实完成@choruslove普通勾选及一次提交，原生mailto显示kikochan@pomato.hk。完整采集器恢复输出completed，空间正常结束。证据见 validation/youtube-native-20261023/。

## 2026-10-23 更正来源后的增量同步

已同步对话「设计主页邮箱递归查找脚本」01a16283-f323-7613-8072-bfcd8a8fd039的验证断点、提交恢复、点击后观察和iframe快照行为；保留preview的保护与证据语义。仅Bio命中停止当前主页，原生联系邮箱后继续挂链；旧原生停止断点在恢复时重建挂链队列，不重复读取频道。站外support@邮箱作为待复核支持线索保留，reviewReason=support_mailbox_requires_review，不自动计入acceptedEmails。

全量477/477通过，独立复核11项通过。Kallaway原生证据复用，空间92新增访问5个站外页面32.795秒，取得support@sandcastles.ai并单列待复核；completed，队列为空，空间正常结束。见validation/youtube-source-merge-20261023/。
