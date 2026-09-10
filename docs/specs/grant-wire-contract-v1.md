# Grant Wire Contract V1

状态：Accepted；版本：v1；owner：Core；产品归口：[#505](https://github.com/WebEnvoy/WebEnvoy/issues/505)。本合同只补充恢复相关的持久授权语义，既有 `Principal`、`Connection`、`Grant` 字段和交集规则仍以 managed-access 实现及 Plugin Runtime Exposure V1 为准。

## 恢复操作值

`allowed_operations` 可包含以下恢复值：

- `recovery.inspect`：读取指定 Profile 的安全摘要；不停止、不写入。
- `recovery.request`：提交一个恢复请求并生成待 owner 决定的 plan/operation；不确认、不覆盖。
- `recovery.status`：查询原恢复 operation/receipt；不重新执行。

这些值沿用现有 Grant 数组、Profile policy、task scope、Principal/Connection 撤销和过期交集，不新增 Grant 字段、scope 维度或隐式 owner 权限。旧 Grant 不会自动得到恢复值；只有被明确授予对应 operation 的有效 Grant 才能使用 Plugin projection。`recovery.backup`、`recovery.plan`、`recovery.apply` 是 owner CLI/Core supervisor 操作，不是 Agent Grant 值。

## 持久对象与单计划确认安全语义

Core 持久化以下 v1 对象；字段未知、缺失、类型错误、额外字段和 schema/version 不匹配均默认拒绝：

```json
{
  "plan": {
    "schema_version": "webenvoy.profile-recovery-plan.v1",
    "plan_ref": "plan:<opaque>",
    "profile_ref": "<opaque>",
    "backup_ref": "backup:<opaque>",
    "backup_time": "<UTC>",
    "current_material_fingerprint": "<sha256>",
    "backup_material_fingerprint": "<sha256>",
    "current_environment_fingerprint": "<sha256>",
    "backup_environment_fingerprint": "<sha256>",
    "current_material_version": "<opaque>",
    "backup_material_version": "<opaque>",
    "owner_binding": "<sha256>",
    "compatibility": { "provider_id": "camoufox", "provider_version": "<pinned>", "camoufox_version": "<pinned>", "browser_version": "<pinned>", "properties_sha256": "<sha256>", "bundle_schema_version": 1 },
    "scope": "profile_storage_and_matching_environment_bundle",
    "preserved_current_truth": ["grants", "revocations", "security_policy", "account_bindings", "runs", "receipts", "external_outcomes", "audit", "other_profiles"],
    "expires_at": "<UTC>"
  },
  "confirmation": {
    "schema_version": "webenvoy.profile-recovery-confirmation.v1",
    "confirmation_ref": "confirmation:<opaque>",
    "plan_ref": "plan:<opaque>",
    "confirmed_at": "<UTC>",
    "confirmed_by": "owner",
    "idempotency_key": "<opaque>",
    "decision": "apply"
  }
}
```

`recovery.request` 只能产生待 owner 决定的计划。owner 确认绑定单一 `plan_ref` 和 `confirmation_ref`，一次确认只能消费一次；plan 过期、目标/backup/材料/归属变化、活动 Instance 或重复/冲突 idempotency key 都必须拒绝。已消费且成功的 confirmation 用同 key 查询时返回历史 result；不重新执行 apply。撤销或过期的 Principal/Connection/Grant 只阻止新 Agent request，不改变历史 Run/receipt。

所有操作复用 Core Run Record/receipt：请求的响应丢失时按原 idempotency key 或 operation ref 查询；`unknown_outcome` 不自动转换为成功，也不重放 apply。Owner CLI 的 `recovery status` 接受互斥的 `--operation-ref` 或 `--idempotency-key` selector；后者的 `--kind` 严格限定为 `inspect`、`backup`、`plan`、`apply`，默认 `apply`，并按 Core 的 `recovery:<sha256(kind:key)>` 规则派生 operation ref。Core 结果只返回 opaque refs、安全摘要和稳定 failure code，不返回 token、bundle、Profile 路径、Cookie 或浏览器数据。`backup`/`plan`/`apply` 的 owner endpoint 输入也拒绝 Agent Grant 字段和 `owner=true` 伪造。

## 版本兼容

本合同与 `installed-profile-recovery-v1`、`plugin-runtime-exposure-v1` 同属 v1 兼容系列。新增 operation 值需要同时更新 Plugin exposure spec、MCP schema、Grant fixture 和拒绝用例；改变 Grant 字段或交集规则必须升级合同版本并提供迁移。
