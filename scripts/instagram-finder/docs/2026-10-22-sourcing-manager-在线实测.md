# sourcing manager 在线实测（浏览器保护暂停）

项目：/Users/vb/Projects/creator-finder_preview。运行：runs/2026-10-22-sourcing-manager-email-us-gb-500。独立Ego空间60，原任务/空间19未操作。

用户条件：精确普通关键词 sourcing manager；最多核验500位去重作者，或关键词原生结果耗尽；Instagram账户所在地US或GB；邮箱必须，可来自Bio/挂链；无均播要求。用户明确WhatsApp为软件联系入口，直接忽略。

## 当前已提交事实

2026-10-22 23:36（北京时间）保存并暂停。累计发现55位去重作者，已核验45位，已读取46位主页；4位邮箱与国家两项通过，34位条件不符，7位存在待复核项。另有1位执行中断、9位尚未开始。已核验作者中，15位有可采纳公开邮箱，15位国家符合US/GB。

搜索已完整处理2批结果，第三批仍在核验。未达到500位，未确认搜索耗尽；completionReason未设置，报告searchExhausted=false。

两项通过账号：

| 账号 | 账户所在地 | 公开邮箱 |
| --- | --- | --- |
| getacorporatejob | GB | katie@getacorporatejob.com |
| codiesanchez | US | support@contrarianthink.com |
| cindy_the_videorecruiter | US | cindy.hook@lsrecruiters.com |
| liljehu_ | US | samwilson@viralnationtalent.com |

上述只表示邮箱与国家条件通过，岗位/内容语义仍待人工复核。报告qualifiedConfirmed=0、corePassedPendingContentReview=4与此一致。账户所在地不等同于常驻地。经纪/机构邮箱保持原始来源，可由用户进一步判断适用性。

## 当前暂停原因与边界

第46位marianna_cherry.cups.co的邮箱子任务访问https://www.pinterest.com.au/cherrycupsco/，p2导航15秒超时（2026-10-22T15:36:32.067Z）；后续page.evaluate再超时15秒，页面持续无响应，无法确认页面执行已经停止。父任务reason为browser_unavailable，父任务及邮箱子任务均已保存暂停。

采集命令已退出（ego nodejs报告exit code 3，外层CLI exit code 1），运行目录下无残留写锁。没有自动重试、刷新、关闭页面或再次接管控制。无法由本次故障认定出现验证码或限流；本次实际触发的是浏览器无响应保护。

父状态保留最后一次健康提交的作者进度，当前邮箱子任务单独保存至2026-10-22T15:36:47.590Z。执行中的作者不计入45位已核验数，恢复时应从同一断点处理。后续恢复前须先处理无响应页面，不能直接绕过保护重跑。

## 本次真实发现及处理

1. 入口此前只支持#词、单一国家、无作者上限。按本次用户条件增加普通关键词、countries多选、maxAuthors核验上限；Red4项→全量432项通过。上限结束与关键词耗尽分别记录，不伪造末页。
2. WhatsApp联系入口被当成普通网页，沿服务商页脚扩散。首位作者邮箱子任务发现70页、52待处理，主动交还控制并保存暂停。用户明确“WhatsApp是跳转软件联系的，忽略”。新增直接入口跳过、短链重定向跳过、恢复时停止其独占后代分支，原始证据/边保留；Red3项→全量435通过。恢复后真实验证该规则，首位国家为CN，被独立国家条件排除。
3. 第10位的作者挂载杂志链接正常可读，但普通新闻站文章标题中的business/management/collaboration被误当联系线索，违反既定不整站爬取范围。收紧普通网页出链，按不可变页面快照重核旧队列，保留真实联系页及独立有效路径；Red2项→全量437通过。本轮恢复已在线清理14条无关分支并完成该作者，邮箱通过、国家IN不符。
4. 恢复时遇task.listTabs控制权保护，只读元数据确认ownership实际为agentDelegatedToUser，入口先前未识别该枚举。新增明确--resume时使用takeOverTaskSpace的分支及CLI透传；Red1项→全量438通过。用户明确“继续”后，本轮在原空间60成功恢复并继续核验至45位，接口已在线验证。

本轮恢复未修改代码；最近全量438项测试通过。没有发邮件、没有提交表单、没有采集均播。

## 证据与交付

本对话work/sourcing-manager-20261022：配置、run.log、resume-01.log、resume-02.log、resume-03.log、修正前子断点备份、报告适配脚本。

本对话work：online-scope-red/green、whatsapp-ignore-red/green、contact-scope-red/green、delegated-resume-red、online-final-regression.log。

本对话outputs：instagram-sourcing-manager-us-gb.html/.json/.csv、instagram-sourcing-manager-progress.json、sourcing-manager-实测状态.txt。

父任务execution-state.json、results.json、results.csv以及authors/各authorId/email/内子任务断点和页面证据保存在本次运行目录；动作证据为actions.jsonl。

报告只从本次已提交状态映射，Bio与挂链来源分开，原始来源URL/原文/路径保留；当前作者的邮箱展示可读取单独提交的子任务结果，但不将其计入已完成核验数。未进行HTML浏览器视觉验收。完成条件邮箱/国家通过与岗位语义人工复核分开，不把关键词命中当作岗位真实性证明。
