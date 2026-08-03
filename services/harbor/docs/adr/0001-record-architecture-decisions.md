# 0001. 记录架构决策

## 状态

已接受，2026-06-29。

## 背景

Harbor 已经在 `docs/draft/` 下保存规划草稿，但这些草稿明确不是稳定规格或实现承诺。项目需要一个小而稳定的位置记录可被其他 WebEnvoy 仓库引用的决策，避免把每一条草稿笔记都当成已接受架构。

## 决策

架构决策记录在 `docs/adr/` 下，使用编号 Markdown 文件：

```text
NNNN-short-kebab-title.md
```

每份 ADR 使用这个精简结构：

- `状态`
- `背景`
- `决策`
- `影响`
- `备选方案`
- `研究证据`
- 草案 ADR 可以使用 `未决问题`
- 已接受 ADR 如有非阻塞后续项，使用 `后续决策`、`后续 ADR` 或 `实施期决策`

所有待决策项必须同步到 [pending-decisions.md](pending-decisions.md)，并在 ADR 本文引用 pending decision ID。

状态值为：

- `草案`：需要评审的决策草案。
- `已接受`：仓库当前遵循的决策。
- `被 ADR NNNN 取代`：后续决策替换了本决策。

ADR 只描述产品和架构边界。它不替代 schema、测试、迁移说明、API 引用或实现文档。

## 影响

这让决策记录足够小，便于维护。草稿文档可以继续探索，已接受 ADR 则作为 Harbor、Core、Lode 和 App 集成工作的引用点。

修改决策时，应新增 ADR 或用明确理由更新状态，不应静默改写旧背景。

## 备选方案

- 把所有决策继续放在 `docs/draft/`：拒绝，因为草稿材料混合了选项、参考和开放问题。
- 采用更大的 ADR 模板：暂时拒绝，因为 Harbor 仍在定义第一批边界，额外字段只会增加流程，不会改善决策质量。
- 只写最终规格：拒绝，因为边界决策需要在 schema 和实现工作前先被评审。

## 研究证据

- [docs/draft/README.md](../draft/README.md) 说明当前草稿是规划候选，不是稳定规格。
- [README.md](../../README.md) 定义 Harbor 是 runtime/profile/evidence 边界，并把站点业务逻辑排除在 Harbor 外。
- [AGENTS.md](../../AGENTS.md) 要求涉及低层 runtime、proxy、sandbox 或 evidence 的设计变化先更新设计文档。

## 后续决策

这些后续项不阻塞本 ADR 的已接受状态：

- [PD-0001](pending-decisions.md#pd-0001)：ADR 被接受后，版本化 Runtime API schema 应放在哪里？
- [PD-0002](pending-decisions.md#pd-0002)：已接受 ADR 后续是否需要 owner 字段，还是 Git 历史已经足够？
