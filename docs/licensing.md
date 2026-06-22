# 许可证边界

本文档记录 WebEnvoy 组织当前的许可证策略和未来拆分边界。它不是法律意见；具体法律风险需要单独评估。

## 当前仓库策略

| 仓库 | 策略 | 说明 |
|---|---|---|
| `WebEnvoy/WebEnvoy` | AGPL-3.0-only | 保护 Core、API Server、Console、CLI、MCP Server 和正式执行逻辑。 |
| `WebEnvoy/Harbor` | AGPL-3.0-only | 保护 Runtime Server、Profile、Execution Identity、Browser Drivers、Evidence 等核心运行时能力。 |
| `WebEnvoy/Lode` | MIT | 鼓励站点知识、能力包、任务封装、模板和能力包 Schema 传播与复用。 |
| `WebEnvoy/.github` | MIT | 组织主页、issue 模板、PR 模板和社区配置，保持宽松复用。 |
| `WebEnvoy/research` | private | 调研、竞品分析、技术比较和决策候选默认不公开。 |

## AGPL 核心边界

AGPL 仓库承载产品核心能力：

- WebEnvoy Core；
- API Server；
- Console；
- CLI；
- MCP Server；
- Harbor Runtime Server；
- Profile 与 Execution Identity；
- Browser Drivers；
- Evidence Store；
- 正式站点能力执行逻辑。

这些模块不应为了集成便利而被复制到宽松许可仓库中。

## 宽松许可边界

面向生态集成、跨语言调用和公共协议的内容，未来应优先放入 MIT 或 Apache-2.0 仓库，而不是默认沉入 AGPL 核心仓库。

候选仓库包括：

| 候选仓库 | 可能许可证 | 可能内容 |
|---|---|---|
| `WebEnvoy/contracts` | MIT 或 Apache-2.0 | OpenAPI、JSON Schema、Runtime Contract Schema、Capability Package Schema、错误码、协议定义。 |
| `WebEnvoy/sdk-js` | MIT 或 Apache-2.0 | TypeScript / JavaScript SDK、生成类型、客户端封装。 |
| `WebEnvoy/sdk-python` | MIT 或 Apache-2.0 | Python SDK、生成模型、客户端封装。 |

## 当前落地规则

- 现在不新建 `contracts`、`sdk-js`、`sdk-python` 仓库；
- 正式实现 SDK、Client、跨语言 Schema 或公共协议前，先评估是否需要独立宽松许可仓库；
- 不把面向外部集成的客户端库默认放进 AGPL 核心代码路径；
- Lode 的能力资产、模板和包格式继续保持 MIT；
- research 保持 private，不放许可证文件。

## 后续触发条件

出现以下情况时，应重新审视仓库拆分：

- 外部系统需要直接集成 SDK；
- OpenAPI / JSON Schema 开始被多个仓库共同消费；
- MCP client 或轻量 client 需要被第三方项目嵌入；
- Lode 包格式需要作为公共生态协议发布；
- AGPL 对外部集成造成明显阻力。
