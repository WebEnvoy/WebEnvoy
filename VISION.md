# WebEnvoy 产品 monorepo 愿景

本仓库承载 WebEnvoy 的 Core、Desktop App 与 Harbor Runtime。WebEnvoy 是第三方 Agent 和上游系统的浏览器基础设施；完整产品定位、对象边界、V1 约束和五类决策状态以组织级 [canonical v1.6 规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md) 为准。S0 三仓基线已于 2026-09-18 合并并回读；新产品边界已生效，但不表示对应能力已经实现。

- Core：统一授权、任务、Run、外部结果、幂等、失败和恢复。
- Harbor：WebEnvoy 管理的 Profile、Provider、Environment、Instance、页面现场和 ControlLease。
- CLI／API／Plugin：用户、脚本、第三方 Agent 与上游系统的正式入口，共用 owner 状态。
- 可信用户入口：不依赖 App 的授权、监督、接管、交还、撤权、停止与恢复。
- Desktop App：冻结的可选人类控制台代码与历史设计，不是正式能力的运行前提。
- Lode：独立仓库中的站点 SKILL、AccountSystem 模板、references、scripts、assets 与验证材料。

WebEnvoy 的成果是上游、Agent 与可信用户在同一长期浏览器现场完成可观察、可接管、可核验、可恢复的网站任务，不是对象、合同或页面数量。
