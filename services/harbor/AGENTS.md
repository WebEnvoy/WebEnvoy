# 仓库指南

## 项目结构与模块组织

本仓库是 `WebEnvoy/Harbor`，负责 Profile Runtime、Execution Identity、Runtime Session、Browser Drivers、CDP / VNC、Evidence 和 Runtime API。当前文档位于 `README.md` 和 `docs/`；后续代码建议按以下方向组织：`packages/runtime-api/` 放 Runtime API，`packages/profile-manager/`、`packages/identity-manager/`、`packages/session-manager/` 放核心对象，`packages/browser-drivers/` 放 chrome-official、cloakbrowser、camoufox、remote-cdp 等 driver，`packages/evidence-store/` 放证据存储，`examples/` 放启动示例。

## 构建、测试与开发命令

当前尚未初始化 `package.json`。新增工程脚手架后，优先统一为：`pnpm install` 安装依赖，`pnpm build` 构建，`pnpm test` 运行测试，`pnpm lint` 检查风格，`pnpm typecheck` 做类型检查。涉及浏览器 driver 的 smoke test 应提供独立命令，例如 `pnpm test:drivers`。

## 代码风格与命名规范

默认主语言为 TypeScript / Node.js。浏览器自动化优先基于 Playwright / CDP，存储默认 SQLite。目录和包名使用小写短横线，例如 `browser-drivers`、`evidence-store`；核心模型使用 `Profile`、`ExecutionIdentity`、`RuntimeSession`、`RunEvidence` 等明确命名。不要把某个浏览器 provider 的专有参数泄漏成 Harbor 核心模型。

## 测试指南

测试应覆盖 typecheck、lint、unit tests、Runtime API contract tests、storage schema validation 和 browser driver smoke tests。测试文件建议使用 `*.test.ts` 或 `*.spec.ts`。Driver 测试必须明确是否需要本地浏览器、Docker 或远程 CDP，不能假设开发机已有同一环境。

## Harbor Runtime 技术基线

- 默认技术栈是 TypeScript / Node.js；browser automation/provider baseline 是 Playwright primitives 与 CDP；本地事实存储默认 SQLite metadata/refs，filesystem 只保存 policy-allowed artifact locator。
- 不因 docs-only PR 安装 Playwright、创建 `package.json`、引入 provider adapter、runtime server、viewer、evidence store、database schema 或 browser binary。
- Rust / Go 只在进程守护、沙箱、本地加密、低层代理等系统边界经 ADR 引入。
- Browser Driver 只负责 launch/connect/configure/health/facts；不得实现站点任务策略、task runner loop、provider ranking、目标站点成功率或 Lode capability 逻辑。
- Provider 专有字段、launch flags、anti-detection claims、raw CDP/VNC/ws endpoints 和 provider secrets 不得泄漏为 Harbor 公共模型。
- Runtime facts 不承诺任务成功；Core 拥有 admission、Run Record、task outcome、unknown outcome 和 reconciliation。
- Snapshot/RefMap/Evidence 默认只暴露 refs、source_trace、redaction、retention、access state 和 structured unavailable state；不要默认保存 raw DOM、raw HAR、完整 request/response bodies、未脱敏 screenshot/video/trace 或 production payload。
- Viewer/handoff/control ownership 是 Harbor runtime facts 和 Core/App intent 的组合；App 不拥有 Runtime Session truth，Harbor 不自动抢回用户控制。

## Runtime smoke 最低要求

后续 provider/session/evidence/viewer 代码 PR 至少要留下能证明以下事实的 smoke 入口：

- provider launch 或 connect readiness；
- Runtime Session facts readback；
- configured/observed/provider_claim/validation_evidence 分离；
- Snapshot/RefMap/Evidence refs 产生或结构化 unavailable；
- viewer/handoff/control owner facts readback（触碰 viewer/handoff 时）。

默认 smoke 不得使用真实账号、credential、生产页面 payload、raw cookies/storage、未脱敏截图、raw HAR、raw DOM 或 video。docs-only PR 可只跑 Markdown/metadata 检查和 `git diff --check`。

## 提交与 Pull Request 规范

提交信息使用 Conventional Commits，例如 `docs: refine browser driver model`、`feat: add runtime session API`。PR 需要说明影响的核心对象、API 变化、验证命令和是否涉及本地敏感状态。涉及 VNC、CDP、Cookie、Profile 或 Evidence 的改动，必须说明数据边界和默认行为。

## 架构与 Agent 专项说明

Harbor 不理解具体站点业务，也不执行 Lode 任务封装。它只向 WebEnvoy Core 提供可执行 session、Profile / Identity 状态、资源约束、CDP / VNC 信息、Evidence 策略和 Runtime 错误。Browser Driver 只负责启动、连接、配置和返回 session，不承载站点能力逻辑。

## 路线图 / 里程碑 / 功能需求 / 工作项

- 跨仓长期方向以 `WebEnvoy/.github/ROADMAP.md` 为准。
- 当前执行状态以 GitHub Milestones、Project、issues 和 PR 为准，不在仓库文档中复制维护。
- GitHub Milestone 只承载当前 1-3 个可交付阶段，不承载全部远期设想。
- 功能需求（FR）issue 表达用户可见或系统可验证的能力增量。
- 工作项（Work Item）issue 是可由一个 PR 完成的最小执行单元。
- 新建功能需求或工作项前，先确认它属于当前活跃 Milestone；不属于则回到总 ROADMAP 或 backlog。
- 创建或调整 Milestone、功能需求或工作项前，先检查本仓 `docs/adr/pending-decisions.md`；会阻塞当前事项的决策必须链接到 issue，并标明阻塞级别：`Milestone blocker`、`FR blocker`、`Work Item blocker`、`Spec detail` 或 `Deferred`。
- 被决策阻塞的 issue 使用 `status: needs-decision`；决策完成后必须回写对应 ADR 或 `docs/adr/pending-decisions.md`，再继续拆分或实施。
- 仓库级 `ROADMAP.md` 是组织级 ROADMAP 的本仓投影，只能说明本仓如何服务总路线，不能新增跨仓阶段、重定义目标状态或覆盖组织级边界。
- 除仓库级 `ROADMAP.md` 外，单仓 planning 文档只能解释本仓如何服务当前活跃 Milestone，不能新增跨仓 Milestone。
- 不允许在单仓创建与总 ROADMAP 冲突的平行路线图。
- 规格文档只服务当前或下一个活跃 Milestone，不提前铺满远期设计。
- 涉及跨仓方向、阶段阶梯或边界调整时，先更新或评审总 ROADMAP / 跨仓架构，再拆单仓事项。

## 安全与配置说明

默认最小暴露运行证据。不要提交真实凭据、会话状态、未脱敏执行现场或用户业务数据。涉及本地加密、进程守护、低层代理或沙箱时，可以讨论 Rust / Go 等系统语言，但必须先更新设计文档。

## 许可证边界说明

本仓库属于 AGPL 核心仓库，承载 Runtime Server、Profile、Execution Identity、Browser Drivers、Evidence 和正式运行时能力。面向外部集成的 Runtime API schema、client types、client SDK、OpenAPI 或生成模型，应优先评估是否放入未来的 `contracts` 或 SDK 类 MIT / Apache-2.0 仓库，不应默认进入 Harbor 的 AGPL 核心代码路径。

<!-- LOOM_BOOTSTRAP_START -->
## Loom Execution

本仓库使用 Loom 编排 Work Item、build、review、merge-ready 与 host closeout。Loom
消费 GitHub 与工作现场事实，不用 repo current、progress、review、shadow 或 closeout
carrier 替代宿主真相。

开始改文件前：

1. 用 `loom route --target . --issue <issue> --json` 判断规划或执行入口。
2. 实现必须显式绑定 Work Item 与 issue-scoped branch；PR 创建前可直接运行
   `loom build --target . --issue <work-item> --branch <branch> --json`。
3. 一次只推进一个有界目标；不要创建空提交、空 PR 或治理载体来满足 admission。
4. PR 存在后再运行 `loom pre-review`、`loom review`、`loom merge-ready` 或 `loom ship`；
   这些入口从 GitHub readback 取得 branch、head、review、checks 与 merge 状态。
5. 验证证据记录命令、结果、时间或 head/run id；变更代码或 PR review 输入后重新确认
   current-head attestation 与 gate freshness。
6. merge 不等于产品完成；用 `loom attestation closeout` 消费宿主 closeout，用
   `loom release readback` 消费发布事实，不创建 closeout/current-retire PR。

环境或 provider 问题由 `loom doctor --target . --json` 分类；退役命令返回
`unsupported_command_surface`，不得通过 compatibility flag 恢复。
<!-- LOOM_BOOTSTRAP_END -->
