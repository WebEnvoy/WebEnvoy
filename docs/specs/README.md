# WebEnvoy 规范性规格

本目录定义 WebEnvoy 已确认产品与架构边界下的规范性语义：某项能力、对象或状态“支持”是什么意思，以及实现和验收必须满足什么。

Spec 不维护当前交付状态，不替代 canonical 产品范围，也不直接冻结所有 wire 字段。最终 HTTP／MCP／JSON Schema、生成类型和 migration 在具体实现需要时建立，并由 [`docs/contracts/README.md`](../contracts/README.md) 索引。

## 当前规格

| 规格 | 归口 | 作用 |
| --- | --- | --- |
| [Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md) | [Runtime FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497) | 定义 V1 Browser Runtime capability 类别、支持／证据状态、权限、数据边界、恢复和完成条件。 |
| [Profile Environment V1](profile-environment-v1.md) | [Provider／环境 FR #471](https://github.com/WebEnvoy/WebEnvoy/issues/471) | 定义长期 Profile 环境的 configured／effective／pending／observed／drift、Provider owner、连续性和验证。 |

## 使用规则

1. 先读取组织级 [canonical v1.1](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md) 和适用 Accepted ADR。
2. Spec 定义语义；Issue 定义当前交付切片；verification 只保存实际证据。
3. 当前实现缺失不能反向缩小 spec；需要缩小 V1 范围时先更新产品决策。
4. Provider 私有 API、站点 selector、临时测试字段和未经接受的草稿不能进入公共 spec。
5. 规格中尚未冻结的 wire 名称应在实现 Work Item 中通过 schema／fixture／兼容和迁移说明收敛。
6. 新 spec 必须声明状态、版本、owner、产品依据、架构依据和非目标。
