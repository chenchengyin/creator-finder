# TikTok多关键词查找

入口为[find.mjs](find.mjs)。[设计](docs/2026-10-21-多关键词顺序查找-设计.md)、[测试契约](docs/2026-10-21-多关键词顺序查找-测试用例.md)、[实现计划](docs/2026-10-21-多关键词顺序查找-实现计划.md)和Review记录均与代码放在本模块内。

默认按输入顺序逐词搜完、筛完，再进入下一词；未启用停止选项时达到目标仍继续。配置`maxKeywords`可限制累计完整关键词数，`stopAtTarget=true`在唯一confirmed/suspected人数达到`targetCount`后停止开新主页，先到即止，最终导出全部已核验唯一作者。当前Bio公开邮箱、完整时间窗口均播和目标视频地区字段仍是必要数据条件；内容有歧义时以“疑似符合”交付并保留依据。地区字段不证明本人现居地。

## 操作入口

需要Node.js、Ego Lite及`ego-browser`。真实新任务先由主助手按Ego流程创建一次空间，记录spaceId并设置`FINDER_SPACE_ID`，随后一直复用该空间的p1。脚本不创建替代空间、不自行接管。历史空间328已关闭，不能拿来跑新任务。

先复制[配置示例](config.example.json)并修改实际条件。示例只用于说明格式，不代表一次真实采集授权。下列`runs/新批次`应换成独立的新批次目录。

```bash
# 本地校验，不创建任务目录或访问浏览器
node /Users/vb/Projects/creator-finder/scripts/tiktok-finder/find.mjs \
  --config /Users/vb/Projects/creator-finder/scripts/tiktok-finder/config.example.json \
  --run-dir /Users/vb/Projects/creator-finder/runs/新批次 --dry-run

# 开始实际已指定任务，FINDER_SPACE_ID填本批已有且由Agent控制的空间ID
node /Users/vb/Projects/creator-finder/scripts/tiktok-finder/find.mjs \
  --config /Users/vb/Projects/creator-finder/scripts/tiktok-finder/config.example.json \
  --run-dir /Users/vb/Projects/creator-finder/runs/新批次 --space "$FINDER_SPACE_ID"

# 在原配置、原窗口及原空间恢复；无需重新传配置
node /Users/vb/Projects/creator-finder/scripts/tiktok-finder/find.mjs \
  --run-dir /Users/vb/Projects/creator-finder/runs/新批次 --resume

# 查看进度，或在任务暂停后导出当前已核验的候选
node /Users/vb/Projects/creator-finder/scripts/tiktok-finder/find.mjs \
  --run-dir /Users/vb/Projects/creator-finder/runs/新批次 --status
node /Users/vb/Projects/creator-finder/scripts/tiktok-finder/find.mjs \
  --run-dir /Users/vb/Projects/creator-finder/runs/新批次 --export
```

启动前固定上海时间的完整自然日窗口；恢复不跨日重算窗口，不接受改变关键词顺序或筛选条件。`country=null`不筛地区，省去额外详情访问；`requireBioEmail=false`允许无邮箱。没有隐藏粉丝或最少作品数门槛。

每个关键词开始时，脚本先打开TikTok官网首页，点开搜索入口，在输入框填入关键词并按Enter进入结果页，再点击“视频”标签；后续批次在原结果页慢速滚动。搜索结果翻页至少间隔10.5秒；主页作品翻页至少间隔3秒；打开主页、排序及地区详情等其他浏览器动作至少间隔10.5秒。所有动作串行，并等待数据加载后再继续。只被动读取正常页面产生的响应，校验请求所属页面和关键词，不生成签名或重放后台请求。

2026-10-22慢速滚动更新（统一`find.mjs`入口）：下一批操作保留上述间隔；批内通过Ego原生鼠标滚轮，每次滚可见区域四分之一、至少相隔1秒，检测到分页请求发起就停滚。跨批次及恢复共用原子保存的`last-tiktok-scroll.txt`，避免长批次结束后紧接着滚动。冷却期间每250ms接收并保留事件；按请求顺序校验分页链，正文完整下载、数据及页面稳定后再继续。网站自行预加载的请求不受脚本操作间隔保证。寻找加载位置最多120秒，原地停滞3秒、下载/响应头等待30秒、布局稳定等待5秒或资料就绪等待12秒后仍无进展则暂停，不把超时当成末页。滚轮动作保存在批次`scroll-events.jsonl`；有效`hasMore=false`仍是搜索结束依据。20项新增用例及186项相关测试通过；[book真实实测](docs/2026-10-22-book-慢速滚动实测.md)完成10批/114位/5收录，62步原生滚轮最短1063ms，6个403详情页全部恢复。历史独立`search.mjs`调试入口现也经首页输入关键词，但其旧批次滚动行为不属于该慢速滚动适配范围。

未启用前N规则（forceProfileFirstN缺省或0）或排在第N位之后，且需要公开Bio邮箱时，先用搜索响应的作者`signature`做邮箱预筛：空简介，或无邮箱且没有结尾`...`、`…`、`⋯`、`﹒﹒﹒`等省略标记时，记录`no_search_bio_email`并跳过主页；有邮箱提示或疑似截断时打开主页，核验作者身份与当前Bio。搜索签名预筛不是主页邮箱核验，无法发现没有省略标记的静默截断；自动排除依据会注明该限制。同一批已有匹配的主页邮箱缓存则优先复用。`requireBioEmail=false`时不执行此预筛。

普通403在同址等11秒重试一次，重试状态随动作保存；401/429、验证码及控制权异常优先暂停。只有检测到可见且可关闭的TikTok登录弹窗时，才点击该弹窗的关闭叉号并确认消失后继续；没有登录弹窗时直接继续，不点击关闭按钮或额外等待；无关闭按钮或关闭失败时暂停检查。该处理适用于搜索、主页和视频详情读取。任何查找阶段的页面若快照明确显示Chromium TikTok HTTP 403或Ego `ERR_BLOCKED_BY_CLIENT`错误页，且有可见“重新加载”按钮，每次重试先等至少10秒、只点一次、检查结果，最多30次；等待直接写在共享按钮循环内，独立于翻页节奏；恢复即停，验证码/登录提示或按钮消失时停止，“Please wait”等待5秒复查。普通API 403仍只同址重试一次；没有可见错误页按钮时不扩成三十次。`checkpoint.retry.screen`与`checkpoint.retry.reloadClicks`持久化当前错误页和已点击次数，恢复时直接检查原页面、只执行剩余次数；到30次后立即暂停，不额外等待或重新打开网址。用户恢复页面并交还Agent控制后，使用resume继续。丢失原页可能需正常滚动重经已见页面，但已核验作者不重新打开，已采作品不重复计数。

## 状态与输出

`config.json`固定参数；`execution-state.json`保存当前词、阶段、作者、计数和停止原因；`candidate-queue.json`保留来源；`capture-*.json`保存逐项检查及未完成动作；`author-*.json`先于总进度提交，恢复时据此核对结果；`results.json`保留包括排除/数据不足在内的全部判定。有效writer锁阻止重复启动，强制终止后resume核对旧PID再清遗留锁。历史目录不能转成新任务。

地区恢复使用`capture.videoRegion.navigationAttempts`保留完整动作和已用点击次数；普通403的一次导航重试已耗尽时，原错误页的可见按钮仍有独立剩余额度。识别器兼容Chromium把标题拆成多个文本节点，避免页面明明有按钮但文本匹配失败。2026-10-21的`r3alism_0fficial`真实页面已由统一脚本等待后点击按钮1次恢复200，并读取US字段；不是助手临时手动点击。

XLSX含达人名单、主页证据、视频证据，逐人有收录依据、全部来源词及复核状态。数据条件未核实的记录不进入最终候选名单。导出失败恢复只做导出；表格公式核对通过后才完成任务并关闭原空间。

导出复用Artifact Tool：优先使用正常安装的`@oai/artifact-tool`，再尝试Codex内置运行时；非本机环境可通过`CREATOR_FINDER_NODE_MODULES`指定安装该包的node_modules目录。不调用大模型API。

## 验证边界

```bash
node --test scripts/tiktok-finder/*.test.mjs
node --test scripts/tiktok-browser/access.test.mjs scripts/tiktok-search/search.test.mjs scripts/tiktok-video-region/region.test.mjs
```

初始模块交付验证：新增46项与原组件44项均通过，合计90/90。2026-10-21邮箱预筛变更复验：模块50/50、依赖57/57通过；追加Review记录见[验证记录](docs/2026-10-21-开发验证与实现Review.md)。独立Reviewer/PR Review未做。

离线联调目录`validation/offline-run/`使用虚构账号，仅用于检验顺序、全量导出、依据、公式和长ID，不能当成真实达人名单。既有5人的历史数据仅用于本地回放，未改变原任务或表格。

本次没有启动新TikTok批次，真实站点端到端尚未验收；也未在原生Excel中打开验证。Artifact预览可能把数字形式的文本ID显示为科学记数法，保存的XLSX须另查XML确认ID原值和文本类型。

2026-10-21当前补充批次：用户15词队列，累计10词或100位停止；包含前批已完成两词/10位，剩余词及未处理候选保留。配置新增可选maxKeywords与stopAtTarget；老配置行为不变。停止原因另记completionReason，不把额度停止写成全部关键词完成。128项相关测试通过；本轮在线进度见活动任务目录。


## 前20位强制主页核验（2026-10-22更新）

用户追加将N从10调整为20。新批次配置示例已写入 `"forceProfileFirstN": 20`。每词仍搜到有效 `hasMore=false`；按本词响应中作者首次出现的顺序、稳定ID去重，前20位绕过搜索Bio邮箱预筛并查主页。第21位起沿用原预筛；实际不足20位时检查实际人数。跨词复用本批完整主页/挂链核验，不补足20位新作者，不因前20位失败改查第21位凑数。

配置缺省或0保留旧模式，历史运行配置不自动添加或更改N。恢复不接受改变N、关键词或固定窗口。每词 `authorOrder` 保存顺序；作者 `keywordChecks` 保存排名、强制原因、是否核验和缓存复用；`forcedProfiles` 输出 required/completed/reused。账号正常私密、资料不完整或挂链未核实会保留明确缺口，completed不冒充required。

每次实际打开主页一并读取 `bioLink.link`，用原生 `bio_url` 的target备用/交叉核验；挂链状态区分present/none/unknown，保留完整URL、原始字段/DOM来源、身份和时间。字段异常、来源冲突或身份不符不记成无链接。邮箱仍只接受当前公开Bio原文，挂链不自动访问，也不替代邮箱条件；无Bio邮箱则停止该作者深查并留排除依据。

本批核验用runId和冻结配置/窗口归属；历史capture及旧processedKeywords不能冒充本批核验。恢复优先用最新capture断点，作者记录先提交后再汇总，进度可从作者记录恢复。未在本批重新核实的旧合格结果不计目标、不进入导出。主名单M:O、主页证据H:J追加挂链、状态、来源依据，原D:F指标公式保持原位。

开发验证：模块90/90，依赖与历史缓存回归65/65，共155/155；历史搜索9批/101条视频/60位作者离线回放通过，真实挂链样本解析通过。离线主页未提供的账号保留unknown，不作为真实核验完成。新版尚未在线验收；原22位人工复核批次未恢复。详细命令、Review与限制见[开发验证与实现Review](docs/2026-10-22-前N位强制主页核验-开发验证与实现Review.md)。


## 2026-10-22真实验收完成

bible/christian各完整搜索17/13批，前20位按原始响应顺序均已检查；跨词去重后308位全部处理，收录4位。[真实验收记录](docs/2026-10-22-bible-christian-真实验收.md)区分已真实覆盖、仅离线验证和可选后续完善。

已修正点开头用户名漏记；观众管理状态209002只记该账号数据不足，普通登录提示仍暂停。统一入口默认接入主页作品正文丢失的一次性补采：归档旧页、同空间从第一页重放当前账号，保留其他作者和固定窗口；再次失败暂停。成功后清除旧失败标记，挂链重核保留已用的视频403和正文补采次数。主表收录依据改逐项摘要，完整原文和链接保留在证据页/JSON。

最终模块100项、相关回归66项，共166/166通过，真实证据独立复算与XLSX公式缓存核对通过。代码Review已完成（Brainstorming bounded只读），独立Reviewer未做。原22位名单未重跑。
