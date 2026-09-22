# Desktop App 执行指南

本目录保存冻结的 App 代码和历史设计。先遵循仓库根 `AGENTS.md`、[canonical v1.6 产品规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md) 和已接受的 [ADR 0014](../../docs/adr/0014-browser-infrastructure-and-app-freeze.md)。

- App 专属产品化冻结；除安全修复、兼容维护、明确的去 App 隐藏依赖工作或新的重启决定外，不新增界面和产品流程。
- 授权、监督、接管、交还、撤权、停止和恢复必须可由无 App 的可信入口完成；不得把普通 Agent 或 owner 能力做成 App-only。
- `Activity` 优先投影已有 Run／receipt，不新建第二业务状态机。
- 没有网站 SKILL 时仍允许授权范围内的通用浏览器；账号绑定清单不是网站访问白名单。
- App 不复制授权、站点准入、结果判断或 Profile 数据；所有输入经 owner API，观看失败不等于任务失败。
- Electron／React／TypeScript／Vite 与现有组件保持不变；不为 docs-only 或规划任务安装依赖、创建脚手架或改产品代码。
- UI 变更验证正向、必要拒绝和恢复/接管路径；默认不保存凭据、Profile 数据或未脱敏现场。
