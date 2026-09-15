# Grant Wire Contract V1

状态：Accepted；版本：v1.4（v1 兼容系列）；owner：Core。产品归口：[Work Item #508](https://github.com/WebEnvoy/WebEnvoy/issues/508)、已安装恢复 [#505](https://github.com/WebEnvoy/WebEnvoy/issues/505)、Provider 默认 [#516](https://github.com/WebEnvoy/WebEnvoy/issues/516) 与受管浏览器文件 [#523](https://github.com/WebEnvoy/WebEnvoy/issues/523)。本合同冻结恢复 Grant、SKILL 资源范围、Provider preference/创建模板、browser-files 文件范围和 managed-browser scope semantics 的跨进程语义；既有 Principal、Connection、Profile Grant、撤销和交集规则仍由 Core owner API 维护。

## 版本与兼容规则

v1.0 的 recovery 与 v1.1 的 `skill_scope` 语义保持不变。v1.2 新增 preference operation 值，并允许新创建模板把 `provider_id` 明确设为 null；v1.3 新增可选 `file_scope` 与 browser task `file_refs`；v1.4 新增可选 `scope_semantics`，并以本节的 owner v2 lifecycle 兼容修订补齐正式 API/CLI。上述扩展不改变既有网页 `profile_refs`、`allowed_origins`、`allowed_operations` 的含义。未携带 `scope_semantics` 的 Grant/Profile policy 解释为 `legacy_request_guard_v1`；首次 legacy→v2 仍只能沿用原 owner 确认路径，Agent/task 请求不能指定或升级语义。之后的续发、重签、替换和 v2 policy 调整只走本节的 owner API/CLI/App 入口。

### Managed browser scope semantics

`scope_semantics` 只允许 `legacy_request_guard_v1` 或 `agent_operations_v2`。Grant 与对应 Profile policy 必须匹配，才能启动 Instance 或派发 Page、interaction、file、diagnostics、环境与 recovery mutation；Instance 启动时固定该值，后续调用只携带 Core 已核验的值，不能改变它。Profile list/read 和 recovery inspect/status 是不派发浏览器动作的只读元数据入口，转换后仍可按原 Grant 的既有范围查询。旧 `webenvoy.managed-access.v0` reader 遇到 Grant、policy 或 state 顶层未知字段必须拒绝；支持 v1.4 的 reader 可读 v0 并按缺省 legacy 处理，升级后的 state 使用 `webenvoy.managed-access.v1`，不把新字段静默写回 v0。现有 legacy-shaped owner policy 更新入口遇到已转换 Profile 必须明确拒绝；未来需要修改 v2 policy 时须另行定义 v2-aware owner 合同，旧 reader 仍不得直接读写 v1 store。

首次 legacy→v2 的 Owner confirmation 仍使用现有原子 receipt/transaction：输入绑定一个 legacy source Grant、一个 Profile、`webenvoy.agent-operations-v2-confirmation.v1` confirmation、owner/apply、未来期限和新 Grant/policy。Harbor 可信事实必须证明该 Profile 没有活动 Runtime Session；请求中的停止布尔值不构成证明。新范围只能是 source Grant ∩ source policy 的子集，不能包含 `profile.create`、创建模板或新的 Profile/origin/operation；旧 Grant 不修改、不撤销、不复活，新 v2 Grant/policy 只产生一次。成功 receipt 可用原 idempotency key 重复查询；同一 confirmation_ref 的新 key 只读失败为 consumed，绝不重复升级。

## Owner v2 Grant/Profile lifecycle（v1.4 兼容修订）

正式 owner API 为 `POST /agent-access/v2/grants` 与 `POST /agent-access/v2/profile-policies`；CLI 只提供 `access grant-v2` 与 `access policy-v2`，两者均须显式 `--confirm`。它们复用同一 managed-access store、transaction、receipt 和 idempotency；不新增权限系统，也不进入 Agent MCP。`GET /agent-access` 的 owner projection 为每个 Grant 加计算得到的 `grant_digest`、为每个 Profile policy 加计算得到的 `policy_digest`；digest 不持久化，按当前完整对象快照计算。

`POST /agent-access/v2/grants` 必须提交最终完整的 `principal_id`、恰好一个 `profile_refs`、`policy_digest`、`allowed_operations`、`allowed_origins` 和未来的 `expires_at`。服务端固定 `scope_semantics: "agent_operations_v2"`、`creation_template: null`、`max_created_profiles: 0`；不从 source 推断最终范围。Principal 必须已登记且未撤销，目标 Profile 必须已有 v2 policy；服务端在同一事务内先按 `policy_digest` 做 CAS，再校验操作/origin 是目标 policy 的子集。`file_scope`、`skill_scope` 仍是显式范围，不从 source 或 policy 推导，并继续遵循各自既有文件材料／SKILL 合同的执行时校验。普通 Grant 签发、续发和替换不要求停止 Profile。

`source_grant_id`/`source_grant_digest` 是可选的模板或历史关联：成对出现时必须核对当前 source 内容摘要，source 缺失、Principal/Profile/语义不匹配仍返回 `source_invalid`；它不是新授权的依据。省略 source 即可由 owner 为有效 Principal 和 v2 Profile 直接签发。来源已过期或已撤销时只能创建新的 Grant，不得通过它修改原 Grant 的 `revoked_at`。

`replaces_grant_id`/`replaces_grant_digest` 是可选的原子替换请求。只有当前有效、同 Principal、v2、恰好单 Profile 且目标 Profile 相同的 replacement 才可接受；提交成功在同一事务创建新 Grant 并撤销旧 Grant，且不要求停止 Profile。多 Profile 来源只能作为新签发的可选模板，不能自动撤销或缩窄其它 Profile。source/replacement 不存在或语义不匹配分别返回 `managed_access_v2_grant_source_invalid`/`managed_access_v2_grant_replacement_invalid`；digest 与当前对象不符是可刷新确认的 `managed_access_grant_conflict`，HTTP 409。

`POST /agent-access/v2/profile-policies` 必须提交完整的新 `allowed_operations`、`allowed_origins` 与 `controlled_interaction_origins`（显式 `[]` 也必须提交）以及当前 `current_policy_digest`。它只替换选定 Profile 的 v2 policy，不从 boolean 推导或扩大 controlled origin；当前 Profile 必须由 Harbor 可信地保持 stopped，活动 Runtime 时拒绝。digest 过期返回 `managed_access_policy_conflict`/HTTP 409。相同 operation key 的 reservation 直到所有同 key 持有者释放才解除，避免失败等待者使后续 policy CAS 失去 stopped 保护。

无论来源是否存在，成功结果都保留旧 Grant、历史 Run、receipt 和撤销事实；撤销/过期来源不会复活。owner 刷新列表后应把最新 digest 和完整字段重新确认再提交；Agent 只需重新 `webenvoy_connect` 获取当前有效 Grant，不能自行续发、替换或调整 policy。

### 用户场景→缺口→入口→验收

| 用户场景 | 原有缺口 | 正式入口 | 验收边界 |
| --- | --- | --- | --- |
| 有效期到期后续发 | 旧 Grant 只能沿用初次签发，过期来源会被误当成可恢复对象 | App/`access grant-v2 --confirm`，可带 source digest | 只创建新 Grant；旧 Grant 保持 expired，不被复活或改写 |
| 撤销后重新签发 | 撤销是历史事实，不能靠 replace 恢复 | 同一 v2 Grant API，source 可选且可指向 revoked Grant | 新 Grant 成功，旧 `revoked_at` 不变；replaces revoked source 被拒绝 |
| 有效单 Profile 重签 | 缺少原子“新签发+旧撤销” | `replaces_grant_id`/`replaces_grant_digest` | 同一 transaction 原子替换；陈旧 digest 返回 409 |
| 多 Profile 授权调整 | 直接替换会误撤销其它 Profile | 单一 `profile_refs` 的新签发 | 只新增目标 Profile Grant，原多 Profile Grant 不自动撤销 |
| 调整 Profile 权限上限 | 完整字段与停止事实未绑定，controlled 列表可能被 boolean 扩大 | `access policy-v2 --confirm` / v2 policy API | current digest CAS、完整 origin/operation/controlled 列表、可信 stopped；活动 Profile 拒绝 |
| owner 选择文件材料 | 手填 ref/path 会越过 owner 文件登记边界 | App 的 `/owner/files` 可用材料选择 | 只提交选中 opaque `file_ref`；状态/归属/大小由材料记录决定 |

v2 不改变 Profile/Grant/task origin 交集、Page/document/ControlLease、文件归属、unknown/no-replay 或 explicit navigation 的 pre-dispatch origin 检查。合法 click 的自然越界可保持 `dispatched`；之后 observe/read/input 只允许返回脱敏 origin 与 opaque Page ref，不返回越界 URL path/query/title/text。普通资源、CDN 和 redirect 不以全局 route guard 作为 v2 的授权边界；它们仍受固定 Instance、Page relation、文件/ControlLease 和结果安全边界约束。legacy 继续使用既有逐跳 route guard。

## Managed Browser Files Grant 与 task scope

`file.upload` 与 `file.download` 是需要逐项明确授予的 `allowed_operations`；旧 Grant 缺少它们即没有文件权限。带文件操作的 Grant 可选地包含：

```json
{
  "file_scope": {
    "upload_refs": ["attachment:runtime/<UUID>"],
    "allowed_mime_types": ["image/png", "image/jpeg", "application/pdf", "text/plain", "text/csv"],
    "max_file_bytes": 10485760
  }
}
```

`upload_refs` 是 owner 已登记、属于同一 Profile 的精确 opaque refs，最多 32 项；不接受路径、通配符、正文或 URL。`allowed_mime_types` 必须是上述五种类型的非空唯一子集，`max_file_bytes` 为 1–10 MiB 的整数。省略 `file_scope`、空数组或不兼容字段都不会推导文件权限；旧严格 reader 必须明确拒绝不认识的非兼容扩展，不能忽略后放宽权限。

Browser task scope 在保留 `operations`、`profile_refs`、`origins` 的同时，可为文件操作带 `file_refs`（最多 32 项、唯一 opaque refs）。上传必须恰好携带一个与 Grant `upload_refs` 及任务 scope 一致的 `file_ref`；下载必须携带空 `file_refs`，因为输出材料尚不存在。非文件 operation 不得借 `file_refs` 传递隐藏权限。Core 还须在派发时重新核对文件存在、Profile 归属、未过期/未撤销、类型/大小上限、Page/document/target 新鲜度和 ControlLease。

文件 scope 只允许交付已登记的不可变副本或创建同一 Principal/Profile 的下载结果；它不授予 owner import/export/delete、任意本地路径、正文读取、headers/body、Network interception、跨 Profile 共享或网站业务提交。Grant/Principal/Connection 撤销和过期只阻止新的 Agent 文件操作，不改写已经派发的 Run/receipt；响应丢失按原 operation/idempotency 查询，未知结果不得以新 key 重放。

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
