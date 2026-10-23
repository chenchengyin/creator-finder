# bible / christian 两词真实验收

日期：2026-10-22，Asia/Shanghai。用户授权新建可见Ego Lite空间并运行真实脚本。关联：[前N设计](2026-10-22-前N位强制主页核验-设计.md)、[测试用例](2026-10-22-前N位强制主页核验-测试用例.md)、[计划](2026-10-22-前N位强制主页核验-实现计划.md)。

执行目录：`/Users/vb/Projects/creator-finder/runs/2026-10-22-bible-christian-n20-live/`。空间55，始终复用p1；完成导出后由工作流等待finish一次，状态completed、runtimeRunning=false、无writer锁。未新建恢复空间，原22位人工复核批次1484个文件SHA256不变。

## 参数与真实结果

关键词依次bible、christian；US；近10个完整上海自然日（10月12日00:00至10月22日00:00，结束不含）；算术均播严格大于50000；当前公开Bio明确邮箱；forceProfileFirstN=20。stopAtTarget=false，两词搜完筛完，未在合格人数到20时停止。地区按最新公开视频locationCreated判断，不证明本人现居地。

| 关键词 | 加载批数，含首批 | 首批后的向下加载 | 原始视频条目 | 不同作者 | 前20主页检查 |
|---|---:|---:|---:|---:|---:|
| bible | 17 | 16 | 196 | 185 | 20/20 |
| christian | 13 | 12 | 143 | 124 | 20/20 |

两词均有效hasMore=false。共339条搜索视频记录，309个按词作者命中，跨词重复1位，308位唯一作者全部判定。实际调用主页读取68次，最终保存66位主页记录；其余242位按搜索邮箱预筛排除。主页调用包含一次作品补采重新读取、受限页复查；修复前还多检查过原始第21位，检查记录保留，最终强制名额已按原始顺序纠正，不能把多查视作正确前20的替代。

共4位满足本批数据条件：

| 账号 | 窗口视频数 | 窗口均播 | 视频地区 |
|---|---:|---:|---|
| biblepoints | 14 | 548107.14 | US |
| justjules09 | 19 | 303426.32 | US |
| joechristianguy | 10 | 65104.30 | US |
| tinglunsuu | 13 | 147215.38 | US |

判定分布：搜索简介无邮箱242、已查主页无Bio邮箱41、均播不达标12、窗口无合格视频5、最新视频地区不符3、受众管理导致不可核验1、已确认4。主题按本次宽关键词bible/christian匹配，最终名单仍供人工内容复核。

主页挂链23位present、43位unknown。unknown未冒充none。前20“已检查”与“挂链状态明确”不同：两个词分别有8/7位前20挂链状态明确，其余已访问但字段证据不足，结果继续保留unknown。

## 真实触发及修复

1. **403重新加载**：5个视频详情页共点击52次，每次均等待后点击页面按钮；分组次数19、12、9、7、5，均恢复200后自动停止。最短观测点击间隔10.259秒。未使用网址刷新替代按钮；最多30次耗尽暂停本轮未触发，仍由已有测试覆盖。
2. **主页作品翻页正文失败**：mrsirmafabro在采集第8批已存作品后遇到response_body_unavailable，先按原设计暂停。页面正常，未跳过缺页计算。`post-body-recovery.mjs`一次性归档8批旧证据，在同一p1重放当前账号作品，最终15批、窗口201条视频、均播1017.57，完整覆盖后排除。恢复次数最多1次，403/控制权错误直接传递；3项独立断言及原profile回归通过。同一恢复函数已提升到模块post-body-recovery.mjs并接入createEgoBrowser，统一find.mjs默认入口可复用。成功响应清除旧失败标记，避免恢复后误触发第二次补采；挂链未知触发主页重核时保留已有视频403次数及正文重放预算。接线和预算新增3项Red/Green验证；未再开启第三个真实批次。
3. **点开头用户名**：旧search.mergeCandidates的首字符正则误丢`..liezel4`（bible第23）和`.2636628`（christian第14），导致前20错位。先以失败测试复现“查了第3位替掉第2位”，再允许原生点开头用户名，仍拒绝路径分隔符。暂停并在无writer锁时以SHA256守卫修正本批记录：队列306→308，保留217条已核验结果、4位收录、59份采集快照和固定窗口，按原响应重建两词authorOrder及排名；补查真实第14位。最终审计无漏记、无前20错位。修正前快照与具体差异在native-order-repair/。
4. **观众管理与全站登录分开**：kickinwithchristian公开页面明确显示“该创作者启用了观众管理功能”，hydration.statusCode=209002，资料不可见。新增严格匹配该状态码与目标主页的分支，记单账号data_incomplete并继续其他作者；普通登录提示仍暂停。未要求用户登录、未绕过受限页面，也未把不可读Bio算为空邮箱。
5. **主表可读性**：真实长文案让旧收录依据撑出很高的行。主表L列改为内容来源、Bio邮箱、完整窗口均播、视频地区、挂链和判定的简要逐项依据；完整原文/链接仍在主页证据、视频证据及results.json，筛选结论不变。原始长依据版归档到artifact-before-summary/。

运行维护说明：Ego当前Node服务PID可被多次调用共享，不能杀共享Node进程来终止单次采集；客户端SIGINT也没有停止浏览器内脚本。本轮未杀共享服务，使用可恢复的本批日志写入故障让当前检查落盘后退出，并确认runtimeRunning=false且锁已清除后才修正排名。原日志已恢复，维护原因和备份均保留。统一入口的明确停止信号仍是后续完善项，不能把PID活着等同于某一轮仍在执行。

## 测试、复算与代码Review

先Red再Green：用户名2项失败、观众管理1项失败（普通登录保护用例通过）、主表依据过长1项失败、默认恢复接线/旧标记清除2项失败、跨阶段预算保留1项失败；对应修复后全量验证：

```bash
node --test scripts/tiktok-finder/*.test.mjs scripts/tiktok-browser/access.test.mjs scripts/tiktok-search/search.test.mjs scripts/tiktok-video-region/region.test.mjs runs/2026-10-21-ai-keywords-round-1-us-100/recheck-cache.test.mjs
# 166 passed, 0 failed（模块100、相关回归66，补采测试已归入模块）

node runs/2026-10-22-bible-christian-n20-live/audit-live.mjs
# auditPassed=true, findings=[], completed=true
```

真实证据复算独立从capture.pages去重、按固定时间边界/公开视频条件重算4位样本、总播放和均播，未调用生产analyzePosts计算期望值；与结果一致。逐词原始响应作者顺序与最终authorOrder逐项一致，前20都有真实检查及相符rank。导出后另查XLSX XML：4行长ID为文本，D/E/F公式及缓存值一致，摘要和完整来源保持分开。已检查三页预览；Artifact预览可能将文本长ID显示为科学记数法，文件原值未损坏，原生Excel未打开验证。

Brainstorming需求评审：原设计已完成，流程图已确认。本轮新增内容均为原有排序、数据门槛、证据和可读性要求内的明确修正，未放宽选人条件。

代码Review：已完成（Brainstorming bounded只读实现Review）。范围：search候选合并及调用者、browser账号限制/登录保护、profile强制重核时的预算保留、export摘要与公式依赖、模块一次性补采和本批守卫修正、相关测试和真实证据。输出为阻塞/高优缺口、自动修复与复验；停止条件为修复不扩大范围、无数据损失、前20恢复正确且无未处理阻塞。修复后再次只读核对，未发现剩余阻塞，166/166及真实审计复验通过。

独立Reviewer/PR Review：未做。主助手Review不等于独立审查；没有调用review-agent或另开Agent。独立creator-finder无Git元数据，未在CRM仓库提交/合入。

## 未覆盖与下一步

本轮跨词重复作者biblicalcuriositytv无邮箱，验证了队列去重，但没有触发“同一有邮箱主页跨词复用”的真实样本；该分支仍以离线测试为证。本轮也未实际触发30次按钮全部失败。正文补采已整合统一入口；可选后续完善项是提供明确的CLI停止请求。现有Ego控制权暂停仍保留，不把客户端SIGINT当作浏览器执行已终止的证据。

结果：`runs/2026-10-22-bible-christian-n20-live/outputs/TikTok-达人查找结果.xlsx`。审计：live-acceptance.json、artifact-verification.json、final-tests.log。未自动增加新关键词或恢复原22位任务。
