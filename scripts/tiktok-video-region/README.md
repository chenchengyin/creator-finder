# TikTok 视频地区字段读取

使用 Ego Lite，从已核验作者主页的最新发布作品读取 `locationCreated`。默认一条，也支持三条一致性核对。模块和命令行都可复用，不依赖本次采集目录，也不需要安装第三方 Node 包。

## 运行

需要 Node.js 22+、可用的 `ego-browser` 命令，以及 Agent 当前控制的已有 Ego 空间。空间由用户接管或暂停时，脚本拒绝操作，不自动创建或接管空间。

```bash
node /Users/vb/Projects/creator-finder/scripts/tiktok-video-region/read-region.mjs \
  --space 328 \
  --profile /绝对路径/profile-账号.json \
  --output /绝对路径/regions/账号.json \
  --limit 1
```

把 `--limit 1` 改成 `--limit 3` 可核对三条。加 `--dry-run` 只检查输入并列出目标作品，完全不调用浏览器。`--help` 查看参数。

`--profile` 使用现有采集器保存的 JSON，必须包含：

- `profile.authorId`、`profile.username`、`profile.capturedAt`、`identityVerified: true`、`latestOrderConfirmed: true`。
- `pages[].statusCode: 0` 和 `pages[].items[]`。
- 每条作品的字符串 `id`、字符串 `authorId`、`username`、秒级整数 `createdAt`、TikTok `url`。可带 `pinned`、`privateItem`、`mediaType`、`locationCreated`、`capturedAt`。

目标作品是**该份主页快照中**按发布时间排序的最新公开视频。旧快照不会冒充实时主页：结果单独保存 `selectionSnapshotAt`。需实时最新作品时，先正常刷新并采集主页，再运行。置顶位置不参与排序；发布时间确实最新的置顶视频仍可入选。私密作品和可识别的图文作品不入选。

## 结果

每条观察保留作者 ID、账号、作品 ID、视频链接、发布时间、采集时间、来源路径、`rawValue` 和规范化 `regionCode`。只存这些选定字段，不保存 Cookie 或完整响应。

字段来源优先使用正常主页作品列表响应中的同名 `itemList[].locationCreated`，这样不增加详情访问。列表中没有可用值时，才正常打开该作品详情页，读取：

```text
__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct.locationCreated
```

只读取视频对象；不使用 `webapp.app-context.region`、语言、邮箱域名或 CDN 域名推断。

`summary.status`：

| 状态 | 含义 |
|---|---|
| `single_video` | 要求一条，成功读取一条 |
| `recent_videos_consistent` | 要求三条，三条均成功且一致 |
| `conflicting` | 已读到不同地区代码 |
| `incomplete` | 字段缺失、作品不足或访问中断 |

只有完整读取所要求数量且结果一致，汇总才提供 `regionCode`。每条证据始终保留，便于人工复核。字段仅表示观察到的视频地区值，**不代表已核验本人现居地、国籍或受众国家**。表格可标为“美国（最新视频地区字段）”，不能写成“已确认现居美国”。

默认复用输入目录中的 `last-tiktok-nav.txt`，与现有采集器共用至少 10.5 秒访问间隔；串行使用同一空间。视频详情页遇普通403时，等待11秒后执行原址恢复一次。若错误页快照确认 `HTTP ERROR 403` 或 Ego 的 `ERR_BLOCKED_BY_CLIENT`，且页面有可见的“重新加载”按钮，则每次等待至少10秒后点击一次，累计最多30次；每次点击后检查页面，视频恢复就结束，出现验证码/登录提示或按钮消失就停止，页面显示“Please wait”则等待5秒并复查。调用方对每次浏览器动作仍至少间隔10.5秒。没有可见按钮时按原址规则恢复；仍失败就保存并停止。401/429或验证码直接停止并交还用户。普通登录提示暂停供检查，不直接宣称强制登录；身份不符、异常页面或控制权丢失均不继续下一条。

命令正常结束返回退出码 0；采集因访问保护或异常中断时，保存报告并返回 3；参数或空间控制权检查失败返回 1。脚本不自动解决验证。恢复已有403断点时可加 `--resume-403`：普通403只使用一次延迟原址恢复；若当前地区详情页仍是有可见按钮的支持错误页，则可走最多30次按钮点击流程。目标视频已正常打开时直接读字段，避免重复导航。`ERR_BLOCKED_BY_CLIENT`（Ego拦截页）不当作TikTok HTTP403；按钮恢复若未改变页面则保存断点并停止，不绕过拦截。

## 作为模块接入

```js
import {collectVideoRegions} from '/Users/vb/Projects/creator-finder/scripts/tiktok-video-region/region.mjs';
const report = await collectVideoRegions({
  page,                 // 现有 Ego Page
  capture,              // 已核验主页快照
  limit: 1,
  beforeNavigate,        // 调用方维持同一空间的访问节奏
  save: async report => { /* 按账号保存 JSON */ }
});
```

模块只负责读取和生成结果；调用方必须处理 `stopped`、保存主任务状态，并在真实访问保护出现时停止任务及 `task.handOff()`。本次 `collect-profiles.ego.mjs` 已接入：新达标账号自动保存 `regions/<账号>.json`，同时附在该账号的 `videoRegion` 中。它不会把地区字段冒充原有所在地认证，也不会自动修改历史 31 位账号的地区。

## 验证

```bash
node --test /Users/vb/Projects/creator-finder/scripts/tiktok-video-region/region.test.mjs
```

测试使用离线模拟页面与捕获结构。真实在线批量可用率尚未验收。`djhuntsofficial`的HTTP403和`mylifeintwocountries`的HTTP403页面在实际点击可见“重新加载”后恢复，分别读取到US和NL地区字段。Ego拦截错误`ERR_BLOCKED_BY_CLIENT`有一次在等待11秒后第4次点击时恢复；另一次等待11秒后点按5次仍未恢复。随后脚本规则更新为最多10次，并以离线测试验证；尚无真实运行证据证明十次完整自动化流程可恢复。不能据此保证所有403或浏览器拦截页都能恢复。
