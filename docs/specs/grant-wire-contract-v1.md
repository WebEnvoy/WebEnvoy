# Grant Wire Contract V1

状态：Accepted；版本：v1.2（v1 兼容系列）；owner：Core。产品归口：[Work Item #508](https://github.com/WebEnvoy/WebEnvoy/issues/508)、已安装恢复 [#505](https://github.com/WebEnvoy/WebEnvoy/issues/505) 与 Provider 默认 [#516](https://github.com/WebEnvoy/WebEnvoy/issues/516)。本合同冻结恢复 Grant、SKILL 资源范围与 Provider preference/创建模板的跨进程语义；既有 Principal、Connection、Profile Grant、撤销和交集规则仍由 Core owner API 维护。

## 版本与兼容规则

v1.0 的 recovery 与 v1.1 的 `skill_scope` 语义保持不变。v1.2 新增 preference operation 值，并允许新创建模板把 `provider_id` 明确设为 null；不改变既有网页 `profile_refs`、`allowed_origins`、`allowed_operations` 的含义。当前持久化 envelope 仍为 `webenvoy.managed-access.v0`，不要求给旧记录伪造字段，也没有第二套权限系统。

## Provider preference 与创建模板

`allowed_operations` 新值为 `provider.preference.read`、`provider.preference.set`、`provider.preference.clear`，必须逐项明确授予并同时出现在 task scope。调用不带 Profile 或 origin，task scope 的 `profile_refs`/`origins` 为空；Profile policy 不参与，也不能推出这些权限。set/clear 不由 create、browser、environment 或模板权限推出。旧 Grant 缺少新值即没有权限。

旧模板 `provider_id:string` 保持 fixed：Core 只发送该值，任何 Agent 请求级 `provider_id` 都拒绝。新模板 `provider_id:null` 表示 owner 允许创建时使用一次性 Provider 或 Harbor 用户默认；它不允许修改默认，也不把当前默认复制进模板。动态模板无一次性选择且用户默认 unset 时 create 返回 `provider_selection_required`。旧严格 reader 不认识 null 或新 operation 时必须拒绝，不能忽略后继续。

偏好权限不新增 Provider ID scope；set 的候选仍由 Harbor 当前 catalog 可用性和有效主体授权共同限制。Core 的 preference target/owner proof 与 managed Profile 分离，write 走现有 Run、idempotency、unknown outcome 和只读 receipt 对账。

新版 reader 读取没有 `skill_scope` 的旧 Grant 时必须成功，但该 Grant 没有任何 SKILL 权限；不能自动补全全库 scope、`skill.*` operation 或来源。旧严格 reader 遇到新增 `skill_scope` 字段或 `skill.*` operation 必须明确拒绝，不能自动降级、忽略字段或继续执行；因此旧消费者不能被喂入新字段，兼容边界由严格解析和拒绝保证。新版 reader 仍须通过逐项 `allowed_operations` 和 scope 交集检查。

实现对含 v1.1 extension 的存储做旧版本读写时，必须保留 `skill_scope` 或明确拒绝写入；不得静默丢弃 scope 造成授权回退。v1.1 → 旧版本降级不能把带 scope 的 Grant 当作无 scope 的可写副本。未来增加 Grant 字段、改变交集规则、改变旧字段含义或使旧消费者必须理解新字段时，必须升级合同修订并给出迁移与拒绝规则；不能依靠忽略未知字段继续执行。

## SKILL Grant 与 task scope

Grant 的新增维度只有：

```json
{
  "skill_scope": {
    "skill_refs": ["webenvoy-browser-reference"],
    "source_refs": ["github:WebEnvoy/WebEnvoy:apps/desktop/agent-entry/skills/webenvoy-browser/SKILL.md@047917cd5c17b546336504fa7b56725805bd6e0c"]
  }
}
```

两个数组都必须是有限、唯一的 opaque refs；空数组表示没有对应范围，省略字段表示旧 Grant 且没有 SKILL 权限，不是 wildcard。`allowed_operations` 必须明确列出所需的 `skill.list`、`skill.inspect`、`skill.install`、`skill.enable`、`skill.read`、`skill.update`、`skill.rollback` 或 `skill.disable`，不会由 `skill_scope` 推导。

SKILL 请求的 `task_scope` 必须恰好包含 `operations`、`skill_refs`、`source_refs` 三组数组；每组只能收窄 Grant，不能新增 Grant 中不存在的 ref。调用还须指定一个当前有效的 Principal、Connection 和 Grant，以及获准的 `skill_ref`/完整 `revision_ref`。Core 取 Grant scope、task scope、批准清单和 compatibility 的交集；网页 Profile/origin scope 不参与也不能推出 SKILL 权限，SKILL scope 不能推出网页权限。未知字段、Profile/origin/path/URL/script 字段拒绝。

来源 revision 的批准清单和不可变 commit/blob/SHA-256 身份由 [Managed SKILL Library Lifecycle V1](skill-library-lifecycle-v1.md) 维护。Grant 不得携带本地路径、正文、Cookie、Token 或 Provider-private 数据；错误、list 和 inspect 也不得泄露这些内容。

## Owner 入口与历史

Owner 固定使用本机受信的 `access register`、`access grant`、`access revoke`、`access list` 管理 Principal、Grant 及 `skill_scope`；owner credential 只在本机/owner API 内部读取，不进入 Agent MCP。Agent 不能写自己的 scope，网页操作 Grant 不能替代 owner 授权。

Grant/Principal/Connection 的撤销与过期在每次新 SKILL 管理或 read 前检查；撤销只阻止新的认证、调用和内容读取，不删除历史 Run、receipt、选择或 revoked_at。重启后这些事实必须保留，重装不能通过清空受管 data root 以外的文件恢复权限。

## Recovery operation values

`allowed_operations` 可包含以下恢复值：

- `recovery.inspect`：读取指定 Profile 的安全摘要；不停止、不写入。
- `recovery.request`：提交恢复请求并生成待 owner 决定的 plan/operation；不确认、不覆盖。
- `recovery.status`：查询原 recovery operation/receipt；不重新执行。

这些值沿用既有 Grant 数组、Profile policy、task scope、Principal/Connection 撤销和过期交集；旧 Grant 不自动得到恢复值。`recovery.backup`、`recovery.plan`、`recovery.apply` 是 owner CLI/Core supervisor 操作，不是 Agent Grant 值。

## Recovery 持久对象与单计划确认

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

`recovery.request` 只能产生待 owner 决定的计划。Owner confirmation 绑定单一 `plan_ref` 和 `confirmation_ref`，一次确认只能消费一次；plan 过期、目标/backup/材料/归属变化、活动 Instance 或重复/冲突 idempotency key 都必须拒绝。已消费且成功的 confirmation 用同 key 查询时返回历史 result，不重新执行 apply。撤销或过期的 Principal/Connection/Grant 只阻止新 Agent request，不改变历史 Run/receipt。

所有操作复用 Core Run Record/receipt。请求响应丢失时按原 idempotency key 或 operation ref 查询；`unknown_outcome` 不自动转换为成功，也不重放 apply。Owner CLI 的 `recovery status` 接受互斥的 `--operation-ref` 或 `--idempotency-key` selector；后者的 `--kind` 仅限 `inspect`、`backup`、`plan`、`apply`，默认 `apply`，按 Core 的 `recovery:<sha256(kind:key)>` 规则派生 operation ref。Core 结果只返回 opaque refs、安全摘要和稳定 failure code，不返回 token、bundle、Profile 路径、Cookie 或浏览器数据。owner endpoint 拒绝 Agent Grant 字段和 `owner=true` 伪造。

## 非目标

本合同不新增第二权限系统，不赋予 Agent owner backup/plan/apply，不把 SKILL scope 变成网页 origin 白名单，不修改 Network/Console/Provider-private schema，也不定义不存在的 fixture 或验收路径。Plugin 投影和八个 SKILL operation 见 [Plugin Runtime Exposure V1](plugin-runtime-exposure-v1.md)。
