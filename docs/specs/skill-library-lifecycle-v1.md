# Managed SKILL Library Lifecycle V1

状态：Accepted；版本：v1；owner：Core（授权、持久选择、Run 与 receipt）、Plugin（MCP 薄投影）。产品归口：[Work Item #508](https://github.com/WebEnvoy/WebEnvoy/issues/508)，衔接 [#475](https://github.com/WebEnvoy/WebEnvoy/issues/475) 与已安装入口 [#474](https://github.com/WebEnvoy/WebEnvoy/issues/474)。Harbor 与 Lode 本轮不改变资产所有权或内容。

本规格冻结一个可选、固定来源 SKILL 的受管生命周期；它不定义网站业务流程、第二个任务状态机或本轮未完成的验收证据。

## 固定资产与来源身份

本切片唯一登记的资产为 `skill_ref=webenvoy-browser-reference`，随安装包携带只读 `webenvoy.skill-source-manifest.v1` 清单。`webenvoy_skill` 的必需管理引导资产保持独立，不被此可选副本覆盖或自动加载。

来源身份必须同时绑定 repository、source path、commit、Git blob 和内容 SHA-256；Git blob 是来源身份（SHA-1），不能代替内容摘要。Agent 只能选择清单中的完整 `revision_ref`，不能提交任意路径、URL、`latest` 或未经批准的 Git ref。

| 修订 | `revision_ref` | `source_ref` | version | content bytes | content SHA-256 |
| --- | --- | --- | ---: | ---: | --- |
| R1 | `git:WebEnvoy/WebEnvoy@047917cd5c17b546336504fa7b56725805bd6e0c:apps/desktop/agent-entry/skills/webenvoy-browser/SKILL.md#81726c79132bb8bc968746d40de18ceecbb87de1` | `github:WebEnvoy/WebEnvoy:apps/desktop/agent-entry/skills/webenvoy-browser/SKILL.md@047917cd5c17b546336504fa7b56725805bd6e0c` | `0.2.0` | 5351 | `ee486fec882fea40fc68e29622e604a5088d47a15486044a0fd18b10487d93e0` |
| R2 | `git:WebEnvoy/WebEnvoy@c113f4537f206384705df81c35ca5e2e64b8c261:apps/desktop/agent-entry/skills/webenvoy-browser/SKILL.md#fef903a0c9a96b5c378913ff25c460741a10d879` | `github:WebEnvoy/WebEnvoy:apps/desktop/agent-entry/skills/webenvoy-browser/SKILL.md@c113f4537f206384705df81c35ca5e2e64b8c261` | `0.2.0` | 7443 | `a5176205c9c87a5492498053749f4ba567d713fa007426f4ee38cb9084d0475c` |

两份修订的真实版本均为 `0.2.0`，不得改写为不存在的 `0.2.1`，也不得仅以 semver 去重。当前批准清单的 SHA-256 为 `ddcc8bf912379ed9731b3f7fb6b7ea19b39b716e428a8b64887c9fb97dfb3b4d`。内容是原始 UTF-8 字节；清单上限为 256 KiB（262,144 bytes），单个修订上限为 1 MiB（1,048,576 bytes），清单、源文件和物化文件都必须是普通文件，任一祖先目录为 symlink、目录以外的类型或路径越界都拒绝。

兼容信息必须为 `host=codex`、`plugin_version=0.2.0`。不兼容的清单条目不能安装或读取；安装包缺少清单或内容时只使这个可选资产不可用。

当前稳定实现锚点为：[随包来源清单](../../apps/desktop/agent-entry/skill-assets/manifest.json)、[MCP `webenvoy_skills` inputSchema](../../apps/desktop/agent-entry/mcp.mjs) 与 [Core package test](../../packages/core/src/skill-library.test.ts)。这些链接用于约束真实字段和测试入口；test/fixture 不是 installed-live 验收证据，不能据此声称宿主安装闭环已经通过。

## 所有权、存储与局部失败

构建包可携带上述可选源副本、清单和其完整性记录；Core 在 Runtime data root 的独立受管库拥有安装后的状态、物化内容、操作摘要、receipt 引用、选择版本、历史和撤销事实，Plugin 只投影 Core。受管运行真相不放在 App 包、Profile 目录、宿主用户配置或临时 worktree，Runtime 重启、升级或重装不删除 data root。data root、本地物化路径和内部 credential 永不出现在 Agent 响应、错误或 receipt 中；批准的 repository/source path 可作为来源元数据返回。

物化文件按来源摘要校验字节数和 SHA-256。安装使用临时文件、同目录 no-clobber 发布和库锁；并发写入、竞态、symlink、目录穿越或中断都必须拒绝或留下可安全重试的未提交状态，不能覆盖已安装内容。状态提交与操作摘要在同一受管锁内完成，`record_version` 单调增加；重启后选择、启用值、历史、receipt 元数据和 revoked_at 保持不变。

## 持久与结果 shape

下表是现有跨进程/持久合同的最小字段面；它不创建第二套状态机，也不替代未来需要时建立的正式 JSON Schema。

| shape | 关键字段 | 持久与内容边界 |
| --- | --- | --- |
| `webenvoy.skill-library.v1` root | `schema_version`、`assets`、`operations` | Core data-root 的唯一受管库状态。 |
| `assets[]` / revision | `skill_ref`、`asset_name`、`source_repository`、`source_path`、`revisions[]`、`enabled`、`enabled_revision_ref`、`record_version`、`history[]`；revision 含 `revision_ref`、`source_ref`、`source_commit`、`source_blob`、`version`、`path`、`content_sha256`、`content_bytes`、`compatibility`、`installed_at` | `history` item 含 `event`、可选 revision/source/receipt ref、`at`、`run_id`；不保存正文。 |
| `operations[]` | `run_id`、`principal_id`、`request_hash`、`operation`、`metadata`、`committed_at` | `metadata` 是非正文摘要；含 `content` 的持久记录拒绝。 |
| `webenvoy.skill-operation-result.v1` | result `schema_version` 加统一 `{ok, run_id, status, result?, failure?}`；result 按 operation 使用 `skills`/`skill`、`revision`、`idempotent`，read 使用 `skill_ref`、`revision`、`receipt` | 即时 `skill.read` 响应可附真实 `content`；Run、operation metadata 和 query 不保存或返回正文。 |
| `webenvoy.skill-read-receipt.v1` | `receipt_ref`、`skill_ref`、`revision_ref`、`source_ref`、`content_sha256`、`content_bytes`、`record_version`、`read_at` | receipt 证明已校验的版本和字节摘要，不携带正文。 |

库状态与 operation 摘要在受管锁内原子提交；提交后既有 Run 只是结果投影。若 Run 投影或响应丢失，恢复只从已提交的 operation metadata 补齐 Run/result envelope，不重新执行 install、enable、read、update、rollback 或 disable。

清单/源内容缺失或损坏、单个物化修订缺失/修改/摘要错误、版本不兼容或来源未获准，只影响当前资产操作。它们不能阻断 bootstrap、status/connect、合法的 `profile.list`/Profile 管理或没有网站 SKILL 的通用浏览器能力。

## Plugin 投影与授权

已安装 MCP 暴露固定工具 `webenvoy_skills`，其 operation 只有：`skill.list`、`skill.inspect`、`skill.install`、`skill.enable`、`skill.read`、`skill.update`、`skill.rollback`、`skill.disable`。它复用现有 `webenvoy_connect`、`webenvoy_query`、Principal/Connection 和 Core Run；不直接调用 Harbor、Lode 或 Provider。

每次调用都带 `idempotency_key`、`grant_id` 和 `task_scope`，Connector 注入当前 `connection_id`。SKILL 的 `task_scope` 恰好是 `operations`、`skill_refs`、`source_refs` 三组数组；不接受 Profile、origin、浏览器 session、路径、URL 或脚本字段。涉及资产时传 `skill_ref`；安装时传完整 `revision_ref`，切换或回退时传完整 `target_revision_ref`，必要时的 `source_ref` 必须与批准清单精确相等。未知字段拒绝。

operation-specific 输入也严格校验：`skill.install` 使用明确 `revision_ref`；`skill.enable`、`skill.update`、`skill.rollback` 使用 `target_revision_ref`；`skill.read`、`skill.disable` 不接受目标 revision；四个切换 operation 才接受相应 CAS 预期字段。把字段放在不适用的 operation、同时提交两个目标 ref 或提交未知字段都拒绝。

Grant 通过窄 `skill_scope={skill_refs,source_refs}` 授权；`allowed_operations` 仍须逐项包含本次 `skill.*` operation。旧 Grant 缺少 `skill_scope` 等价于没有 SKILL 权限，绝不默认为全库。Core 只选择一个当前有效的 Principal/Connection/Grant，并取 Grant scope、task scope、批准清单和 Runtime 兼容条件的交集；网页 Profile/origin scope 不能推出资产权，资产权也不能推出网页操作权。版本与旧消费者规则见 [Grant Wire Contract V1](grant-wire-contract-v1.md)。

`skill.list`/`skill.inspect` 只返回当前范围内的批准元数据和本地状态，不返回未授权 revision、物化内容或本地路径。Owner 只通过现有受信入口的 `access register`、`access grant`、`access revoke`、`access list` 管理资产范围；凭据只在 owner/本机内部流转，不能放入 MCP。

## 生命周期与不变量

| operation | 必需行为 |
| --- | --- |
| `skill.list` / `skill.inspect` | 查询获准资产、来源和选择摘要；只记录本次 Run/receipt，不改变资产选择、启用值或物化正文，不读出正文。 |
| `skill.install` | 只安装清单中的明确 revision；首次保持 disabled，不自动选择、启用或安装 latest；同一有效请求幂等返回相同摘要。 |
| `skill.enable` | 只选择已安装、兼容且完整校验的 revision；显式启用。 |
| `skill.read` | 只读取当前 enabled revision；先用同一物化 Buffer 校验 bytes/hash，再返回真实 UTF-8 content 与 receipt。disabled、缺失、修改、损坏、不兼容或越权均拒绝。 |
| `skill.update` | 只将选择切换到调用者明确指定、已安装且完整校验的目标 revision；不隐式 install/merge/latest，并保持原 `enabled` 值。 |
| `skill.rollback` | 只切回先前已安装且仍完整可用的历史 revision；不隐式 install/merge/latest，并保持原 `enabled` 值。 |
| `skill.disable` | 阻止后续新 read，保留物化文件、选择和历史；不删除内容、不撤销网页 Grant。 |

`enable`、`update`、`rollback`、`disable` 都必须提供当前选择的 `expected_revision_ref`/`expected_current_revision_ref` 或 `expected_record_version`，并在锁内用 Compare-And-Swap 再次比较；缺失或不相等返回 `managed_skill_conflict`，不能覆盖其他决定。切换操作的 idempotency replay 不改变选择或启用值。

`update`/`rollback` 的目标必须已安装且 valid；当前选择（如存在）也必须仍能校验。`disable` 不修改此前的 read receipt；禁用前已进入 Agent context 的内容不被远程删除。再次 read 必须重新检查当前 Principal、Connection、Grant、撤销和过期状态，不能用旧 receipt 取得新正文。

成功 `skill.read` 返回真实 content 和 `webenvoy.skill-read-receipt.v1`，receipt 至少包含 `skill_ref`、完整 `revision_ref`、`source_ref`、content SHA-256、bytes、`record_version` 和读取时间。正文不写入 Run Record、持久操作摘要或历史 receipt。`webenvoy_query` 及相同 idempotency key 的 replay 只返回已提交的 receipt/摘要，不返回正文、不重放安装或切换动作。

## 失败、恢复与非目标

实现必须稳定区分并准确拒绝：`managed_skill_source_missing`、`managed_skill_source_corrupt`、`managed_skill_local_modified`、`managed_skill_missing`、`managed_skill_incompatible`、`managed_skill_conflict`、`managed_skill_revision_unavailable`、`managed_skill_disabled`、`managed_skill_not_installed`、`managed_access_denied` 与 idempotency conflict。源清单/源字节损坏使用 `managed_skill_source_corrupt`；物化文件缺失使用 `managed_skill_missing`，存在但类型、字节数或摘要不匹配使用 `managed_skill_local_modified`。`read`、`update`、`rollback` 遇到这些状态时必须拒绝并保持选择不变。失败消息不得泄露未授权来源、正文或本地路径；安装、更新、回退失败不能覆盖用户原件或切换选择。

本轮不实现 overlay 编辑、草稿修复/合并、SKILL 脚本执行、浏览器启动、输入租约、网站登录、Profile/Account/Provider 变更、Marketplace、队列或第二权限系统。Design Obligations：`DO-PLUGIN-EXPOSURE=triggered`、`DO-GRANT-WIRE=triggered`；Network、Console、Provider-private schema、完整 App IA 为 `not-triggered`，因为本轮不改变这些边界。
