# Browser Environment Quality V1

> 状态：待合并生效；本规格 PR 经独立审查并合入 `main` 后成为 Accepted 实施基线，不表示 W3 质量验证完成
> 版本：1.0
> 日期：2026-09-22
> 产品依据：[canonical v1.6](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)、[#567](https://github.com/WebEnvoy/WebEnvoy/issues/567)
> W3 消费项：[#570](https://github.com/WebEnvoy/WebEnvoy/issues/570)
> 产品归口：[Provider／环境 FR #471](https://github.com/WebEnvoy/WebEnvoy/issues/471)
> 现场 owner：Harbor；授权、Run、ExternalOutcome 与恢复事实继续由 Core 负责

本文定义如何判断一个**固定 Provider／版本／平台／配置／执行方式组合**的长期环境、隔离、自动化暴露质量、操作语义和性能。它只定义标准和有界验收计划，不记录本次实际测试结果，也不把文档接受、历史证据或 Provider 宣称写成当前支持。

本文中的质量结论始终绑定精确组合和证据范围。不同组合之间不能互相外推；同一组合的一个维度通过，也不能替代其他维度的证据。

## 1. 目标、范围和规范性用语

### 1.1 用户结果

用户和维护者能够回答：

- 当前声明支持的组合是否保持同一 Profile 的长期环境连续性；
- 不同 Profile、Instance、Context、Page、ControlLease 和账号事实是否隔离；
- Provider 的原生环境与自动化暴露质量在什么范围内有证据；
- 已支持操作是否正确落到目标并能恢复，而不是只看页面是否打开；
- 等待、输出、模型调用和资源成本是否可比较；
- 版本、平台、配置或执行路径变化后，哪些结论必须重验。

### 1.2 本文不改变的 owner

| 事实 | 唯一 owner | 本文的关系 |
| --- | --- | --- |
| `configured`／`effective`／`pending`／`observed`／`drift`、Profile 生命周期 | [Profile Environment V1](profile-environment-v1.md)／Harbor | 复用其状态和公共 envelope，不创建质量状态副本 |
| Camoufox 固定来源、版本、完整启动材料和 exact replay | [Camoufox Environment Continuity V1](camoufox-environment-continuity-v1.md)／Harbor Driver | 只引用其 provenance、limited 边界和私有材料 owner |
| Provider 选择、用户新建默认和 Profile binding | [Provider Selection V1](provider-selection-v1.md)／Harbor | 质量记录读取实际 binding，不把推荐或默认当成运行事实 |
| Provider 资格、支持状态和证据等级 | [ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)、[Provider 执行复用设计](../architecture/provider-execution-reuse-v1.md) | 复用 Qualification Gate；本文不新增 Provider enum |
| Browser capability 公共语义、权限、ControlLease、Run、unknown/no-replay | [Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md)／Core／Harbor | 质量判断不得绕过既有授权、目标新鲜度和恢复语义 |
| 观察与续读耗时调查 | [#556](https://github.com/WebEnvoy/WebEnvoy/issues/556) | W3 记录可取得的结果并消费其事实，不取代或复制 #556 |

### 1.3 规范性用语

- **必须**：验收和实现都要满足。
- **不得**：禁止把缺失事实、失败或未知改写成成功。
- **应**：默认采用，偏离时记录具体理由。
- **可以**：允许但不是完成前提。
- **固定组合**：Provider、来源／构建、Provider 版本、Driver／库版本、平台／架构、Profile 环境版本、配置和执行方式的完整元组。

### 1.4 明确非目标

本 Work Item 不做以下工作：

- 运行真实隐身测试、下载／安装／升级 Provider、浏览真实账号或执行未获授权站点任务；
- 建立长期 telemetry、竞品排行、费用监控平台、质量数据库或第二状态机；
- 修改 Profile／Environment／Provider／Grant／Run 的 owner、wire、Schema、Plugin tool projection 或 Provider-private bundle；
- 恢复旧私有 patch binding、patched/native artifact、Obscura 或随机设备身份路线；
- 承诺“不可检测”“不会封号”、固定挑战率或无依据 SLA；
- 通过换 Provider、换 Profile、换代理、重新随机身份或重放未知写入制造通过。

## 2. 质量维度必须分别判定

质量报告不得合成为一个没有解释的总分。每个维度必须绑定自己的场景、证据和结论；一个维度的改善不能掩盖另一个维度的回归。

| 维度 | 必须回答的问题 | 最低判定对象 |
| --- | --- | --- |
| 长期环境与连续性 | 同一 Profile 重启、版本变化或安全配置变更后，关键事实是否保持可解释、可回读、可恢复？ | configured/effective/pending/observed/drift、Provider 来源与版本、Profile data、关键环境事实 |
| 隔离 | 不同 Profile、Instance、Context、Page、控制者和账号事实是否不会交叉？ | 存储、进程／Context、环境材料、Page／ControlLease、Grant、Account／BusinessTarget |
| 自动化暴露与隐身质量 | 固定 Provider 原生环境和执行方式下，暴露的环境／自动化信号是否在声明范围内有证据？ | 固定环境一致性、Provider 原生能力、辅助代码／Network／主世界／输入路径的实际影响、挑战归因 |
| 操作语义与恢复 | 操作是否落到正确的 Page／document、身份和目标，且失败、接管、断连、unknown 能安全处理？ | 任务结果、目标新鲜度、ControlLease、Run／ExternalOutcome、人工介入和恢复 |
| 性能与资源 | 同一任务和组合下等待、输出、模型调用和资源代价是否可比较？ | 启动、观察、续读、动作、等待、输出、模型调用／费用、可取得的资源事实 |

“通过”只表示该维度在给定组合、场景和证据范围内满足门槛；它不表示 Provider 永远可用、所有站点兼容或其他维度通过。

## 3. 固定组合与现有 Provider 事实

### 3.1 组合标识

每次质量记录必须保存以下上下文；缺少任一会影响结论外推的字段时，结论为 `unknown` 或 `not_evaluated`：

```text
provider_id
provider_source_or_binding
provider_version
browser_version
driver_or_library_version
platform_and_architecture
profile_environment_schema_or_bundle_reference
effective_configuration_summary
execution_mode_and_path
runtime_build_or_commit
```

完整私有环境材料、Cookie、代理凭据、Profile 路径和 raw fingerprint 不进入公共质量记录。需要引用时使用已有 opaque ref、bundle hash 或脱敏 evidence ref。

执行方式至少说明 headful／headless、是否使用 viewer、主世界执行、Network routing／interception、输入策略和正式入口；这些变化会改变质量组合，不能只写 Provider 名称。

### 3.2 当前可引用的组合

下表是 W3 可以核对的现有候选，不是本规格新增的支持承诺。完整来源 hash、私有 bundle 形状和当前安装证据仍由既有规格和 verification 事实拥有。

[#567](https://github.com/WebEnvoy/WebEnvoy/issues/567) 的固定选择 2 保留一条历史选型理由：负责人当时优先隐身与开源/分发条件，所以先把 Camoufox 作为工程验证对象。该理由只解释历史选择，不是当前质量证据，不等于 Camoufox 已满足本规格，也不意味着当前没有 Chromium 候选；官方 Chrome 仍按自己的来源、版本、平台、配置、执行方式和质量证据独立判断。

| 组合 | 现有固定事实 | 既有 Qualification／能力范围 | W3 质量基线初始状态 |
| --- | --- | --- | --- |
| Camoufox upstream | `webenvoy.camoufox-upstream/v1`；Camoufox Python `0.5.6`；browser `152.0.4-beta.30`；Playwright `1.60.0`；`properties.json` 与来源由 owner 重新核对 | 当前上游原版路径按 `limited` 使用；完整 `launch_options`／`context_options` exact replay、缺 bundle fail-closed、popup 关系未知时局部拒绝，见 [Camoufox Environment Continuity V1](camoufox-environment-continuity-v1.md) | `not_evaluated`；必须绑定实际平台／架构和当前安装证据，不从历史 #499 或静态材料外推 |
| 官方 Chrome | `webenvoy.chrome-official/v1`；browser `153.0.8010.37`；Playwright `1.60.0`；既有 #528 证据范围包含 macOS arm64 的普通页面、标准文件、控制和恢复切片 | 仅按既有 #528／Provider 执行事实的声明范围使用；不能把 Chrome 视为 Camoufox 的同等级环境或隐身能力 | `not_evaluated`；必须重新绑定 exact platform／config／execution path，#528 的局部能力证据不替代 W3 质量基线 |
| 其他 Provider | 未列入本 W3 固定组合 | 没有当前质量基线；接口存在或供应方宣传不等于资格通过 | `not_evaluated`；没有明确资格、来源和授权不得执行 |
| Obscura、旧 patched/native 路线 | [ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md) 与既有规格明确排除／退役 | 不重新研发、适配、验证或监控 | `not_adopted`；不得作为失败后的 fallback |

`Provider support`、`quality baseline`、`current authorization` 和 `live evidence` 是不同事实。质量规格接受不改变 Provider 选择、资格或授权。

## 4. 质量维度的判定规则

### 4.1 长期环境与连续性

W3 必须复用 [Profile Environment V1](profile-environment-v1.md) 的状态关系：

```text
configured → effective → observed → verified 或 drift
                         └──────────────→ unknown
```

- `configured` 是已保存目标，不等于当前 Instance 已生效。
- `effective` 只来自该 Instance 的启动快照，不由保存配置改写。
- `pending` 表示活动 Instance 仍使用旧 effective；安全停止／重启后才能成为新的 effective。
- `observed` 是实际回读；缺失或不支持不得从 configured 猜测。
- `drift` 只对已核对字段成立；未知字段保持 `unknown`，不算一致。

连续性至少核对同一 Profile data、Provider family、关键 bundle／seed owner、Account 绑定和可解释的版本变化。单独的 marker、目录存在、登录仍在或 locale／timezone 两个字段相同，都不能证明完整环境连续性。

版本升级或配置变更只在明确兼容策略、实际回读和证据支持时标记通过。失败时保留 Profile、配置和历史事实，不自动清理、换 Provider、换代理、随机身份或覆盖 ExternalOutcome。

### 4.2 隔离

隔离不是长期连续性的副产物，必须单独验证：

- 不同 Profile 使用不同受管 data root、锁、Instance、Context、Page 引用和临时材料；
- 账号、BusinessTarget、Grant、ControlLease 和 Run 引用不会因名称、URL、最后活动页或事件顺序串联；
- 一个 Profile 的环境 bundle、Cookie、storage、下载材料和页面状态不会被另一个 Profile 消费；
- 同一 Profile 的并发约束、单主实例规则和 owner lock 继续由既有 Harbor 事实执行；
- 失败或关闭一个 Profile 不会停止或改写无关 Profile 的 Run／ExternalOutcome。

最低隔离样本使用两个专用无账号 Profile；不能使用日常 Profile、真实账号或复制登录态证明隔离。

### 4.3 自动化暴露与隐身质量

本文把“隐身质量”限定为固定 Provider、固定环境和固定操作路径下的**自动化暴露质量与环境一致性**。它不代表不可检测、不封号，也不把某个检测页分数当成总证明。

质量记录必须区分：

- Provider 或供应方声明；
- 静态来源、版本、配置和代码事实；
- 实际 Provider／原 Instance 观测；
- 真实 Agent、真人和真实第三方站点行为；
- 账号、行为、网络、站点和环境因素造成的挑战或失败。

挑战、验证码或页面差异出现时，先保留事实并分别排查账号、行为、网络、站点条件、Provider 和环境；证据不足不得统一归因于隐身，也不得轮换身份环境制造“成功”。

Network routing、主世界脚本、controlled evaluation、viewer、输入策略和等待方式可能改变暴露质量，必须记录其实际影响。能力开关存在不等于缺陷，关闭某个可选开关也不自动等于质量回归。

### 4.4 操作语义与恢复

操作质量必须复用 Browser Runtime 公共语义和 Core／Harbor owner：

- Page／document、Account、BusinessTarget、授权和 ControlLease 都能核对；
- 成功、失败、`unknown_outcome`、`manual_recovery_required` 和已派发事实分别保存；
- 人工接管只改变 ControlLease；交还后重新观察原任务页，不自动跟随最后观看页；
- Viewer、CLI、Plugin 或 Runtime 断连不被写成 Instance 停止或业务失败；
- 已派发且结果未知的写入只允许原 operation 查询、对账、人工接管和停止后续动作，不重放。

更快但目标错误、页面过期、账号不符、ControlLease 缺失或结果未知的操作，操作质量判定失败或未知；不能用性能结果掩盖语义问题。

### 4.5 性能与资源

性能是独立维度。若现有入口能够取得，应按同一固定任务记录：

| 指标 | 语义 |
| --- | --- |
| startup／ready | 从正式启动请求到 Instance 可按既有规则执行 |
| observe／continuation | 首次观察、续读和同批 continuation 的耗时 |
| action／wait | 动作派发、页面等待和结果回读耗时 |
| output | 输出量、截断或缺失 |
| model usage | 调用次数、实际模型／版本、费用；不可知即 `unknown` |
| manual intervention | 等待用户、人工操作和恢复耗时；无人工不填零来掩盖未测 |
| resource facts | 已有可核对的 CPU／memory 或其他资源记录；没有现成事实即 `unknown` |

性能比较必须固定 Provider、平台、Profile 类型、任务、输入、执行方式和证据范围。重复运行保留每次原始结果并报告简单的中位数／范围或逐次值；不挑最快一次，也不把小样本写成 SLA。任何优化若改变目标、身份、结果、控制或环境连续性，先按对应维度判定，不能只凭耗时采用。

## 5. 证据、样本与记录

### 5.1 证据类型

沿用 [Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md) 与 ADR 0012 的证据语义，不新增公共证据 enum：

| 证据 | 能证明什么 | 不能证明什么 |
| --- | --- | --- |
| `provider_claim` | 供应方公开声明或项目历史选择理由 | 当前组合可运行、质量通过或不封号 |
| `fixture_verified` | 固定 fixture／mock／确定性逻辑 | 真实 Provider、真实 Agent、真人或真实站点 |
| `live_verified` | 来源可核对的真实 Provider 原 Instance 行为 | 所有平台、版本、站点或 Provider |
| 正式安装路径 | 正式构建与隔离安装经正式入口调用 | `plugin_verified` 或完整 V1 |
| `plugin_verified` | 已安装 Plugin 被真实第三方 Agent 消费 | 测试脚本、CLI、MCP 辅助客户端或真人操作 |
| 真人操作 | 真人观看、输入、接管和交还 | Agent 自动化、环境连续性或业务全量成功 |
| 真实第三方站点 | 指定站点、时间和场景的行为 | 其他站点、账号、Provider 或不可检测保证 |

证据类型可以组合，但不要求每个维度凑齐所有类型。真实站点未获授权、不可安全执行或未执行时标为缺口，不用受控 fixture 冒充真实站点。

### 5.2 有界质量记录

W3 的执行记录不是新的公共 Schema。它应在现有 verification／evidence 载体中保存或引用以下信息：

```text
quality_scope:
  fixed_combination
  user_result
  profile_class (dedicated_no_account | authorized_site)
  platform_and_runtime
  execution_path
  evidence_types
attempts:
  each attempt outcome (success | failed | unknown | manual_recovery_required)
  failure or challenge facts
  manual intervention
  wait/output/model/resource facts when available
decision:
  dimension-level adopted | restricted | continue_investigation | not_adopted
  optional combination-level decision (for example `combination_adopted`), kept separate from dimension results
  supported scope
  limits and unverified fields
  evidence refs
  revalidation triggers
```

只保存必要且脱敏的引用、摘要和指标；不得保存 Cookie、token、凭据、raw Profile、未脱敏画面、HAR、生产 payload 或用户私有业务内容。没有证据地址、固定组合、实际消费者或授权边界时，结论为 `unknown`／`not_evaluated`。

### 5.3 W3 最小样本计划

W3 对每个获准的 exact combination 单独建立一行矩阵，并按实际预算执行以下最小计划：

1. **初始环境**：一个专用无账号 Profile 首次启动，记录 configured、effective、observed、support、drift、来源和版本。
2. **连续性**：同一 Profile 正常停止后至少两次独立重启；若正式路径支持 Runtime 重启，再覆盖一次 Runtime 重启。每次都从实际回读判断，不只比较 marker。
3. **隔离**：第二个专用无账号 Profile 与第一个同时存在或顺序运行，核对 data root、Context、Page、控制、材料和结果引用不交叉。
4. **操作质量**：使用当前已支持的固定观察、输入、等待和结果回读路径；若声明人工接管或文件路径，则加入对应原 Instance 的接管／交还或文件结果证据。未实现的 Network／视觉路线列为 `not_applicable`，不为测量新造功能。
5. **性能**：对同一短任务进行至少三次可比较运行时保留逐次耗时、输出、模型／人工等待和可取得的资源事实；样本不足时只报告逐次事实和 `unknown`，不计算无依据结论。
6. **版本／配置变化**：当前 W3 不下载或升级 Provider。获得明确升级授权并存在新来源、版本、平台、配置或执行方式时，按第 8 节重新建立受影响矩阵；旧证据只保留为旧组合事实。

样本不是统计 SLA，也不是允许真实高风控账号试错的授权。预算、无账号材料、站点范围、退出条件和必要的真人／Agent／安装授权必须在 W3 开始前固定。任何失败、unknown、挑战、人工介入和中断都保留，不删除异常样本或只选最快运行。

## 6. 正常场景与反例

| 正常场景 | 预期记录 | 反例与处理 |
| --- | --- | --- |
| 同一专用 Profile 正常停止并重启 | 实际回读的连续字段匹配或有解释的允许变化 | marker 相同但关键环境、网络路径或 Provider 版本变化：标 drift／unknown，不能判连续通过 |
| 两个 Profile 同时使用各自原 Instance | 存储、Context、Page、ControlLease、材料和 Run 归属清楚 | A 的材料、页面、控制或结果落到 B：隔离失败，停止受影响路径，不清理或重建来掩盖 |
| configured 变更后活动 Instance 仍运行 | 旧 effective 保持，新的 configured 进入 pending；安全重启后再回读 | 保存即静默热应用代理、时区、seed、Provider 或身份：环境和操作质量失败 |
| 固定页面观察／输入／等待完成 | 目标、身份、授权、ControlLease 和结果均可回读 | 操作更快但落到错误 Page／BusinessTarget，或 stale target 未拒绝：语义失败，性能不能补偿 |
| 用户接管后明确交还 | Agent 停止输入；交还后重新观察原任务页 | 观看 B 后交还却跟随 B，或断连后重放 unknown 写入：恢复失败，保留历史事实 |
| 站点出现挑战或验证码 | 保留时间、站点、账号／行为／环境／网络事实并进入人工处理 | 仅凭挑战断言 Provider 隐身失败，或自动轮换代理／指纹：结论无效且违反非目标 |
| Provider 声称有某接口 | 进入 `provider_claim`，等待实际资格和组合证据 | 接口存在但未验证就写成 supported，或因未测直接写 unsupported：分别改为 `not_evaluated` |
| 新版本或新平台 | 以新 exact combination 建立新记录并做受影响回归 | 自动 fallback、热换活动 Instance、移植旧补丁或覆盖旧证据：拒绝并保持旧组合事实 |
| 观察优化降低等待 | 在同任务、同组合下记录前后语义、结果和性能 | 等待变短但输出缺失、环境漂移、目标错误或模型／外发扩大：不采用该优化 |

## 7. 采用、受限采用与不采用

下列是文档级决策标签，不是公共 wire enum。结论必须按 exact combination 和质量维度记录。

### 7.1 `adopted`（按维度采用）

`adopted` 是一个质量维度的结论，不是整个组合的默认总标签。只检查该维度适用的证据条件；其他维度仍为 `unknown`、`not_evaluated` 或未采用时，不得错误阻塞已经满足条件的维度。每个维度至少满足：

- **长期环境与连续性**：来源、版本、平台和执行方式可核对，并有该 Profile 的实际环境回读以及重启或安全配置变化证据；
- **隔离**：至少两个专用无账号 Profile／Instance 的实际 Provider 证据证明存储、Context、控制、材料和结果引用不交叉；
- **自动化暴露与隐身质量**：固定 Provider、环境和执行路径下有适用的 `live_verified`、真人、真实站点或同等直接证据；供应方声明和静态检查不能单独采用；
- **操作语义与恢复**：声明的操作路径有成功、必要拒绝、恢复以及 `unknown`／no-replay 处理证据；
- **性能与资源**：同一任务和组合有逐次耗时、输出以及可取得的模型、人工和资源事实；未知指标明确列出，不能以小样本冒称 SLA。

每个维度仍必须写出精确组合、适用范围、限制、未验证字段和 evidence refs。一个维度达到条件时，只把该维度写为 `adopted`，其他维度保持自身结论。若需要对整个组合给出总的采用结论，必须另标为 `combination_adopted`：只有所有适用维度均达到各自条件、无关键未处理的身份／授权／控制／数据／结果未知，且范围、限制、实际消费者和证据 refs 齐全时才可使用。`combination_adopted` 与单维度 `adopted` 是不同结论；本文不以总标签替代维度判定。

### 7.2 `restricted`（按维度受限采用）

当该维度能够在有界场景提供用户结果，但某个平台、版本、能力或证据范围有限时使用。记录必须包含：

- 允许的精确范围；
- 明确的 `limited`／`unknown` 字段；
- 触发局部拒绝、人工处理或继续调查的条件；
- 不会静默 fallback、换环境或扩大授权的边界。

受限采用只说明当前维度的有界结果，不等于其他维度、其他 Provider 或相同 Provider 的其他版本通过。

### 7.3 `continue_investigation`（继续调查）

该维度的证据缺失、冲突、样本不足、挑战无法归因或关键字段未回读时，保持未决，不提前采用，也不改称 `unsupported`。后续只有在获得新授权、来源、现场或可判别证据后才重新评估。

### 7.4 `not_adopted`（不采用）

出现以下任一情况时不采用受影响维度或其声明范围：

- Qualification Gate 发现缺少必须的浏览器核心语义，需 WebEnvoy 模拟、补丁或长期补偿；
- 不能保持 Profile／身份／控制／结果隔离；
- 活动 Instance、Page、ControlLease、unknown 或恢复语义无法可信满足；
- 来源、版本、安装或平台事实无法核对；
- 回归导致关键用户结果失败，且没有有界的人工处理或恢复；
- 路线依赖 Obscura、旧 patched/native artifact、自动随机身份或静默 fallback。

不采用只影响受影响维度和声明范围；不得借此全局删除不依赖它的通用能力，也不得自动切换另一个 Provider 制造成功。

## 8. 升级与回归触发

### 8.1 必须重新评估的变化

以下变化至少触发受影响维度的重新评估；来源、Provider、平台或执行方式变化通常需要建立新的 exact combination：

- Provider executable、浏览器／Provider／Driver／Playwright 版本、来源归档、签名、hash 或 `properties.json` 变化；
- OS、CPU 架构、显示／窗口运行条件、安装方式或正式 Agent／Plugin 入口变化；
- Profile environment schema、Camoufox bundle、seed、locale、timezone、viewport、proxy／geo／WebRTC 或输入策略变化；
- Harbor Driver、启动／连接、Page／document、ControlLease、Run／receipt、unknown/no-replay 或恢复语义变化；
- 主世界执行、Network routing／interception、viewer、等待、截图或输入辅助路径变化；
- 观察算法、Canvas／Audio／字体／voices 等比较方式变化；
- 真实站点、版本、挑战或网络条件发生会影响结论的变化；
- 已知性能、输出、资源、人工介入或失败模式出现有意义变化。

### 8.2 回归处理

1. 保存旧组合的原始结论，不原地改写成新版本结论。
2. 先核对来源、版本、安装和静态配置，再运行最小受影响样本。
3. 环境／Provider／平台变化重做连续性与隔离；操作路径变化加做目标、控制、结果和恢复；测量算法变化只在新算法下重建比较基线。
4. 发现关键回归时，将该组合降为 `restricted`、`continue_investigation` 或 `not_adopted`，并准确说明受影响范围。
5. 不自动回退、热换 Provider、改写账号／授权／指纹／代理、重建 Profile 或重放未知写入。

### 8.3 质量基线的有效期

质量结论只对记录的 exact combination、执行方式、任务和证据时间有效。没有新鲜证据时标记为过期／未知，不把旧 `live_verified` 自动延伸到新提交、新版本、新平台或新站点。

## 9. W3 #570 有界验收计划

### 9.1 进入条件

- #567 规格已接受并与 [#471](https://github.com/WebEnvoy/WebEnvoy/issues/471) 的 Profile／Provider owner 对齐；
- 本规格可与 S1 [#562](https://github.com/WebEnvoy/WebEnvoy/issues/562)、S2 [#563](https://github.com/WebEnvoy/WebEnvoy/issues/563) 和 [#556](https://github.com/WebEnvoy/WebEnvoy/issues/556) 并行；它们不是 W3 的统一硬前置，W3 只消费已存在且适用的事实；
- 目标 Provider、来源、版本、平台、配置、执行方式和当前授权已固定；
- 使用专用无账号材料，或已获得明确的真人／Agent／安装／真实站点授权；
- 样本、预算、退出条件和证据保存位置已登记；
- 不安装、升级或切换 Provider，不操作未授权账号，不恢复旧补丁或 Obscura。

### 9.2 执行顺序

1. 记录 exact combination 和现有 Qualification／support facts。
2. 为每个组合建立环境、隔离、操作、性能和限制矩阵。
3. 按第 5.3 节执行初始、重启、隔离、操作和性能样本；遇到反例先保留原始事实并停止受影响扩展。
4. 对每个维度分别判定 `adopted`、`restricted`、`continue_investigation` 或 `not_adopted`，不以单一总分覆盖未知。
5. 由独立 reviewer 回读 exact head、组合、证据类型、失败／unknown／人工介入和限制；证据不足时保持未决。
6. 将实际结果写入既有 verification／evidence 事实载体，并更新 owning FR 的适用结果和限制；不因 W3 完成关闭 #471、#497 或宣称完整 V1。

### 9.3 W3 完成门

- 一份按组合绑定的实际执行记录和维度结论；
- 版本、平台、配置、范围、全部尝试、限制、复验方法和回归触发齐全；
- 环境、隔离、隐身、操作、性能分别表达，未测项为 `unknown`／`not_evaluated`；
- 失败、unknown、挑战、人工介入和中断均保留；没有用最快一次或营销声明替代证据；
- 没有把历史 #499、现有 #528 普通页面切片或静态来源直接外推为完整环境／隐身质量；
- 对具体缺口提出有证据的后续工作，不新增长期测量平台、Provider fallback 或补丁路线；
- 完成 exact-head 独立审查和 required checks，并按事实类型回读；
- 更新 owning FR 的适用结果和限制，不推导全部 Provider、平台、站点或完整 V1 已通过。

## 10. Design Obligation Gate 与旧条款替代

### 10.1 本 Work Item 的 Design Obligation 判定

| Trigger | 判定 | 理由与后续条件 |
| --- | --- | --- |
| `DO-PLUGIN-EXPOSURE` | `not-triggered` | 本文不新增 capability、工具投影、宿主过滤或 Plugin 参数。若 W3 实现需要新的动态 exposure，必须先更新 Plugin 规格。 |
| `DO-GRANT-WIRE` | `not-triggered` | 本文复用既有 Profile ceiling、Grant、task scope 和 ControlLease，不新增持久权限维度。若质量记录要成为跨进程 Grant 字段，必须先转为 `triggered`。 |
| `DO-NETWORK-CONTRACT` | `not-triggered` | 本文只记录既有 Network／环境事实及其影响，不新增 request／response payload、intercept 或修改语义。 |
| `DO-CONSOLE-CONTRACT` | `not-triggered` | 本文不新增 console／page-error 公共结构或生命周期。 |
| `DO-PROVIDER-PRIVATE-SCHEMA` | `not-triggered` | 本文读取既有 Provider binding、bundle hash 和 support facts，不新增或改变 Provider-private 持久材料。W3 若发现需要新 schema，停止该部分并单独冻结合同。 |
| `DO-APP-IA` | `not-triggered` | 本文不新增 App 工作台、导航、Library、Activity 或布局；可信入口继续复用既有 owner facts。 |

本判定只适用于本 docs PR。W3 实施或验证如果改变稳定 wire、Plugin、Grant、Provider-private schema 或 App surface，必须按实际变更重新判断，不能把本表当作豁免。

### 10.2 与既有规格的补充和替代

本文是质量标准和 W3 计划，不复制既有状态、配置或 Provider 真相：

- [Profile Environment V1](profile-environment-v1.md) 继续拥有环境状态、字段 owner、pending／effective 语义和公共生命周期合同；本文补充如何用这些事实判断质量。
- [Camoufox Environment Continuity V1](camoufox-environment-continuity-v1.md) 继续拥有当前固定 upstream bundle、exact replay、私有材料和历史 #499 边界；本文明确历史 live 记录不能外推当前质量。
- [Provider Selection V1](provider-selection-v1.md) 继续拥有选择、默认和 binding；本文不把推荐、默认或最近使用当成组合事实。
- [Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md) 继续拥有 capability、授权、证据名称和完成边界；本文不把质量文档接受当成功能完成。
- [ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md) 和 [Provider 执行复用设计](../architecture/provider-execution-reuse-v1.md) 继续拥有 Qualification Gate、Provider 差异和“不实现／模拟／长期补偿核心浏览器语义”的边界。
- [#556](https://github.com/WebEnvoy/WebEnvoy/issues/556) 继续拥有正式观察／续读耗时的调查与优化取舍；本文只定义 W3 如何消费可取得的性能事实。

本文将以下容易混淆的判断固定为无效：marker 或目录存在不等于环境连续；一个检测页或挑战不等于隐身结论；更快不等于操作质量更好；接口存在不等于 Provider 已通过；一次历史成功不等于新版本、新平台或新执行方式通过。它们不会覆盖或改写既有合法历史事实。
