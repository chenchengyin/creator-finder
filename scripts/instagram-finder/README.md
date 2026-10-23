# Instagram 找人与邮箱协作

实际项目根目录：`/Users/vb/Projects/creator-finder_preview`。本副本独立开发；复制来的历史 runs、旧 round 脚本及旧空间不可作为新任务入口。原项目/空间19不由此模块操作。

## 分工

INS 负责关键词搜索、作者去重、身份、国家/Threads/均播和资格汇总；邮箱模块负责Bio及挂链查找、解析和证据。新条件 `requireEmail: true` 接受明确公开Bio/挂链邮箱；`requireBioEmail` 是历史接口，保持原义，不能与新条件混用。

邮箱与国家结果独立：一项不符合或未知不阻止另一项及其他显式请求检查。全局限流/验证/接管/浏览器失联/写盘失败停止任务。跨其他账号发现的邮箱保留证据待归属核验。内容仍待人工复核；`core_pass_pending_content_review` 不等于最终内容已合格。

## 统一入口

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
- `actions.jsonl`：所有导航/点击/滚动/按键的串行操作记录，普通操作至少8秒，TikTok目标导航至少10.5秒。
- `results.json` / `results.csv`：全部已观察作者及状态，含Bio/挂链邮箱分列、来源URL/发现路径、国家语义、均播及逐人收录依据。待复核、排除和处理中作者不冒充已合格。

邮箱 `completed` 允许包含已记录跳过页面。无命中但有跳过/部分失败/疑难证据时为未知；明确合格来源邮箱命中可满足邮箱条件，其他缺口仍保留。`.lock` 遗留时需先确认进程已停止再人工清理，程序不会自动抢锁。

## 代码接口

`processSearchPage({page, items, conditions:{requireEmail:true,...}, runDir, state, onCheckpoint, readers})` 与 `collectCreator({page, username, authorId, conditions, runDir, state, onCheckpoint})` 共用单作者 verification。浏览器调用方需要统一协调页面/节奏与空间；独立调用应显式管理对应 Page。

[协作设计](docs/2026-10-22-邮箱模块协作-设计.md) · [测试契约](docs/2026-10-22-邮箱模块协作-测试用例.md) · [实现计划](docs/2026-10-22-邮箱模块协作-实现计划.md) · [验证与Review](docs/2026-10-22-邮箱模块协作-开发验证与实现Review.md)

本次为离线实现，真实新批次在线端到端尚未验收。

2026-10-22 新实测条件支持：keywords接受普通关键词（无需加#）；conditions.countries可传["US","GB"]表示任选其一，不与单country混用；maxAuthors为完成核验的去重作者上限。达到上限返回author_limit_reached，searchExhausted=false，保留未处理搜索结果；原生末页且当前候选全部处理才返回keywords_exhausted。未请求均播时不采视频指标。本次WhatsApp忽略规则见邮箱模块README。


2026-10-23：邮箱别名去重、独立入口恢复及采纳质量已定向完善。导出时对真实原始邮箱报告按当前规则纯函数重算acceptedEmails/reviewEmails，并同步导出的checks、matches、status和verification展示；不会重采或改写原始execution-state及页面证据。--status仍展示已保存断点快照。第6项8页预算待确认；第7独立页面/国家先保存、第8断点数据去重未在本轮实施。最终451项脚本回归通过，46份本次已保存快照只读复验通过，独立Review问题已修复；未恢复在线采集。
