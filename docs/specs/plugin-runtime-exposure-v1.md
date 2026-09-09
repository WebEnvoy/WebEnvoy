# Plugin Runtime Exposure V1

状态：Accepted；版本：v1；owner：Core（授权与 Run）、Harbor（能力与现场）、Desktop Agent entry（MCP 投影）。产品归口：[#498](https://github.com/WebEnvoy/WebEnvoy/issues/498)、[#474](https://github.com/WebEnvoy/WebEnvoy/issues/474)。依据：[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)、[Runtime 能力规格](browser-runtime-capabilities-v1.md)。

## 固定投影

首宿主 Codex 通过已安装、完整性核验的 MCP entry 消费能力。`webenvoy_status` 返回安装与 Runtime readiness；`webenvoy_skill` 返回安装的管理指引；`webenvoy_connect` 连接已经由 owner 登记的 Principal 并返回当前 Grants；`webenvoy_operation` 提交一个 operation；`webenvoy_query` 查询原 Run。Plugin 不建立授权或直接调用 Provider。

| Runtime capability | MCP 投影 | 授权值 | 结果合同 |
| --- | --- | --- | --- |
| bounded Network metadata + Console/Page Error | `webenvoy_operation` 的 `operation=instance.diagnostics` | 既有 `allowed_operations` 中的 `instance.diagnostics` | [Network V1](network-runtime-contract-v1.md)、[Console V1](console-runtime-contract-v1.md) |
| Profile environment facts / bounded configuration update | `webenvoy_operation` 的 `operation=environment.read` / `environment.update` | 既有 `allowed_operations` 中同名值 | [Profile Environment V1 §18](profile-environment-v1.md#18-首个正式环境生命周期合同499) |

诊断输入为 `idempotency_key`、`grant_id`、`operation`、`task_scope`、`profile_ref`、`runtime_session_ref`、精确 `origin`，可选 `page_ref`、`cursor`、`limit`（整数 1–64）。Plugin 添加当前 Connection ID；未知输入字段拒绝。诊断不接受页面动作、selector、脚本、header、body 或 raw endpoint 参数。Page 引用来自同一实例的观察，cursor 是不透明值。

## Availability 与授权

#499 环境操作复用上述固定工具：输入 `idempotency_key`、`grant_id`、`operation`、`task_scope`、`profile_ref`、精确 `origin`；update 额外要求非空 `configuration`，只接受 timezone/language/viewport（各 1–128 字符）。不接受 Instance/Page/cursor、脚本、Provider/proxy/seed 参数。返回 `harbor-profile-environment/v1` 的 configured/effective/pending/observed/drift/provider/support/last_verified_at；字段与失败合同由 Profile Environment V1 §18 唯一维护。保存不热改活动 Instance，不隐式重启。更新响应丢失后 query 原 key，仅查询 mutation receipt 和当前环境事实，不再次提交更新。首次 readback/跨 restart 与未验证项必须区分；unknown 不等于 verified。此扩展触发 Plugin exposure，但不新增 Grant wire 维度；旧 Grant 不自动获得新操作。

MCP 工具列表固定；工具可见不意味着 Provider 支持或主体获授权。本版本不做动态过滤、不按站点或 SKILL 发明诊断能力。Core 验证 Profile ceiling ∩ Principal Grant ∩ task scope；Harbor 验证 Instance、Page、origin、lifecycle 和 Provider 支持。没有网站 SKILL 不影响通用诊断。未实现能力返回 unavailable，不能以空事件冒充成功。单 Profile 拒绝不改变其他 Profile 授权。

新增 operation 值复用既有 Grant 数组、持久化与交集模型；不增加 Grant 字段、scope 维度或持久授权对象，所以 `DO-GRANT-WIRE=not-triggered`。本次新增 capability→tool 投影，`DO-PLUGIN-EXPOSURE=triggered`。

## 结果与恢复

Core 沿用 `{ok, run_id, status, result?, failure?}` 包装；成功诊断的 `result.schema_version` 为 `harbor-runtime-diagnostics/v1`。拒绝通过既有 admission error 或失败 Run 的 `failure.code` 传递；不吞掉 unavailable、stale 或 revoked。详情与允许值由上述两份结果合同定义。

Plugin 不重试 operation。断线后重新 connect，按原 `idempotency_key` 或 `run_id` 查询；不得为找回诊断而重放 click、navigate 等动作。纯 diagnostic read 可在仍获授权时用新 key 读取当前窗口。查询原 Run 返回历史事实，不把历史 observation 解释为当前 Page 状态。撤销阻止新的诊断读取；既有 Run 仍沿用原有主体查询权限。

## 版本与非目标

安装 bundle/skill/MCP 版本保持现有 `0.2.0` 兼容系列，实际代码由安装 manifest 的 exact commit/tree 与文件哈希识别；diagnostics 为新增枚举值，旧授权默认不包含它。旧 Plugin 不会调用此值；新 Plugin 遇到不支持该 operation 的旧 Runtime 必须拒绝，不回退到内部 HTTP 或浏览器协议。破坏现有输入/结果语义需升级对应合同版本。

本切片不定义多宿主平台、动态工具路由、第二权限系统、Network body/interception/modification 或通用任意脚本能力。
