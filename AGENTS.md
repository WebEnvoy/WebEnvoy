# WebEnvoy monorepo 执行指南

本仓库是 `WebEnvoy/WebEnvoy` 产品 monorepo：`packages/*` 承载 Core，`apps/desktop` 承载 Desktop App，`services/harbor` 承载 Harbor Runtime；Lode 仍是独立资产仓。

产品方向、V1 约束和决策状态以组织级 [canonical v1 规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md) 为准。仓内 ADR 解释实现决策，不得另立产品方向。

## 实施原则

- 用户或 Agent 的真实路径仍是交付单元；但已确认进入 V1 的基础 Runtime 能力类别必须先在 canonical／FR 中完整定义，不得因当前消费者暂未使用就从规划中省略。对象、Schema 和合同的具体实现仍只细化到当前与下一批真实交付需要的程度。
- 先验证会推翻设计的页面或 Provider 假设。Provider 由用户选择；Camoufox 只保留首个工程验证及已验证范围，Chrome 是显式兼容选择，有界 Work Item 可以验证其他 Provider；不得引入 ego-lite／ego-browser 或 Wayfern。
- Core 拥有授权、Run、外部结果、幂等和恢复；Harbor 拥有 Profile、Provider、Instance、现场和 ControlLease；App 只组合 owner facts 并发送用户意图；Lode 拥有 SKILL、AccountSystem 模板和网站知识。
- Browser Runtime capability 是否存在，与 Plugin 向 Agent 展示哪些工具以及当前 Grant 是否允许调用必须分离；Network、Console、文件、窗口、受控执行、画面等通用能力不得按站点特例散落到 Harbor／Core。
- V1 实施优先采用 Plugin-first：一个已安装 Plugin 在真实第三方 Agent 中持续消费 Runtime、Profile、账号、环境、SKILL 和结果能力；完整 App 产品化后移，但必要 owner 授权、敏感决定、同实例接管与交还持续可用。
- 每条业务规则只有一个 owner。预检和正式执行复用同一判定，不在 App、站点代码或 Lode 复制授权白名单。
- 防御作用域不大于风险作用域。身份、授权、控制权和重复写入必须保护；可选 evidence、viewer 或未安装网站 SKILL 不得全局阻断通用浏览器与环境管理。
- unknown 写入禁止重放，但允许安全查询、对账、人工接管和停止后续执行。
- 复用现有存储、锁、授权、Run、结果和诊断；不为未来形态预建 DSL、服务、队列、Schema 或兼容层。

## 设计与合同义务

- Runtime、Profile、Plugin 或 App 的 Work Item 进入实现前，必须按 [`docs/specs/README.md`](docs/specs/README.md) 的 Design Obligation Triggers 逐项记录 `triggered`、`not-triggered` 或 `conditional`；不能用“后续补 spec”替代判断。
- 某个 trigger 一旦成立，对应正式 spec／contract／schema／architecture artifact 自动成为当前 Work Item 的 Definition of Done。它可以和实现同 PR，也可以先行 docs PR，但在 Work Item 标记 `completed` 前必须已经合并且被实现与测试引用。
- 探索性内部实现可以先验证；一旦新增或改变稳定跨进程 API、MCP／Plugin tool projection、wire payload、持久字段、enum、Grant 维度或 Provider-private versioned config，必须在该合同成为正式消费者依赖或 durable write 之前同步冻结对应正式规格。
- `not-triggered` 必须给出具体理由；`conditional` 必须写清转为 `triggered` 的条件。不要为了占位创建空 spec，也不要把实现代码、fixture 或 Issue body 当成最终合同。
- CI 可以检查声明是否存在、引用文件是否存在；是否真的触发某项设计义务由 PR 作者声明并由 exact-head 独立 reviewer 复核，不能把自动检查当成语义审查替代品。

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
- 合并前完成 exact-head 独立 review 和 required checks。单账号开发不要求为了形式制造第二 GitHub 身份：如果无法使用不同账号提交原生 `Approve`，可以由与实现执行者分离的审查会话／进程／工作树在 PR 顶级评论中记录 exact head SHA、审查范围、实际读取/运行的检查、findings 和明确结论 `APPROVE` 或 `REQUEST_CHANGES`；该评论可替代原生 Approve 作为独立审查证据。实现执行者自己的自审评论不能替代独立 review。
- `completed` 需要原验收证据；`not_planned` 对应 Won’t Do。Milestone 表达产品目标归属，Project 状态表达当前执行状态：待授权或延期但仍属于 V1 的事项保持原 Milestone并进入 Backlog；只有明确移出该产品目标时才移出 Milestone。PR 合并不自动关闭业务 Issue。
