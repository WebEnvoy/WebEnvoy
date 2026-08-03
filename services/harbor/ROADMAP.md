# Harbor 路线图

本文是 `WebEnvoy/.github/ROADMAP.md` 的 Harbor 仓库级投影。若本文与组织级 ROADMAP 冲突，以组织级 ROADMAP 为准。

本文用于指导 Harbor GitHub Milestone 的创建和排序，不维护当前 issue、PR 或执行看板。

## 本仓职责

Harbor 负责 Profile、Execution Identity、Runtime Session、browser provider、Snapshot、RefMap、Evidence refs、Viewer / handoff facts 和运行现场事实。

Harbor 不判断任务业务成功，不拥有 Lode schema 或 Core Run Record。

## 路线原则

- GitHub Milestone 必须能映射到本文的阶段路线和组织级 ROADMAP。
- Harbor 可以在对外 runtime facts 合同稳定后独立加速实现，不要求 Core、Lode 和 App 同步进入同一阶段。
- provider、Profile Browser 或外部项目机制可以作为实现加速来源，但不能反向污染 Harbor 核心模型。
- Core 和 App 只消费 Harbor 对外 facts，不消费 provider 内部概念。
- Harbor 的早期价值是可信、可引用、可接管的运行现场，不是独立浏览器产品。
- 涉及当前 milestone 的 pending decision 必须先在 `docs/adr/pending-decisions.md` 标明阻塞级别。

## 阶段路线

### 组织阶段一投影：用户任务与吸收边界

Harbor 明确自己是浏览器身份、运行现场和证据引用的事实源，不是站点能力解释器或任务编排器。

可创建 milestone 的主题：

- Harbor 边界和 ADR 治理。
- Profile / Session / Provider facts ownership。
- CloakBrowser provider baseline 采用边界。
- CloakBrowser-Manager 作为 Profile Runtime、Viewer / VNC、CDP proxy 和 provider args adapter 的参考实现，不整体迁入。
- BrowserSkill / ego-lite / Playwright dashboard 等 handoff 和 control ownership 机制吸收评估。
- hosted browser、vault、persona 平台和反检测成功率承诺不进入 Harbor MVP 合同。

### 组织阶段二投影：最小统一协议

Harbor 的第一优先级是提供 Core 和 App 能消费的最小 runtime facts、session refs、snapshot refs、evidence refs 和 viewer refs。

可创建 milestone 的主题：

- Runtime Session lifecycle contract v0。
- Provider / Profile / Identity facts v0。
- Snapshot / RefMap contract v0。
- Evidence refs 和 viewer / handoff facts v0。

阶段二完成前，不应把某个 provider manager 或 Profile Browser 实现写成 Core 稳定依赖。

### 组织阶段三投影：可信可引用运行现场

Harbor 形成最小受控浏览器现场：用户能看到 Profile、Runtime Session、Provider、Viewer 和页面引用状态，Core 能引用低噪音页面上下文。

可创建 milestone 的主题：

- local dedicated profile runtime v0。
- provider adapter v0。
- provider 检测、安装、更新、修复和启动验证 v0。
- Profile / Runtime Session / Viewer facts。
- Snapshot / RefMap / indexed element / locator fallback v0。
- Provider license、binary、依赖、更新和运行 smoke 评估。

源码复用只有在 license、数据边界、binary 边界和核心模型隔离通过后才进入 milestone。

### 组织阶段四投影：最小只读任务闭环

Harbor 支撑首个低风险只读任务的页面引用、运行事实、证据引用和 session continuity。

可创建 milestone 的主题：

- read task runtime requirements。
- Snapshot / RefMap refs for read execution。
- evidence refs 和 provenance。
- session continuity 和 runtime error 表达。

### 组织阶段五投影：只读能力产品化

Harbor 支撑只读能力验证、fixture 捕获、evidence provenance 和页面引用生命周期。

可创建 milestone 的主题：

- capability validation runtime facts。
- fixture capture support without saving private runtime truth。
- RefMap freshness / stale state。
- evidence retention policy v0。

### 组织阶段六投影：写前验证闭环

Harbor 支撑写前验证的表单状态、输入目标、页面引用和预览证据，但不判断业务提交是否成功。

可创建 milestone 的主题：

- writable element refs 和 target state。
- form/input state snapshot。
- preview evidence refs。
- pre-write runtime guard facts。

### 组织阶段七投影：受控写入闭环

Harbor 支撑首批低风险真实写入的前后证据、控制权事实和页面现场 provenance。

可创建 milestone 的主题：

- before / after evidence refs。
- control ownership facts。
- write provenance 和 session continuity。
- evidence unavailable / page changed 表达。

### 组织阶段八投影：可恢复多步读写工作流

Harbor 提供可观察、可接管、可恢复的运行现场事实，并维护控制权归属。

可创建 milestone 的主题：

- Viewer / takeover control ownership。
- handoff / resume facts。
- stale RefMap、session loss 和 evidence unavailable 表达。
- captcha / login / manual action facts。

### 组织阶段九投影：日常产品与多入口稳定

Harbor 为 App Browser 表面和 Core 查询提供稳定数据和操作入口，但不成为独立任务产品。

可创建 milestone 的主题：

- Browser identities / profiles query。
- Runtime sessions / viewer entry。
- provider facts 和 health state 展示支持。
- App / API 一致的 runtime facts 查询。

### 组织阶段十投影：生态与协作扩展

Harbor 支持更多 provider、远程 runtime 和团队环境，同时保持 facts contract 稳定。

可创建 milestone 的主题：

- remote runtime / server mode。
- multi-provider compatibility。
- evidence retention / encryption policy hardening。

## 不进入 Harbor 路线图

- Core Run Record、Result Envelope、Admission 和任务业务成功判断。
- Lode capability package、schema、fixtures 和 normalizer。
- App Shell 和业务 UI truth。
- 账号运营、内容策略、广告投放、CRM 或业务决策。

## Milestone 创建检查

创建 Harbor milestone 前必须确认：

- 对应组织级 ROADMAP 阶段。
- 对应的 Harbor 阶段路线主题。
- 是否服务当前组织阶段的纵向闭环，而不是只完成 Harbor 横向 facts。
- 是否对 Core、Lode 或 App 暴露新 facts contract。
- 是否有 `Milestone blocker` 或 `FR blocker` pending decision。
- provider 专有概念是否被隔离在 adapter 层。
