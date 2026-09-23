# W3 当前正式组合的环境与自动化暴露基线

日期：2026-09-23。归口：[W3 #570](https://github.com/WebEnvoy/WebEnvoy/issues/570)、[FR #471](https://github.com/WebEnvoy/WebEnvoy/issues/471)。判定依据：[Browser Environment Quality V1](../specs/browser-environment-quality-v1.md)。本记录按组合和维度报告事实，不表示不可检测、真实账号可用、全部平台或完整 V1 通过。

## 执行前固定的范围

初始委派授权推进 W3、无账号受控材料的验证、必要修改与 PR，当时停止于合并、关闭事项和发布之前。#567 已接受，合入 `fe67f593261340e943c36b91c6faed2149849c29`；本次将规格页遗留的“待合并生效”标题校准为 Accepted，不改变质量门槛。#570 原生 parent 为 #471，Milestone 21，blocked-by #567（Closed），Project 状态仍为 Backlog；登记状态不替代本轮授权。W2 #569／PR #582 已合并，本项不重复其产品实现。

随后回读到 [2026-09-23 授权事件](https://github.com/WebEnvoy/WebEnvoy/issues/570#issuecomment-5793885770)：允许在完成标准、独立审查和 required checks 满足后 squash merge、回读和关闭 #570。该条件授权不消除现场证据缺口；本文不以授权事件表示完成门已满足。Release 仍不在授权内。

- 仅运行现有正式来源、固定版本的 Provider；不下载、安装、升级或替换浏览器，不修改日常 Profile。
- 每组合两个新建无账号 Profile；仅访问本地 `127.0.0.1` 受控页面，无第三方站点、业务账号、代理或付费模型调用。
- 每组合最多两个同时运行实例；A 初启、两次正常停启、一次 Runtime 停启后再启动，B 一次启动；至少三次相同短任务。每调用 120 秒、每组合 live 总预算 15 分钟。
- 非预期失败、隔离错误、来源漂移或写入 unknown 后保留事实，停止受影响扩展；只允许查询和专属资源清理，不换 Provider、换 key 或重放写入。
- 最后显式停止本次实例、Runtime 与本地服务器。私有临时材料不提交；公共证据不包含 Cookie、凭据、Profile 路径或 raw fingerprint。

## 候选与正式入口

运行代码为最新 main `9c317172b10960c7dd5d80527de1053a08e0f04b`，tree `f6441dd68b0e7a608c04be0c078660a757dc168a`。此次仅添加验证脚本与证据，不改变运行代码或正式合同。

无 App standalone-runtime，Node `24.14.0`、pnpm `10.30.3`、macOS `27.0` build `26A428`、arm64；Lode 固定资产 `88615079e6292a6a5254ce4ab5fde2ebd189a072`。包 manifest SHA-256 `88a0527c438389edd7ab2ec63d577f025e478e51a814b0ae835b076fa96e1c76`，archive SHA-256 `51eab318107f04beefba51ba737dbdd1f095c045b2a5aa47b5e7d176819c999f`；`release:false`。

操作入口为独立临时安装的包内 CLI／既有 owner API，使用同 UID `trusted_local`，不证明 OS 进程隔离。运行脚本不是第三方模型消费，不标记 `plugin_verified` 或真人操作。未实现的主动 Network／受控视觉不适用；现有普通导航／Page 读取与对象级输入另行记录。

实际执行组合为 headful、无 viewer 操作、`legacy_request_guard_v1`。本次三个持久 Grant 与两个 Profile policy 均未设置 `scope_semantics`，Core 的既有缺省语义为 legacy；[共享 Driver](../../services/harbor/packages/runtime-api/src/playwright_shared_driver.py) 因而启用 `context.route`、启动期间 offline 与 `service_workers=block`。不是 v2 无请求拦截路径，不外推其网络外观。本次测试页没有外部资源，未观测外部出口／DNS／TLS，也不声称阻断了浏览器所有后台网络。

[Camoufox adapter](../../services/harbor/packages/runtime-api/src/camoufox-upstream-driver.py) 使用正式 `launch_options`、`main_world_eval=True`，排除 UBO addon，完整 launch/context options 持久化后 exact replay。输入使用可信 ElementHandle 对象的 `fill`，不模拟逐键人工节奏；`press` 未在本轮使用。该代码事实不是“这些配置无暴露影响”的证明。

### Provider 来源预检

| 组合 | 实际核验 | 本轮运行资格 |
| --- | --- | --- |
| `webenvoy.camoufox-upstream/v1`，Python package `0.5.6`，browser `152.0.4-beta.30`，Playwright `1.60.0`，Python `3.12.13` | 正式 `verifyCamoufoxUpstreamInstall` 通过；browser source `3b43e766574f286a6a63296cf58b660b7a3120952086c869b4df4c9a71604bc3`，Camoufox wheel `b906836cd952376a466f0e55445f139b8a65adfb9f18ab55cb2cd0c727b11561`，Playwright wheel `39b5420ba6145045b69ced4c5c47d4d9fe5bddfc8ff816c518913afcb25ec7a5`，properties `10d5cfb6c8eb3824485734362a3920e07b36c3801770fffcc14a3546e56f81f4`，executable `e468f25acba5085624da4d1ac809fd5679fa281ed2b0265f82efe63904900b33` | 可进入本轮受控测试；静态来源通过不等于质量通过 |
| `webenvoy.chrome-official/v1` 正式固定 browser `153.0.8010.37`／Playwright `1.60.0` | 当前找到的系统安装 Info.plist 为 `153.0.8010.53`，executable `af09314952c541583cc380057318e0a812a2dd1d7627327d564fc2e991736345`，不匹配正式固定 executable `83dfc7d9e4fde4272ced1c0cc8d3584d3b5d3bdac46978ee05031e8c2ae3c2` | `not_evaluated`：未找到可重新核验的 `.37` 专用安装及归档；未启动、复制、改绑或安装 Chrome。`.53` 不属于本轮已采用组合 |

Chrome 只完成只读材料预检，live 尝试为零。用户明确回复“没有保留”固定材料；缺口是匹配现场材料，不是整个 Chrome Provider `unsupported`，也不把历史 `.37` 成功外推为本机 `.53` 支持。本轮不下载替代版本，Chrome 当前质量矩阵保持未验证。

## 既有证据的复用边界

| 来源 | 本轮可使用的事实 | 不能推导的结论 |
| --- | --- | --- |
| [#555](https://github.com/WebEnvoy/WebEnvoy/issues/555)／PR #557 | 已接受表单状态与动作适用性规格；最新事件明确功能仍未实现 | 没有可复用的新表单状态 live 指标，不能把规格当实现 |
| [#556](https://github.com/WebEnvoy/WebEnvoy/issues/556) | 有界性能调查合同；尚无执行评论或测量交付 | 本项不替代其分阶段／协议往返调查，也不作 A/B/C 优化决定 |
| [#540/#554 证据](observation-targets-540.json) | 旧候选的 128+32 续读、目标身份与正式 Provider／Agent 记录；Camoufox 长元数据压力样例 60 秒后 unknown 保留 | 不外推当前候选性能；Chrome 自动更新后 launch_failed 不能被后续成功抹去；旧 Agent 结果不算本轮 plugin_verified |
| [#528](provider-execution-reuse-528.json) | 固定 Chrome 来源、版本及旧候选普通 Page／Files／控制切片 | 不代表完整环境、隐身、所有平台或当前安装可用 |
| [W2](w2-dual-instance-control.md) | 旧固定运行候选的双实例、接管／交还与拒绝证据；仍保留原生最小化／焦点限制 | 不重复计为本轮测试，也不推导长期连续或零干扰 |

## Design Obligation

`DO-PLUGIN-EXPOSURE`、`DO-GRANT-WIRE`、`DO-NETWORK-CONTRACT`、`DO-CONSOLE-CONTRACT`、`DO-PROVIDER-PRIVATE-SCHEMA`、`DO-APP-IA` 均为 `not-triggered`：只通过既有入口测量并记录证据，不新增 wire、持久字段、权限、Provider 配置、工具投影或 App 产品流程。验证脚本位于现有 standalone 脚本目录，不解除 App 冻结。

## 实际执行与全部尝试

脱敏逐调用、逐环境回读与逐样本记录：[browser-environment-quality-570.json](browser-environment-quality-570.json)。2026-09-23 `11:39:08.133Z` 至 `11:39:46.316Z` 完成主要采样（约 38.2 秒，随后清理）；共一次 live 运行，A 四次启动、B 一次启动，无失败后换 Profile 重测。63 次 WebEnvoy CLI 调用中 62 次 completed、1 次预期拒绝：A Grant 读取 B 返回 `managed_access_denied/not_dispatched`。无非预期业务失败、timeout、unknown、挑战或人工介入；未发生不等于对应故障路径已验证。另有 113 次进程只读采样及 1 次管理策略设置，均成功。

脚本初稿的返回值、业务状态分类、漂移处理及清理登记问题在 live 前通过静态审查修正，没有作为成功样本混入。live 后发现测量元数据把 routing 写成 `not configured`；按本次持久 Grant／policy 和 Core 缺省规则修正为 legacy，原字段和修正依据在 JSON `metadata_corrections` 保留。没有改变执行路径、清理数据或重跑来制造通过。原测量脚本 hash 和原结果 hash 一并保留；最终脚本另补 unknown/manual/timeout 自检并删除未使用函数，不改变 fixture、采样动作或 Runtime。

### 环境与隔离

A 的初启、两次正常停启及 Runtime 停启后回读均为 `harbor-profile-environment/v1`：configured/effective 为 Camoufox、`en-US`、`UTC`、未配置 viewport／proxy／geoip，pending 为 null；真实 observed 为 `en-US`、`[en-US,en]`、`UTC`、viewport `1280×720`、screen `1728×1117`。这五个实际字段、Provider 版本及同一 A 的 bundle hash 在三个转换中一致；A/B bundle hash 不同。A 的合成 localStorage 输入记录从 0→1→2→3，Runtime 重启后仍为 3，最后值仍为 A3。不是仅靠 marker 作整体连续性判断，也不代表已进行多日老化或升级测试。

公共 drift 为 `match`，其 owner 实际只将 language／timezone 列入 checked_fields。脚本额外比较五个回读字段不改写 owner 的 unknown：network_exit、geo、WebRTC、media_devices、screen、hardware_concurrency、WebGL vendor/renderer、Canvas、Audio、device_memory、fonts、voices 仍按公共结果保持未验证。screen 虽有逐次回读一致值，尚未被 owner 判定完整环境连续；hardware_concurrency 虽在 readback_fields 中，本脚本未保存比较其数值。

A/B 曾同时运行；B 初始 storage count 为 0，B 输入后 A 仍为 2，实际 session、Page ID、Page ref、Run 指纹不同，跨 Profile Grant 读取拒绝。专用 Profile 的 data-root 路径、Context 内部、Cookie／下载材料、环境材料路由和 ControlLease mutation 本轮未独立核验，不能宣称完整隔离。B 停止后 A 完成 A3，所有五次浏览器退出均有原 PID 消失回读；最后 A、专属 Runtime、loopback 服务停止，B 已在中途停止。

### 操作、暴露与性能

固定短任务为 observe → snapshot → read → fill 一个普通字段 → query 原 key → read 结果，共六次 CLI 调用。四次输入均完成，原 key 查询返回相同 Run，页面输入记录仅增加一次。仅使用一个控件，不触发 continuation；续读成本、browser 协议往返数、collector 阶段耗时未知，未冒充 #556 调查。

页面自行呈现的直接信号为 `navigator.webdriver=false`、UA/languages 可见、四次输入事件 `isTrusted=true`。它们只是该 loopback 页面、原 Instance 和当前执行方式的观测；未做开关 A/B、外部检测页、站点挑战、账号或真人行为测试，不由这些信号推导不可检测。

| 样本 | 启动 CLI / ready（ms） | 短任务（ms） | CLI 输出字节 | 主浏览器 RSS（KiB） | 主浏览器 CPU 点样本 |
| --- | --- | --- | --- | --- | --- |
| A1，首次 | 4845 / 5037 | 1775 | 8038 | 419056 | 0.8% |
| A2，正常重启 | 2290 / 2440 | 1777 | 8034 | 417648 | 0.8% |
| B1，另一 Profile | 2699 / 2858 | 1806 | 8038 | 420832 | 0.7% |
| A3，再次正常重启 | 2193 / 2340 | 1691 | 8034 | 437392 | 1.1% |
| A4，Runtime 重启后 | 2241 / 2388 | 未再写入；只回读 | 见逐调用记录 | 未作短任务点样本 | 未作短任务点样本 |

三次 A 同任务中位数 1775 ms、范围 1691–1777 ms；没有剔除 A1。耗时包含 CLI 启动、传输、测量持久化等开销，ready 还包括进程确认，不能解释为纯 Provider／观察采集成本。首次 Profile 与持久 Profile 的差异单列，不声称清空 OS 缓存的冷启动对照。输出量计六次 CLI stdout+stderr；不是 token 数。`ps` 是主浏览器进程点样本，不含全部 renderer／Driver／Core／Harbor，不是峰值、整机或双实例总资源。测试工作流未调用模型，无人工等待；编写本报告的宿主 Agent 模型消耗与费用未计入，保持 unknown。

### 逐维度决定

| 固定组合 | 环境连续 | 隔离 | 自动化暴露 | 操作与恢复 | 性能资源 |
| --- | --- | --- | --- | --- | --- |
| 本文 Camoufox macOS arm64／legacy／headful／固定包 | `restricted`：已述五个回读字段、版本、bundle 与存储接续 | `restricted`：localStorage、Grant、session／Page／Run 与进程生命周期 | `continue_investigation`：只有局部页面信号，没有整体隐身采用结论 | `restricted`：普通输入、结果查询、必要越权拒绝和正常重启；无事故重放／人工恢复实测 | `restricted`：三次 A 和一次 B 逐次成本及主进程点样本 |
| Chrome `.37`／Playwright `1.60.0` | `not_evaluated` | `not_evaluated` | `not_evaluated` | `not_evaluated` | `not_evaluated` |

决定：保持当前来源与已有 Provider 支持边界，仅按上述场景受限使用；不作 `combination_adopted` 总结，不切换 Provider 或重新生成设备身份。Cookie、账号／BusinessTarget、完整 seed／fingerprint、网络出口、真实站点、第三方模型 Plugin、真人控制、文件路径与版本升级均不因本次结果获得通过。W2 控制证据继续按旧候选引用，本轮没有重做 W2。

有证据的下一步仅限：需要扩大 Chrome 声明范围时先恢复可核验的获准材料；需要环境完整采用时补齐当前 unknown 字段的正式观测及授权；需要优化时交由 #556 量化实际瓶颈。不据本地约 1.7 秒任务擅自提速、放宽权限或建设监控平台。

## 检查与候选适用性

`pnpm install --frozen-lockfile`、standalone 构建／`check-standalone-package`、脚本 `node --check`／`--self-check`、`make py-compile`、`git diff --check` 和 Markdown 本地链接检查通过。App agent-entry 回归 44 passed、0 failed、2 skipped；跳过的是未提供专用来源 fixture 环境的用例，不当作通过，当前实际 Camoufox 来源另经正式 verifier 校验。未修改产品 Runtime，未因证据文档或测量分类自检变化机械重跑完整产品测试；最终 PR 中运行资产与上述冻结包相同，候选审查和 required checks 单独绑定 PR HEAD。

## 复验与重评条件

重新运行前先读取质量规格及当前 Provider pins，核验原始来源材料、安装版本、当前授权与预算，再构建独立候选包；不能直接复用上一轮临时 Profile 或把上一轮成功写到新候选。`pnpm install --frozen-lockfile` 后使用 `WEBENVOY_LODE_ASSETS_SOURCE_DIR=<locked-Lode-repository> pnpm --filter @webenvoy/app package:standalone <new-package-directory>`，再运行 `node apps/desktop/scripts/check-standalone-package.mjs <new-package-directory>`。

测量命令：`node apps/desktop/scripts/standalone-environment-quality-check.mjs <new-package-directory> <fixed-materials-pointer>`。pointer 是一行既有 Camoufox 正式材料目录，布局与 [standalone dual-instance 检查](../../apps/desktop/scripts/standalone-dual-instance-check.mjs) 相同；脚本不下载。先运行 `node apps/desktop/scripts/standalone-environment-quality-check.mjs --self-check`。每次生成独立私有临时 evidence，发布前移除私有路径并核对组合／全部尝试；不得直接把整个临时目录提交。

- Provider／Playwright／Python、OS／架构、正式来源 hash 或安装身份变化：重新固定组合，至少重验环境连续与隔离；本轮不授权升级或改变 pins。
- Harbor 启动、环境 bundle、Page／ControlLease、观察／输入、Run／恢复或正式入口变化：补受影响语义与成本测试，不从相同 Provider 名称继承成功。
- scope semantics、routing/interception、viewer、主世界辅助代码、输入策略、代理或网络条件变化：重新核对暴露与环境影响；本轮没有代理／外部出口证据。
- 测量算法、页面内容、目标数量或输出合同变化：重新建立可比较样本，保留旧失败、unknown 和旧结果。
- Chrome `.37` 材料重新可核验，或新版本另经明确采用与授权：才恢复其组合基线。不得为完成矩阵启动当前 `.53` 或自动回退。
- 普通任务出现可重复等待／语义退化：提交具体样本给 #555／#556 对应 owner；此处不预设提速方案，不创建监控平台或新 Provider 工作。
