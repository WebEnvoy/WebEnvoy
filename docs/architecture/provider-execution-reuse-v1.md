# Provider 执行复用设计 V1

- 文档性质：规范性实施设计；包含本文件的 docs PR 经独立审查合并后生效。
- 版本：1.1；日期：2026-09-14。
- Owner：Harbor Runtime；产品归口：[#497](https://github.com/WebEnvoy/WebEnvoy/issues/497)。
- 当前交付：[#528](https://github.com/WebEnvoy/WebEnvoy/issues/528)；实现 PR：[#530](https://github.com/WebEnvoy/WebEnvoy/pull/530)；关联 #471、#474、#477、#482。
- 产品依据：[canonical v1.5](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)。
- 架构依据：[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)、[Runtime Capability Plane](runtime-capability-plane.md)。
- 本文不宣称 Chrome 已通过资格门，不新增公共操作、权限或十二类能力要求；实现、当前支持和证据由 #528／#530／#497 记录。

## 1. 产品决定

**一套 WebEnvoy 能力，由不同 Provider 的适配执行；不是每个 Provider 建一套 WebEnvoy。** 用户切换所选 Provider 后，已有工具、授权、文件引用、任务页、接管与结果规则不另起一套。Provider 的真实差异保留，但尚未接入、尚未验证和上游确实不支持必须分开说明。

公共产品语义统一，并不自动证明实现已经共享。相同受支持自动化接口下可共用的执行代码必须真正抽取；不同协议可有独立适配，但不得复制 Core 授权、Harbor 资源/控制/材料及结果规则。兼容性证据按 Provider 单独取得，不因共用代码自动继承。

本轮只以现有 Camoufox 与官方 Chrome 为两个消费者，兑现已交付普通页面、标准文件、诊断与持续控制能力的复用；不是第三个 Provider、完整 Chrome V1 或通用 Driver 平台项目。

## 2. 已核对的基线与缺口

实现盘点基线：`19489f89108fd3b31d73ce987325339efc8b483c`。

| 当前位置 | 来源事实 | 本轮处理 |
| --- | --- | --- |
| `packages/core/src/managed-browser.ts` | 共同授权、Run、查询与结果边界 | 保留；只做实际需要的适用性调整，不分 Provider 复制 |
| `services/harbor/packages/runtime-api/src/runtime-session.ts` | 共同 Page、ControlLease、可信回调、派发和恢复 | 保留现有 owner，接入同一结果/引用规则 |
| `camoufox-upstream-driver.py/.ts` | 已包含页面、输入、等待、文件、诊断和 #526 async 生命周期，也混有 Camoufox 来源、环境与启动 | 将通用执行部分提取，特有部分保留为适配器 |
| `local-provider-launcher.ts` | 按 binding 选程序；Camoufox 接通新回调，其他路径在 `profile_management` 上仍直接拒绝，并保留历史 CDP/站点逻辑 | 为已通过资格的 Chrome 接通共同执行路径，不简单删除拒绝条件 |
| #516／#519／#523／#526 | 分别证明选择绑定、原版任务页、文件切片和持续运行 | 保留既有结论；本轮按受影响范围回归，不重开原任务 |

上述是当前盘点，不把它写成永久 Provider 差异。使用同一工具名、复制一个类或将文件改成通用名称，均不能单独证明复用完成。

## 3. 三层复用边界

| 层 | 只维护一份的内容 | 不在本层承担的内容 |
| --- | --- | --- |
| 产品与资源 owner | Core 的 Principal/Grant/Run/幂等/结果；Harbor 的 Profile/Page/ControlLease/材料；Plugin 调用与投影 | 浏览器原生实现、第二套按品牌授权 |
| 共享执行实现 | 当前公开 Playwright API 上的 Page/目标观察、输入/等待、受管请求保护、既有诊断、标准上传下载、队列与生命周期处理、事实转换 | Camoufox SDK/pin/properties、品牌安装查找、私有指纹生成、站点规则 |
| Provider 适配器 | 已验证程序、版本来源、公开启动配置、持久 Context 创建、原生环境材料与有证据的差异 | 通用上传/下载/点击/查询的复制实现，任意脚本或绕过授权的入口 |

这不是新增服务或跨仓包。代码仍位于 Harbor `runtime-api` 内，继续消费既有 `LocalProviderLaunchInput` / `LocalProviderLaunchResult`、可信操作回调和正式调用链。内部文件组织由实施者按实际模块依赖完成，不得形成并行 Runtime。

**共享代码不共享运行现场。** 每个 Instance 各自持有进程、owning event loop、Context、Page 引用、队列、临时材料和关闭状态；不得把两种 Provider 放进一个可互相污染的 Context、权限集合或全局当前页。

## 4. 本轮固定的接入路线

### 4.1 共享执行核心

从已交付 async Driver 抽取共同 Python 执行与 TypeScript JSONL 适配。保留一个 owning event loop、普通命令有界串行、独立 close/EOF 生命周期、下载取消及清理屏障。普通动作、事件处理和 owner 控制仍按 #526 的边界工作，不重新设计调度系统。

共同模块不得直接导入 Camoufox SDK 或依赖 Camoufox properties、原包摘要、环境 bundle、专用环境变量。选择适配器由可信启动输入和固定内部映射完成；不接受 Agent 提供模块名、程序路径、调试端点或执行后端选择。

### 4.2 Camoufox 适配器

保留当前官方来源、版本、properties 和完整配置检查；经现有公开配置生成路径启动 Firefox persistent Context，精确复用已有 `launch_options` / `context_options` 与私有环境材料。不得为了抽取而改变 schema、重新随机设备身份、删除校验或丢失 pending/effective 语义。

当前固定组合继续为 Camoufox Python `0.5.6`、browser `152.0.4-beta.30`、Playwright `1.60.0`。旧 native/legacy/patched binding 继续拒绝。现有 Camoufox 环境读取和配置行为必须保留，不能以“现在变成通用实现”为理由降级。

### 4.3 官方 Chrome 适配器

使用同一已安装 Python/Playwright 运行资产，通过公开 `playwright.chromium.launch_persistent_context` 启动 **该 Profile binding 所指向、由 owner 验证的官方 Chrome executable** 与受管 user-data-dir。不以通用 `channel` 解析偷偷换程序，不自动安装 bundled Chromium，不接管用户默认或日常 Profile。

Chrome `152.0.7977.84` 仅是 #516 的历史核对线索。G0 必须记录本机现有官方版本和来源；不同版本的证据不自动继承，不自动下载、升级、降级或换 Provider。Playwright 保持本任务固定版本。供应方文档存在该 API，不代表当前 Chrome/SDK 组合必然合格。

截至 2026-09-14，#530 对官方 Stable Chrome `153.0.8010.37`（macOS arm64）与固定 Playwright Python `1.60.0` 授予一次有界兼容资格核对授权，并且仅在候选1失败后，允许对候选2进行同样有界的资格核对/条件性考虑。该授权仅替代本段原有的“不得因候选核对而变更浏览器版本”的限制：候选必须使用 owner 已取得、隔离 executable/profile 和固定端口，且不得迁移或清理用户数据；它不授权正式 Runtime 自动更新、版本漂移、回退、换 Provider 或复用候选证据，也不把候选2的条件性考虑视为支持资格。

候选 run 1 的下载 bytes/hash、localStorage marker、唯一 PID 和正常 Context close 均通过；run 2 的 bytes/hash、marker 与正常 close 仍通过，但发现一个与 `153.0.8010.37` 隔离 executable/profile 关联的新 Crashpad dump（仅记录脱敏文件名摘要 `049a0b34…ac2a`）。这违反 crash-free 资格门，候选立即标为 blocked，run 3 不执行；不得用另一个版本、旧 CDP/站点路径或关闭保护制造通过。候选资格核对失败不改变下方共享实现、数据、guard、无 fallback 和不接管日常 Profile 的约束。

候选1失败后，候选2仅完成资料层面的条件性考虑，因不满足执行资格而未进入安装或运行：现有 Playwright Python 共享实现没有正式的 Python/Chrome 153 配对依据（PyPI Python `1.62.0` 的正式配对仍对应 Chrome 151；通用 Playwright `1.63` 材料虽列 Chrome 153，但不提供当前 Python 实现所需的正式配对）。因此候选2不能替代固定 Python `1.60.0` 实现，也不能解除本节的暂停门。

Chrome 自有运行不得要求 Camoufox 程序、配置、pin/properties 或 bundle。可使用同一已安装 Python 运行包，不要求为证明隔离而卸载其中的 Camoufox wheel；但 Chrome 启动模块不得导入该 SDK，也不得因 Camoufox 专用资料缺失而失败。

### 4.4 旧 Chromium/CDP 路径

当前历史站点操作和其显式 scope 保留，不在本任务整仓迁移。新的通用 Chrome `profile_management` 和由该实例执行的 Page/Files/诊断必须进入共享实现；失败时明确拒绝，不切到旧站点/CDP路径，不在 Agent 工具中新增 Chrome 专属替代操作。

不把“没有 CDP”当成目标；不同协议适配仍是允许工作。本轮不选 `connect_over_cdp` 作为新共同路径，也不在 persistent-context 路径失败后自动换协议。相同 Profile 只能由其现行管理入口持有，两个后端不能并发写入同一目录。既有 Instance 不热换后端。

## 5. 必须保留的不变量

### 5.1 选择、数据与配置

本次显式选择、用户新建默认、固定模板、Profile binding、内部执行后端分别处理。`camoufox` 与 `chrome_official` 的身份不改，不新增名为 Playwright 的 Provider。bind 后的程序解析、Provider 分类和最终启动必须一致服从可信 binding；请求级 Provider/path 冲突在 spawn 前拒绝，无 fallback。

不能把全局 Camoufox 配置清掉或为 Chrome 换另一套 Runtime来制造“共存”。不能将 Camoufox 私有指纹材料传给 Chrome；Chrome 只沿其已有 Profile 配置和公开接口应用适用语言、时区、窗口、代理等设置。已配置但无法支持的设置须在派发前准确报告，不静默忽略。未验证代理出口、geo、指纹等不在本项中新增完整承诺。

提取不迁移日常数据、账号绑定、Run 或材料。正常测试使用专用无账号 Profile；已有非空目录的兼容性通过专用合成数据核验，不用清目录或复制登录态代替恢复。

### 5.2 保护与结果

保留 Profile ceiling、单个 Grant、task scope 与 Runtime 条件的交集；工具可见或适配器存在都不授予权限。页面请求保护在受管外部导航前建立，redirect 逐跳验证；观察调用不扩大已有 scope。页面不可归属时局部拒绝，不按 URL、标题、事件先后或最后点击猜测。

共享实现必须保留 Page/document/observation/control 代次与实际目标核验。原生可选焦点未知不影响可信 Page；原生坐标输入仍需正确窗口对应。接管不是换页、重开或复制现场，交还后重新观察；已派发 unknown 只能 query/reconcile，不重新点击、上传或下载。

文件继续消费 [Files V1](../specs/browser-files-v1.md) 的 owner 不可变副本、`file_scope`、格式/大小/配额/期限、目标有效性、下载归属、取消清理、持久材料与结果分层。不得新建 Chrome 文件库。下载或 SDK 调用仍使用公开取消/关闭手段，不将取消 asyncio task 当作撤销浏览器效果。

### 5.3 安装与兼容

安装包必须包含共享模块和两种适配器及各自来源说明，禁止从 checkout 或未登记路径补缺。既有 `HARBOR_CAMOUFOX_*` 输入只属于 Camoufox，不能变成 Chrome 依赖或允许 Agent 选后端的通道。

若私有 JSONL、安装 manifest 或配对字段改变，须在成为正式依赖前明确版本、严格 reader、旧版本拒绝和包内配对；不能新 TypeScript 配旧 Python 后静默失败。可以保留只做委派的旧 Camoufox入口兼容封装，但不得保留第二套操作实现或恢复旧补丁入口。需要新增持久字段时同步正式合同/schema，不凭架构文档直接写库。

## 6. 本批支持目标，不扩大十二类范围

两种 Provider 均通过同一执行路径覆盖以下 **已存在的切片**：

| 目标 | 本轮验收 | 不据此新增的范围 |
| --- | --- | --- |
| Instance/Page | 正式创建/启动/复用/停止；明确 A/B；list/open/任务页选择/close；普通导航/刷新/历史/redirect | 原生窗口一致性、任意搬页、全部 popup |
| 观察与交互 | 既有有界 snapshot/read、click/input/press/scroll/wait 与 stale 拒绝 | 多行输入扩围、select/drag-drop新实现、富文本/frame全覆盖 |
| 诊断 | 现有 Network/Console 元数据、脱敏、Page/document/cursor 对应 | response body、HAR、请求改写、无限历史 |
| 文件 | #523 标准单文件上传、网页receipt、同页HTTP(S) GET下载、owner inspect/export | 新文件格式或大小、多文件、特殊导出、系统dialog |
| 持续性与控制 | #526 空闲completion、人工持有拒绝、交还fresh observe、在途wait的revoke/handoff/stop | SLA、长期压力、offscreen稳定输入 |
| 环境与持久性 | 各自binding/受管配置/合成存储保持；Camoufox环境能力不回归 | 两个Provider指纹能力相同、真实登录迁移 |

现有 screenshot 等内部回调在抽取中不丢失，沿既有接口回归；不新增截图 MCP、画面保留策略或 Viewer 工作台。新缺口仍归原 FR，不让复制型实现消耗本项后继续扩围。

## 7. 最早的三个资格门

在完整抽取、全量审查、打包和真实 Agent前，先验证最可能推翻本路线的条件。基线可以使用现有受信任客户端与有界 spike；最终必须进入正式安装链。

**G0-A：接入/依赖/共存。** 两个专用 Profile 使用各自程序和 persistent Context；同一 Runtime安装级 Camoufox 配置不影响 Chrome。Chrome专用样本移除Camoufox配置/来源/properties后仍可启动；相同缺失对Camoufox仍准确拒绝。核对实际executable、目录和初始请求保护，不能只看catalog。

**G0-B：文件/归属/保护。** 同一脚本分别在两种Provider原页上传生成PNG，核对服务端hash；从同页普通链接下载CSV、关闭Context后检查保留结果hash。guard始终启用，未授权direct/redirect请求计数为零；无可信Page归属仍拒绝，不能按首个下载事件认领。

**G0-C：事件/控制。** 复用#526方法：一次动作返回后10秒无read/snapshot/保活，页面1秒延迟任务及completion自然完成；在途wait时验证owner控制通道。1秒/10秒为测试参数，不是SLA。原生UI与真人分开记载，不以Provider click冒充静默期人工操作。

对于本来已经是当前Camoufox正式基线的能力，先确认现有证据适用，避免为开工重复全部G0；完成抽取后仍须双Provider安装复验。G0-A的跨Provider组合及Chrome的G0-B/C必须先实际执行，不能靠旧Camoufox证据跳过。

三门通过后连续实现，无需逐内部步骤重新请批。WebEnvoy适配错误在同一WI修复；新假设才继续试验。需要改上游、变更依赖/Provider、放宽权限或改变用户结果时暂停受影响部分并保留首反例，不用另一个协议或较小范围制造通过。

## 8. 复用的证明与测试顺序

先形成一张本WI内的迁移对应表：原函数/责任 → 共同实现 → 保留的适配差异 → 同一套回归。它不是另一状态台账。共同模块的操作逻辑不得按品牌分叉；必要引擎差异通过窄且可测的适配钩子表达，逐项解释依据，不能将整个文件/网络/控制流程委派回品牌模块。

| 原函数/责任 | 共同实现 | adapter 保留差异 | 共同回归 |
| --- | --- | --- | --- |
| JSONL 请求、Page/文档归属、观察、交互、等待与 lifecycle | `playwright_shared_driver.py`、`playwright-shared-driver.ts` | 仅提供启动工厂、程序路径、资格 facts | `playwright-shared-driver.test.ts` 的同一参数化工厂 |
| 首次请求前 guard、逐跳 redirect 检查、Network/Console metadata | `playwright_shared_driver.py` | 无品牌分叉 | Camoufox 既有请求保护测试与双 Provider G0 |
| 上传、下载归属、hash、迟到结果与清理屏障 | `playwright_shared_driver.py` | 无品牌分叉 | Camoufox 既有文件反例测试与双 Provider G0 |
| persistent Context 创建与环境应用 | 共享生命周期调用 adapter `prepare` | Camoufox 保留来源/pin/properties、完整 bundle/exact replay 和 Firefox 创建；Chrome 仅绑定的官方 executable、受管目录及 Chromium 公开 API | 同一工厂回归加各 Provider 资格拒绝测试 |

一套确定性测试按Provider/启动工厂参数化运行，预先覆盖：全局路径污染、请求与binding冲突、旧绑定拒绝、Camoufox依赖泄漏、同名同址目标、scope收窄、撤销/代次、无关下载、文件取消/超限/迟到结果和不重放。不靠两份复制测试证明共享；不按品牌删除困难断言。

运行代码冻结后构建一份支持两种适配器的正式安装。确定性安装客户端证明多页与metadata、文件失败恢复、10秒静默、原生UI接管交还、三种在途控制、P1不影响P2、正常重开和Runtime重启后的binding/材料/Run保持。

真实Codex按相同任务模板分别消费两种Provider各一次：原页观察与普通输入 → PNG上传并回读receipt → CSV下载与原结果查询。只替换Provider/Profile/获准引用，不给品牌专用selector、脚本或操作。故障矩阵和精准时序不塞给模型；首次非预期结果交实施者定位，修后只重验受影响范围。

共用源码的改动只维护一次、共同测试只定义一次；真实Provider/配置/版本/安装/Agent证据仍分别记录。后续在同一公共API家族增加Provider，应主要新增/调整适配、资格事实和参数，不重新定义用户工具与整套执行逻辑。不同协议仍需必要Driver映射，但不能复制产品owner。

## 9. 完成门与实施后投影

仅有抽象代码、品牌改名、Chrome能启动或CI通过，都不能完成#528。必须共同满足：实际共享模块、双Provider上述正式路径、Camoufox不回归、一套参数化回归、真实Agent分别消费、关键拒绝/恢复/连续性和最终exact-head独立审查/安装身份回读。

按照既有事实结构分别表示：公共能力已定义、该适配是否实现、原生支持限制、当前配置是否可执行、当前是否授权、哪个版本经过何种验证。缺适配写为WebEnvoy接入缺口，待验写为待验；只有有证据的上游限制才能归为Provider限制。不为这组解释预建一个新的公共enum/数据库。

合并前更新#497的当前能力行及#474正式支持范围，#471保留Provider/环境资格边界；只回写实际结果，不宣称完整Runtime/Chrome/Files/Dialog/V1完成。#516保持已完成。#510/#521和真实身份任务不因本项关闭而自动完成或被取消。

## 10. 设计义务

| Trigger | 本实现任务判定 | Artifact/边界 |
| --- | --- | --- |
| DO-PLUGIN-EXPOSURE | triggered | 更新现有Plugin合同的Chrome支持投影和availability；工具及公共参数不另建一套 |
| DO-GRANT-WIRE | not-triggered | 复用既有Grant/file_scope，无新维度；真正必须变化时先说明影响，不暗扩权 |
| DO-NETWORK-CONTRACT | conditional | 纯实现迁移保持当前payload；若公共归属/事件/生命周期变化则同步正式合同 |
| DO-CONSOLE-CONTRACT | conditional | 同上，若公共结构或生命周期变化则同步正式合同 |
| DO-PROVIDER-PRIVATE-SCHEMA | conditional | 新Chrome来源/安装配对持久字段，或既有bundle/启动结构改变时须先冻结规格/schema/兼容 |
| DO-APP-IA | not-triggered | 复用最小owner/接管，不增加完整工作台 |

本docs PR只冻结设计，不改schema、运行代码或支持状态。实现PR必须再按真实变更回读以上义务，不能把本表当成跳过正式合同的许可。

## 11. 明确非目标与停止条件

不恢复浏览器/Playwright私有改写，不新增Provider marketplace、远程浏览器、自动更新平台、站点知识迁移或完整App；不新增第三个Provider、账号绑定/登录/交易、不使用日常Profile，不扩Files/Dialog/多行/frame/跨窗/popup成功/offscreen。

本轮批准路线是现有正式程序的公开persistent-context适配。若该组合不能在既定安全条件下完成范围，保留未完成状态和可核对反例，不退回“每品牌复制一份”、关闭保护或换浏览器。#530 的新 Crashpad 反例触发候选暂停门：在重新取得 owner 授权、固定来源和独立兼容证据前，不得继续候选 run、把 Chrome 标为可支持，或以候选 2 补齐现有 Python 共享实现；候选2的条件性考虑不会绕过该暂停门。架构要求是代码复用，不是让所有Provider原生能力完全相同。

## 12. 来源与证据边界

本轮脱敏的实现、G0 A/B/C 结果、首个信任边界反例和 #530 有界兼容资格结果见
[Provider execution reuse verification](../verification/provider-execution-reuse-v1.json)。该记录只
绑定版本与 SHA-256、证据角色和限制，不包含临时正文、Profile 数据、Crashpad dump 内容或 installed/live
Plugin 完成声明。

项目事实来源：本文件第2节列出的固定main源码，以及#516/#519/#523/#526和现行ADR0012/Runtime Capability Plane。以上支持“公共规则已存在、共同操作混在专用Driver、Chrome通用消费仍有缺口”，不支持“Chrome新路径已可用”。

供应方接口参考：

- [Playwright Python BrowserType](https://playwright.dev/python/docs/api/class-browsertype)：persistent Context与executable参数、CDP连接差异及兼容性提醒。
- [Playwright Python Library](https://playwright.dev/python/docs/library)：async接口、线程与取消约束。

这些是路线依据，不能替代固定SDK签名、本机原包、双Provider安全资格和installed验收。实际执行不得以文档最新版为理由更新固定依赖。
