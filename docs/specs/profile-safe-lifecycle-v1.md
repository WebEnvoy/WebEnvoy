# Profile Safe Lifecycle V1

状态：Accepted for Work Item [#601](https://github.com/WebEnvoy/WebEnvoy/issues/601)；版本：v1；owner：Core（Grant、Run、quota 与结果）、Harbor（Profile、local data、lifecycle 与 start gate）。产品依据：[canonical §7、§8、§12.3](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)。架构依据：[Runtime Capability Plane](../architecture/runtime-capability-plane.md)、[Plugin Runtime Exposure V1](plugin-runtime-exposure-v1.md)、[Grant Wire Contract V1](grant-wire-contract-v1.md)。

本合同定义 Agent 在已有 trusted owner Grant 范围内安全复制环境模板、持久归档或明确删除 Profile 的行为。它不完成 #470/#474 的全部长期范围；真实安装验收和发布证据仍绑定冻结候选。

## 所有权与正式入口

Agent 只经 Core managed-browser operation 调用 `webenvoy_operation`，用 `webenvoy_query` 查询原 Run。Core 是唯一 Grant、task scope、ExecutionPolicy、Run、quota 和公共结果 owner；Harbor 是唯一 Profile ref、local material、lifecycle、mutation receipt、repair 和 Provider start owner。CLI、API 与已安装 Plugin 复用此路径，不直接调用 Provider 或另建 lifecycle 状态。

新增 Agent operation 为 `profile.copy_environment`、`profile.archive` 与 `profile.delete`。输入字段、operation exposure 和未知字段拒绝使用随正式 Core 包安装的 `managed-capability-definitions.json`；Harbor 内部 mutation request 见 [`profile-lifecycle-mutation-request.schema.json`](../../packages/schemas/schemas/profile-lifecycle-mutation-request.schema.json)。Harbor mutation result 保持 `webenvoy.harbor-identity-environment-mutation/v1`，原 key receipt 可经 Core Run 查询。

## 安全环境复制

`profile.copy_environment` 要求同一个有效 Grant 同时包含 `profile.copy_environment`、一个精确 source `profile_ref` 的权限与创建 template/quota；task scope 必须再次包含该 operation 和唯一 source Profile，`origins` 必须为空。请求必须给出该 Grant 中的 `template_ref`。`provider_id` 由固定 template 提供，null 或 source/template mismatch 在派发前拒绝；Core 始终把其已核验的 template snapshot 传给 Harbor，Harbor 在 mutation lock 内复核同一 Provider、site id/origin/display name、language 和 timezone。现有可信 owner `copy_environment` 请求可以不携带 Core 专用 snapshot，按源环境原样复制；Harbor 仍拥有源和目标、并在 lock 内读取源。Harbor 生成新 identity、execution、Profile 与 storage refs。

副本只保留 template 明确固定的 Provider、site 和 language/timezone。Proxy、region、viewport、UA、fingerprint 及其他非模板环境设置保持未配置。Browser storage 建立为空的新存储；Cookie、login state、Account binding 与 binding receipt、credential、keychain/local secret、登录方法、Grant、Run、decision、ExternalOperation 与历史来源不继承。副本以 logged-out / manual-login-required 状态开始。Harbor 的 provider-specific binding 仅供同一受支持 Provider 使用，不构成换 Provider 或登录态恢复的 fallback。

副本的 Profile policy 逐项取 source policy ∩ creation template ceiling ∩ invoking Grant。allowed origins 与 controlled interaction origins 也只能留在该交集内；交集为空时保留空权限，不能 fallback。

## 共用 creation quota 与 unknown

同一 Grant 的 `profile.create` 和 `profile.copy_environment` 共用 Core 创建锁、`created_profile_refs` quota 与 Run/Harbor mutation receipt。额度登记必须 exactly once。未知前序创建、Harbor 已完成但 Core 未登记 quota，或缺少可核对 receipt 时，Core 阻止新的 create/copy。

查询只读原 Run 和原 Harbor idempotency receipt。发现原 mutation 已完成时，Core 只为 Harbor 返回的同一 Profile ref 补登记原 quota；不再次调用 create/copy、不生成新 ref。不同 wire 复用 key 返回冲突；unknown、`repair_required` 和残余状态继续如实呈现。

## Archive

`lifecycle_state` 持久化为 `active | archived`。现有 Harbor store `v0` 记录迁移到 `v1` 时，缺失字段按 `active` 读取并在下一次写入保存。Profile list/read 都返回 lifecycle state。

`profile.archive` 要求 Grant 和 task scope 中明确的同一 Profile、同名 operation 与空 `origins`。存在活动 Session、Harbor mutation reservation、external Profile lock 或未决 repair 时拒绝，必须先由调用者显式 stop/unlock/reconcile。归档只改变生命周期；保留同一 refs、storage、Account bindings、metadata、历史 receipts 和恢复资料，不 stop、不解绑、不删除。已归档 Profile 作为唯一 runnable Account 冲突判定中的非 runnable 事实排除，但原 binding 保持可读历史。

所有正式 Provider start 路径在 dispatch 前按 Harbor owner Profile identity/ref/storage refs 检查 lifecycle。`archived` 明确拒绝，不能启动后再补偿；`profile.create` 与 `copy_environment` 不会创建 archived Profile。没有 start capability 或 Provider 的 Profile 管理读取仍可按当前 Grant 使用。

## 明确删除

`profile.delete` 要求 trusted owner 已授予的精确 Profile/delete operation 和同一 task Profile，task `origins` 必须为空；Core 也要求现行 ExecutionPolicy 对 catalog 中的 `destructive` action 放行。`confirmation: "delete_local_data"` 只表达本次 request intent，不签发 owner permission，也不替代该 policy。

有活动 Instance/session、mutation reservation、external lock 或未决 repair 时拒绝，不自动 stop/unlock/unbind。Harbor 删除保留原 identity ref 与 receipt 直到 local storage、Cookie/browser-storage refs、credentials/keychain/local-secret refs 清理及 residual check 成功。清理 incomplete 时 record、refs、receipt 与 repair state 保留；原 key 可查询并修复。query 只核对 receipt，不换 key 或重放删除。已经派发但 result unknown 时保持 unknown。

## 错误与验收边界

未授权主体、Profile/task scope mismatch、固定模板 provider 未指定或不匹配、archived source、quota exhaustion、活动/外部锁、repair、缺确认、未知字段、同 key 不同 wire 都明确拒绝且不产生副作用。拒绝的作用域由实际影响对象限定；Profile 生命周期错误不全局关闭独立 Profile 或 Provider 能力。

此次实现的静态 checks、fixture/fault injection、Harbor Runtime、正式安装包/第三方 Agent、owner 操作和真实账号分别记录。只有 frozen installed Plugin 由真实第三方 Agent 消费并通过合同指定闭环，且 exact HEAD 检查与独立 review 满足后，才可验收 #601；fixture、编译、CI、merge 或本合同本身不代表该验收。
