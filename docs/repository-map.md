# 仓库地图

## 当前基础仓库

| 仓库 | 角色 |
|---|---|
| `WebEnvoy/WebEnvoy` | 站点能力执行与编排层，包含 Core、API Server、SDK、CLI、MCP、Console、Schema 和示例 |
| `WebEnvoy/Harbor` | Agent-ready 指纹浏览器 / Profile Runtime / 执行身份浏览器 |
| `WebEnvoy/Lode` | 站点知识、站点能力、原子动作、任务封装和模板资产库 |
| `WebEnvoy/research` | 组织级研究、调研、对比和决策候选仓库 |
| `WebEnvoy/.github` | 组织主页、issue 模板、PR 模板和社区配置 |

## 命名约定

在 `github.com/WebEnvoy` 组织下，主仓使用 `WebEnvoy`，其他仓库使用清晰的产品名或资产名，不重复添加项目前缀。

推荐：

```text
WebEnvoy/WebEnvoy
WebEnvoy/Harbor
WebEnvoy/Lode
WebEnvoy/research
WebEnvoy/.github
```

不推荐：

```text
WebEnvoy/runtime
WebEnvoy/profile-browser
WebEnvoy/site-packages
```

## 后续可能独立的仓库

后续只有当产品边界、部署形态、维护节奏或许可证边界足够清晰时，才考虑新增仓库，例如：

- `cloud`：公共 Registry、同步、审核和分发；
- `docs` 或官网仓库：独立文档站；
- `contracts`：OpenAPI、JSON Schema、Runtime Contract Schema、Capability Package Schema、错误码和公共协议定义；
- `sdk-js`：TypeScript / JavaScript SDK、生成类型和客户端封装；
- `sdk-python`：Python SDK、生成模型和客户端封装。

`contracts` 和 SDK 类仓库未来应优先采用 MIT 或 Apache-2.0，避免把面向外部集成的客户端生态默认沉入 AGPL 核心仓库。

## 许可证与可见性

| 仓库 | 许可证 / 可见性 |
|---|---|
| `WebEnvoy/WebEnvoy` | AGPL-3.0 |
| `WebEnvoy/Harbor` | AGPL-3.0 |
| `WebEnvoy/Lode` | MIT |
| `WebEnvoy/research` | private |
| `WebEnvoy/.github` | MIT |

## 许可证边界

- AGPL 核心仓库：`WebEnvoy/WebEnvoy`、`WebEnvoy/Harbor`；
- MIT 资产与配置仓库：`WebEnvoy/Lode`、`WebEnvoy/.github`；
- private 研究仓库：`WebEnvoy/research`；
- 未来宽松许可集成仓库：`WebEnvoy/contracts`、`WebEnvoy/sdk-js`、`WebEnvoy/sdk-python`。

详细策略见 [许可证边界](licensing.md)。
