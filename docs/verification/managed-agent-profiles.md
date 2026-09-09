# Agent 管理多个 Profile

当前正式入口由 Desktop 监督的 Core HTTP API 提供。设置 → Agent 接入登记 Agent 客户端生成的 SHA-256 凭据指纹，向稳定 Principal 授予有期限、固定 Camoufox 模板和最多两个新 Profile 的管理 Grant。原始凭据只由客户端保存；不传入 App 表单、日志或 Issue。

客户端以 `Authorization: Bearer <本地凭据>` 调用：

- `POST /agent-connections`：返回新 Connection，Principal 不随重连变化。
- `POST /managed-browser/operations`：提交一次管理意图。
- `GET /managed-browser/operations/:run_id`：只查询已有结果，不重放操作。

管理请求必须包括 `idempotency_key`、`connection_id`、`grant_id`、`operation` 和 `task_scope: {operations, profile_refs, origins}`。创建还须传入 owner Grant 的 `template_ref`；不能提供 Provider 配置或权限。对已有 Profile 的操作传 `profile_ref`；启动、观察、账号绑定还须传授权 `origin`。启动可选无凭据、无 query/hash 的 `url`，只用于创建新 Instance；复用不会导航或重建页面。

操作包括 `profile.create/list/read`、`instance.start/observe/handoff/stop`、`account.bind`。绑定需要先前返回的 `observation_ref`、`account_system_ref`、`account_ref`，并由 Harbor 再核实新鲜的同实例观察与唯一归属。发现账号不会自动绑定；unknown 不猜测。

Grant 是管理授权的一层，每次操作还受 Profile 上限、任务范围、现有 Core execution policy 和 Harbor ControlLease 约束。App 的现有策略界面设置所需操作策略；默认确认/拒绝不会被 Grant 覆盖。Agent 凭据不能访问 owner 授权、策略或旧任务路由。owner 撤销入口为 `POST /agent-access/grants/:id/revoke`，新连接不能恢复撤销权限。

结果返回 `run_id`、`status`、`ok` 和脱敏 `result` 或 `failure.code`。超时/中断可能产生 `unknown_outcome`：同一 key 查询或重复提交只读已有 Run；创建可查询 Harbor 已有 receipt 对账。对账不会改写原 unknown 历史，也不会恢复已撤销 Grant。未对账的创建阻止同 Grant 再消费配额。

人工接管只转移指定 Instance 的控制权。owner 明确交还后，Agent 再调用 start/observe，复用同一 Instance 重新观察；不会自动重复站点动作。

## 可运行验证

- `pnpm --filter @webenvoy/core-runtime test`：权限交集、幂等、在途撤销保留结果、未知创建只读对账。
- `pnpm --filter @webenvoy/api-server test`：owner/Agent 路由隔离、重复认证头、公开 receipt、撤销。
- `pnpm --filter @webenvoy/harbor test`：同实例观察、账号唯一绑定、控制权与 Profile 拒绝。
- Desktop `smoke:packaged:runtime`：打包目录的 Core/Harbor 启动、owner 注入与 Lode pin 消费。

真实 Profile 验收脚本及其 `--help` 说明只针对显式指定的隔离测试 store；不使用日常 Profile 或已有账号，不上传、编辑字段或发布。验证证据和完成状态以 [#454](https://github.com/WebEnvoy/WebEnvoy/issues/454) 为准。

此入口依赖 Desktop 监督的 Runtime 生命周期。packaged 通过不证明关闭 App 后仍可独立使用；完整独立安装与常驻 Agent 消费由 #474/#475/#477 后继交付承接。
