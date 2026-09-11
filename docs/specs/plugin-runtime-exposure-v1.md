# Plugin Runtime Exposure V1

状态：Accepted；版本：v1；owner：Core（授权、Run 与结果）、Harbor（Runtime 能力与现场）、Desktop Agent entry（MCP 投影）。产品归口：[Runtime Work Item #498](https://github.com/WebEnvoy/WebEnvoy/issues/498)、[#474](https://github.com/WebEnvoy/WebEnvoy/issues/474)、[#508](https://github.com/WebEnvoy/WebEnvoy/issues/508)。依据：[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)、[Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md)、[Managed SKILL Library Lifecycle V1](skill-library-lifecycle-v1.md)。

本规格冻结首宿主的固定 MCP 投影、授权边界、版本兼容和失败语义。工具可见、Runtime capability 存在、当前 Grant 允许调用以及 Provider 当前可执行性是四个独立事实。

## 固定工具与投影

已安装、完整性核验的 Plugin 通过下列固定工具消费 Runtime；Plugin 不建立授权、不直接调用 Harbor/Provider、不把浏览器协议作为回退路径。

| Runtime/管理能力 | MCP 工具与 operation | 授权和结果归口 |
| --- | --- | --- |
| bounded Network metadata + Console/Page Error | `webenvoy_operation`：`instance.diagnostics` | 既有 `allowed_operations` 中的 `instance.diagnostics`；详见 [Network V1](network-runtime-contract-v1.md) 与 [Console V1](console-runtime-contract-v1.md)。 |
| Profile environment facts / bounded configuration update | `webenvoy_operation`：`environment.read`、`environment.update` | 既有同名 `allowed_operations`；字段与失败语义由 [Profile Environment V1 §18](profile-environment-v1.md#18-首个正式环境生命周期合同499) 维护。 |
| Installed Profile recovery diagnosis/request/status | `webenvoy_recovery`：`recovery.inspect`、`recovery.request`、`recovery.status` | 明确授予的同名 operation；Agent 不能 backup/plan/apply，详见 [Grant Wire Contract V1](grant-wire-contract-v1.md)。 |
| 已安装、固定来源的可选 SKILL | `webenvoy_skills`：`skill.list`、`skill.inspect`、`skill.install`、`skill.enable`、`skill.read`、`skill.update`、`skill.rollback`、`skill.disable` | `skill_scope` 与同名 `allowed_operations` 交集；正文与 receipt 由 [SKILL Library Lifecycle V1](skill-library-lifecycle-v1.md) 维护。 |

`webenvoy_skill` 仍只提供必需管理/浏览器引导资产；`webenvoy_skills` 不能替换或覆盖它。工具唯一拼写为 `webenvoy_skills`，不引入 `webevoy_skills` 别名。

## SKILL 工具输入

每次 `webenvoy_skills` 调用都要求 `idempotency_key`、`grant_id`、`operation`、`task_scope`；Connector 注入当前 `connection_id`。`task_scope` 必须恰好含 `operations`、`skill_refs`、`source_refs` 三组数组，数组项唯一且 operation 必须包含当前 operation。SKILL 请求不带 Profile、origin、runtime session、page、URL、路径、脚本或浏览器动作字段；未知字段拒绝。

| operation | 输入选择 | 结果边界 |
| --- | --- | --- |
| `skill.list` | 仅 task scope；返回范围内批准资产/修订元数据与本地状态。 | 不返回正文。 |
| `skill.inspect` | `skill_ref`。 | 只返回该资产的批准元数据、选择和状态。 |
| `skill.install` | 明确完整 `revision_ref`，可带精确 `source_ref`。 | 安装后保持 disabled，不自动选择或启用；同一有效请求幂等。 |
| `skill.enable` | `skill_ref`、已安装目标 `target_revision_ref`，以及当前选择的 CAS 预期值。 | 只启用完整且兼容的已安装修订。 |
| `skill.read` | `skill_ref`；读取当前 enabled revision。 | 先校验同一物化 Buffer，再返回真实 content 和 read receipt。 |
| `skill.update` / `skill.rollback` | `skill_ref`、已安装目标 `target_revision_ref`，以及 CAS 预期值。 | 原子切换选择，保持原 enabled 值；不隐式 install/latest/merge。 |
| `skill.disable` | `skill_ref` 以及当前选择的 CAS 预期值。 | 阻止后续新 read，保留内容、选择和历史。 |

`enable`、`update`、`rollback`、`disable` 的 CAS 必须在 Core 锁内再次检查；缺少或不匹配的当前 revision/record version 拒绝并返回稳定 conflict。`skill.update` 与 `skill.rollback` 只接受已安装且 valid 的目标，rollback 还须是仍可用的历史修订。来源身份、大小、UTF-8、hash、路径越界和 symlink 规则见生命周期合同。

## 既有 Runtime 输入与 availability

`webenvoy_operation` 的诊断输入仍为 `idempotency_key`、`grant_id`、`operation=instance.diagnostics`、既有 browser `task_scope`、`profile_ref`、`runtime_session_ref` 和精确 `origin`，可选同一 Instance 的 `page_ref`、不透明 `cursor`、`limit`（整数 1–64）。Plugin 添加当前 `connection_id`；未知输入字段拒绝。诊断不接受页面动作、selector、脚本、header、body 或 raw endpoint 参数，结果仍是有界脱敏 metadata。

`environment.read` / `environment.update` 复用既有 `webenvoy_operation`。update 额外要求非空 `configuration`，只接受 timezone/language/viewport（各 1–128 字符）；不接受 Instance/Page/cursor、脚本、Provider/proxy/seed 参数。返回 `harbor-profile-environment/v1` 的 configured/effective/pending/observed/drift/provider/support/last_verified_at；保存不热改活动 Instance，不隐式重启。更新响应丢失后 query 原 key，只查询 mutation receipt 和当前环境事实，不再次提交更新；首次 readback/跨 restart 与未验证项必须区分，unknown 不等于 verified。

MCP 工具固定可见；可见不意味着 Provider 支持或主体获授权。本版本不按站点或 SKILL 动态隐藏既有工具，也不发明诊断能力。未实现能力返回 unavailable，不能以空事件冒充成功；单 Profile 拒绝不改变其他 Profile 授权。没有网站 SKILL 不影响通用诊断、环境或浏览器能力。

`profile.create` 不从项目推荐推导 Provider。可信 owner 在创建 Grant 时显式选择 `creation_template.provider_id`；Plugin 只能提交该 template ref，不能替换 Provider。模板 Provider 不可用或未获授权时，相关创建局部拒绝，不得静默改用其他 Provider。已存在 Profile 的 Grant 永远沿用 Profile binding；修改推荐或未来用户默认偏好不改变旧绑定。

恢复投影只允许 `recovery.inspect`、`recovery.request`、`recovery.status`。inspect 返回安全摘要；request 创建待 owner 决定的 plan/operation，不自动 stop、覆盖或确认；status 只查询原 operation/receipt。Plugin 永远不能调用 owner-only 的 backup/plan/apply，不能携带 owner token。plan 的 Profile、当前材料指纹、backup ref、范围与有效期由 Core 持久化；目标/材料/归属变化或活动 Instance 会使后续确认失效。

环境与恢复 operation 复用既有 Grant 数组、持久化与交集模型；环境扩展不新增 Grant wire 维度，恢复值与单计划确认的持久安全语义见 [Grant Wire Contract V1](grant-wire-contract-v1.md)。

## Grant、task scope 与浏览器边界

Core 只接受一个当前有效的 Principal/Connection/Grant，取 `skill_scope={skill_refs,source_refs}`、task scope、批准清单和 compatibility 的交集。旧 Grant 缺少 `skill_scope` 时没有 SKILL 权限；不得以网页 Profile、origin、账号绑定或通用浏览器 Grant 推导 SKILL 权限，也不得以 SKILL 权限推导网页操作权。版本升级、旧 Grant 读取和旧严格 reader 的拒绝边界见 [Grant Wire Contract V1](grant-wire-contract-v1.md)。

既有 `webenvoy_operation` 的 browser/environment task scope 继续使用 `operations`、`profile_refs`、`origins`，其授权和 Web scope 不因 SKILL 工具改变。SKILL 请求不携带网页范围；同一个连接仍须先通过 `webenvoy_connect`，撤销/过期在每次新管理或 read 前重新检查。

`webenvoy_status`、bootstrap、合法 `connect`、Profile 管理和无网站 SKILL 的通用浏览器能力不得被可选 SKILL 清单缺失、内容损坏或不兼容阻断。未获授权的资产、修订和来源不能出现在 list、inspect、错误或结果中；错误不得泄露本地 data root、物化路径、凭据或正文。

## 结果、receipt 与恢复

Core 沿用 `{ok, run_id, status, result?, failure?}` 包装。管理操作的成功结果为非内容元数据；`skill.read` 的即时结果额外带通过同一 Buffer 校验的真实 content 与 `webenvoy.skill-read-receipt.v1`。内容不写入 Run Record、持久操作摘要或历史 receipt。

成功诊断的 `result.schema_version` 继续为 `harbor-runtime-diagnostics/v1`；拒绝通过既有 admission error 或失败 Run 的 `failure.code` 传递，不能吞掉 unavailable、stale 或 revoked。Plugin 不重试 operation；断线后重新 connect，按原 `idempotency_key` 或 `run_id` 查询。纯 diagnostic read 只有在仍获授权时才能用新 key 读取当前窗口；查询原 Run 返回历史事实，不把历史 observation 解释为当前 Page 状态。

`webenvoy_query` 只查询原 Run/receipt/摘要，不重放安装、启用、切换、禁用或 read，也不因旧 receipt 返回新的正文。响应丢失时，Plugin 重新 connect 后按原 idempotency key 或 run 查询；idempotency conflict、CAS conflict、`managed_skill_local_modified`、`managed_skill_missing`、`managed_skill_source_corrupt`、unavailable、revoked 和 incompatible 都保持明确失败，不能降级为空成功。

SKILL 资产管理不启动浏览器、不申请 ControlLease、不登录网站、不执行 SKILL 附带脚本、不改变 Profile/Account/Provider，不实现动态 tool routing、Marketplace、任意脚本或 Network body/interception/modification。新增 capability→tool projection 使本 Work Item 的 `DO-PLUGIN-EXPOSURE=triggered`；SKILL Grant 维度使 `DO-GRANT-WIRE=triggered`，其余 Network、Console、Provider-private schema、完整 App IA 本轮不触发。

## 版本与安装边界

安装 bundle、引导 SKILL 和 MCP 兼容系列保持 `0.2.0`；可选参考资产 R1/R2 的真实 version 也均为 `0.2.0`，其来源 commit/blob 与内容 SHA-256 见生命周期合同。旧 Plugin 不会调用 `webenvoy_skills`；旧 Runtime 不认识新 operation 时必须明确拒绝，不回退到内部 HTTP 或浏览器协议。改变既有输入、结果、Grant 字段或交集规则时，必须升级对应合同并提供兼容/迁移规则；没有兼容能力的版本不能静默继续执行。
