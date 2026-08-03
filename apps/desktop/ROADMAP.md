# WebEnvoy App 路线图

本文是 `WebEnvoy/.github/ROADMAP.md` 的 App 仓库级投影。若本文与组织级 ROADMAP 冲突，以组织级 ROADMAP 为准。

本文用于指导 App GitHub Milestone 的创建和排序，不维护当前 issue、PR 或执行看板。

## 本仓职责

App 负责 Work、Library 和 Browser 三个用户表面，展示 Core、Harbor 和 Lode 的上游事实并发送用户意图。

App 不直接执行能力，不写 Run Record，不绕过 Harbor 操作 Runtime Session，也不保存 Lode 能力资产 truth。

## 路线原则

- GitHub Milestone 必须能映射到本文的阶段路线和组织级 ROADMAP。
- App 可以早期采用统一产品外壳，但交互能力必须受 Core、Harbor 和 Lode 对外合同约束。
- App milestone 优先消费稳定 facts，不在 UI 内自定义上游字段真相。
- App 可以先做只读表面，再逐步开放操作、接管和修复。
- App 的早期任务是验证用户能否理解任务、结果、证据、风险和异常，不等到后期才出现。
- 涉及当前 milestone 的 pending decision 必须先在 `docs/adr/pending-decisions.md` 标明阻塞级别。

## 阶段路线

### 组织阶段一投影：用户任务与吸收边界

App 明确自己是用户入口，不是 Core、Harbor 或 Lode 的 truth source；同时明确首个用户旅程和早期写侧只展示 preview / draft。

可创建 milestone 的主题：

- App 边界和 ADR 治理。
- Work / Library / Browser 产品域划分。
- 首个低风险只读任务用户旅程。
- 写前验证、审批预览和真实写入 UI 边界。
- App 不吸收外部 UI shell 或 hosted 平台控制台。

### 组织阶段二投影：最小统一协议

App 的第一优先级是用最小用户入口消费统一协议，展示 task、run、result、evidence 和 action request，而不是在 UI 内自定义字段真相。

可创建 milestone 的主题：

- minimal task submission intent。
- minimal run viewer facts。
- result / failure display contract。
- handoff / recovery prompt facts。
- evidence reference display contract。
- action request / approval display contract。
- capability catalog fields for Library。

阶段二完成前，不应创建依赖完整执行 UI、完整 Browser 表面或完整 marketplace 的 milestone。

### 组织阶段三投影：可信可引用运行现场

App 的 Browser 表面让用户看到受控运行现场、Profile、Runtime Session、Provider、Viewer 和页面引用状态。

可创建 milestone 的主题：

- Browser read-only profile/session/provider facts。
- Viewer entry。
- Snapshot / RefMap / evidence ref display。
- local settings 和连接状态。

### 组织阶段四投影：最小只读任务闭环

App 的 Work 表面跑通首个低风险只读任务闭环：提交任务、查看运行、读取结构化结果、打开证据和理解失败原因。

可创建 milestone 的主题：

- Work read task submission。
- runs / results / evidence read view。
- structured failure reason display。
- capability source attribution。

### 组织阶段五投影：只读能力产品化

App 的 Library 表面支持用户浏览、安装、锁定、测试、失效和修复首批只读能力。

可创建 milestone 的主题：

- Library read capability catalog。
- capability install / lock / update / repair。
- invalidation / repair draft display。
- Explorer draft to Lode asset handoff。

### 组织阶段六投影：写前验证闭环

App 支持写前验证 UI：预览将要发生的变更、风险、审批请求和取消入口，但不把预览呈现为已提交。

可创建 milestone 的主题：

- write preview view。
- risk and approval request display。
- cancellation intent。
- validate-only / draft result display。

### 组织阶段七投影：受控写入闭环

App 支持首批低风险真实写入的审批、执行、证据、unknown outcome、post-check 和对账入口。

可创建 milestone 的主题：

- approval and execute intent。
- write evidence display。
- unknown outcome 和 post-check 展示。
- reconcile / manual handling entry。

### 组织阶段八投影：可恢复多步读写工作流

App 支持用户观察、接管、恢复、停止、重试或对账，但不复制上游状态机。

可创建 milestone 的主题：

- takeover prompt 和 recovery action intent。
- retry / resume / cancel / reconcile intent。
- unknown outcome 和 manual recovery 展示。
- redacted / expired evidence 状态。

### 组织阶段九投影：日常产品与多入口稳定

App 形成 Work、Library、Browser 和 Settings 的完整用户闭环，并与 API、CLI、MCP 和 SDK 的语义保持一致。

可创建 milestone 的主题：

- task submission and run management。
- capability lifecycle management。
- Profile / Runtime Session 操作入口。
- Settings for API、Harbor、Lode、权限和隐私策略。
- 多入口错误、证据、审批和恢复语义一致性。

### 组织阶段十投影：生态与协作扩展

App 支持团队、可选同步、外部集成和平台贡献体验，但不成为底层 truth source。

可创建 milestone 的主题：

- team/workspace views。
- optional asset sync / contribution UI。
- external integration settings。

## 不进入 App 路线图

- Core Runtime、Run Record durable truth、Admission 和 Action Risk 执行逻辑。
- Harbor Runtime Server、browser driver、CDP/VNC 和 evidence store。
- Lode package/schema/registry truth。
- 账号运营、内容策略、广告投放、CRM 或业务决策。

## Milestone 创建检查

创建 App milestone 前必须确认：

- 对应组织级 ROADMAP 阶段。
- 对应的 App 阶段路线主题。
- 是否服务当前组织阶段的纵向闭环，而不是只完成 App 局部 UI。
- 依赖的 Core、Harbor 或 Lode facts 是否稳定。
- 是否有 `Milestone blocker` 或 `FR blocker` pending decision。
- App 是否只展示上游事实并发送用户意图，而不是复制 truth。
