# WebEnvoy monorepo 执行指南

本仓库是 `WebEnvoy/WebEnvoy` 产品 monorepo：`packages/*` 承载 Core，`apps/desktop` 承载 Desktop App，`services/harbor` 承载 Harbor Runtime；Lode 仍是独立资产仓。

产品方向、V1 约束和决策状态以组织级 [canonical v1 规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md) 为准。仓内 ADR 解释实现决策，不得另立产品方向。

## 实施原则

- 用户或 Agent 的真实路径是交付单元；对象、Schema 和合同只细化到当前消费者需要的程度。
- 先验证会推翻设计的页面或 Provider 假设。Camoufox 是首个默认 Provider 验证目标，不是已确认结论；Chrome 是显式兼容 Provider；不得引入 ego-lite／ego-browser 或 Wayfern。
- Core 拥有授权、Run、外部结果、幂等和恢复；Harbor 拥有 Profile、Provider、Instance、现场和 ControlLease；App 只组合 owner facts 并发送用户意图；Lode 拥有 SKILL、AccountSystem 模板和网站知识。
- 每条业务规则只有一个 owner。预检和正式执行复用同一判定，不在 App、站点代码或 Lode 复制授权白名单。
- 防御作用域不大于风险作用域。身份、授权、控制权和重复写入必须保护；可选 evidence、viewer 或未安装网站 SKILL 不得全局阻断通用浏览器与环境管理。
- unknown 写入禁止重放，但允许安全查询、对账、人工接管和停止后续执行。
- 复用现有存储、锁、授权、Run、结果和诊断；不为未来形态预建 DSL、服务、队列、Schema 或兼容层。

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
- PR 绑定真实 Work Item，保持单一可验收范围；合并前完成 exact-head 独立 review 和 required checks。
- `completed` 需要原验收证据；`not_planned` 对应 Won’t Do；延期保持 open、退出活跃 Milestone并进入 Backlog。PR 合并不自动关闭业务 Issue。
