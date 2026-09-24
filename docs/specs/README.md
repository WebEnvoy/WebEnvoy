# WebEnvoy 规范性规格

本目录定义 WebEnvoy 已确认产品与架构边界下的规范性语义：某项能力、对象或状态“支持”是什么意思，以及实现和验收必须满足什么。

Spec 不维护当前交付状态，不替代 canonical 产品范围，也不直接冻结所有 wire 字段。最终 HTTP／MCP／JSON Schema、生成类型和 migration 在具体实现需要时建立，并由 [`docs/contracts/README.md`](../contracts/README.md) 索引。

## 当前规格

| 规格 | 归口 | 作用 |
| --- | --- | --- |
| [CLI and Upstream Integration V1](cli-integration-v1.md) | [S1 #562](https://github.com/WebEnvoy/WebEnvoy/issues/562)、[集成 FR #474](https://github.com/WebEnvoy/WebEnvoy/issues/474) | 经独立审查并合入 main 后作为 Accepted 实施基线：无 App 首次信任、可信本地用户域与 Agent plane 的角色／Grant／控制边界、CLI/API/Plugin 映射、独立现场控制、跨入口结果及正式安装合同；不声称同 UID OS 进程隔离，也不表示 W1/W2 已实现或验证。 |
| [Model Usage V1](model-usage-v1.md) | [产品 FR #558](https://github.com/WebEnvoy/WebEnvoy/issues/558)、[条件验证 #559](https://github.com/WebEnvoy/WebEnvoy/issues/559) | Proposed：通用模型配置、用途、外发与费用、有界网页循环、DONE/BLOCKED、接管／交回和结果核验；非 V1 发布阻塞，不表示模型已支持。 |
| [Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md) | [Runtime FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497) | 定义 V1 Browser Runtime capability 类别、支持／证据状态、权限、数据边界、恢复和完成条件。 |
| [Page, Document and Navigation Runtime Contract V1](page-navigation-runtime-contract-v1.md) | [Runtime FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497)、[Native tab handoff #510](https://github.com/WebEnvoy/WebEnvoy/issues/510) | 冻结同一 Instance 内多 Page、document generation、popup/opener、URL/origin authorization、redirect、bounded close tombstone、native tab handoff 的 Page/ref 连续性、旧观察失效、receipt 与关系异常安全暂停语义。 |
| [Profile Environment V1](profile-environment-v1.md) | [Provider／环境 FR #471](https://github.com/WebEnvoy/WebEnvoy/issues/471) | 定义长期 Profile 环境的 configured／effective／pending／observed／drift、Provider owner、连续性和验证。 |
| [Browser Environment Quality V1](browser-environment-quality-v1.md) | [规格 #567](https://github.com/WebEnvoy/WebEnvoy/issues/567)、[质量基线 #570](https://github.com/WebEnvoy/WebEnvoy/issues/570) | 合入后生效的固定组合质量标准、证据要求和回归计划，分别判断连续性、隔离、隐身、操作与性能；不表示实际质量验证完成。 |
| [Provider Selection and Creation Default V1](provider-selection-v1.md) | [Work Item #516](https://github.com/WebEnvoy/WebEnvoy/issues/516) | 冻结项目推荐、用户新建默认、本次选择与 Profile binding 的分离，以及 Harbor 持久化、App/Plugin、Grant、幂等与兼容语义；Agent 创建前 Provider 事实投影见 [Schema](../../packages/schemas/schemas/provider-preference-read-result.schema.json)。 |
| [Network Runtime Contract V1](network-runtime-contract-v1.md) | [Work Item #498](https://github.com/WebEnvoy/WebEnvoy/issues/498) | 冻结 bounded Network metadata、Page binding、cursor、脱敏和生命周期语义。 |
| [Console Runtime Contract V1](console-runtime-contract-v1.md) | [Work Item #498](https://github.com/WebEnvoy/WebEnvoy/issues/498) | 冻结 console/page-error levels、文本截断脱敏、source location 和生命周期语义。 |
| [Plugin Runtime Exposure V1](plugin-runtime-exposure-v1.md) | [Work Items #498](https://github.com/WebEnvoy/WebEnvoy/issues/498)、[#508](https://github.com/WebEnvoy/WebEnvoy/issues/508) | 固定诊断与已安装 SKILL capability→MCP projection、版本、availability、授权与恢复语义。 |
| [Observation Completeness and Target Identity V1](observation-targets-v1.md) | [Work Item #540](https://github.com/WebEnvoy/WebEnvoy/issues/540)、[#497](https://github.com/WebEnvoy/WebEnvoy/issues/497)、[#474](https://github.com/WebEnvoy/WebEnvoy/issues/474) | 已接受的 Page/Plugin 专门补充：snapshot 完整性、同批续读、标签/同名上下文、真实目标身份、局部失效、版本和 O1—O10 验收；不新增权限或浏览器后端。 |
| [Form State and Target Actionability V1](form-state-actionability-v1.md) | [Work Item #555](https://github.com/WebEnvoy/WebEnvoy/issues/555)、[#497](https://github.com/WebEnvoy/WebEnvoy/issues/497)、[#474](https://github.com/WebEnvoy/WebEnvoy/issues/474) | 已接受的 Observation/Plugin 专门补充：在可信 target 上冻结普通表单当前状态、目标级既有动作适用性、状态新鲜度、准确未派发拒绝、兼容与 S1—S9 验收；不新增 planner、权限或浏览器能力。 |
| [Capability Discovery and Operation Guidance V1](capability-discovery-v1.md) | [Work Item #539](https://github.com/WebEnvoy/WebEnvoy/issues/539)、[#474](https://github.com/WebEnvoy/WebEnvoy/issues/474) | 已接受实施合同：单 operation 的静态规则与上下文说明、五维状态、只读无派发、单一参数定义、版本和验收；不表示已实现或新增执行权限。 |
| [Camoufox Environment Continuity V1](camoufox-environment-continuity-v1.md) | [Camoufox 环境连续性 #499](https://github.com/WebEnvoy/WebEnvoy/issues/499)、[#519](https://github.com/WebEnvoy/WebEnvoy/issues/519) | 冻结 #519 官方固定来源、完整 `launch_options`/`context_options` exact replay、popup 受限边界和 #499 历史 continuity；不暴露私有材料，installed/live evidence 另行记录。 |
| [Camoufox Native Provider Contract V1](camoufox-native-provider-contract-v1.md) | [Phase 1 native Camoufox validation #504](https://github.com/WebEnvoy/WebEnvoy/issues/504)、[Native tab handoff #510](https://github.com/WebEnvoy/WebEnvoy/issues/510)、[Runtime FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497) | 历史 test-only Camoufox native snapshot、Playwright adapter、固定构件、Page relation、background create、safe-return close、reload 适配、v2 native tab-handoff/CSS variant 及兼容/回滚边界；2026-09-12 起不作为当前 launch/support 路线，现行退役事实见规格正文。 |
| [Installed Profile Recovery V1](installed-profile-recovery-v1.md) | [安装 Profile 接续与恢复 #505](https://github.com/WebEnvoy/WebEnvoy/issues/505) | 定义已安装更新/重装的数据 root 接续、受管 Profile backup/plan/apply、owner 确认、撤销/历史保留和 fail-closed 语义。 |
| [Managed SKILL Library Lifecycle V1](skill-library-lifecycle-v1.md) | [Work Item #508](https://github.com/WebEnvoy/WebEnvoy/issues/508)、[S3 #564](https://github.com/WebEnvoy/WebEnvoy/issues/564) | 固定可选 SKILL 的来源身份、受管 data-root 生命周期、八个 `webenvoy_skills` operation、内容/receipt、CAS、局部失败与恢复语义；S3 补充外部导入、草稿、显式本地覆盖与修复的行为基线，不表示入口或执行器已实现。 |
| [Site SKILL Execution V1](site-skill-execution-v1.md) | [S2 #563](https://github.com/WebEnvoy/WebEnvoy/issues/563)、[资产 FR #475](https://github.com/WebEnvoy/WebEnvoy/issues/475) | 经独立审查并合入 main 后作为 Accepted 实施基线：固定版本站点任务的准入、调用、输入输出、执行边界、目标新鲜度及失败恢复；Lode 包格式由跨仓唯一合同拥有，不表示执行器或真实站点已支持。 |
| [Managed Browser Files V1](browser-files-v1.md) | [Work Item #523](https://github.com/WebEnvoy/WebEnvoy/issues/523)，授权语义 [#544](https://github.com/WebEnvoy/WebEnvoy/issues/544) | 冻结 owner 文件材料、`file.upload`/`file.download` 的 Page/ControlLease/Grant 绑定、受限格式与配额、原子持久化、结果/对账、撤销/过期，以及 legacy/v2 下载归属边界。 |
| [Grant Wire Contract V1 (v1.5)](grant-wire-contract-v1.md) | [Work Items #505](https://github.com/WebEnvoy/WebEnvoy/issues/505)、[#508](https://github.com/WebEnvoy/WebEnvoy/issues/508)、[#516](https://github.com/WebEnvoy/WebEnvoy/issues/516)、[#544](https://github.com/WebEnvoy/WebEnvoy/issues/544)、[#547](https://github.com/WebEnvoy/WebEnvoy/issues/547)、[#563](https://github.com/WebEnvoy/WebEnvoy/issues/563) | 固定 recovery、SKILL/file scope、Provider preference、`scope_semantics`、owner v2 Grant/policy lifecycle、site-task operation 与请求范围、digest CAS、可信 stopped、严格 reader 拒绝和历史兼容边界。 |

## 已登记、尚未编写的规格

| 代号 | 真实 Issue | 计划归口 |
| --- | --- | --- |
| S4 | [#565](https://github.com/WebEnvoy/WebEnvoy/issues/565) | 主动 Network 能力；扩展现有 Network 合同。 |
| S5 | [#566](https://github.com/WebEnvoy/WebEnvoy/issues/566) | 视觉观察与交互；与 Page、Grant、控制和外发边界对齐。 |

本批不创建上述空 spec、schema、fixture 或验证报告。Spec Issue 关闭只表示规范已接受，不表示对应功能、真实 Agent 路径或 V1 验收已经完成。

## 可选模型辅助的设计义务（Proposed）

- #558/#559：方向与行为由 [ADR 0013](../adr/0013-optional-model-assisted-browser-tasks.md) 和 [Model Usage V1](model-usage-v1.md) 承接，正式接受须先完成 canonical 对应修订；不以文档接受、SDK 接口或模型目录可见冒充功能完成。
- 正式模型能力发现／任务委托／查询／退出投影形成时，`DO-PLUGIN-EXPOSURE = triggered`；新增可委托模型使用、数据外发或持久跨进程授权字段时，`DO-GRANT-WIRE = triggered`，不能继承 #555 的 `not-triggered`。
- 完整模型设置、导航或活动工作台改变时，`DO-APP-IA = triggered`；无论是否触发完整 IA，最小 owner 配置、外发、费用和停止入口都必须定义并验收。Browser、Network、Console 和 Provider-private schema 未实际改变时不扩围，实际改变时重判。
- 本轮仅建立语义和采用边界，不新增运行依赖、字段枚举、空 schema/fixture、持续监控或空验证报告；#555/#556/#557 独立推进，模型方向不增加当前 V1 发布阻塞。

## 使用规则

1. 先读取组织级 [canonical 产品规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md) 和适用 Accepted ADR。
2. Spec 定义语义；Issue 定义当前交付切片；verification 只保存实际证据。
3. 当前实现缺失不能反向缩小 spec；需要缩小 V1 范围时先更新产品决策。
4. Provider 私有 API、站点 selector、临时测试字段和未经接受的草稿不能进入公共 spec。
5. 规格中尚未冻结的 wire 名称应在实现 Work Item 中通过真实 schema／fixture（存在后再链接）、兼容和迁移说明收敛；不得虚构 fixture 路径或验收证据。
6. 新 spec 必须声明状态、版本、owner、产品依据、架构依据和非目标。

## Design Obligation Gate

Design Obligation Gate 用来防止“代码已经实现，但对应架构／spec／wire contract 被遗忘”。它不是第二套规划状态机，也不要求提前创建空文档。

Work Item 进入实现前，作者必须逐项判断以下 trigger，并在 Issue/PR 中记录 `triggered`、`not-triggered` 或 `conditional`。一旦 trigger 成立，对应 artifact 自动成为该 Work Item 的 Definition of Done；未完成就不能把 Work Item 标记为 `completed`。

| ID | 触发条件 | 触发后必须形成的正式 artifact |
| --- | --- | --- |
| `DO-PLUGIN-EXPOSURE` | 新增动态 capability discovery；按 Grant／SKILL／宿主过滤工具；同一 Runtime capability 出现新的 Agent tool projection；或需要第二宿主复用 exposure 规则 | 新建或更新 `docs/specs/plugin-runtime-exposure-v1.md`，冻结 capability→tool projection、availability、版本、过滤和错误语义 |
| `DO-GRANT-WIRE` | 新增或改变持久化／跨进程 Grant 维度，例如 Network body、request modification、controlled evaluation、storage、Account／Environment／SKILL 管理权 | 新建或更新 `docs/specs/grant-wire-contract-v1.md`；若实现冻结 wire，同步更新正式 schema／fixture／migration |
| `DO-NETWORK-CONTRACT` | 第一次形成稳定跨 Driver→Harbor→Core→Plugin 的 Network public payload，或新增 response body、intercept、modify 等公共能力 | 新建或更新 `docs/specs/network-runtime-contract-v1.md`，冻结 operation/event/result、生命周期、敏感字段过滤、权限、Page/Instance binding 和结束/丢失语义 |
| `DO-CONSOLE-CONTRACT` | 第一次形成稳定跨层 console／page-error public payload，或扩展日志级别、source、exception 等公共结构 | 新建或更新 `docs/specs/console-runtime-contract-v1.md`，冻结公共错误结构、截断、脱敏、Page binding、生命周期和权限 |
| `DO-PROVIDER-PRIVATE-SCHEMA` | WebEnvoy 开始持久化 Provider-specific environment bundle、fingerprint/seed config、provider config version 或启动回灌结构 | 建立 versioned Provider-private contract/schema，并说明 owner、迁移、兼容与回滚；若事实证明全部由 Provider/Profile 自持久化，则记录明确的 `not-triggered` 证据，不创建空 schema |
| `DO-APP-IA` | 有明确重启 App 产品化的决定，并开始新增或重构完整资源工作台、全局导航、Library／Activity、多实例管理等正式产品 surface | 更新现有 App IA 权威文档或创建被明确指定的新 IA/architecture；可信 CLI／宿主确认不是重启整个工作台，不得由 UI 组件反向发明对象、状态或权限 |

### 判定规则

- `triggered`：条件已经成立；必须链接本 Work Item 要创建／更新的正式 artifact。
- `conditional`：当前尚未成立，但实现过程中出现明确条件就自动转为 `triggered`；必须写出该条件。
- `not-triggered`：必须给出具体理由，例如“复用既有稳定 payload，未新增 wire 字段或 tool projection”；不能只写 `N/A`。
- 一个 Work Item 可以触发多个 obligation；不要为了减少文档工作而把不同风险合并成一个模糊 spec。
- 探索性内部代码可以先验证；稳定跨进程接口、Plugin tool、持久字段、enum、Grant 维度或 Provider-private versioned config 不得先成为正式依赖，再把 spec 留给未来。
- Issue body、PR 描述、fixture、代码类型和测试用例可以作为证据，但不能替代已经触发的正式 artifact。

### 当前已知映射

- #562：CLI、可信用户控制和跨入口语义由 [CLI and Upstream Integration V1](cli-integration-v1.md) 承接；Design Obligation 逐项判定见该规格第 13 节，功能和安装证据由 W1/W2 分别交付。
- #563：`DO-PLUGIN-EXPOSURE`、`DO-GRANT-WIRE = triggered`，由 [Site SKILL Execution V1](site-skill-execution-v1.md)、Plugin exposure 和 Grant wire 的窄增量共同承接；其余逐项判定见执行规格第 10 节。Lode 唯一拥有包格式，文档接受不表示执行器或真实站点验收完成。
- #564：稳定流程合同由 [Lifecycle 的 S3 补充](skill-library-lifecycle-v1.md#s3-外部导入草稿与本地覆盖) 与 [Lode 站点创作／导入指南](https://github.com/WebEnvoy/Lode/blob/f1a8cc3d4ad1757af2c5aac0960b8e15ce106bc5/docs/contracts/site-asset-authoring-import-v1.md)承接。`DO-PLUGIN-EXPOSURE`、`DO-GRANT-WIRE = conditional`：本规格复用 #508/S2 既有 operation 与身份，不新增 wire；后续来源准入或草稿/overlay 管理若新增正式投影或持久授权字段，必须先更新各自 owner 合同再实现。`DO-NETWORK-CONTRACT = conditional`：OpenCLI 分类不授予主动 Network、body 或外发；实际任务需要时先接受 S4 对应合同。`DO-CONSOLE-CONTRACT`、`DO-PROVIDER-PRIVATE-SCHEMA`、`DO-APP-IA = not-triggered`：不新增诊断 payload、Provider 配置或 App surface。转换报告和离线样例不构成真实站点、执行器或 V1 验收。
- #498：`DO-NETWORK-CONTRACT = triggered`、`DO-CONSOLE-CONTRACT = triggered`；`DO-PLUGIN-EXPOSURE` 与 `DO-GRANT-WIRE` 在新增动态 exposure policy 或新 Grant wire dimension 时转为 `triggered`。
- #499：`DO-PROVIDER-PRIVATE-SCHEMA = triggered`；固定版本 Camoufox 的 `launch_options()` 会生成必须由 WebEnvoy 重放的 fingerprint/config/seed 材料，正式私有合同见 [Camoufox Environment Continuity V1](camoufox-environment-continuity-v1.md)。#499 的历史 bundle/验收本身不授予当前 launchability；该合同的当前上游 addendum 由 #519 重新承接。`DO-PLUGIN-EXPOSURE` 与 `DO-GRANT-WIRE` 复用既有 operation/Grant 结构，不新增持久维度。
- #505：`DO-PLUGIN-EXPOSURE = triggered`，恢复 projection 见 [Plugin Runtime Exposure V1](plugin-runtime-exposure-v1.md)；`DO-GRANT-WIRE = triggered`，恢复值与单计划确认见 [Grant Wire Contract V1](grant-wire-contract-v1.md)；`DO-PROVIDER-PRIVATE-SCHEMA = conditional`，仅当改变 Camoufox 私有 bundle/兼容规则时转为 triggered，恢复默认沿用 [Camoufox Environment Continuity V1](camoufox-environment-continuity-v1.md)。
- #508：`DO-PLUGIN-EXPOSURE = triggered`，固定 `webenvoy_skills` 与八个 SKILL operation 见 [Plugin Runtime Exposure V1](plugin-runtime-exposure-v1.md)；`DO-GRANT-WIRE = triggered`，`skill_scope`、task scope、旧 Grant 读取和旧严格 reader 拒绝边界见 [Grant Wire Contract V1](grant-wire-contract-v1.md)；SKILL 生命周期与内容/receipt 见 [Managed SKILL Library Lifecycle V1](skill-library-lifecycle-v1.md)。`DO-NETWORK-CONTRACT`、`DO-CONSOLE-CONTRACT`、`DO-PROVIDER-PRIVATE-SCHEMA`、`DO-APP-IA` 为 `not-triggered`：本项不改变这些边界。
- #504：`DO-PLUGIN-EXPOSURE = triggered`，Page list/open/activate/close/navigation 与固定版本投影见 [Plugin Runtime Exposure V1](plugin-runtime-exposure-v1.md)；`DO-NETWORK-CONTRACT = triggered`、`DO-CONSOLE-CONTRACT = triggered`，Page/document/cursor binding 与有界诊断见各自合同；`DO-GRANT-WIRE = not-triggered`，复用单一有效 Grant 的既有 `profile_refs`、`allowed_origins`、`allowed_operations` 交集；`DO-PROVIDER-PRIVATE-SCHEMA = triggered`，固定 native snapshot、Playwright adapter、Camoufox test artifact 与 reload 适配的 versioned 私有合同见 [Camoufox Native Provider Contract V1](camoufox-native-provider-contract-v1.md)，该判断只描述历史 test-only artifact，不是当前 launch/support 承诺；`DO-APP-IA = not-triggered`，沿用现有最小 owner/handback 入口，不新增完整 App 工作台。关系无法证明时必须 `page_relation_unavailable` 并暂停受影响 Instance 派发，缺失 receipt 必须保留 `unknown_outcome`/`dispatched`，详见 Page 合同。
- #510：`DO-PROVIDER-PRIVATE-SCHEMA = triggered`，独立 v2 `managed-native-tab-handoff` artifact、精确 `chrome.css` source/output hash、Juggler native swap lifecycle 与 Page/target/`BrowsingContext` continuity 见 [Camoufox Native Provider Contract V1](camoufox-native-provider-contract-v1.md)；公共 Page 语义（同一 `page_id` 的 location handoff、旧 observation/interaction/cursor 失效、partial/unknown 安全暂停与 fresh reobserve recovery）见 [Page, Document and Navigation Runtime Contract V1](page-navigation-runtime-contract-v1.md)。这些是历史 test-only 设计；当前 Camoufox launch binding 已退役，本项不新增 Plugin tool、Grant wire 或 App IA。
- #519：`DO-PROVIDER-PRIVATE-SCHEMA = triggered`，固定官方 `webenvoy.camoufox-upstream/v1` 安装来源和版本，以及 `.webenvoy-camoufox-environment.v1.json` 中完整 public `launch_options`/`context_options` exact replay 由 [Camoufox Environment Continuity V1](camoufox-environment-continuity-v1.md) 承接；`DO-PLUGIN-EXPOSURE`、`DO-GRANT-WIRE`、`DO-NETWORK-CONTRACT`、`DO-CONSOLE-CONTRACT` 和 `DO-APP-IA` 均 `not-triggered`，因为复用既有 operation、Grant、Network/Console envelope 和 owner 入口。popup 首导航局部拒绝、普通 Page 恢复和 click `dispatched`/子请求 `not_dispatched` 的语义见 [Page](page-navigation-runtime-contract-v1.md)、[Network](network-runtime-contract-v1.md) 与 [Plugin](plugin-runtime-exposure-v1.md)。静态来源与 fixture/code 检查不等于 installed/live/plugin verified；#519 完成门仍须现场回写。
- #516：偏好持久字段与选择结果由 [Provider Selection V1](provider-selection-v1.md) 冻结；`DO-PLUGIN-EXPOSURE = triggered`，正式 MCP operation/字段见 [Plugin Runtime Exposure V1](plugin-runtime-exposure-v1.md)；`DO-GRANT-WIRE = triggered`，独立偏好权限和固定／动态模板兼容见 [Grant Wire Contract V1](grant-wire-contract-v1.md)；`DO-APP-IA = not-triggered`，只扩展现有 Provider／Profile 最小入口；`DO-PROVIDER-PRIVATE-SCHEMA`、Network、Console 均 not-triggered，因为未新增 Provider-private 材料或这些能力的公共 wire。
- #523：`DO-PLUGIN-EXPOSURE = triggered`，`webenvoy_operation` 的 `file.upload`/`file.download`、`webenvoy_query` 对账与固定结果边界见 [Managed Browser Files V1](browser-files-v1.md) 和 [Plugin Runtime Exposure V1](plugin-runtime-exposure-v1.md)；`DO-GRANT-WIRE = triggered`，`file_scope`、`task_scope.file_refs` 与旧 Grant 严格拒绝见 [Grant Wire Contract V1](grant-wire-contract-v1.md)；`DO-NETWORK-CONTRACT = triggered`，下载 Page/请求归属、redirect guard 与未归属拒绝见 [Network Runtime V1](network-runtime-contract-v1.md)。`DO-CONSOLE-CONTRACT`、`DO-PROVIDER-PRIVATE-SCHEMA`、`DO-APP-IA` 为 `not-triggered`：本切片不新增 Console payload、Provider-private bundle 或完整 App 工作台。
- #544：`DO-GRANT-WIRE = triggered`，`scope_semantics`、v0缺省legacy、v1严格reader及owner一次确认见 Grant Wire v1.4；`DO-NETWORK-CONTRACT = triggered`，页面操作范围与可选逐请求保护分层见 Network v1.2；`DO-PLUGIN-EXPOSURE = triggered`，现有owner授权面增加确认、普通Agent schema不增加后端/语义选择；Files/Page合同同步v2归属与自然越界脱敏。Console payload、Provider-private schema和完整App IA不变。
- #547：`DO-GRANT-WIRE = triggered`，owner v2 Grant/policy 的完整输入、digest CAS、source/replacement 生命周期、可信 stopped 和 409 冲突见 [Grant Wire Contract V1](grant-wire-contract-v1.md)；`DO-PLUGIN-EXPOSURE = not-triggered`，Plugin/MCP 不增加 owner mutation 或 Agent schema，仅补充刷新授权说明；`DO-APP-IA = not-triggered`，复用既有最小 AgentAccessPanel、owner files 选择和确认入口；Network、Console、Provider-private schema 不变。

- #539：`DO-PLUGIN-EXPOSURE = triggered`，单一 `webenvoy_describe` 与只读 Core/Harbor 合同见 [Capability Discovery V1](capability-discovery-v1.md) 及 [Plugin exposure](plugin-runtime-exposure-v1.md)。`DO-GRANT-WIRE = not-triggered`：复用既有 Profile 元数据可见性和目标授权判定，不新增持久维度；Network/Console/Provider-private schema/App IA不变。真实schema/fixtures在实现PR建立，docs PR不冒充功能完成。

- #540：`DO-PLUGIN-EXPOSURE = triggered`；Page/Observation 与 Plugin snapshot 的新增输入/输出、continuation、目标语义和错误合同集中于 [Observation Targets V1](observation-targets-v1.md)（Accepted）。该专门补充已接受并优先规定所列观察变化，其余 [Page](page-navigation-runtime-contract-v1.md) 与 [Plugin](plugin-runtime-exposure-v1.md) 条款保持。Grant、Network/Console、Provider-private schema 和完整 App IA 为 not-triggered；真实 schema/fixtures 与安装配对由实现 PR 完成，规格接受不表示 #540 功能已交付。

- #555：`DO-PLUGIN-EXPOSURE = triggered`；目标当前状态、target-local 既有动作适用性、状态新鲜度、`target_state_changed`／`target_operation_not_applicable` 与正式 Plugin projection 集中于 [Form State and Target Actionability V1](form-state-actionability-v1.md)（Accepted）。该文件作为 Observation/Plugin 专门补充；其余 #539/#540、Grant、Page、Run、ControlLease 和 unknown/no-replay 条款保持。`DO-GRANT-WIRE`、Network/Console、Provider-private schema、App IA 为 not-triggered；真实 schema/fixtures 与 installed/plugin evidence 由实现 PR 建立，spec PR 不冒充功能完成。

- #556：调查阶段 `DO-PLUGIN-EXPOSURE / DO-GRANT-WIRE / DO-PROVIDER-PRIVATE-SCHEMA / DO-APP-IA = not-triggered`：只测量现有正式观察／续读路径并给出 A/B/C 取舍，不新增产品 wire、权限或持续 telemetry。若后续优化实际改变 observation projection、缓存生命周期或跨进程合同，必须在独立实现项重新触发对应 Design Obligation。
