# 0006. Provider、Profile 与 Identity facts v0

## 状态

Accepted for Stage 2 docs-only contract, 2026-06-30.

Provider facts 继续有效；检测、安装、更新、修复和启动验证的生命周期由
[ADR 0009](0009-provider-lifecycle-management.md) 扩展，2026-07-14。

## 背景

Stage 2 FR #40 要冻结 Harbor 对 Core、Lode 和 App 可消费的 provider、Profile 与 Execution Identity facts v0。#41 覆盖事实词表，#42 覆盖 observed fact 与 provider claim 的区别，#43 覆盖 license、binary、secret 与 profile data 边界。

本 ADR 只定义 docs-only 合同，不实现 runtime/provider 代码、API schema、Profile 管理产品、browser smoke 或 provider enablement。

## v0 词表

| 字段或状态 | Harbor owner | Consumer | 有效性 / 过期规则 | 失败分类 | 非目标 |
|---|---|---|---|---|---|
| `provider_ref` | Harbor Provider Registry / Browser Driver | Core、App、Lode resource requirements | 不透明、不可猜测，引用 Harbor 已登记 provider record；绑定 provider type、engine、mode、source、capability facts、claim refs、license/binary boundary、validation evidence refs 和 known limitations；provider version、binary、license 或 capability validation 改变后旧 ref 只能作为历史证据。 | `provider_missing`、`provider_unverified`、`license_blocked`、`binary_unavailable`、`claim_without_evidence` | 不作为 provider 排名、站点通过率承诺、provider native id 或 launch flags 公共替代。 |
| `profile_ref` | Harbor Profile Manager | Core、App、Lode resource requirements | 不透明，引用 Harbor 持有或可连接的浏览器身份容器；绑定 provider_ref、ownership、storage/profile data boundary、proxy_ref、locale、timezone、viewport、user_agent、extensions、fingerprint facts、last_normal_at、running_state 和 invalidation reason；Profile 删除、ownership 改变、storage reset 或 policy revoke 后失效。 | `profile_missing`、`profile_locked`、`profile_invalid`、`profile_data_policy_denied` | 不包含 cookie、token、完整 storage、user_data_dir 绝对路径或 provider secret；不等同 Core Run Record。 |
| `execution_identity_ref` | Harbor Identity Manager | Core、App、Lode resource requirements | 不透明，引用站点/账号执行身份；绑定 site_id、account_ref、profile_ref、login_state、allowed_execution_channels、evidence_policy_ref、resource_requirement hints、risk/recovery events 和 usage history；账号解绑、login state 失效、policy revoke 或 profile_ref 失效后需要刷新。 | `identity_unknown`、`identity_login_required`、`identity_policy_denied`、`identity_profile_mismatch` | 不保存账号凭据明文；不判断任务业务成功、账号安全分或站点策略。 |
| `provider_capability_facts` | Harbor Browser Driver | Core resource matching、App health view、Lode requirements | 来自 driver 观测、配置回读或 validation evidence；至少区分 profile persistence、user_data_dir、proxy、locale/timezone/viewport/UA、extension、CDP、viewer、snapshot/evidence、provider-native fingerprint/patch support 和 known limitations；能力证据过期或 provider version 变化后降级为 stale。 | `capability_missing`、`capability_stale`、`unsupported`、`validation_required` | 不暴露 provider-specific flags 为公共合同；不承诺某网站可通过。 |
| `profile_facts` | Harbor Profile Manager | Core、App、Lode requirements | 记录浏览器身份容器的可观察状态：持久化类型、storage presence、proxy binding、环境 facts、extension facts、recent normal state、running state、invalid state 和 runtime events；状态随 session health、storage mutation、policy 和 user action 更新。 | `profile_missing`、`profile_locked`、`profile_invalid`、`profile_state_stale` | 不复制完整 Profile 目录、history、cookies、localStorage、sessionStorage、IndexedDB 或 private files。 |
| `identity_facts` | Harbor Identity Manager | Core admission、App identity view、Lode requirements | 记录 site/account/profile 绑定、login_state、allowed channels、evidence policy、recovery/risk events 和 usage history；login_state 必须来自 Harbor 可观察信号、用户确认或上层 ref，不得凭 provider marketing claim。 | `identity_unknown`、`login_state_unknown`、`identity_login_required`、`identity_policy_denied` | 不输出任务结果、业务字段、账号健康评分或 credential payload。 |
| `fact_source` | Harbor fact producer | Core、App、Lode | v0 枚举：`observed`、`configured`、`provider_claim`、`user_declared`、`derived`、`validation_evidence`；消费者必须能区分可执行事实和仅供参考的 claim。 | `source_unknown`、`claim_without_evidence` | 不把 claim 自动升级为 observed fact。 |
| `fact_ref` / evidence refs | Harbor Evidence / Diagnostics | Core、App | 对高敏材料只暴露脱敏 ref、redaction status、retention/export policy、captured_at、provider/profile/session refs 和 provenance；ref 过期、policy revoke 或 retention 删除后不可解引用。 | `evidence_unavailable`、`evidence_policy_denied`、`ref_expired` | 不把 raw evidence、raw endpoint、secret 或 profile data 作为公共字段。 |

## Observed fact 与 provider claim

| 类别 | 定义 | 可被 Core/Lode/App 如何消费 | 升级条件 | 失败分类 |
|---|---|---|---|---|
| Observed fact | Harbor 在本地或远程 runtime 中实际观测、配置回读、health check 或 validation evidence 证明的事实。 | Core 可用于 resource matching；Lode 可声明 requirement；App 可展示状态和限制。 | 绑定 source_trace、captured_at、producer、provider/profile/session refs 和有效期。 | `fact_missing`、`fact_stale`、`validation_required` |
| Configured fact | Harbor 请求或保存的配置，例如 proxy_ref、timezone、viewport、provider mode。 | 只能说明请求配置，不能单独证明 provider 已生效。 | provider 回读、runtime observation 或 validation evidence 后可补 observed fact。 | `configured_not_observed`、`provider_mismatch` |
| Provider claim | provider README、文档、license page、marketing copy、upstream wiki 或 binary release 声明。 | 只能作为候选 provider 信息、evaluation input 或 App 警示；Core 不得把它当作满足 requirement 的证据。 | 通过 Harbor-controlled validation evidence 或 runtime smoke 后，另行记录 observed fact；claim 本身仍保留 claim 来源。 | `claim_without_evidence`、`unverified_success_claim` |
| User declared fact | 用户或管理员声明的账号、Profile、授权或安装事实。 | App 可展示，Core 可要求进一步验证；不能自动替代 Harbor observation。 | 用户授权 + Harbor 可观察验证，或明确 policy 允许仅以声明为准。 | `authorization_required`、`declaration_unverified` |
| Derived fact | Harbor 从多个 observed/configured facts 推导的状态，例如 continuity/profile mismatch。 | 可用于错误分类和 admission input，但必须保留输入 refs。 | 输入 facts 仍有效且推导规则版本未变。 | `derived_from_stale_input` |

## 数据与授权边界

| 内容 | 是否进入 Harbor public facts | 允许表达方式 | 拒绝或 deferred 边界 | 失败分类 |
|---|---|---|---|---|
| Provider source/license | 是 | source locator、license id/ref、terms status、reviewed_at、evidence ref。 | 不把法律结论伪装成技术 fact；正式 enablement 仍由 provider evaluation 决定。 | `license_unknown`、`license_blocked` |
| Provider binary | 只进入 metadata/ref | binary source、version、checksum/ref、install source、redistribution/SaaS/OEM boundary status。 | 不提交 binary，不静默下载，不把 wrapper license 套到 binary。 | `binary_unavailable`、`redistribution_not_allowed` |
| Provider secret/API key | 否 | `secret_ref`、presence status、provider account boundary、policy_denied reason。 | 不进入 Harbor facts、ADR、PR、logs、evidence 或 Core/Lode/App payload。 | `secret_required`、`secret_policy_denied` |
| Profile data | 只进入 ref/metadata | profile_ref、ownership、storage class、persistence status、redaction status、retention/export policy。 | cookies、tokens、credentials、history、full storage、full user_data_dir、private files 不进入公共合同。 | `profile_data_policy_denied`、`sensitive_data_refused` |
| Account/login state | 只进入 identity facts | account_ref、site_id、login_state、last_observed_at、verification source。 | credential payload、2FA secret、recovery codes、private account data 不进入合同。 | `identity_login_required`、`credential_refused` |
| Fingerprint/stealth facts | 部分进入 facts | capability presence、configured values、observed consistency、provider claim refs、validation refs。 | 不输出通过率、黑盒风险分、target-site guarantee。 | `unverified_success_claim`、`unsupported` |
| Viewer/CDP endpoint | 只进入 capability/ref | viewer_ref、cdp_ref、access boundary、availability、policy status。 | 不裸露 raw CDP/VNC URL 给 Core/Lode/App 公共合同。 | `viewer_unavailable`、`cdp_unavailable`、`policy_denied` |

## 与 Runtime Session lifecycle v0 的关系

ADR 0005 定义 `runtime_session_ref` 的生命周期、lease、continuity 和 unavailable 分类。本 ADR 定义它绑定的 provider/profile/identity facts。

- `runtime_session_ref` 必须绑定 `provider_ref`、`profile_ref` 和可选 `execution_identity_ref`，但 ref 本身不携带 secret、cookie、token、profile path、raw CDP URL 或 raw viewer URL。
- `continuity_key` 使用同一 `runtime_session_ref`、同一 `profile_ref`、同一 `execution_identity_ref`、未进入不可恢复终态且 lease 未被其他 owner 替换来判断连续性。
- session availability 可以消费 provider/profile/identity facts，但 provider claim 不能让 session 从 `unsupported` 或 `validation_required` 升级为可执行状态。
- Core 只消费 refs、facts、availability 和 evidence refs；Core 拥有 admission、Run Record 和 task outcome。
- Lode 只声明 resource requirements，例如 persistent Profile、已登录 identity、proxy binding、snapshot support 或 manual takeover，不保存 Harbor private state。
- App 展示 provider/profile/identity/session 状态、授权和 handoff intent，但不把 Harbor facts 重新解释为业务成功保证。

## 研究吸收 / 复用判断

| locator | 判断 | 理由 | 落点 |
|---|---|---|---|
| `Harbor/ROADMAP.md` | 吸收 | Stage 2 明确要求最小 runtime facts、session refs、provider/profile/identity facts；本 ADR 冻结合同而不进入 implementation。 | v0 词表、非目标、Runtime Session 关系。 |
| `docs/adr/pending-decisions.md` | 裁剪复用 | 已接受 facts 归属与 provider baseline 边界；PD-0003/0005/0007 仍保留字段 schema、validation evidence 格式和 provider enablement gate，不阻塞 docs-only v0。 | v0 表格与 deferred 决策。 |
| `docs/adr/0002-profile-session-and-provider-facts.md` | 吸收 | 已定义 Profile、Execution Identity、Runtime Session、provider_facts 与配置/观测/claim/evidence 分层。 | 本 ADR 词表和 fact_source。 |
| `docs/adr/0005-runtime-session-lifecycle-v0.md` | 吸收 | 已冻结 session ref、lease、continuity、unavailable 分类；本 ADR 只补 session 绑定的 provider/profile/identity facts。 | Runtime Session 关系。 |
| `research/synthesis.md` | 吸收 | 已接受 runtime facts 与 task policy 必须拆开、CloakBrowser 是 provider baseline、Manager 是参考实现、hosted/vault/persona 不吸收。 | Core/Lode/App 消费边界和 provider claim 限制。 |
| `research/absorability/README.md` | 只参考 | 该文件定义 research 分层，不提供字段语义；本 ADR 遵循其“不替代 Harbor 正式规格”的边界。 | 研究吸收表。 |
| `research/absorability/Harbor/runtime-provider-profile-viewer.md` | 吸收 | 已收敛 provider facts、Profile、Runtime Session、Viewer/CDP refs 的最小模型，并明确 Manager 不整体迁入。 | `provider_ref`、`profile_ref`、session 绑定与 Viewer/CDP ref 边界。 |
| `research/absorability/themes/browser-identity-and-runtime.md` | 裁剪复用 | 吸收 Profile 作为持久浏览器身份容器、Runtime Session 绑定 provider/profile/viewer/CDP 的机制；拒绝将外部 Profile schema、内存 RunningProfile 或用户日常 Chrome 默认作为 WebEnvoy 合同。 | Profile facts、provider modes、非目标。 |
| `research/absorability/themes/anti-detection-and-provider-facts.md` | 吸收 | 吸收 wrapper license 与 binary license 分离、provider facts 分层、claim 需要 runtime evidence；拒绝 README 成功率和 provider flags 公共化。 | claim 表、license/binary/secret 表。 |
| `research/subjects/CloakHQ/CloakBrowser/wiki/index.md` | 只参考 | 该 locator 只证明 CloakBrowser wiki 已完整捕获；本 PR 不做 provider adoption、源码复用、binary/license 审查或 runtime smoke。 | 非目标；provider evaluation deferred。 |
| `sources/CloakHQ/CloakBrowser-Manager` | 裁剪复用 | 只吸收 Profile Runtime、Viewer/VNC、CDP proxy、provider args adapter 机制；不整体迁入 backend/frontend、内存 session 或 provider-specific lifecycle。 | Provider/Profile/Viewer/CDP refs 边界。 |
| hosted browser / vault / persona 平台 | 拒绝 | secret、payment、persona、provider service 和真实账号托管边界过宽，超出 Stage 2 facts v0。 | 数据与授权边界；deferred/non-goals。 |

## Deferred 决策

- PD-0003 仍定义首版版本化字段集和 API schema；本 ADR 只冻结可消费事实形状。
- PD-0005 仍定义最小 provider validation evidence 格式；本 ADR 只要求 claim 与 observed fact 分层。
- PD-0007 已由 [ADR 0009](0009-provider-lifecycle-management.md) 解决；provider
  enablement 必须提供来源、许可、版本、OS/arch、完整性材料和启动验证。本 ADR
  继续只定义 public facts 可记录哪些 metadata/ref。
- PD-0010/0012 仍定义 handoff/control ownership 与 Viewer MVP；本 ADR 只说明 session refs 如何绑定 facts。

## 非目标

- 不新增 runtime/provider 代码、browser driver、Profile manager、Identity manager、API schema、OpenAPI、database schema、browser smoke、hosted runtime 或 provider evaluation packet。
- 不扩大到 #44/#48/#53，不关闭 #40/#41/#42/#43，不 merge。
- 不把 provider claim、anti-detection marketing、binary availability 或真实账号状态写成 WebEnvoy 成功率承诺。
