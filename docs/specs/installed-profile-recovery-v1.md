# Installed Profile Recovery V1

状态：Accepted；版本：v1；owner：Core（owner 授权、计划、确认、操作记录与结果）、Harbor（Profile 数据、锁、私有材料、备份与执行）、Desktop Agent entry（本机 owner CLI）；产品归口：[#505](https://github.com/WebEnvoy/WebEnvoy/issues/505)，父项 [#477](https://github.com/WebEnvoy/WebEnvoy/issues/477)。

本规格定义已安装 WebEnvoy 在更换安装资产后继续使用原长期 Profile，以及在受支持损坏时由可信 owner 恢复一个指定私有备份的语义。它只覆盖当前已验证 macOS arm64、本机 Codex、固定且已安装的 Camoufox Provider。它不承诺跨操作系统、跨 Provider、历史任意版本或 Provider 下载/升级迁移。

## 1. 所有权与数据边界

| 数据 | 唯一 owner | 恢复语义 |
| --- | --- | --- |
| 安装运行时、Lode/runtime/Plugin 资产 | Desktop 安装器 | 只替换可证明由本安装管理且未被用户改动的文件；记录 commit/tree/manifest/文件完整性；不覆盖用户修改的 host/SKILL，报告冲突。 |
| host 接入配置与 Client credential | Desktop 安装器／owner | 与原 host identity 和 data root 绑定；更新、重装和卸载不生成第二 data root，不删除长期数据。 |
| Profile 浏览器数据与 Camoufox 私有 bundle | Harbor | 备份和恢复的唯一对象；必须持有既有 Profile ownership lock，检查浏览器活动锁，拒绝 symlink/path traversal。 |
| Provider 环境配置与私有 bundle | Harbor／Camoufox Driver | 只接受与当前受支持 Provider、版本、properties pin 和环境材料匹配的备份；沿用 [Camoufox Environment Continuity V1](camoufox-environment-continuity-v1.md)，不生成新指纹。 |
| Principal、Connection、Grant、撤销与过期 | Core managed-access | 永远使用当前真相；恢复不回滚、复活或扩大任何授权。 |
| Profile ceiling、安全策略、Account/AccountSystem/BusinessTarget 正式归属 | Core／Harbor 各自 owner | 恢复不覆盖；缺失或不兼容时拒绝并要求重新授权/修复。 |
| Run、receipt、ExternalOutcome、审计与历史结果 | Core | 永不回滚，历史动作不重放；响应丢失只能 query 原操作。 |
| socket/pid/临时缓存 | Runtime | 不属于长期恢复对象；切换前清理或重新生成，不能作为成功证据。 |

Core 的 Run Record 是 owner 操作记录的持久真相。Harbor 只持久化执行所需的私有 backup/plan/result metadata 和原子切换状态；两层都使用已有文件锁和 receipt/idempotency 模式，不建立第二权限系统或通用备份平台。

## 2. 版本化对象

以下字段是 v1 的最小公共投影。`profile_ref`、`identity_environment_ref`、`backup_ref`、`plan_ref`、`operation_ref` 和路径均为 opaque ref；公共结果不得返回本地路径、Profile 路径、Cookie、Token、raw browser data、Provider config 或 Camoufox seed。

### 2.1 Backup

```json
{
  "schema_version": "webenvoy.profile-recovery-backup.v1",
  "backup_ref": "backup:<opaque>",
  "profile_ref": "<opaque>",
  "identity_environment_ref": "<opaque>",
  "created_at": "<UTC>",
  "backup_time": "<UTC>",
  "storage_fingerprint": "<sha256>",
  "environment_fingerprint": "<sha256>",
  "material_version": "<opaque provider/profile material version>",
  "owner_binding": "<sha256 of profile and identity ownership binding>",
  "provider_id": "camoufox",
  "compatibility": { "provider_id": "camoufox", "provider_version": "<pinned>", "camoufox_version": "<pinned>", "browser_version": "<pinned>", "properties_sha256": "<sha256>", "bundle_schema_version": 1 },
  "scope": "profile_storage_and_matching_environment_bundle",
  "private": true
}
```

Backup 是不可启动的隔离副本，不登记为第二运行 Profile。Harbor 通过安全目录和原子文件写入保存索引；备份本体使用 0700 目录，文件拒绝 symlink，所有目录遍历都以受管 root 为边界。除 `backup.json` 外，备份目录还保存私有 `environment.json` 快照；快照只用于执行校验和恢复配置，包含当前 Provider binding 与 environment 配置，不属于公共结果，也不包含登录、账号、凭据或浏览器私有存储。`environment_fingerprint` 是该快照的 canonical JSON SHA-256，apply 会重新读取并校验它，不能只相信 operation metadata。v1 不自动删除备份或恢复前副本，也不提供保留策略和定时备份。

### 2.2 Recovery plan

```json
{
  "schema_version": "webenvoy.profile-recovery-plan.v1",
  "plan_ref": "plan:<opaque>",
  "profile_ref": "<opaque>",
  "backup_ref": "backup:<opaque>",
  "created_at": "<UTC>",
  "expires_at": "<UTC>",
  "backup_time": "<UTC>",
  "current_material_fingerprint": "<sha256>",
  "backup_material_fingerprint": "<sha256>",
  "current_environment_fingerprint": "<sha256>",
  "backup_environment_fingerprint": "<sha256>",
  "current_material_version": "<opaque provider/profile material version>",
  "backup_material_version": "<opaque provider/profile material version>",
  "owner_binding": "<sha256 of profile and identity ownership binding>",
  "compatibility": { "provider_id": "camoufox", "provider_version": "<pinned>", "camoufox_version": "<pinned>", "browser_version": "<pinned>", "properties_sha256": "<sha256>", "bundle_schema_version": 1 },
  "scope": "profile_storage_and_matching_environment_bundle",
  "preserved_current_truth": ["grants", "revocations", "security_policy", "account_bindings", "runs", "receipts", "external_outcomes", "audit", "other_profiles"],
  "expected_effect": "restore_selected_profile_to_backup_timepoint_without_replay"
}
```

计划必须绑定 Profile、当前材料指纹、当前与备份 environment 指纹、备份 ref/时间、范围和明确不回滚的真相。计划过期、Profile/备份/材料/归属变化或 Instance 重新活动时，确认和 apply 必须拒绝并要求新 plan。当前与备份环境的 Provider、proxy、region、browser/fingerprint 等静态身份参数必须匹配；只有 `language`、`timezone`、`viewport` 可以作为受管动态配置恢复。生产路径由 Harbor 的 `LocalIdentityEnvironmentManager` 在 Profile lock 内校验当前 identity facts 与 account bindings 后写回这三个配置，并重置已验证一致性，恢复后必须重新 observation。

### 2.3 Result and status

所有恢复操作返回 Core 的 `{ ok, operation_ref, status, result?, failure? }` 投影。状态使用 `inspect_completed`、`backup_completed`、`plan_completed`、`apply_completed`、`rejected`、`running`、`unknown_outcome`、`manual_recovery_required`；失败必须带稳定 code 和恢复提示。`unknown_outcome` 只能通过 status/query 对账，不能自动重试 apply。相同 idempotency key 与相同请求必须返回历史 operation/result，即使历史 apply 已成功；相同 key 搭配不同请求必须返回 `idempotency_conflict`，绝不能重新执行。

Harbor 执行阶段按 `validate → prepare → switch → verify` 顺序工作。apply 前把当前 Profile 原子隔离为恢复前副本，再将已验证 backup staging 目录切换到目标；中断必须留下可诊断的 operation state，不能将半新半旧目录报告为正常启动。Runtime 启动会检查同一 Profile 是否存在未完成的 apply 或 staging residue；存在时以稳定错误 `recovery_operation_unfinished` 拒绝启动并要求查询原 operation，直到完成对账或人工修复。成功只表示回到备份时点，不声称保留备份后的浏览器修改。

## 3. 固定入口与确认

本机 owner CLI 提供以下等价命令：`recovery inspect`、`recovery backup`、`recovery plan`、`recovery apply`、`recovery status`。CLI 只提交 owner 意图和展示安全摘要；它不读/打印 private bundle、token 或本地 Profile 路径。`recovery status` 可用 `--operation-ref REF` 查询；如果 apply/backup 请求的响应丢失而只有原 `--idempotency-key KEY`，可用 `--idempotency-key KEY [--kind inspect|backup|plan|apply]` 查询，`--kind` 默认 `apply`。两种 selector 互斥，CLI 按 Core 相同的 `recovery:<sha256(kind:key)>` 规则派生 operation ref，调用者不需要手工计算。

Core owner API 负责输入校验、当前安全策略/授权检查、单计划确认、idempotency、Run/receipt 和结果。只有对单一未过期计划的明确确认才允许 apply；确认不能通过 `owner=true`、重复请求或 Agent 参数绕过。Harbor 只接受 Core supervisor route，普通 Agent credential 不能进入 backup/apply。Harbor 的 plan metadata 只记录执行校验所需的私有事实，不拥有确认、授权或独立 plan 生命周期；Core 的 plan/confirmation/Run 才是公共操作真相。

Plugin 只增加 `recovery.inspect`、`recovery.request`、`recovery.status` 投影：inspect 可读诊断，request 创建待 owner 决定的 plan/operation，不自动 stop、覆盖或确认，status 查询原 operation。Plugin 不能看到 owner token，也不能调用 Harbor owner route。

## 4. 安装更新与卸载

安装 identity 与原 data root 绑定，并持久化 commit/tree/manifest/完整性证据。新包先通过完整性核验，再复用同一 data root；旧 Runtime 活动或资产 digest 不匹配时拒绝并要求一次明确安全 stop。不得关闭未核对在途任务、强抢人工控制或用两个新 data root 冒充更新。

若安装显式选择 Camoufox native test artifact，安装配置必须在新 data root 首次 setup 时于 `installation.json` 中持久化 `camoufoxArtifact` 绑定（`app`、`executable`、`manifest`、`manifest_sha256`）。绑定只接受固定 `webenvoy.camoufox-native/v1`、`managed-native-snapshot`、Provider/browser/source pins、实际输出文件 hash、派生 app identity 与 `properties.json` 邻接副本均通过核验的独立 test-only artifact；原 `/Applications/Camoufox.app` 和任意 symlink/替换路径都拒绝。已有绑定不可通过重复 setup 改指向其他构件；已有但未绑定 artifact 的 installation 也不可追加绑定，必须另建隔离 data root，避免把既有 Profile 的默认 Provider 数据切换到 test executable。每次 Runtime 启动都重新核验绑定及 manifest hash，失败则 fail closed。安装服务清除继承的 `WEBENVOY_`、`HARBOR_`、`CAMOUFOX_` 覆盖；仅将这次核验得到的 executable 作为 `HARBOR_CAMOUFOX_PATH` 传给 Harbor。没有该字段的旧 installation 配置继续使用 Harbor 既有默认 Provider 检测，不迁移或改写 Profile 的 executable/provider binding。

卸载只移除本次受管安装、入口和注册，不删除长期数据、Profile、私有身份材料、备份、恢复前副本、Principal、Grant 或 Run。用户手改 host/SKILL 保留原件并报告冲突；不强制覆盖后宣称更新成功。

## 5. Fail-closed 与连续性

- 无活动 Instance/写者且 Profile ownership lock 和浏览器活动锁验证成功，才可 backup/apply。
- Profile、backup、plan、environment bundle 的 schema/version/provider/hash/归属不匹配时不覆盖。
- 旧非空 Profile 缺 Camoufox bundle：只有可信同 Profile、完整兼容 backup 走同一 plan/owner/apply；无则保留原数据并报告 `manual_recovery_required`，禁止自动重建、随机生成或从可见属性反推身份。当前 bundle 损坏、缺失或不兼容时，Harbor 通过已安装的 Camoufox Python Driver 的 `validate_environment_bundle` 私有操作校验备份 bundle；Python Driver 负责 canonical bundle schema、hash 与 Provider pin 校验，TypeScript recovery 层不复制另一套 Camoufox 解析规则。
- 不切换 Provider、proxy 或 fingerprint，不自动新建 Profile，不把历史 observation 当作当前 verified；环境恢复后必须重新 observation，`unknown` 不等于成功。
- 活动锁、错 Profile、损坏或不兼容 backup、symlink/path traversal、计划过期、材料变化、恢复中断和普通 Agent apply 都必须拒绝。
- 响应丢失后 status/query 原 operation/receipt，不再次 apply；历史 Run 和 action count 不增加。

## 6. 非目标与验收

本版本不做生产或真实账号迁移，不上传第三方业务数据，不新增 Provider/系统软件/代理，不建设完整 App 恢复工作台、第二网站 SKILL、备份平台或跨 OS 迁移。

验收至少包含：A→B 同 data root 的 Profile/环境摘要/marker/Principal/有效与撤销 Grant/历史 Run 接续；B backup 后撤销 Grant 和新增 Run 仍保留；损坏 bundle 的准确拒绝与匹配恢复；旧非空缺 bundle 的有备份恢复和无备份拒绝；活动锁、错 Profile、损坏 backup、symlink/path traversal、过期 plan、材料变化、中断、重复请求、丢响应 query、Agent owner apply 拒绝。所有测试使用隔离无账号 Profile、合成 marker 和固定已装 Provider fixture，不提交私有材料。
