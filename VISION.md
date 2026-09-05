# WebEnvoy 产品 monorepo 愿景

本仓库承载 WebEnvoy 的 Core、Desktop App 与 Harbor Runtime。完整产品定位、对象边界、V1 约束和五类决策状态以组织级 [canonical v1 规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md) 为准。

- Core：统一授权、任务、Run、外部结果、幂等、失败和恢复。
- Harbor：WebEnvoy 管理的 Profile、Provider、Environment、Instance、页面现场和 ControlLease。
- Desktop App：人类管理、观看、授权、接管和结果处理入口，不复制 owner 状态机。
- Lode：独立仓库中的网站 SKILL、AccountSystem 模板与共享知识资产。

WebEnvoy 的成果是 Agent 与人在同一长期浏览器现场完成可观察、可接管、可核验的网站任务，不是对象、合同或页面数量。
