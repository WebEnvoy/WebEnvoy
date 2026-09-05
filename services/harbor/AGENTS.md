# Harbor Runtime 执行指南

本目录是 monorepo 内的浏览器运行时。先遵循仓库根 `AGENTS.md` 和 [canonical v1 规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)。

- Harbor 拥有 WebEnvoy 管理的 Profile、ProviderBinding、EnvironmentConfiguration、Instance、页面操作、Viewer、ControlLease 和运行观测；不拥有业务授权、Run 结果或网站知识。
- Camoufox 是首个默认 Provider 验证目标，不是已通过结论；Chrome 是显式兼容 Provider。公共能力不得长期等同于 CDP，也不得为理论通用性先建复杂 Provider 平台。
- Profile 数据由 WebEnvoy 管理，不挂载外部软件的活动 Profile；Provider 运行中不静默切换，配置区分 configured/effective/pending/drift。
- Viewer 展示原 Instance；观看和控制分离，人工接管只改变 ControlLease，不自动改写 Run 或夺回控制。
- 无网站 SKILL 不阻断通用浏览器；身份冲突只阻止依赖该身份的操作。
- 默认只暴露必要 refs 与结构化 unavailable，不保存或提交 Cookie、Token、raw DOM/HAR、未脱敏截图/视频或生产现场。
- Provider 或现场逻辑变更至少验证 launch/readback、身份连续性、一个应放行路径、一个应拒绝路径和恢复；docs-only 只做最小文档检查。
