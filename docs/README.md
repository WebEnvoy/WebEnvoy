# WebEnvoy monorepo 文档

本目录维护 `WebEnvoy/WebEnvoy` monorepo 的正式工程文档。产品方向、V1 范围和决策状态以组织级 [WebEnvoy v1 产品与架构方向规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md) 为最高真相。

仓内文档不得另立产品方向；它们负责解释架构决策、模块关系、规范性语义、稳定合同和实际验证。

Provider 资格、用户选择和职责边界的组织级修订尚在 [.github#20](https://github.com/WebEnvoy/.github/pull/20) 待合并。本仓的 2026-09-12 ADR／spec 修订以它为前提，不复制另一份 canonical；该 PR 变化时必须先对账。

## 权威关系

遇到冲突时按以下顺序处理：

1. **Canonical 产品规范**：产品定位、V1 必须范围、长期原则与非目标；
2. **Accepted ADR**：为什么采用某项架构和实施决策、哪些旧解释被替代；
3. **Spec／contract**：能力语义、状态、约束、错误、兼容和数据边界；
4. **Architecture**：模块所有权、调用方向和禁止跨界；
5. **Issue／Milestone／Project**：交付范围、当前执行状态和完成证据归口；
6. **Verification**：某个版本实际证明了什么，不反向扩大产品或架构范围。

代码与文档不一致时不得用旧文档掩盖实现事实，也不得仅凭当前实现缩小 canonical／spec 已确认的 V1 范围；应通过 Issue 修复实现或通过正式决策修订规范。

## 目录语义

| 目录 | 用途 | 不放什么 |
| --- | --- | --- |
| `adr/` | 已接受、拟议、拒绝、废弃或被替代的架构决策；解释“为什么”。 | 最终 wire schema、运行手册、交付状态台账。 |
| `architecture/` | 系统分层、模块所有权、依赖方向、数据与控制流；解释“系统怎样协作”。 | 产品路线图、字段级 API、站点流程。 |
| `specs/` | 规范性能力、对象和状态语义；定义“什么叫支持和完成”。 | 当前 Issue 状态、Provider 宣传、未接受草稿。 |
| `contracts/` | 稳定 ADR、spec、schema 和跨模块合同的索引，不复制第二份正文。 | 候选字段、实现草图。 |
| `verification/` | 可运行入口、版本、成功／拒绝／恢复证据和已知限制。 | 新的产品范围或架构决定。 |
| `migration/` | 数据、API、Provider 或架构迁移的执行与回退说明。 | 长期产品规划。 |
| `draft/` | 短期探索材料；每份保留草稿必须有状态、owner、linked issue 和退出条件。 | 实现依据、长期 truth、空目录占位。 |

暂不创建通用 `guides/`。真实、稳定且可重复的用户流程出现后，再按需要建立面向用户或维护者的指南。

## 当前 V1 架构基线

- [ADR 0011：以受管浏览器与 SKILL 纵向路径推进 V1](adr/0011-v1-managed-browser-and-skill-delivery.md)
- [ADR 0012：V1 Runtime Capability Plane 与 Plugin-first 交付基线](adr/0012-runtime-capability-plane-and-plugin-first.md)
- [跨仓架构](architecture/cross-repo-architecture.md)
- [Runtime Capability Plane 架构](architecture/runtime-capability-plane.md)
- [Browser Runtime Capabilities V1](specs/browser-runtime-capabilities-v1.md)
- [Profile Environment V1](specs/profile-environment-v1.md)
- [合同索引](contracts/README.md)

ADR 0012 部分替代 ADR 0011 中“仅因当前消费者未使用即可省略 Runtime 基础能力类别”的过度实施解释；其 2026-09-12 修订又替代 ADR 0011 第 3 条的“默认 Provider 验证目标”当前解释。ADR 0011 的纵向用户结果、单一 owner、SKILL 边界和不预建大型平台等原则继续有效。

## 当前正式验证入口

- [安装后的单宿主 Agent 入口](verification/installed-agent.md)
- [Agent 管理多个 Profile](verification/managed-agent-profiles.md)

Verification 文档只说明对应版本和范围，不等于完整 V1 或当前所有 Provider／平台均已通过。

## 文档变更规则

- 新架构决定使用 ADR；不要回写历史 ADR 让旧决策看起来从未变化。
- 新的规范性能力语义进入 `specs/`；字段级 schema／OpenAPI／MCP schema 在真实实现需要时建立，并从 `contracts/README.md` 链接。
- Issue 负责交付结果和状态，不能成为长期架构正文的唯一载体。
- docs-only PR 至少运行 `git diff --check`、相对链接检查和 Markdown 基本结构检查；不得冒充产品 live。
- 已接受 spec 的实质范围变化必须关联产品 FR 和相应决策，不通过实现便利静默缩小。
