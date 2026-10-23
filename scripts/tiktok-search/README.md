# TikTok 关键词搜索与候选队列

可复用搜索部件：正常打开 TikTok 视频搜索，分批滚动，读取页面正常产生的公开搜索响应，按作者ID去重，保留简介提示、作品文案、来源链接和游标。它输出候选，不将搜索命中或搜索摘要邮箱当成最终合格结果。后续仍须核验当前主页邮箱、完整窗口均播、内容方向和地区。

## 用法

需要 Node.js 22+、已安装的 `ego-browser` 和 Agent 当前控制的已有空间。下面328/p3是本次运行示例；328已在本批完成时关闭。新任务需由主助手按Ego流程创建一次空间，并把实际空间编号及页面标签传入。脚本不会擅自创建或接管空间。

```bash
node /Users/vb/Projects/creator-finder/scripts/tiktok-search/search.mjs \
  --space 328 --page p3 \
  --keyword 'christian skits' \
  --run-dir /Users/vb/Projects/creator-finder/runs/2026-10-21-christian-skits-us-5 \
  --batches 1
```

上面是从搜索入口开始。原搜索页仍停留在同一关键词时，追加 `--continue`，从当前位置滚动，避免重复加载第一页。`--batches` 默认1，可设1至50；按需取一批，候选不足再继续。`--dry-run` 只显示参数和搜索URL，不写文件、不调用浏览器；`--help` 查看参数。

换关键词应使用新的批次目录，或由明确包含该关键词的任务配置管理，不能把不同任务混写。此单词部件当前仍有“已达目标则返回”的旧默认；它与下面新多词调度的全词完成规则不同，接入新入口时须明确关闭该提前返回，保留旧调用兼容。

## 多关键词通用入口（已实现，在线待验收）

用户要求新入口接收有序关键词数组，一个词搜索完并完成对应候选筛选后，才搜索下一个，直至最后一个；中途达到人数也继续。跨词按稳定作者ID去重、合并来源和新证据，复用已采邮箱/作品/地区；每词保存独立断点，访问异常暂停而非跳词。

此处现有CLI仍只支持单个 `--keyword`，重复传入会覆盖前值，不能当作多关键词入口使用。完整调度的[设计](../tiktok-finder/docs/2026-10-21-多关键词顺序查找-设计.md)、[测试用例](../tiktok-finder/docs/2026-10-21-多关键词顺序查找-测试用例.md)和[实现计划](../tiktok-finder/docs/2026-10-21-多关键词顺序查找-实现计划.md)已建立，流程图已由用户确认，通用入口已完成离线实现，见[模块用法](../tiktok-finder/README.md)。本轮未启动新网站采集。

## 保存的内容

- `candidate-queue.json`：候选、作者ID提示、当前处理状态和逐作品 `sourceEvidence`。重复搜索不清空已检查状态；同一作者改名时保留旧用户名，已知不同作者ID不会合并。
- `tiktok-video-discovery.jsonl`：每批选定的公开字段、游标及是否还有结果。
- `access-attempts.jsonl`：正常导航和重试的地址、HTTP结果、时间和错误。
- `execution-state.json`：更新候选数、搜索游标、是否真正耗尽、停止原因和运行状态，保留原有选人条件及其他阶段计数。

搜索页由正常导航和滚动触发 `/api/search/item/full/`；脚本被动读取这些已发生的响应，不生成签名、不重放私有请求、不保存Cookie或完整响应。

## 403 单次重试

按用户2026-10-21的明确要求：普通HTTP403在同一空间、同一页面、同一URL等待11秒后重试一次。文档导航与其搜索响应共用本批重试预算，第二次仍403立即保存并暂停，不开始第三次。其他401/429、验证码、登录提示和控制权丢失不会进入这个重试分支。

2026-10-21后续Review发现，上述规则尚有调用层缺陷：页面429或同批API401/429与另一条API403同时出现时，现有代码仍可能进入403重试。另有部分响应读取失败却exhausted=true、响应未核对当前关键词的问题。详见[脚本流程Review](../tiktok-finder/docs/2026-10-21-脚本操作流程Review.md)；这三项已有直接回归用例并已修复，详见[开发验证与实现Review](../tiktok-finder/docs/2026-10-21-开发验证与实现Review.md)。旧批次片段保留原状，新的全流程使用tiktok-finder。

HTTP403恢复后可能返回搜索第一页，队列去重会保留已收集作者和证据。恢复进度仍依赖原页面自然滚动；保存游标供检查，不将其拼成额外后台请求。

启动前空间由用户控制时，主助手须先获得用户授权并恢复控制。脚本中途失去控制时退出，不能自行重新接管。

## 验证

```bash
node --test /Users/vb/Projects/creator-finder/scripts/tiktok-browser/access.test.mjs \
  /Users/vb/Projects/creator-finder/scripts/tiktok-search/search.test.mjs \
  /Users/vb/Projects/creator-finder/scripts/tiktok-video-region/region.test.mjs
```

测试覆盖公共字段筛选、作者去重/改名、状态保留、游标、真实文件写出、403预算、11秒等待和控制权中止；真实网站可用性另以本次现场运行结果记录，不用离线测试替代在线验收。
