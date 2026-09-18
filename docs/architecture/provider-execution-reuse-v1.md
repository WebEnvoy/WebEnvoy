# Provider 执行复用设计 V1

- 文档性质：规范性实施设计；包含本文件的 docs PR 经独立审查合并后生效。
- 版本：1.3；日期：2026-09-15。
- Owner：Harbor Runtime；产品归口：[#497](https://github.com/WebEnvoy/WebEnvoy/issues/497)。
- 当前交付：[#528](https://github.com/WebEnvoy/WebEnvoy/issues/528)、[#541](https://github.com/WebEnvoy/WebEnvoy/issues/541)、[#544](https://github.com/WebEnvoy/WebEnvoy/issues/544)；关联 #471、#474、#477、#482。
- 产品依据：[canonical 产品规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)。

> 2026-09-18 Proposed：S0 允许正式 Provider 在保持公共语义、Profile／Context／权限隔离和 owner facts 单一的前提下采用 Provider 特有优化。复用是降低维护成本的手段，不要求不同 Provider 内部实现完全相同；特有路径须提供语义、隐身质量和性能证据。该方向不预设直接 CDP 重写，也不改变本文件已记录的现行执行路径。
- 架构依据：[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)、[Runtime Capability Plane](runtime-capability-plane.md)。
- 本文不宣称 Chrome 已通过资格门，不新增公共操作、权限或十二类能力要求；实现、当前支持和证据由 #528／#541／#497 记录。

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

Chrome 的通用用户结果固定，启动／连接接口由资格证据决定。旧候选使用公开 `playwright.chromium.launch_persistent_context` 启动 **该 Profile binding 所指向、由 owner 验证的官方 Chrome executable** 与受管 user-data-dir；它保留为历史失败证据，不再是当前采用路线，也不得成为新路线失败后的 fallback。

2026-09-15 的新主候选是由 WebEnvoy 管理同一可信 executable、进程和受管 user-data-dir，再通过 Playwright Python 公开 `connect_over_cdp` 取得 default Context并交给共同执行实现。该候选必须证明 Agent 在授权、Page/控制归属和执行准备完成前不能派发操作，连接只属于任务管理的 loopback 端点，断连不冒充停止且正常停止会关闭确切进程；默认合同不再要求连接前的恢复页、Service Worker 或浏览器后台活动全部零联网。公开接口存在不等于资格通过。

Chrome 自有运行不得要求 Camoufox 程序、配置、pin/properties 或 bundle。可使用同一已安装 Python 运行包，不要求为证明隔离而卸载其中的 Camoufox wheel；但 Chrome 启动模块不得导入该 SDK，也不得因 Camoufox 专用资料缺失而失败。

### 4.4 旧 Chromium/CDP 路径

当前历史站点操作和其显式 scope 保留，不在本任务整仓迁移。新的通用 Chrome `profile_management` 和由该实例执行的 Page/Files/诊断必须进入共享实现；失败时明确拒绝，不切到旧站点/CDP路径，不在 Agent 工具中新增 Chrome 专属替代操作。

不同公开协议可以由窄适配器使用，但每个新 Instance 固定一种后端；失败时不自动切换，活动 Instance 不热换，相同 Profile 不并发写入。`connect_over_cdp` 只允许承担启动／连接差异，不能复制 raw CDP Page、Files、guard、诊断或恢复实现。

## 5. 必须保留的不变量

### 5.1 选择、数据与配置

本次显式选择、用户新建默认、固定模板、Profile binding、内部执行后端分别处理。`camoufox` 与 `chrome_official` 的身份不改，不新增名为 Playwright 的 Provider。bind 后的程序解析、Provider 分类和最终启动必须一致服从可信 binding；请求级 Provider/path 冲突在 spawn 前拒绝，无 fallback。

不能把全局 Camoufox 配置清掉或为 Chrome 换另一套 Runtime来制造“共存”。不能将 Camoufox 私有指纹材料传给 Chrome；Chrome 只沿其已有 Profile 配置和公开接口应用适用语言、时区、窗口、代理等设置。已配置但无法支持的设置须在派发前准确报告，不静默忽略。未验证代理出口、geo、指纹等不在本项中新增完整承诺。

提取不迁移日常数据、账号绑定、Run 或材料。正常测试使用专用无账号 Profile；已有非空目录的兼容性通过专用合成数据核验，不用清目录或复制登录态代替恢复。

### 5.2 保护与结果

保留 Profile ceiling、单个 Grant、task scope 与 Runtime 条件的交集；工具可见或适配器存在都不授予权限。Grant/Profile policy 的 `scope_semantics` 缺省为 `legacy_request_guard_v1`，首次转换为显式 `agent_operations_v2` 只能由 owner 对已停止 Profile 通过现有 receipt/transaction 一次确认生成，且 Instance 启动后固定；之后的 owner Grant 续发、重签和有效单 Profile 原子替换不要求停止，只有 v2 policy 调整仍要求可信 stopped。Agent/task 不能指定、切换或扩大它。legacy 页面请求保护在受管外部导航前建立并逐跳验证；v2 对显式导航仍做 pre-dispatch origin 检查，但普通资源、CDN 和 redirect 不依赖全局 route guard，合法 click 的自然越界保持 `dispatched`。v2 后续 observe/read/input 只返回脱敏 origin 与 opaque Page ref；观察调用不扩大已有 scope。页面不可归属时局部拒绝，不按 URL、标题、事件先后或最后点击猜测。

共享实现必须保留 Page/document/observation/control 代次与实际目标核验。原生可选焦点未知不影响可信 Page；原生坐标输入仍需正确窗口对应。接管不是换页、重开或复制现场，交还后重新观察；已派发 unknown 只能 query/reconcile，不重新点击、上传或下载。

文件继续消费 [Files V1](../specs/browser-files-v1.md) 的 owner 不可变副本、`file_scope`、格式/大小/配额/期限、目标有效性、下载归属、取消清理、持久材料与结果分层。不得新建 Chrome 文件库。下载或 SDK 调用仍使用公开取消/关闭手段，不将取消 asyncio task 当作撤销浏览器效果。

### 5.3 旧要求归位

| 旧要求 | 现行处理 | 规范与直接检查 |
| --- | --- | --- |
| `allowed_origins` 同时充当网页操作范围与全部请求白名单 | legacy 保留；v2 只控制 Agent 页面读取、操作和显式导航 | Grant v1.4、Page/Network 合同；显式导航 pre-dispatch 与自然越界脱敏测试 |
| 全局 route、offline、关闭 Service Worker 是所有 Provider 的默认准入 | 仅 legacy；增强全生命周期隔离后续独立规划 | 共享 Driver 启动测试断言 v2 不安装/设置这些条件 |
| download redirect/CDN 必须属于页面操作 origin | legacy 保留；v2 允许浏览器交付，但仍要求真实 Page/target/download 归属和文件校验 | Files/Network 合同与受管下载反例 |
| 撤权或断连等于整个浏览器立即断网/停止 | 移出默认承诺；只阻止新 Agent 派发并保留在途/unknown | lifecycle、Run、不重放与 stop 测试 |

### 5.4 安装与兼容

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

**G0-A：接入/依赖/共存。** 两个专用 Profile 使用各自程序和独立 Context；同一 Runtime安装级 Camoufox 配置不影响 Chrome。Chrome专用样本移除Camoufox配置/来源/properties后仍可启动；相同缺失对Camoufox仍准确拒绝。Chrome 外部受管启动候选须核对确切 executable、Profile、PID 和私有 loopback 端点；Agent 在 ready 前零派发，连接失败不发布可用 Instance，断连不冒充停止，正常 stop 关闭自己的进程并确认端点消失。默认资格不再要求全部恢复页、Service Worker、历史下载或后台活动零联网。

**G0-B：文件/归属/可靠性。** 同一脚本分别在两种Provider原页上传生成PNG并核对服务端hash；从同页普通链接下载CSV、关闭Context后检查保留结果hash。Chrome 使用同一无账号长期 Profile 三次独立启动，后两次直接读取原 marker，下载后页面仍可用且正常退出；无可信Page/target/download归属仍拒绝，不能按首个事件、文件名或系统下载目录认领。

**G0-C：事件/控制。** 复用#526方法：一次动作返回后10秒无read/snapshot/保活，页面1秒延迟任务及completion自然完成；在途wait时验证owner控制通道。1秒/10秒为测试参数，不是SLA。原生UI与真人分开记载，不以Provider click冒充静默期人工操作。

对于本来已经是当前Camoufox正式基线的能力，先确认现有证据适用，避免为开工重复全部G0；完成抽取后仍须双Provider安装复验。G0-A的跨Provider组合及Chrome的G0-B/C必须先实际执行，不能靠旧Camoufox证据跳过。

三门通过后连续实现，无需逐内部步骤重新请批。WebEnvoy适配错误在同一WI修复；新假设才继续试验。需要改上游、变更依赖/Provider、放宽权限或改变用户结果时暂停受影响部分并保留首反例，不用另一个协议或较小范围制造通过。

## 8. 复用的证明与测试顺序

先形成一张本WI内的迁移对应表：原函数/责任 → 共同实现 → 保留的适配差异 → 同一套回归。它不是另一状态台账。共同模块的操作逻辑不得按品牌分叉；必要引擎差异通过窄且可测的适配钩子表达，逐项解释依据，不能将整个文件/网络/控制流程委派回品牌模块。

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
| DO-GRANT-WIRE | triggered | `scope_semantics`、缺省 legacy、owner v2确认、严格reader与混装拒绝见 Grant Wire v1.4 |
| DO-NETWORK-CONTRACT | triggered | 页面操作范围与可选请求限制分层；v2普通资源/redirect不再依赖全局route，诊断payload仍有界 |
| DO-CONSOLE-CONTRACT | conditional | 同上，若公共结构或生命周期变化则同步正式合同 |
| DO-PROVIDER-PRIVATE-SCHEMA | conditional | 新Chrome来源/安装配对持久字段，或既有bundle/启动结构改变时须先冻结规格/schema/兼容 |
| DO-APP-IA | not-triggered | 复用最小owner/接管，不增加完整工作台 |

本docs PR只冻结设计，不改schema、运行代码或支持状态。实现PR必须再按真实变更回读以上义务，不能把本表当成跳过正式合同的许可。

## 11. 明确非目标与停止条件

不恢复浏览器/Playwright私有改写，不新增Provider marketplace、远程浏览器、自动更新平台、站点知识迁移或完整App；不新增第三个Provider、账号绑定/登录/交易、不使用日常Profile，不扩Files/Dialog/多行/frame/跨窗/popup成功/offscreen。

本轮允许按资格证据调整官方 Chrome 的公开启动／连接适配。若候选不能在既定安全条件下完成范围，保留未完成状态和可核对反例，不退回“每品牌复制一份”、关闭保护、静默 fallback或换浏览器。架构要求是代码复用，不是让所有Provider原生能力完全相同。

## 12. 来源与证据边界

项目事实来源：本文件第2节列出的固定main源码，以及#516/#519/#523/#526和现行ADR0012/Runtime Capability Plane。以上支持“公共规则已存在、共同操作混在专用Driver、Chrome通用消费仍有缺口”，不支持“Chrome新路径已可用”。

供应方接口参考：

- [Playwright Python BrowserType](https://playwright.dev/python/docs/api/class-browsertype)：persistent Context与executable参数、CDP连接差异及兼容性提醒。
- [Playwright Python Library](https://playwright.dev/python/docs/library)：async接口、线程与取消约束。

这些是路线依据，不能替代固定SDK签名、本机原包、双Provider安全资格和installed验收。实际执行不得以文档最新版为理由更新固定依赖。

## 13. 2026-09-14 分阶段交付决定

[#541](https://github.com/WebEnvoy/WebEnvoy/issues/541) 独立交付当前 Camoufox 的共同执行基线：正式安装包含并校验 `playwright_shared_driver.py` 与 Camoufox 薄 adapter，Camoufox 的 Page、文件、诊断、JSONL、事件循环和生命周期走共同实现；来源、固定版本、properties、完整环境 bundle、exact replay 与 persistent Context 创建仍留在 adapter。安装继续使用既有 `camoufoxUpstream` 对 Python/Camoufox/Playwright 和来源材料的严格配对，不新增 Chrome 私有字段或另一 Runtime。

这个阶段不改变用户步骤、Profile/binding/default、Grant、ControlLease、Run/receipt、文件材料或 unknown 不重放语义。Chrome 新 adapter、generic `profile_management` launcher、availability/environment/support projection 和候选复现资产不进入 #541；main 上既有 Chrome 选择、默认、binding 与旧明确 scope 原样保留。

#541 完成只表示 Camoufox 已无回归地正式消费共同实现，并允许后续 Runtime 开发复用该基线。#528 的双 Provider 用户目标、Chrome crash-free 资格、相同 Agent 流程和完成门保持不变；PR #530 继续 draft、未合并。#541 的直接对应表与脱敏证据见 [`provider-execution-reuse-541.json`](../verification/provider-execution-reuse-541.json)。

## 14. 2026-09-15 官方 Chrome 公开连接候选的资格结果

固定 Playwright Python `1.60.0` 的公开 `connect_over_cdp` 只能连接已经运行的 Chrome default Context。其公开入口没有在 Chrome 进程启动前暂停恢复 Target、已有 Service Worker、未完成下载或网络的选项；`set_offline`、`route` 与 init script 均只能在连接后应用。default Context 也不能通过该入口补入 persistent Context 创建时的 `service_workers="block"`、timezone、locale、proxy 与 downloads path 等配置。

因此 `--no-startup-window`、受管 loopback 和连接后再安装共同 guard 只能作为待验证的 fresh-profile 假设，不能证明任意长期 Profile 在连接前 fail-closed。CDP连接上的公开 `browser.close()` 只断开控制连接，外部 Chrome 还须由 owner 单独停止；若先断连再停进程，会主动形成 guard 空档。新增进程级网络屏障、系统权限、浏览器补丁或把范围缩成 disposable Profile 均超出 #528 当前合同。

本候选据此在 G0-A 停止，未启动浏览器、未进入 G0-B/C、未写 Chrome 产品 adapter，也未改变 Camoufox、Grant、file_scope、ControlLease 或历史 Run。脱敏证据见 [`chrome-managed-cdp-qualification-v1.json`](../verification/chrome-managed-cdp-qualification-v1.json)。#528 保持未完成；恢复实施需要一个公开、可维护的接入能力，能够在进程启动前建立 fail-closed 保护，同时保留 persistent Context 的配置、下载与生命周期语义。

## 15. 2026-09-15 新默认授权合同下的 Chrome 正式消费

第14节保留旧 `legacy_request_guard_v1` 完成门下的当时静态结论，不改写为运行成功。#544 将默认 `agent_operations_v2` 从增强的全浏览器网络隔离中分离后，#528 以受管启动可信官方 Chrome、私有 loopback 和 Playwright Python 公开 `connect_over_cdp` 完成资格与正式接入。Agent 在 Instance ready 前不能派发；ready 后仍须通过 Profile、Grant、`scope_semantics`、Page/document/target、ControlLease 与文件材料检查。断开控制连接不冒充停止，正常 stop 由 owner 关闭确切进程并核对端点消失。该适配不暴露调试地址，不连接日常或未知浏览器，不在失败时切换旧路径、Provider 或 Profile。

Chrome adapter 只负责可信 executable/user-data-dir、受管进程、公开连接、适用配置及生命周期差异；Page、观察、交互、等待、Network/Console 元数据、上传、下载、JSONL、事件循环与结果处理继续由 #541 已交付的共同实现承担。Camoufox 的官方来源、properties、完整环境 bundle、exact replay 与 persistent Context 创建仍留在其 adapter。两个 Provider 各有独立进程、Context、页面引用、队列、临时目录和控制状态，没有共享运行现场。

正式资格覆盖 macOS arm64 的官方 Chrome `153.0.8010.37` 与 Playwright Python `1.60.0`：同一专用长期 Profile 三次独立启动均直接读到既有 marker，完成固定 CSV 下载、页面继续使用和 owner 正常关闭；正式安装还覆盖双 Profile 隔离、PNG 上传/页面 receipt、redirected CSV 下载、诊断、10 秒 Agent 静默事件推进、人工接管/交还、Runtime 重启后的 Run/材料查询与真实 Codex 短流程。该结果只证明 #528 的当前普通页面、标准文件、控制与恢复切片，不外推完整 Chrome V1、任意 Chrome/OS/网站或全生命周期网络隔离。来源、hash、运行次数、继承边界和脱敏证据见 [`provider-execution-reuse-528.json`](../verification/provider-execution-reuse-528.json)。
