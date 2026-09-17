# WebEnvoy monorepo 执行指南

本仓库是 `WebEnvoy/WebEnvoy` 产品 monorepo：`packages/*` 承载 Core，`apps/desktop` 承载 Desktop App，`services/harbor` 承载 Harbor Runtime；Lode 仍是独立资产仓。

产品方向、V1 约束和决策状态以组织级 [canonical v1.5 规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md) 为准。仓内 ADR 解释实现决策，不得另立产品方向。

## 可选模型辅助的执行边界

- [#558](https://github.com/WebEnvoy/WebEnvoy/issues/558) 为独立条件性后续，首个采用验证为 [#559](https://github.com/WebEnvoy/WebEnvoy/issues/559)；不扩大当前 V1 完成门，不把 #555/#556/#557 改成模型接入任务。
- 具体采用边界见 [ADR 0013](docs/adr/0013-optional-model-assisted-browser-tasks.md)，用户行为见 [Model Usage V1](docs/specs/model-usage-v1.md)。Proposed 文档须先与组织级 canonical 修订一起完成接受流程，不能当作模型运行、费用或外发授权。
- 使用通用 Model Provider；通用连接优先采用 TanStack AI 正式能力。原生 evaluation 不满足条件时不默认自建 bridge、不伪装成 TextAdapter，不预建通用模型／任务平台。
- 模型可以完成一段有界循环，但不拥有授权、浏览器现场或业务结果。每次派发复用现有 owner；DONE 不等于业务成功，交回宿主也不能重放 unknown 写入。凭据、数据外发、停止和迟到回复的边界必须沿正式合同验收。

## 实施原则

- 用户或 Agent 的真实路径仍是交付单元；但已确认进入 V1 的基础 Runtime 能力类别必须先在 canonical／FR 中完整定义，不得因当前消费者暂未使用就从规划中省略。对象、Schema 和合同的具体实现仍只细化到当前与下一批真实交付需要的程度。
- 先验证会推翻设计的页面或 Provider 假设。Provider 接入遵循 [ADR 0012](docs/adr/0012-runtime-capability-plane-and-plugin-first.md) 的 Qualification Gate：先分类、后有界 spike、再决定是否采用。WebEnvoy 不实现、模拟或长期补偿 Provider 缺失的浏览器核心语义；Obscura 在当前愿景内不采用，历史见 [#511](https://github.com/WebEnvoy/WebEnvoy/issues/511)，不再验证、等待或跟踪版本。该产品方向以已合并的 [canonical 修订 .github#21](https://github.com/WebEnvoy/.github/pull/21) 为准。
- 本轮 [#519](https://github.com/WebEnvoy/WebEnvoy/issues/519)／[PR #522](https://github.com/WebEnvoy/WebEnvoy/pull/522) 已完成其声明范围的供应方原版 Camoufox 任务页协作与私有补丁退役：只接受 owner 明确提供、重新核验 provenance 的 Camoufox `0.5.6`、browser `152.0.4-beta.30`、Playwright `1.60.0`，由公开 API Driver 消费完整 launch/context options 并精确复用。该路径仍按 `limited` 处理：popup 首请求若在派发前无法建立可信 Page 归属，必须在任何 `fetch`/`continue`/外部请求前以 `page_relation_unavailable` 局部拒绝，不猜测、不重放；普通任务页和同 Instance 观察/接管语义仍有效。#519 的完成只覆盖其实际声明范围；完整 Runtime、所有 popup／Files／Provider、#497／#474／#482 的其余结果仍由各自 FR／Work Item 和证据核验。旧 Camoufox 私有 launch binding、patched/native artifact 继续 `unsupported`／已退役，不启动、不 fallback；#499、#504、#510 的旧记录仅作历史/恢复校验事实。
- Core 拥有授权、Run、外部结果、幂等和恢复；Harbor 拥有 Profile、Provider、Instance、现场和 ControlLease；App 只组合 owner facts 并发送用户意图；Lode 拥有 SKILL、AccountSystem 模板和网站知识。
- Browser Runtime capability 是否存在，与 Plugin 向 Agent 展示哪些工具以及当前 Grant 是否允许调用必须分离；Network、Console、文件、窗口、受控执行、画面等通用能力不得按站点特例散落到 Harbor／Core。
- V1 实施优先采用 Plugin-first：一个已安装 Plugin 在真实第三方 Agent 中持续消费 Runtime、Profile、账号、环境、SKILL 和结果能力；完整 App 产品化后移，但必要 owner 授权、敏感决定、同实例接管与交还持续可用。
- 每条业务规则只有一个 owner。预检和正式执行复用同一判定，不在 App、站点代码或 Lode 复制授权白名单。
- 防御作用域不大于风险作用域。身份、授权、控制权和重复写入必须保护；可选 evidence、viewer 或未安装网站 SKILL 不得全局阻断通用浏览器与环境管理。
- unknown 写入禁止重放，但允许安全查询、对账、人工接管和停止后续执行。
- 复用现有存储、锁、授权、Run、结果和诊断；不为未来形态预建 DSL、服务、队列、Schema 或兼容层。
- Provider 扩展同时兑现代码复用：同一受支持自动化接口的通用执行逻辑只维护一套，Provider adapter 只保留启动、来源校验、环境和有证据的差异；不能按品牌复制 Page／Files／诊断／调度，或将尚未接入冒称上游不支持。具体边界与双 Provider 完成门见 [Provider 执行复用设计](docs/architecture/provider-execution-reuse-v1.md)。共享代码不共享 Profile、Context 或权限，真实兼容性证据仍按 Provider 分别取得。

## 设计与合同义务

- Runtime、Profile、Plugin 或 App 的 Work Item 进入实现前，必须按 [`docs/specs/README.md`](docs/specs/README.md) 的 Design Obligation Triggers 逐项记录 `triggered`、`not-triggered` 或 `conditional`；不能用“后续补 spec”替代判断。
- 某个 trigger 一旦成立，对应正式 spec／contract／schema／architecture artifact 自动成为当前 Work Item 的 Definition of Done。它可以和实现同 PR，也可以先行 docs PR，但在 Work Item 标记 `completed` 前必须已经合并且被实现与测试引用。
- 探索性内部实现可以先验证；一旦新增或改变稳定跨进程 API、MCP／Plugin tool projection、wire payload、持久字段、enum、Grant 维度或 Provider-private versioned config，必须在该合同成为正式消费者依赖或 durable write 之前同步冻结对应正式规格。
- `not-triggered` 必须给出具体理由；`conditional` 必须写清转为 `triggered` 的条件。不要为了占位创建空 spec，也不要把实现代码、fixture 或 Issue body 当成最终合同。
- CI 可以检查声明是否存在、引用文件是否存在；是否真的触发某项设计义务由 PR 作者声明并由 exact-head 独立 reviewer 复核，不能把自动检查当成语义审查替代品。
- 获批执行规则：Work Item 的原生 parent、Milestone、范围、完成标准和适用 Design Obligation 必须可回读；执行只覆盖已确认的用户结果、Provider、权限、数据和环境边界。缺少授权、资格门或可信目标时只做局部拒绝/诊断，不换 Provider、放宽权限、恢复私有补丁或用 fallback／猜测补齐缺失能力；已派发 unknown 只能 query／reconcile／人工接管，不得换 key 重放。高影响外部动作须有明确 owner 授权，完成仍需按证据类型分别回读。
- 验收分别记录 fixture／mock、真实 Provider、正式安装路径、真实第三方 Agent、真人操作和真实第三方站点。`plugin_verified` 只表示已安装 Plugin 由真实第三方 Agent 消费通过；安装检查、脚本或 MCP 辅助客户端不能冒充。
- 开工先写一个用户结果、非目标和少量关键反例；最早可行时验证会推翻方案的条件。确定性测试负责状态机、权限、并发和故障，安装客户端负责真实资源、持久化和传输，真实 Agent 只承担一条短用户闭环；首次出现非预期结果后由实施者定位，不能让消费 Agent 在同一长回合读取源码调试产品。
- 同一独立 reviewer 可以早审关键边界并最终审 exact head；修复轮只重验受影响内容。运行代码候选冻结后再做昂贵安装验证；docs-only 变化只能按明确内容等价继承，不能声称完整 tree 相同。薄 Agent 验收以真实用户结果为准，不以工具调用次数为完成门。

## 构建与验证

- 环境：Node.js `>=24 <25`、pnpm `>=10 <11`，锁定 pnpm `10.30.3`。
- 安装：`pnpm install --frozen-lockfile`。
- 常用检查：`pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm conformance`、`pnpm smoke`。
- Python 编译检查使用 `make py-compile` 或仓库脚本，不直接在 checkout 生成 `__pycache__`。
- 非平凡逻辑至少留下一个最小可运行检查；错误修复优先证明修复前失败、修复后通过。
- docs-only 变更至少运行 `git diff --check` 和相关 Markdown/JSON/YAML 可读性检查，不冒充产品 live 验收。

## 数据与安全

不得提交 Cookie、Token、凭据、Profile 数据、raw DOM/HAR、未脱敏截图/视频、生产 payload 或用户私有业务内容。SKILL、脚本、CDP 和协议工具均不授予权限或绕过 ControlLease。

## GitHub-native 交付

- 当前状态只以 GitHub Issue、原生 parent/sub-issue/dependency、Milestone、Project、PR、checks、review 和 `main` 回读为准；不创建 carrier 或第二状态机。
- 普通工作可直接使用 Work Item；只细化当前和下一批，只有真实阻塞才建 dependency。
- 产品/实现 PR 绑定真实 Work Item，保持单一可验收范围；纯治理或架构基线 docs-only PR 在没有独立产品结果时可以绑定 owning FR／ADR，而不为文档本身制造虚假产品 Work Item。
- Issue／PR 正文写入前保存完整 UTF-8 body、`updated_at` 和 hash，写前重读防并发，写后重新 GET 全文与 native metadata；失败、截断、空正文或错误文本不得进入写入。交付完成时同步更新当前摘要、父 FR 对应行和证据链接，不把多轮 closeout 变成固定流程。
- 合并前完成 exact-head 独立 review 和 required checks。单账号开发不要求为了形式制造第二 GitHub 身份：如果无法使用不同账号提交原生 `Approve`，可以由与实现执行者分离的审查会话／进程／工作树在 PR 顶级评论中记录 exact head SHA、审查范围、实际读取/运行的检查、findings 和明确结论 `APPROVE` 或 `REQUEST_CHANGES`；该评论可替代原生 Approve 作为独立审查证据。实现执行者自己的自审评论不能替代独立 review。
- `completed` 需要原验收证据；`not_planned` 对应 Won’t Do。Milestone 表达产品目标归属，Project 状态表达当前执行状态：待授权或延期但仍属于 V1 的事项保持原 Milestone并进入 Backlog；只有明确移出该产品目标时才移出 Milestone。PR 合并不自动关闭业务 Issue。
