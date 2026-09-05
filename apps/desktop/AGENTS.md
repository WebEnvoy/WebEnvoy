# Desktop App 执行指南

本目录是 monorepo 内的人类控制台。先遵循仓库根 `AGENTS.md` 和 [canonical v1 规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)。

- App 管理 Agent 接入、AccountSystem、Account、Profile、Provider、SKILL、Instance、Activity、观看和人工接管；不拥有 Core、Harbor 或 Lode 的业务真相。
- 首批界面围绕“正在运行／需要我处理／最近完成”、同一真实 Instance、必要确认和接管；不把 Task Thread、完整 Library、三栏布局或站点专属创作编辑器预设为实现前置。
- `Activity` 优先投影已有 Run／receipt，不新建第二业务状态机。
- 没有网站 SKILL 时仍允许授权范围内的通用浏览器；账号绑定清单不是网站访问白名单。
- App 不复制授权、站点准入、结果判断或 Profile 数据；所有输入经 owner API，观看失败不等于任务失败。
- Electron／React／TypeScript／Vite 与现有组件保持不变；不为 docs-only 或规划任务安装依赖、创建脚手架或改产品代码。
- UI 变更验证正向、必要拒绝和恢复/接管路径；默认不保存凭据、Profile 数据或未脱敏现场。
