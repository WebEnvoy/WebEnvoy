# 仓库指南

## 项目结构与模块组织

本仓库是 `WebEnvoy/WebEnvoy` 主仓，负责站点能力执行与编排层。当前文档位于 `README.md` 和 `docs/`；后续代码建议按以下方向组织：`packages/api-server/` 放 Public API 与 Internal API，`packages/core/` 放能力执行、任务编排和结果归一，`packages/schemas/` 放跨仓契约，`packages/cli/`、`packages/mcp-server/`、`packages/sdk-*` 放调用入口，`apps/console/` 放管理界面，`examples/` 放示例。

## 构建、测试与开发命令

当前尚未初始化 `package.json`。新增工程脚手架后，优先统一为：`pnpm install` 安装依赖，`pnpm build` 构建，`pnpm test` 运行测试，`pnpm lint` 检查风格，`pnpm typecheck` 做 TypeScript 类型检查。新增命令必须写入 `package.json` 并同步 README 或 `docs/`。

## 代码风格与命名规范

默认主语言为 TypeScript / Node.js。API、Core、CLI、MCP、Console 应复用共享 Schema，不要各自定义不兼容类型。目录和包名使用小写短横线，例如 `api-server`、`runtime-contract`；TypeScript 类型和类使用 `PascalCase`，函数和变量使用 `camelCase`。Schema 优先使用 JSON Schema，必要时配合 Zod。

## 测试指南

测试应覆盖 typecheck、lint、unit tests、schema validation 和 API contract tests。测试文件建议使用 `*.test.ts` 或 `*.spec.ts`。涉及 Harbor 或 Lode 的变更，至少补充契约测试或示例验证，避免只靠手工说明。

## 提交与 Pull Request 规范

提交信息使用 Conventional Commits，例如 `chore: initialize repository documentation`、`docs: refine runtime contract`。PR 需要说明变更范围、影响的仓库边界、验证命令和结果；涉及 Console 变更时补充截图；涉及 API 或 Schema 时链接对应文档。

## 架构与 Agent 专项说明

API Server 是一等入口。SDK、CLI、MCP 和 Console 应通过 API Server 调用 Core，不得绕开 Core 建立独立执行入口。Core 不直接管理浏览器进程、Profile、Cookie、CDP、VNC 或代理，这些属于 Harbor。站点知识、能力包、任务封装和模板资产属于 Lode。不要把主仓扩展成通用 Browser Agent、账号矩阵系统或业务决策系统。

## 许可证边界说明

本仓库属于 AGPL 核心仓库，承载 Core、API Server、Console、CLI、MCP Server 和正式执行逻辑。公共 SDK、Client、跨语言 Schema、OpenAPI、JSON Schema、协议定义和生成类型如果面向外部集成，应优先评估是否放入未来的 `contracts`、`sdk-js` 或 `sdk-python` 等 MIT / Apache-2.0 仓库，不应默认进入 AGPL 核心代码路径。相关策略见 `docs/licensing.md`。
