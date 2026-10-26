# Instagram 找人与邮箱协作

实际项目根目录：`/Users/vb/Projects/creator-finder_preview`。本副本独立开发；复制来的历史 runs、旧 round 脚本及旧空间不可作为新任务入口。原项目/空间19不由此模块操作。

## 分工

INS 负责关键词搜索、作者去重、身份、国家/Threads/均播和资格汇总；邮箱模块负责Bio及挂链查找、解析和证据。新条件 `requireEmail: true` 接受明确公开Bio/挂链邮箱；`requireBioEmail` 是历史接口，保持原义，不能与新条件混用。

邮箱与国家结果默认独立：一项不符合或未知不阻止另一项及其他显式请求检查。需要邮箱时，若简介已完整读取、挂链列表已完整读取且为空，并且邮箱核验明确未发现邮箱，则以 `no_email_or_profile_links` 排除，直接处理下一位，不再查询国家、Threads 或均播。有挂链、资料不完整或邮箱结果不确定时不提前跳过；旧断点恢复也采用此规则。全局限流/验证/接管/浏览器失联/写盘失败停止任务。跨其他账号发现的邮箱保留证据待归属核验。内容仍待人工复核；`core_pass_pending_content_review` 不等于最终内容已合格。

## 统一入口

每个新关键词均从 Instagram 官网首页开始，点击左侧“搜索”，等待搜索输入框可用，输入原始关键词并按 Enter 确认。仅在浏览器实际进入对应关键词结果页，且收到可核对关键词的原生搜索响应后读取候选；不拼接关键词搜索地址导航。后续批次继续在当前结果页滚动，断点恢复沿用原结果页。登录、验证、限流及控制权异常继续暂停。

新批次示例配置为本目录 `config.example.json`。关键词和其他筛选条件由当次任务配置决定；均播窗口如未指定，在创建任务时冻结为此前10个完整上海自然日。

```bash
node /Users/vb/Projects/creator-finder_preview/scripts/instagram-finder/find.mjs \
  --config scripts/instagram-finder/config.example.json \
  --run-dir runs/2026-10-22-ins-email-001
```

上述命令会真实启动在线搜索，需在决定开展实测后执行。本次实现过程没有执行该命令。新目录必须为空且位于本副本 runs 内；拒绝原目录、逃逸符号链接、复制来的历史批次和旧格式断点。

```bash
# 仅读进度，不连接浏览器
node /Users/vb/Projects/creator-finder_preview/scripts/instagram-finder/find.mjs --status --run-dir runs/2026-10-22-ins-email-001
# 暂停问题处理完、用户明确恢复后，在同一空间继续
node /Users/vb/Projects/creator-finder_preview/scripts/instagram-finder/find.mjs --resume --run-dir runs/2026-10-22-ins-email-001
# 只从断点重建输出，不连接浏览器；持有批次写锁
node /Users/vb/Projects/creator-finder_preview/scripts/instagram-finder/find.mjs --export --run-dir runs/2026-10-22-ins-email-001
```

相对路径以本副本项目根解析。退出码0完成、3暂停、1失败。运行日志包含空间/页面、阶段、前后URL及操作错误；页面标识来自实际创建回执并存入断点。失去已保存页面时暂停，不自动换页继续。

## 输出与恢复

- `execution-state.json`：唯一批次断点，保存当前词/页/作者阶段、冻结条件和空间。
- `authors/<作者ID>/email/`：邮箱模块独立断点、结果及不可变证据。子任务先提交，父任务随后记账。
- `actions.jsonl`：所有导航/点击/滚动/按键的串行操作记录，普通操作至少8秒，TikTok目标导航至少10.5秒。进入国家核验时确认主页地址、身份及弹窗状态后记录 `country_profile_ready`，等待至少2秒后点击“更多”，不补足导航后的8秒间隔；主流程仍先完成主页、邮箱及断点保存。更多菜单确认“账户简介”入口可见后记录 `country_menu_ready`，等待至少500毫秒即可点击该入口。国家资料读取及身份、冲突检查完成后记录 `country_dialog_read`，等待至少500毫秒即可关闭资料卡；资料未取得或访问受阻时不启用该例外。确认关闭后记录 `country_dialog_closed`，下一次普通操作只需距关闭确认至少1秒；随后恢复原节奏。入口未就绪或关闭未确认时不启用对应例外。
- `results.json` / `results.csv`：全部已观察作者及状态，含Bio/挂链邮箱分列、来源URL/发现路径、国家语义、均播及逐人收录依据。待复核、排除和处理中作者不冒充已合格。

邮箱 `completed` 允许包含已记录跳过页面。无命中但有跳过/部分失败/疑难证据时为未知；明确合格来源邮箱命中可满足邮箱条件，其他缺口仍保留。`.lock` 遗留时需先确认进程已停止再人工清理，程序不会自动抢锁。
扩大邮箱扫描额度后的旧候选补扫会跳过国家条件已明确不符的达人；其原有邮箱断点和缺口仍保留，不把未扫页面记作已完成。

挂链扫描遇 YouTube 图片验证码时，先保存作者与邮箱子断点、导出当前结果、释放批次写锁，再交还原浏览器空间。人工处理后使用原 run 目录的 `--resume` 继续；验证码过期时只允许一次有原生过期提示的复选框重试，不解图片题。

## 代码接口

`processSearchPage({page, items, conditions:{requireEmail:true,...}, runDir, state, onCheckpoint, readers})` 与 `collectCreator({page, username, authorId, conditions, runDir, state, onCheckpoint})` 共用单作者 verification。浏览器调用方需要统一协调页面/节奏与空间；独立调用应显式管理对应 Page。

[协作设计](docs/2026-10-22-邮箱模块协作-设计.md) · [测试契约](docs/2026-10-22-邮箱模块协作-测试用例.md) · [实现计划](docs/2026-10-22-邮箱模块协作-实现计划.md) · [验证与Review](docs/2026-10-22-邮箱模块协作-开发验证与实现Review.md)

本次为离线实现，真实新批次在线端到端尚未验收。

2026-10-22 新实测条件支持：keywords接受普通关键词（无需加#）；conditions.countries可传["US","GB"]表示任选其一，不与单country混用；maxAuthors为完成核验的去重作者上限。达到上限返回author_limit_reached，searchExhausted=false，保留未处理搜索结果；原生末页且当前候选全部处理才返回keywords_exhausted。未请求均播时不采视频指标。本次WhatsApp忽略规则见邮箱模块README。


2026-10-23：邮箱别名去重、独立入口恢复及采纳质量已定向完善。导出时对真实原始邮箱报告按当前规则纯函数重算acceptedEmails/reviewEmails，并同步导出的checks、matches、status和verification展示；不会重采或改写原始execution-state及页面证据。--status仍展示已保存断点快照。第6项8页预算待确认；第7独立页面/国家先保存、第8断点数据去重未在本轮实施。最终451项脚本回归通过，46份本次已保存快照只读复验通过，独立Review问题已修复；未恢复在线采集。

## 搜索访问证据（2026-10-24）

搜索响应按请求ID、原生操作名、关键词和游标关联。首页/账号建议等非目标响应的错误只作为证据告警；明确登录或验证信号优先暂停。当前正式搜索的429或明确频率错误记为限流，`please wait a few minutes` 单独出现记为访问异常待核实。目标401/403/429即使正文不可读仍暂停；不会被其他成功响应掩盖。错误只影响非必要字段且必要数据完整时保留结果并附告警；缺身份或分页信息不能当空结果/末页。

`search-responses.jsonl` 保存允许字段的脱敏证据，拒绝写入完整请求、Cookie和认证头。暂停断点与 `results.json` 的可选 `accessIssue` 字段保存同一原因；已有有效未消费分页随断点保留。旧断点仍兼容，显式恢复后清除旧暂停原因；证据写入失败停止。

输入Enter后若官网展示了query完全匹配的原生关键词结果链接，或与实际搜索词（自动补#后）完全一致的原生话题链接，脚本点击实际链接。只有账号建议、未出现目标入口时，暂停为 `search_confirmation_unavailable`，不会改为“限流”或“搜索结束”，也不拼接结果地址。已确认的目标搜索限流按下方冷却规则处理。

## 运行进度（2026-10-24）

正式CLI启动后会持续输出 `type=progress` 的单行JSON，直到子进程退出：starting、running、waiting，以及最终completed/paused/failed。每次执行生成独立runId，旧快照不会当成本次成功。缺少终态或退出码冲突均明确报告异常并返回非零。

`progress.json` 约每15秒原子更新一次，包含阶段/关键词/当前作者、tracked/processed/matched计数、heartbeatAt、lastProgressAt、waitReason/waitUntil。matched表示显式条件通过数，不表示人工内容复核已完成。snapshot仅为最近一次观察，不能脱离心跳新鲜度和父进程退出信息判断是否仍在运行；父子15秒节奏叠加时可有约30秒显示延迟。

父进程心跳45秒未更新时提示heartbeat_stale；非已知未来等待且120秒无进展时提示no_progress。两者是需关注提示，不会强杀或重启浏览器操作。普通动作节奏及显式waitForTimeout均提供等待原因和预计时间；限流冷却也提供预计恢复时间和已用重试次数。

进度只维护最新快照、不累积内存历史、不新增浏览器请求或守护进程。写盘串行，正常/暂停/失败都在释放批次锁前完成最终写入并清理timer；异常进程死亡由父进程报告，未确认worker结束时标为unknown。`--status`一次性返回业务断点与runtime快照；持续观察应读取小型progress.json，不要高频重读完整业务断点。

### AI运行配合

实际采集期间保留当前执行会话，持续观察进程和小型进度文件，30～60秒主动说明已处理数、结果数、阶段或等待原因。任务运行/已知等待时不提前发送final；只有完成、明确暂停/失败或需要用户操作才收尾。失联和长时间无进展必须明确说出，不以旧状态冒充仍在采集。此约定不等于项目代码可以控制Codex客户端loading图标；断网、应用退出等情况不承诺持续连接。

## 搜索限流冷却（2026-10-24）

只有当前关键词、当前分页游标对应的已确认搜索限流才自动冷却。整批最多重试2次，默认60/120秒加0–10%正向抖动，并遵守更晚的Retry-After。单次剩余冷却超过10分钟时保存nextRetryAt并明确暂停；显式恢复不会重置deadline或次数。成功换页/换词也不补充预算。

等待时进度为waiting，waitReason=search_rate_limit，快照包含retryAttempts/retryLimit/nextRetryAt。正常冷却仍持续观察执行会话并主动汇报，不提前结束对话。等待不产生新的脚本网站请求，保留当前关键词、搜索游标及已保存结果。

等待中退出可恢复剩余等待；在重试派发中退出时，无法确认上次动作是否完成，暂停为search_retry_dispatch_interrupted，需人工核对，不自动重放。耗尽则search_retry_exhausted；长等待则search_retry_deferred。原有遗留锁仍需先确认worker停止再人工处理。登录/验证码/403/原因不明提示、来源或游标不符、存储与控制权异常均不自动重试。第一页继续官网输入框链路，后续页继续同页原生滚动。

[冷却设计](docs/2026-10-24-搜索冷却-设计.md) · [验证与Review](docs/2026-10-24-搜索冷却-开发验证与Review.md)


## 搜索关键词自动补#（2026-10-24）

新搜索输入没有#时，只在开头补一个；已有#不重复添加。保留大小写和词间空格，例如christian skits实际输入#christian skits，不改成#christianskits。官网链接、页面q和原生响应均按实际searchKeyword关联，仍通过官网原生入口，不拼接地址。

配置与来源keyword保留原始输入，页面缓存、搜索证据、作者来源和历史另保存searchKeyword；结果JSON/CSV新增searchKeywords列。限流重试继续使用原任务词/游标的预算，实际请求必须与对应searchKeyword一致，不能把其他查询归入本词。

旧缓存没有searchKeyword时保留原查询，已有普通词分页沿用原页面q及游标，不因新规则半途切换到#查询。新批次或尚未开始的首次搜索使用自动补#。保留空格的字面查询若官网未提供精确入口，仍明确暂停，不能偷偷删空格或替换话题。


暂停退出码：Ego worker正常完成或已保存暂停状态时退出0；本机父进程只有在本次runId的终态匹配后，才把paused映射为CLI退出3（progress附workerExitCode=0）。真实非零异常或缺失/冲突终态仍返回失败，不会用旧状态掩盖启动异常。
