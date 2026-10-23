# 地区字段脚本验证与 Review

日期：2026-10-21，上海时间。

## 范围

按当前对话已确认的方案，把视频 `locationCreated` 读取形成独立本地脚本，并接入本次 Ego 采集器。检查文件：`region.mjs`、`read-region.mjs`、`region.test.mjs`、`README.md`，以及本次 `session-steps/collect-profiles.ego.mjs` 的字段保留和调用位置。CRM 业务仓库没有改动。本工具在仓库外，不涉及 Git 集成或部署。

Brainstorming 需求评审：已完成（当前对话小范围方案：最新一条/可选三条、保留原始字段与来源、证据不足待核验、访问保护即停、字段不等于本人现居地）。内部采集工具，没有新增产品页面或交互，未做同类产品 UI 对标。

## 实际验证

- Red：首次测试因缺少脚本实现失败，15 项失败，记录在本次采集目录的 `region-tests-red.log`。
- Green：`node --test /Users/vb/Tools/tiktok-video-region/region.test.mjs`，最终 22/22 通过，记录 `region-tests-final.log`。
- 回归：原交接包 `campaign-criteria.test.mjs` 和 `campaign-postfilter.test.mjs`，22/22 通过，记录 `region-criteria-regression.log`。
- `node --check`：核心模块、命令行入口、本次采集器均通过。
- 对现有全部 31 位合格账号的保存快照进行最新视频选取，全部通过；仅离线选取，不声称已读取这些账号的新地区字段。结果为 `region-targets-dry-run.json`。
- 命令行 `--help` 和真实快照 `--dry-run` 通过。
- 命令行实际经过 Ego 启动、模块导入和空间状态检查，原空间 328 状态为 `agentDelegatedToUser`，按设计拒绝进入页面操作，退出 1；未发起 TikTok 请求。记录 `region-cli-control-gate.log`。

## 实现 Review

代码 Review：已完成，采用 Brainstorming bounded 只读实现 Review；检查最新作品选择、作者/作品身份、仅提取指定字段、缓存与来源、逐条保存、访问保护/控制权与异常退出、采集器接入边界。

第一轮发现并自动修复：

1. 采集器可能为图文构造视频形状的 URL，现按保留的 `mediaType` 排除图文。
2. HTTP 500 时可能把旧 hydration 当成有效字段，现返回待核验并停止。
3. 导航失败但旧页面恰好匹配目标时可能误记成功，现保留错误并将证据标为待核验。

对应 3 项失败测试先复现，再修复复验。

第二轮发现并自动修复：正常作品文案出现“HTTP ERROR 403”可能被误当访问保护。现优先读取真实导航状态，只在缺少视频对象的错误页中用错误文本辅助判断。失败测试复现后修复。

最终再次只读复核及相关测试全部通过，未发现未处理的阻塞项。

独立 Reviewer/PR Review：未做。以上属于主实施者的 Brainstorming bounded Review，不是独立审查。

## 实际限制

新脚本尚未完成真实 TikTok 在线批量验收：原任务仍处于用户接管/403 暂停状态。离线测试、原有单条字段观察和命令行保护检查不能证明在线字段覆盖率、地区准确率或批量稳定性。当前 31 位账号的历史地区结果没有重算。

## 归入完整找人项目后的复验

2026-10-21：模块已归入 `/Users/vb/Projects/creator-finder/scripts/tiktok-video-region/`，旧 Tools 路径保留兼容链接。新增链接入口回归用例先失败，再以真实路径比较修复 CLI 入口识别；最终23/23通过，新旧入口 `--help` 和采集器语法检查通过。对本次单点路径修改做 bounded 只读 Review，未发现遗留阻塞项；独立 Reviewer 未做，在线状态仍未验收。
