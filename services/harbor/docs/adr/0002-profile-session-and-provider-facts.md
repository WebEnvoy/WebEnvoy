# 0002. Profile、Session 与 Provider 事实

## 状态

草案，2026-06-29。

## 背景

Harbor 必须向 WebEnvoy Core、Lode 和 App 提供稳定的浏览器运行时边界。现有草稿已经拆分了 Profile、Execution Identity、Runtime Session、Browser Driver、Evidence Store 和 Runtime Capability Facts。

主要风险是把 Harbor 做成站点任务系统，或做成某个 provider 专用的浏览器 wrapper。Harbor 应暴露客观 runtime facts 和引用。Core、Lode、用户策略和 App 再基于这些 facts 判断任务是否可运行、是否需要人工接管、应保留哪些证据。

## 决策

Harbor 输出 runtime facts 和引用。Harbor 不输出业务结果、站点 schema、provider 排名或任务适配结论。

Harbor 应暴露这些事实组：

- `profile_ref` 与 Profile facts：持久浏览器身份容器、user data directory 所有权类型、Cookie/storage 是否存在、proxy 绑定、locale、timezone、viewport、user agent、extensions、last known normal state、running state、invalid state 和近期 runtime events。
- `identity_ref` 与 Execution Identity facts：`site_id`、`account_ref`、关联 Profile、login state、allowed execution channels、resource requirements、evidence policy、recovery/risk events 和 usage history。
- `runtime_session_ref` 与 Runtime Session facts：provider、关联 Profile 和 Execution Identity、running status、CDP 可用性、Viewer/VNC 可用性、screenshot/snapshot/network/log capture 可用性、handoff capability、pause/resume/close capability、current error state、lease refs 和 resource trace refs。
- `provider_facts`：provider type、browser engine、本地或远程模式、persistent profile 支持、独立 `user_data_dir` 支持、proxy 支持、环境配置支持、extension 支持、CDP 支持、viewer 支持、snapshot 支持、provider-native fingerprint 或 patch 能力、known limitations、license/binary boundary，以及可用时的 validation evidence refs。

Provider facts 必须区分：

- 配置输入；
- 已观测 runtime fact；
- provider claim；
- validation evidence。

Anti-detection、stealth、fingerprint、proxy、patch 和 captcha/provider claims 只能作为 facts 和 policy inputs。Harbor 不承诺绕过检测、账号安全、目标站点成功率或 provider 适合某个任务。

Core 消费：

- Harbor refs：`bundle_ref`、`lease_ref`、`profile_ref`、`identity_ref`、`runtime_session_ref`、`evidence_policy_ref`、`resource_trace_refs`。
- Harbor facts：provider/profile/session/evidence capability facts 和当前 resource health facts。
- Harbor evidence refs 和 runtime errors。

Core 默认不消费：

- Cookies、tokens、完整浏览器 storage、私有 Profile 文件或 provider secrets。
- normalized result envelopes、collection/comment/dataset schemas 或站点业务字段。
- 作为公共 contract 的 provider-specific launch flags。

Lode 可以声明 runtime requirements，例如 persistent Profile、已登录 identity、proxy binding、snapshot support、manual takeover 或 write verification。Lode 不管理 Harbor resources，也不保存真实 Profile state。

App 可以通过 Harbor API 展示和管理 Profile、Identity、Session、Viewer、handoff 和 evidence policy state，但不应把 Harbor facts 重新解释为任务成功保证。

## 影响

Harbor providers 可以替换，而 Core 或 Lode 不需要依赖具体 browser binary 或 launch flag。

Core admission 需要把 Lode/user policy requirements 与 Harbor facts 做匹配。这个匹配属于 Harbor 之外。

Facts schema 需要版本化。后续 schema 应把 provider-specific 字段放在 provider details 后面，不进入 Harbor 公共对象模型。

## 备选方案

- 一个包含 provider、proxy、fingerprint、recording、captcha、allowed domains 和 task policy 的大 `BrowserProfile` 模型：拒绝，因为它混合了 runtime facts 和 Core admission policy。
- Harbor 判断任务是否安全或可执行：拒绝，因为 Harbor 不理解站点业务、用户意图或 Lode capability requirements。
- Harbor 公共 schema 镜像每个 provider 的 native flags：拒绝，因为这会泄漏 provider 细节，并提高 provider 替换成本。
- 默认使用 anti-detect browser identity：暂时拒绝，因为这是 provider 能力和合规问题，不是默认产品承诺。

## 研究证据

- [docs/draft/runtime-capability-facts.md](../draft/runtime-capability-facts.md) 将 provider、Profile、Runtime Session、automation exposure 和 evidence policy facts 定义为客观 facts，而不是任务结论。
- [docs/draft/profile-identity-model.md](../draft/profile-identity-model.md) 拆分 Fingerprint、Profile 和 Execution Identity，并把 login/risk history 记录在 Execution Identity 上。
- [docs/draft/resource-lifecycle.md](../draft/resource-lifecycle.md) 说明 Harbor 向 Core 返回 bundle、lease、runtime session、Profile、Identity、capability facts、evidence policy 和 resource trace refs。
- [browser-identity-and-runtime.md](https://github.com/WebEnvoy/research/blob/main/absorability/themes/browser-identity-and-runtime.md) 显示 Profile managers 和 browser runtimes 都收敛到 persistent Profile 加 session facts，例如 profile id、CDP endpoint、viewer endpoint、display 和 status。
- [anti-detection-and-provider-facts.md](https://github.com/WebEnvoy/research/blob/main/absorability/themes/anti-detection-and-provider-facts.md) 说明 provider facts 应按 engine、fingerprint config、network path、runtime behavior、license boundary 和 validation evidence 分层；provider claims 不是 task success evidence。
- [synthesis.md](https://github.com/WebEnvoy/research/blob/main/synthesis.md) 已接受 runtime facts 与 task policy 必须拆开。

## 未决问题

- [PD-0003](pending-decisions.md#pd-0003)：provider/profile/session/evidence facts 的首版版本化字段集是什么？
- [PD-0004](pending-decisions.md#pd-0004)：哪些 health states 可以被 Core 用于只读、写入和恢复任务准入？
- [PD-0005](pending-decisions.md#pd-0005)：最小 provider validation evidence 格式是什么？
- [PD-0006](pending-decisions.md#pd-0006)：typing cadence 这类行为层 facts 属于 Harbor helper facts、Core action policy，还是 Lode capability requirements？
- [PD-0007](pending-decisions.md#pd-0007)：启用 provider 前，哪些 provider license 和 binary facts 必须存在？
