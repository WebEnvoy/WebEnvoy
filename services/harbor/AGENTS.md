# Harbor Runtime 执行指南

本目录是 monorepo 内的浏览器运行时。先遵循仓库根 `AGENTS.md` 和 [canonical v1 规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)。

- Harbor 拥有 WebEnvoy 管理的 Profile、ProviderBinding、EnvironmentConfiguration、Instance、页面操作、Viewer、ControlLease 和运行观测；不拥有业务授权、Run 结果或网站知识。
- Provider 接入必须先通过 [Qualification Gate](../../docs/adr/0012-runtime-capability-plane-and-plugin-first.md#2026-09-12-provider-职责与-qualification-gate-修订)。Harbor／Driver 可以适配 Provider 已有协议和管理现场，不实现、模拟或长期补偿缺失的浏览器核心语义。Obscura 在当前愿景内不采用，不再验证或跟踪；历史见 [#511](https://github.com/WebEnvoy/WebEnvoy/issues/511)。
- Profile 数据由 WebEnvoy 管理，不挂载外部软件的活动 Profile；Provider 运行中不静默切换，配置区分 configured/effective/pending/drift。
- Viewer 展示原 Instance；观看和控制分离，人工接管只改变 ControlLease，不自动改写 Run 或夺回控制。
- 无网站 SKILL 不阻断通用浏览器；身份冲突只阻止依赖该身份的操作。
- 默认只暴露必要 refs 与结构化 unavailable，不保存或提交 Cookie、Token、raw DOM/HAR、未脱敏截图/视频或生产现场。
- Provider 或现场逻辑变更至少验证 launch/readback、身份连续性、一个应放行路径、一个应拒绝路径和恢复；docs-only 只做最小文档检查。
