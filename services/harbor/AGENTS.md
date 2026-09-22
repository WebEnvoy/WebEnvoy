# Harbor Runtime 执行指南

本目录是 monorepo 内的浏览器运行时。先遵循仓库根 `AGENTS.md` 和 [canonical v1.6 规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)。

- Harbor 拥有 WebEnvoy 管理的 Profile、ProviderBinding、EnvironmentConfiguration、Instance、页面操作、Viewer、ControlLease 和运行观测；不拥有业务授权、Run 结果或网站知识。
- [#519](https://github.com/WebEnvoy/WebEnvoy/issues/519)／[PR #522](https://github.com/WebEnvoy/WebEnvoy/pull/522) 已完成其声明范围的供应方原版任务页协作与私有补丁退役。固定组合仍只接受 owner 核验的 Camoufox `0.5.6`、browser `152.0.4-beta.30`、Playwright `1.60.0`，由公开 API Driver 复用完整 launch/context options；其 `limited` 边界是 popup 首请求无法在派发前建立可信 Page 归属时，Harbor 必须在 `fetch`/`continue`/外部请求前以 `page_relation_unavailable` 局部拒绝，不猜测或重放。#519 只覆盖其声明范围，完整 Runtime、所有 popup／Files／Provider 及 #497／#474／#482 余项仍分别验收。旧 Camoufox 私有 launch binding、patched/native artifact 继续 `unsupported`／已退役；Harbor 不启动、不 fallback，旧 #499/#504/#510 记录仅用于历史和 recovery 校验。
- Provider 接入必须先通过 [Qualification Gate](../../docs/adr/0012-runtime-capability-plane-and-plugin-first.md#2026-09-12-provider-职责与-qualification-gate-修订)。Harbor／Driver 可以适配 Provider 已有协议和管理现场，不实现、模拟或长期补偿缺失的浏览器核心语义。Obscura 在当前愿景内不采用，不再验证或跟踪；历史见 [#511](https://github.com/WebEnvoy/WebEnvoy/issues/511)。
- Profile 数据由 WebEnvoy 管理，不挂载外部软件的活动 Profile；Provider 运行中不静默切换，配置区分 configured/effective/pending/drift。
- Viewer 展示原 Instance；观看和控制分离，人工接管只改变 ControlLease，不自动改写 Run 或夺回控制。
- 原 Instance 的页面事件处理不得依赖 Agent 持续 read／snapshot；owner stop、撤权、接管和交还走独立正式控制通道，不能等业务请求自然完成后才误报成功。具体当前 Driver 行为必须先通过专门 G0 核验，不能从同步实现结构直接推断已坏或已修复。
- 无网站 SKILL 不阻断通用浏览器；身份冲突只阻止依赖该身份的操作。
- 默认只暴露必要 refs 与结构化 unavailable，不保存或提交 Cookie、Token、raw DOM/HAR、未脱敏截图/视频或生产现场。
- Provider 或现场逻辑变更至少验证 launch/readback、身份连续性、一个应放行路径、一个应拒绝路径和恢复；docs-only 只做最小文档检查。
