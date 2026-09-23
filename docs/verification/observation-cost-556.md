# #556 有界观察成本调查

归口：[#556](https://github.com/WebEnvoy/WebEnvoy/issues/556)，owning FR [#497](https://github.com/WebEnvoy/WebEnvoy/issues/497)。仅调查既有观察与续读，不实施优化，不发布。

## 执行前冻结（2026-09-24）

- 运行候选：main `5bfb19347ea1dd4079d4d9524686deedc5f2d872`，tree `f4b90d5e7a099abf2411902692efe306847b542a`。即使 #475/#555 后续改变 main，本记录仍只适用于该候选。
- 正式入口：本候选构建的 standalone-runtime CLI，`--version` integrity=verified。manifest SHA-256 `08efc54ebab512940c990151d93e03f73375a9312465de7c56fc3c7b8fbf6911`；archive SHA-256 `bde4bd5393a4a17e3cdd806cdb48253e5a4b6b9effdd8f214397e5f1b3e4ea43`；release=false。构建未包含可选 Lode 资产，本调查不消费站点 SKILL。
- 机器：Mac16,10，arm64，10 logical CPUs，16 GiB RAM；macOS 27.0 / 26A428，Node 24.14.0，pnpm 10.30.3。同机其他应用负载未隔离，不把微小差异当作可靠收益。
- Provider：只运行重新通过正式来源核验的 Camoufox 0.5.6 / browser 152.0.4-beta.30 / Playwright 1.60.0。Chrome 固定 153.0.8010.37 材料缺失；本机 Info.plist 仍为 153.0.8010.53，不启动或采用它；Chrome 测量为 not_evaluated。
- 材料：仅 loopback 静态、无账号、无外部资源的受控表单；普通 32 / 128 / 160 控件，另一个 800 控件长元数据压力页。页面生成规则和摘要随测量脚本固定，不把样本规模当作容量承诺。
- 普通样本：每规模三次首次 snapshot，按实际新启动/已启动状态标记；自然产生 cursor 时续读到末段，随后对已返回的普通 textbox 做一次正常 input。32/128 在 limit=128 时无续读，记不适用；160 应为 128+32。压力页一次，成功时最多 16 段，失败即停止该路径。
- 诊断：另行有界运行相同共享生产方法，只记录阶段、公开 Provider 调用和 CPU，不修改供应方文件或方法、不改变产品 wire/权限/完整性/timeout。诊断样本与正式安装端到端样本分开，不将仪器开销当基线。
- 统计口径：采集、末次/续读整批复核、响应投影及 target freshness 是顶层阶段；其中 DOM 语义、公开 accessibility、对象相等性与句柄释放是嵌套子阶段，inclusive 值不能再次相加。Provider 公共 API 调用单独计数，不冒称协议消息或网络 round-trip。只有直接观测到的序列化/客户端解析时间才归因传输；独立 CLI 与诊断的差值保持未归因。
- 预算：普通每规模最多三次正式样本；诊断每规模最多三次、压力一次；最多两个专属无账号 Profile，浏览器串行；每个 live 层最多 15 分钟。正式 operation 仍为原 60 秒边界；客户端等待上限只负责取得原操作结果，不延长产品 timeout。
- 退出条件：来源漂移、Profile 隔离不明、非预期失败、timeout/unknown、预算耗尽即停止受影响样本扩展，保留尝试，不换 key/Provider 重放动作。只允许查询原 Run、停止专属实例和清理本次服务。压力页失败不抹去普通样本。测量前检查其他 Camoufox/专属 Runtime 进程，避免与 #475 同时占用浏览器资源。

## 合同与边界

沿用 [Observation Targets V1](../specs/observation-targets-v1.md)、[#540/#554 证据](observation-targets-540.json)及 [W3 材料限制](browser-environment-quality-570.md)。原对象身份、语义和 enabled 复核、同批 cursor、固定资源预算、脱敏、Core 授权、ControlLease、unknown/no-replay 均保持。

Design Obligation：`DO-PLUGIN-EXPOSURE / DO-GRANT-WIRE / DO-NETWORK-CONTRACT / DO-CONSOLE-CONTRACT / DO-PROVIDER-PRIVATE-SCHEMA / DO-APP-IA = not-triggered`；仅添加 repo-local 测量与证据，不改变稳定合同或产品实现。若选择 B，后续实施须重新判断，不由本调查豁免。

正式安装客户端、诊断直接方法、真实第三方 Agent、真实站点是不同证据；本项不声称 plugin_verified、真实账号可用或完整 V1 完成。

## 结论：B，后续只评估局部批量读取

普通 128/160 控件的等待确实主要在共享观察采集与整批复核。值得安排一个有界的局部优化候选，**本 PR 不实施优化、不宣称已经提速**。保留两次一致性检查和逐目标公开 accessibility 语义，仅评估把同一轮内的固定 DOM 补充读取、最终原对象集合相等性检查合为有界的公开 `evaluate` 调用。不要用缓存、跳过复核或只检查本段来换速度。

同时发现一个独立的结果交付缺口：正式压力样本在约 39 秒返回 unknown；Core 的 64 KiB Run 摘要上限与观察可返回 256 KiB 的边界不一致。其 owner 是 Core 结果持久化，不应由 Observation 提速或提高 timeout 掩盖。下文明确区分现场事实、已复现边界和未直接捕获的根因。

## 实际样本与安装等待

全部尝试、逐调用输出大小、完整阶段数据及原始错误分类见 [JSON 记录](observation-cost-556.json)。两个层使用同一份 [fixture 与诊断 helper](../../apps/desktop/scripts/standalone-observation-cost-diagnostic.mjs)，四个页面的 SHA-256 在两层一致。执行顺序为诊断后正式 CLI；每规模重启 Instance，同层复用专属无账号 Profile，首次与两次 warm 样本均保留。两层 Profile 不同，不是严格配对实验；不将其差值称为 IPC。

正式 CLI、Core、Harbor 和真实 Camoufox 路径的 wall-clock，单位秒（中位数，括号为最小—最大；每格 n=3）：

| 控件 | 首次 snapshot | 同批 continuation | 正常 input（含新鲜度） | snapshot / continuation stdout 字节 |
| --- | --- | --- | --- | --- |
| 32 | 1.152（1.128—1.224） | 不适用，无 cursor | 0.325（0.316—0.345） | 12,217 / — |
| 128 | 4.332（4.249—4.516） | 不适用，无 cursor | 0.368（0.349—0.374） | 44,278 / — |
| 160 | 5.724（5.546—5.728） | 2.852（2.814—2.993） | 0.350（0.337—0.360） | 44,611 / 12,073 |

九个普通样本全部完成；160 三次均为同 observation 的 128+32、无重复 target、最终 complete，随后输入最后一个真实 textbox。首轮并未一致比 warm 慢，不从三次样本推断普遍冷启动规律。Instance 启动、observe、停止另列原始记录，不计入上表 snapshot。

CLI `--version` 的启动/完整性对照为 461、285、279 ms。上述普通 operation 的请求 JSON 编码不超过 0.009 ms，调用端结果解析不超过 0.148 ms；它们不是全部传输开销。CLI input 的总等待与客户端启动对照同量级，但不能直接相减得到 transport 或 action 的精确份额。未单独测量 Core/Harbor IPC、MCP projection 或真实 Plugin/模型等待。

## 内部阶段与调用数

[诊断 runner](../../apps/desktop/scripts/standalone-observation-cost-profile.mjs) 加载完整性核验后的包内共享 Driver 与正式 adapter，只包装 WebEnvoy 自有方法。Python `sys.setprofile` 只数固定 Playwright `_send_message_to_server` 的方法名，不读取参数、不修改供应方代码。该计数是 **Python→Playwright driver 消息发送数，不是浏览器底层协议往返数**。耗时包含插桩开销，CPU 只覆盖 Python 进程；浏览器/Node CPU 未测。

下表为三次中位数（ms）；初始/暖启动消息数不同，是新 snapshot 释放上一批真实句柄的成本，不是丢弃异常样本：

| 路径 | Driver wall | 初采 | 整批复核 | accessibility 子阶段 | DOM 补充读取子阶段 | Python CPU | 消息数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 32 snapshot | 991.44 | 467.37 | 480.46 | 704.69 | 124.02 | 468.88 | 612 / 676 / 676 |
| 128 snapshot | 4,690.85 | 2,143.68 | 2,348.01 | 3,617.74 | 471.96 | 1,959.85 | 2,436 / 2,692 / 2,692 |
| 160 snapshot | 6,287.65 | 2,935.52 | 3,050.87 | 4,947.01 | 617.87 | 2,566.21 | 3,044 / 3,364 / 3,364 |
| 160 continuation | 2,949.18 | — | 2,948.03 | 2,350.42 | 293.37 | 见逐样本 | 1,602 / 1,602 / 1,602 |

accessibility 与 DOM 读取是初采/复核里的子阶段，**不能再与父阶段相加**；对象相等性、句柄释放又嵌套于其中。JSON 保留 inclusive/exclusive 和调用次数。采集阶段未包装的候选取得、form handle 建立及 Python 规范化保留在其 residual，不伪称已逐项隔离。

首次/续读响应投影 `_snapshot_result` 在普通样本不足 1 ms。动作前 `target_failure` 中位数为 23.94 / 46.23 / 41.05 ms，整个 input 各发送 16 条消息，和整批复核不同量级。主要 accessibility 路径包含 Locator 前后定位、与保留 ElementHandle 相等性核对、ARIA snapshot 及临时句柄释放。它占诊断 snapshot wall 约七至八成，但其中身份保护是必要成本，不可把整个比例当作可消除收益。

数量增长与等待一起增长，只能支持“这条顺序调用路径值得局部评估”，不能证明每条消息耗时相同、网络 RTT 是根因，或全局并行一定安全。静态页面没有外部资源和模型调用，本次无法把实际网站/Agent 的等待归因到它们，也不能外推所有真实任务。

## 压力边界与失败

800 个长元数据控件只尝试一次/层：

- 诊断直接方法：首采 43.107 s、15,124 条消息；保留 702 个目标、`metadata_truncated`、`total=null`、`complete=false`。字节预算使前八段各 86 项、末段 14 项，共九段；八次续读中位数 21.199 s（21.013—22.999），各 7,913 条消息。每段都检查 observation/captured_at 不变、有限推进、最终保留集合无重复；总 snapshot+续读 214.666 s。没有 timeout/异常。
- 正式 CLI：首采 39.309 s 返回 207 字节错误，`unknown_outcome / managed_browser_outcome_unknown / dispatched`；没有返回 controls/cursor。原 key 查询仍返回相同 unknown，随后停止实例、撤销本次 Grant、停止 Runtime/fixture。无续读、输入或换 key 重放；正式压力路径未通过，不能被诊断成功覆盖。
- 这次正式失败未触及 60 秒，不能说复现了 #554 的 timeout。只读回读的持久 Run 在约 39 秒后进入 unknown。源码显示 `managed-browser.ts` 将完整 result 放入 `persisted_public_summary`，`completeRunWithResult` 调用 Run store，后者拒绝超过 64 KiB 的 summary。最小离线生产方法检查中，32,035 字节成功、260,035 字节抛出 `public_result_summary exceeds 64 KiB`。这是已复现的合同大小冲突，也是本次现场 unknown 的强解释；现场原始异常未保存，**不声称已直接捕获该次异常栈或排除所有其他原因**。查询没有把未知状态改写成成功。

测量工具先有一次安装准备失败：source package 位于共享临时父目录，其已有 installation link 指向其他数据目录；未启动 Runtime/浏览器。随后复制完整包到专属安装父目录并重新核验，保留该失败。离线 storage probe 初稿缺少合成 admission 字段，修正后执行，不计为浏览器尝试。没有挑选最快样本或隐去失败。

原始 CLI query 行保留了工具误标的 `outcome=failed`，但其 `result_status=unknown_outcome`、exit 6、dispatch 和错误码均保存；JSON 明确记录分类修正，最终脚本已修正。运行后只修了工具分类/状态记录、加离线自检、删未使用 helper；未改变 fixture、测量候选或重跑现场。全部本次 Camoufox 进程已退出，私有材料仅留临时目录。

## 后续最小范围与退出条件

选择 B 的后续实施建议归 #497，另行授权；本调查关闭不表示它已实施：

1. 只评估一轮采集/复核内固定 DOM 投影与末次集合相等性批量读取。保留单一语义 owner、原 ElementHandle、逐目标 Locator/ARIA 前后身份检查、完整候选集合/顺序/语义/enabled、同批 cursor 与全部现有预算。不增加跨调用缓存、并行执行平台或新产品字段。
2. 以此四个固定样本重新建立候选对照；比较正式端到端 wall、Python→driver 消息数、各阶段与失败率。先取得可复现的普通 128/160 成本下降再接受，不把理论减少的调用数换算成营销 SLA。若节省落在运行噪声内、需要放宽合同或引入供应方私有实现，停止该方案并保留当前实现。
3. 必须保持 #540/#554 的 128+32、预算 incomplete、同名区分、真实节点替换/顺序/语义变化拒绝、target-local freshness、脱敏、ControlLease 和 unknown/no-replay。Core 摘要大小冲突作为独立正确性缺口先归 Core owner；不靠减少返回内容、放大 Run 限制或延长 timeout 顺手“优化”掉它。
4. Camoufox 沿本次固定组合验证；Chrome 只有在正式 `.37` 材料或另外明确采用的固定组合可核验后才能评估，不能继承 Camoufox 的性能或成功。若 #555/#475 改变观察实现，先建立新候选基线，勿混合本记录样本。

A 未选：普通 128/160 已存在数秒的重复逐目标成本，值得一次小范围候选评估。C 未选：普通受控样本的主要等待确实在观察路径；压力页的 Core 交付缺口另行归口，不把它误解释为所有普通样本的性能根因。

## 复验与本轮检查

先按正式 standalone build/package 入口冻结候选、核验来源并使用独立安装/无账号 Profile；不要直接在已使用的安装父目录执行 setup。两个 live 命令串行运行，每个最多 15 分钟加清理预算：

```sh
node apps/desktop/scripts/standalone-observation-cost-diagnostic.mjs --self-check
node apps/desktop/scripts/standalone-observation-cost-check.mjs --self-check
node apps/desktop/scripts/standalone-observation-cost-profile.mjs PACKAGE MATERIALS_POINTER --self-check
node apps/desktop/scripts/standalone-observation-cost-profile.mjs PACKAGE MATERIALS_POINTER
node apps/desktop/scripts/standalone-observation-cost-check.mjs PACKAGE MATERIALS_POINTER EVIDENCE_JSON
node apps/desktop/scripts/standalone-observation-cost-check.mjs --storage-check
```

`PACKAGE` 是上述固定 standalone 构建，`MATERIALS_POINTER` 指向正式固定材料目录的私有指针文件。`--storage-check` 使用本 checkout 构建后的 Core，只写新建临时合成 Run；它不连接浏览器、不重放现场。live 脚本在 unknown/失败时非零退出是准确测量结果，不应自动重试。

已执行：正式 standalone 构建/完整性核验、两个工具自检、生成 Python 编译、离线存储边界检查；共享 Driver 与 managed interaction 既有回归 19/19。没有产品代码/合同更改；安装客户端与真实 Provider 证据如上，真实 Agent、MCP transport、Chrome、真实站点与 Release 均未执行。最终候选的独立 review 与 required checks 以 PR 原生记录为准。
