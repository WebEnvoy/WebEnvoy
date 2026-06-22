# WebEnvoy

WebEnvoy 是面向 Agent 和上游系统的站点能力执行与编排层。

它负责将 Lode 中沉淀的站点知识、站点能力、任务封装和资源需求，编排为可执行流程，并通过 Harbor 获取稳定的 Profile、执行身份和浏览器 Runtime。

## 仓库角色

本仓库承载 WebEnvoy Core 及其一等对外调用入口：

- Core：站点能力解释、任务封装执行、执行策略合成和结果归一；
- API Server：面向 Agent、程序、上游系统、Console、CLI、MCP 和 SDK 的统一服务入口；
- SDK：对 API 的语言封装；
- CLI：对 API 的命令行封装；
- MCP：把 WebEnvoy 能力以 Agent 工具形式暴露；
- Console：配置、观察、调试和运行记录管理；
- Schema：WebEnvoy、Harbor 和 Lode 之间共享的基础契约。

## API 定位

API 不是由 SDK 间接提供，而是 WebEnvoy 主仓的一等入口。

```text
Agent / 上游系统 / Console / CLI / MCP / SDK
  ↓
WebEnvoy API Server
  ↓
WebEnvoy Core
  ↓
Lode + Harbor
```

SDK、CLI、MCP 和 Console 都应尽量复用同一套 API，避免形成多套执行入口。

## 相关仓库

- `WebEnvoy/WebEnvoy`：站点能力执行与编排层，本仓库；
- `WebEnvoy/Harbor`：Agent-ready 指纹浏览器 / Profile Runtime / 执行身份浏览器；
- `WebEnvoy/Lode`：站点知识、站点能力、任务封装与模板资产库；
- `WebEnvoy/research`：组织级研究、调研、对比和决策候选仓库；
- `WebEnvoy/.github`：组织主页、issue 模板、PR 模板和社区配置。

## 文档

- [定位](docs/positioning.md)
- [架构](docs/architecture.md)
- [仓库地图](docs/repository-map.md)
- [许可证边界](docs/licensing.md)
- [Runtime Contract](docs/runtime-contract.md)
- [路线图](docs/roadmap.md)

## 状态

项目处于初始化阶段，接口、模块边界和实现路径仍在收敛中。

## 许可证

本仓库采用 GNU Affero General Public License v3.0。
