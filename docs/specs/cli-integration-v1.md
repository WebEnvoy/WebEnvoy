# CLI、上游 Agent 与可信用户入口 V1

状态：本 PR 经独立审查并合入 main 后成为 Accepted；当前仅交付规格，功能未交付
版本：v1
Owner：Core／Harbor Runtime／安装入口共同实现，CLI 合同由本规范冻结
关联：[#562](https://github.com/WebEnvoy/WebEnvoy/issues/562)、[#568](https://github.com/WebEnvoy/WebEnvoy/issues/568)、[#569](https://github.com/WebEnvoy/WebEnvoy/issues/569)、父 FR #474
前置：S0 #561 已确认 Runtime Capability Plane 的产品边界

本文件冻结“正式安装后，不打开 Desktop App，可信用户可以建立首次信任并独立接管、停止、查询浏览器现场；普通 Agent 或程序只能消费同一套受限能力”的 V1 合同。它是可实施的目标合同，不把当前工作树中的实现或测试状态表述为已完成。实现必须复用现有 Core／Harbor／Run／Grant／ControlLease／ExternalOutcome 真相，不得建立第二套 Runtime、授权、能力目录或结果状态机。

## 1. 交付结果、范围与非目标

### 1.1 用户结果

在一台已安装正式 WebEnvoy Runtime 的主机上：

1. 可信用户使用 **webenvoy setup**、**webenvoy access ...** 和 **webenvoy instance ...** 完成首次管理、Principal／Grant 配置、撤权、接管、交还和停止，不需要打开 Desktop App，也不依赖 App 的构建产物或后台进程。
2. 普通 Agent、受管 SKILL 或脚本使用独立 Agent credential，只能通过受管 Agent 通道消费被授予的 Profile、操作、Origin、File、Skill 范围；不能读取或转用 owner／supervisor credential。
3. Agent、CLI、API 和已安装 Plugin 对同一操作看到同一个 Core Run、同一个 run_id、同一个 ExternalOutcome 与同一条恢复事实。CLI 退出、MCP 进程退出、断线或重新连接不会重放操作，也不会停止浏览器。
4. 只有 Core 已持久化一个需要可信用户决定的 Run 时，Agent 才返回 pending／requires_user_action 结果及 run_id；没有形成 Run 的授权拒绝仍是 denied，不在非交互调用中等待、弹窗、读取 owner 文件或代用户确认。
5. 可信用户对 A 实例接管后，Agent 不能向 A 写入，B 实例仍可按各自 Grant 工作；用户交还后，Agent 必须对 A 重新观察并使用新的 Page／Document generation／Observation 事实。用户关闭 CLI 或主机断线不会被解释为交还。

### 1.2 本次范围

- 冻结正式可调用的 CLI 命令、参数、帮助、结构化输出、stderr 诊断、退出码和输入校验。
- 冻结 owner CLI 与 Core／Harbor owner 路由、Agent CLI 与现有 MCP／managed operation 路由的映射。
- 冻结首次信任、凭据隔离、撤权、实例控制、长任务、查询、断线和 unknown/no-replay 语义。
- 冻结正式安装产物、安装目录、host 配置、数据接续和去 App 构建／进程依赖的目标。
- 为 #568 受管脚本冻结身份约束，为 #569 双实例控制冻结 A/B 控制约束。

### 1.3 明确不做

- 不在 CLI 中复制 Core Grant 白名单、Provider 选择、Run 状态机或 Harbor 现场判断。
- 不增加第二 Runtime、第二本地服务、第二授权目录、第二恢复状态机或 CLI 私有结果数据库。
- 不让 CLI、Plugin 或 SKILL 直接拿到 Cookie、Token、raw CDP、完整 DOM／HAR、owner 文件或 supervisor token。
- 不在本规范交付 Web Console、SDK、多语言客户端、所有宿主 UI、App 改版、自动化站点业务流程或新的视觉／Network 面。
- 不在本规范声称已完成正式安装、真实 Provider、真实第三方 Agent 或真实账号验收；这些是实现后的候选和验证证据。

## 2. 权威事实与术语

以下事实分别由现有 owner 维护：

| 事实 | 唯一 owner | CLI 只能做什么 |
| --- | --- | --- |
| Principal、Grant、Run、幂等、ExternalOutcome、查询和恢复 | Core | 提交已声明的请求、读取返回事实 |
| Profile、Provider、Environment、Instance、Page、ControlLease、现场 receipt | Harbor Runtime | 通过 Core 或 owner supervisor 路由使用 |
| 本地安装、client credential、owner control identity／service credential、host 文件 receipt | 安装入口／Runtime service | 建立本地信任边界、转发已认证请求 |
| Agent 工具投影、SKILL 与静态 capability definition | 已安装 Agent bundle | 消费已安装且完整性验证的固定投影 |
| UI 活动摘要 | 任意客户端 | 只能展示，不得作为授权或结果真相 |

本规范中的“owner”是有权管理本机 WebEnvoy 安装、Principal、Grant、Profile 和 Instance 的可信用户入口。“Agent”是普通上游 Agent、受管 SKILL、脚本或使用 Agent credential 的程序。“owner control identity”是经过 OS UID／ACL／强制签名身份认证的可信 owner control socket peer；“owner service credential”是 Runtime service 内部使用的 bearer／supervisor secret，不能被 owner CLI 或 Agent 读取；“client credential”是给 Agent Principal 的凭据。当前代码中的 owner.json bearer 是待替换的实现事实，不得成为目标安全边界。

本规范使用以下稳定状态：

- Run：pending、admitted、running、succeeded、failed、blocked、requires_user_action、manual_recovery_required、unknown_outcome、cancelled、expired。
- ExternalOutcome／Provider receipt：not_dispatched、dispatched、completed、unavailable、unknown_outcome。
- ControlLease owner：none、core_task、user。查看事实不等于持有写控制权。
- Grant 的有效权限是 Profile ceiling、Principal／Grant、当前 task scope、Runtime safety 的交集。CLI 不得把文件存在、工具可见、SKILL 已安装或模型输出当作授权。

相关长期合同：[Runtime Capability Plane](../architecture/runtime-capability-plane.md)、[跨仓架构](../architecture/cross-repo-architecture.md)、[Grant wire contract](grant-wire-contract-v1.md)、[Plugin runtime exposure](plugin-runtime-exposure-v1.md)、[Profile／environment](profile-environment-v1.md)、[Page／navigation runtime contract](page-navigation-runtime-contract-v1.md)、[browser files](browser-files-v1.md)、[installed profile recovery](installed-profile-recovery-v1.md)。

## 3. 当前实现事实与目标差异

### 3.1 已核对的当前事实

当前候选中的 apps/desktop/agent-entry/cli.mjs 已有以下 owner 入口：

- setup、access list|register|grant|grant-v2|policy-v2|revoke|operation、files import|inspect|export|revoke|delete、recovery inspect|backup|plan|apply|status、start、diagnose、stop、uninstall 和 app。
- setup 已分离 --data-dir 与 --host-dir，默认创建 data／host 目录为 0700，client 文件为 0600，输出 Agent credential fingerprint，写入安装配置、host MCP 配置、SKILL 和 installation receipt。
- owner 路径当前通过本地 Runtime service 使用 data-dir/owner.json 中的 owner bearer；Agent MCP 读取 host 中的 webenvoy-client.json，通过独立 client credential 进入 /agent-connections 和 managed operation 路径。当前 owner.json 的 0600 和同 UID 运行仍不足以形成真实边界，目标必须迁移到第 4.2 节 owner-private OS domain。
- access grant、grant-v2、policy-v2 的输入文件有明确允许字段；files 与 recovery 已有 owner-only 路由；Agent 工具不能执行 owner grant、backup、plan、apply。
- Core 的 managed-access receipt 以 `idempotency_key` 的 hash 和请求 hash 去重；当前 CLI 的 `access register` 会在省略 key 时随机生成 owner-local key，`recovery inspect` 也会在省略 key 时生成 owner-local key。owner files 的 `/owner/files/import` 可记录可选 `operation_ref`，但现有 `importFile` 只保存该关联值，不以它去重；`export`、`revoke` 和 `delete` 也没有 caller key。
- Agent MCP 已有 webenvoy_status、webenvoy_skill、webenvoy_connect、webenvoy_describe、webenvoy_operation、webenvoy_query、webenvoy_recovery、webenvoy_skills，并将 browser operation 映射到 /managed-browser/operations。
- 当前 hostConfig() 仍默认以 Electron process.execPath 加 ELECTRON_RUN_AS_NODE=1 启动 mcp.mjs；client.mjs 和 service.mjs 也以 Electron 运行时作为当前 fallback。当前 setup 输出的 next 仍要求“打开 App 并注册 fingerprint”。
- 当前 CLI 的未捕获异常主要由 Node 写入 stderr，尚未冻结稳定的参数错误、pending、unknown、权限拒绝和 Runtime 不可用退出码。

这些事实只说明当前代码已有可复用的 seam。它们不证明本规范已经实现。

### 3.2 目标差异和替代条款

| 当前条款或事实 | S1 目标条款 | 实施要求 |
| --- | --- | --- |
| setup 的下一步提示打开 App、在 App 注册 fingerprint | setup 完成安装后只提示 owner 使用本地 access register、access grant，不得要求 App | 更新安装输出和专属安装／入口说明；不得把 App 作为隐藏 fallback |
| hostConfig 和 Runtime service 依赖 Electron 可执行文件 | 正式安装提供独立 WebEnvoy Runtime launcher；Agent／owner CLI、service、MCP 均可由该 launcher 启动 | 保留现有协议与服务边界，替换正式包的进程／构建依赖；Electron 兼容路径不构成 V1 验收 |
| 文件模式、同一 UID、不同命令或不同路径 | owner service credential、client credential、OS boundary、服务端 route／Principal 检查和进程环境清除共同形成边界 | 不得用 0600、UID 或命令分组单独声称 owner／Agent 隔离 |
| access register 的 key 可省略；files 路由没有 caller key | 由 Core receipt 覆盖的 mutation 必须使用调用方提供的 key；files 按第 5.3.1 节的现有 operation ref、目标路径排他、file_ref 状态或 CAS 语义处理，不虚构第二套 receipt | 同步命令语法、帮助、示例和丢响应对账行为；省略 key 的兼容 fallback 不能成为目标合同 |
| CLI 成功只输出 JSON，失败没有稳定 envelope／exit map | 见第 7 节：结构化结果、stderr、稳定退出码 | 适配层统一处理本地错误与 Core Run 结果；不得泄露 stack trace 或敏感路径 |
| Agent 只通过 MCP 进入 capability | CLI Agent 投影与 Plugin、API 使用同一请求 envelope、同一 Run、同一 query | CLI 适配层不得创建第二结果或重试机制 |
| 当前验证文档包含 App 参与步骤 | 验证文档中的旧步骤只能代表历史候选事实，不能覆盖本规范目标 | W1 实现并重新验证 no-App 路径；本轮不篡改历史 verification 证据 |

## 4. 信任建立与真实凭据隔离

### 4.1 安装后的角色和凭据

正式安装至少有以下四个逻辑域：

1. **Owner control plane**：可信用户执行 owner CLI。CLI 以可信 owner OS identity 连接 owner control socket，提交 Principal／Grant／撤权／文件／恢复请求和 Instance 控制请求；内部 owner service credential 只由受保护的 Runtime service 使用，不返回给 CLI 调用者。
2. **Runtime service**：本机受管服务。它验证 owner control socket 的 OS peer 或 Agent client credential 后，只把对应角色的请求转到 Core／Harbor；内部 service bearer 不离开受保护进程。
3. **Agent data plane**：Agent、Plugin、SKILL、脚本和 Agent CLI。它只能持有一个 client credential，对应一个 Principal；它不能读取 owner service credential、owner-private store 或 supervisor token。
4. **Browser／Harbor plane**：真实 Profile／Instance／Page 和 ControlLease。Agent 写操作必须经过 Core 授权和 Harbor 现场检查；owner 现场控制不等于 Agent 继续持有控制权。

第 1 至 3 项是同一个已安装 Runtime service 的受保护角色／endpoint 划分；它们不表示再建一个 Runtime、Core、授权 store 或结果数据库。平台若需要独立 owner broker，只能是同一 Runtime 的窄控制面，仍复用现有 Core／Grant／Run 真相。

至少保留以下独立材料：

| 材料 | 位置／传递 | 可见主体 | 用途 |
| --- | --- | --- | --- |
| installation manifest／asset digest | 安装 root | Runtime verifier、owner status | 验证 bundle，不作身份 |
| webenvoy-client.json | host dir，0600 | Agent launcher／MCP／Agent CLI | 保存 client credential、data-dir opaque binding、agent endpoint 和安装时记录的 owner／Agent UID；不得含 owner service credential |
| owner-private store／control socket | OS ACL 保护的 owner domain | owner control service 与被批准的人类 owner client | 保存并使用 owner service credential；不得让 Agent UID 访问 |
| Principal／Grant | Core managed access store | Core、owner API、授权后的查询 | 真实主体、授权范围、有效期和撤销 |
| installation receipt | host dir，0600 | installer／uninstall | 只记录受管文件；不授予权限 |

client credential 以安装时生成的随机 secret 形式保存；owner 注册只提交其 SHA-256 fingerprint／hash。owner CLI 不得把明文 client credential 或 owner service credential 写入 stdout、日志、Grant 或 API；Agent 不得把 owner service credential 的 hash 当成自己的认证凭据。

Agent endpoint 是独立于 owner data root 的绝对 Unix socket 路径，client file 只保存连接引用，不保存 owner socket 或 service bearer。`owner_uid`、`agent_uid` 和 endpoint 只描述安装身份与传输边界，不授予 Core 权限；Runtime 每次启动／连接都重新核对当前 owner socket 的 UID／ACL、Agent socket 的本体／类型／owner 和当前 Agent UID，不能把 client file 中的身份字段当作已验证授权。

### 4.2 真实本机边界和支持矩阵

同一 UID 下可执行任意 shell 的 Agent 能读取同一 UID 有权限读取的 owner file，也能调用同一 UID 可执行的 owner binary；因此文件名、0600、不同命令、不同路径、环境约定和 bearer 字符串本身都不能阻止这种 Agent 取得 owner 权限。V1 不把这种环境称为“已隔离”。

正式安装必须在启用 Agent data plane 前确认一个 OS 强制的身份边界。首版支持的最小方案是：

1. 同一个 Runtime service 的 owner control endpoint 和 owner-private store 由可信 owner UID 持有；Agent data endpoint 使用独立 Agent UID。若平台要求一个特权 service account 托管状态，则 owner-private store 仍必须由该 service 的 OS ACL 保护，Agent UID 无权读取。
2. owner control socket 使用 OS ACL，只允许可信 owner UID 或真实强制验证的人类控制 client 访问；Agent UID 和 Agent 可执行脚本 UID 没有 store 或 socket 的读写权限。
3. owner service 不通过 stdout、环境、argv、可读 client file 或 owner CLI 输出 bearer；owner CLI 只提交经过 schema 校验的 owner action，不提供 dump token／proxy token 子命令。
4. 同一个 Runtime service 的 Agent data endpoint 使用独立 Agent UID／credential 和单独 socket／route，任何 owner route 或 supervisor route 都在 service 与 Core 再次拒绝。
5. 原浏览器 GUI 仍由可信 owner 的人类会话启动或接管；独立 Agent UID／service account 不能被假定为拥有 owner GUI session、WindowServer 或 viewer 权限。需要 viewer 时必须返回实际不可用状态。
6. OS policy 必须同时拒绝 Agent UID 对 owner service 的 process inspection／debug attach（例如 ptrace、task_for_pid、受平台保护的 process memory 或等价接口）；无法证明这一点时不能启用 Agent data plane。
7. 安装器记录 owner UID、Agent UID、socket ACL、process-inspection policy、sandbox／签名身份和 boundary status，diagnose 能复核它们。

首版支持矩阵必须逐项满足下表；表中的拒绝是 OS 强制拒绝，不是 CLI 约定：

| 资源或动作 | 可信 owner UID／人类控制 client | Agent UID／受管脚本 | 主机 root／administrator |
| --- | --- | --- | --- |
| owner-private store、owner control socket | 读写／调用；socket 只接受该身份 | 无读写、无 connect、无 token proxy | 可绕过 OS，超出本规范威胁模型 |
| owner service 的 bearer、环境和内存 | owner service 自身可用；owner CLI 不取得明文 bearer | 无环境继承、无 stdout／argv、无 process inspect／debug attach | 可绕过 OS，超出本规范威胁模型 |
| Agent client file、Agent socket、Agent service | 只按 Agent ACL 使用 client file 和 Agent route | 读写／调用，但仍受 Core Principal／Grant 限制 | 可绕过 OS，超出本规范威胁模型 |
| 原浏览器 GUI／WindowServer／viewer | 人类 owner 会话可启动、查看和接管 | 无 GUI／viewer 权限；只能得到受管事实 | 可绕过 OS，超出本规范威胁模型 |

owner CLI、owner launcher 和 control client 不得是 setuid／setgid 或带有可被 Agent UID 调用的提权 helper；Agent UID 不得拥有 sudo／administrator 能力。只有可信 owner UID 的普通进程身份或平台声明的强制签名身份可以连接 owner control socket。

在 macOS arm64 首版，Runtime verifier 只接受可复核的 OS 事实：当前 owner UID、Agent UID 对应的真实账户、Agent 不是 root／admin、`sudo -n -l -U <agent>` 明确返回无授权（退出 1 但输出为密码需要、配置／LDAP／插件错误时仍是 unknown）、owner data root 本体是当前 owner UID 持有的非 symlink 目录且 mode 为 0700、owner control socket 本体由 owner UID 持有且 ACL／mode 为 owner-only，以及 Agent endpoint 本体是预期 socket 而非 symlink／普通文件。已有路径不满足目录／ACL 条件时 verifier 拒绝并保持原状，不替其他 UID chmod。Node 没有跨平台 peer-UID／`task_for_pid` 原生 API；verifier 不把 JSON 中的 `processInspectionDenied`、`socketAcl` 或类似布尔值当作证据，而是依据真实账户、sudo policy 和 socket 检查推导 `distinct_non_admin_uid`。macOS `ptrace(2)` 的 same-real-UID／root 限制只是一项平台依据，不覆盖 `task_for_pid` 或 sudo policy；任一检查无法复核时，setup／diagnose 必须保持 `owner_agent_isolation_unavailable` 并禁用 Agent data plane。

使用现有 OS sandbox／签名进程身份也可以满足同一要求，但必须能证明 Agent 进程不能读取 owner-private store、调用 owner CLI 获取 token、伪造可信 owner client 或从 owner service 环境取得 secret。没有独立 UID、OS ACL、强制 sandbox 或等价的不可伪造进程身份时：

- setup 可以完成 owner-only maintenance 和 bundle 检查；
- setup／diagnose 必须输出 owner_agent_isolation_unavailable，并拒绝启用 Agent host config、Agent connect 和 Agent operation；
- 不得用 0600、同 UID、不同命令、不同目录或环境清除将该安装标记为 supported；
- owner 也不得通过一个“帮 Agent 取得 token”的 CLI 子命令绕过边界。

这是正式支持前提，不是未来的安全建议。主机 root／administrator 或已突破 OS sandbox 的主体能够绕过文件、socket 和 process policy，不属于本规范保护范围；Agent 不得以 root／administrator 身份运行。若实现首版只支持独立 UID／OS ACL，其他环境必须保持 disabled／unsupported，不能静默降级为“凭据隔离”。

### 4.3 不能作为隔离边界的条件

以下条件各自都不足以形成隔离，也不能在验收中替代 OS 和服务端权限检查：

- owner 和 Agent 使用不同的命令名称或子命令；
- owner 配置和 Agent 配置使用不同的文件名或目录；
- 文件设置为 0600，但 owner 与 Agent 由同一 UID 启动；
- 从父进程继承环境变量，只是“约定”不读取某些变量；
- Agent 看不到某个帮助文本或 Plugin tool；
- --data-dir、--host-dir 或 host config 路径不同，但请求仍能带 owner service bearer；
- 仅依赖 App approval、SKILL 文本、模型决定或 shell wrapper。

### 4.4 必须同时满足的隔离条件

实现只有在以下条件都成立时才可以声称完成 owner／Agent 隔离：

1. 安装器已确认第 4.2 节的 OS 强制边界；若确认失败，Agent data plane 保持 disabled。
2. owner 与 Agent 使用不同 secret、不同授权主体和不同服务端 route。Agent credential 即使被复制，也最多获得该 Principal 的现有 Grant。
3. Runtime service 在每个请求上明确识别 owner 或 Agent 角色；Agent route 拒绝 owner-only 操作，owner route 拒绝 client credential。
4. owner service credential 和 supervisor token 不进入 Agent 进程的 argv、环境、stdin、stdout、MCP payload、SKILL 或客户端可读文件。
5. 启动 Agent／MCP／脚本时，服务端清除 WEBENVOY_、HARBOR_、CAMOUFOX_ 等私有环境继承，只注入经过安装验证且该角色需要的公开运行绑定。
6. Core 再次按 Principal、Grant、Profile／operation／Origin／File／Skill scope、有效期、撤销和当前 Runtime safety 检查；本地 socket 可达不等于授权。
7. 需要 Core receipt 的 owner 写请求携带调用方提供的幂等 key；Harbor ControlLease 写请求携带第 5.5.1 节的 CAS 前置状态；角色审计信息始终由 owner route 保留。Agent 不能通过改写 connection_id、principal_id、run_id 或请求文件冒充 owner。

第 5 点的环境清除是纵深措施，不得替代第 1 至 6 点。#568 受管脚本必须复用 Agent data plane；脚本不得调用 owner／supervisor endpoint 或读取 owner-private store。

### 4.5 no-App 首次信任

以下步骤是正式 no-App 路径的顺序合同：

1. owner 从正式安装入口运行 webenvoy setup，指定独立、持久且不在 installation root 内的 --data-dir 和 --host-dir。
2. setup 验证 bundle、Provider binding、安装目录、OS boundary 和已有 receipt；创建或复用 client credential；输出 fingerprint、安装文件和下一步命令。它不得要求打开 App。
3. owner 从可信终端运行 webenvoy access register，使用 setup 输出的 fingerprint 为 Principal 注册，并提供调用方保存的 `--idempotency-key KEY`。注册是 owner action，不由 Agent 或 Plugin 触发；丢响应时按第 5.3.1 节用同一 key 查询或重试。
4. owner 使用 webenvoy access grant 或明确带 --confirm 的 v2 命令授予最小 Profile／operation／Origin／File／Skill scope，并设置有效期。没有 Grant 时，Agent 应得到明确 denied。
5. Agent 使用 host client 文件运行 webenvoy agent connect 或 Plugin webenvoy_connect。connect 只能发现已注册 Principal，不能 register、grant、revoke 或读取 owner secret。
6. Agent 提交一个 operation；Core 创建或复用原 Run。用户对 Instance 的接管、交还、停止和撤权走 owner CLI，不经 Agent。

任何一步遇到缺少 OS 权限、UID／ACL boundary、Provider executable、source binding、端口、签名、Runtime 或 owner confirmation，都必须报告真实原因并返回非零退出码；不得通过打开 App、换 Provider、换 Profile、放宽 Grant 或静默 fallback 制造成功。

## 5. CLI 入口和命令合同

### 5.1 通用语法

正式 launcher 名称为 webenvoy。所有命令接受全局 --data-dir DIR，但 Agent 命令用 --client-file FILE 绑定 Agent 身份；两者不可以在同一命令中互相替代。

    webenvoy help [COMMAND] [--data-dir DIR]
    webenvoy --version

规则：

- 所有路径参数按绝对路径解析；setup 要求 data root 与 installation root 分离，拒绝把 Profile data 写入安装资产目录。
- 不支持未声明的 positional 参数、未知 --flag、重复 flag、未知 JSON 字段或隐式环境变量替代必填参数。
- help 不启动 Runtime、不创建 Run、不获取 ControlLease；它读取同一安装 bundle 中的静态命令／capability definition。
- --version 只读取已验证 manifest，不启动 Runtime。
- stdout 只承载第 7 节定义的数据；stderr 只承载诊断。不得把进度、颜色、stack trace、owner token、client secret、Cookie、raw DOM 或本机私密路径写入 stdout。
- owner CLI 和 Agent CLI 不是两个 Runtime；它们只是同一安装 Runtime 的两个认证投影。

help 的根页面必须列出 setup、start、diagnose、stop、uninstall、access、files、recovery、instance 和 agent，并明确标注 owner-only、Agent-only 或两者均可。help access、help instance、help files 和 help recovery 必须逐项列出第 5.3.1 节的 caller key、operation selector、CAS 或固有幂等例外，以及 owner OS identity／control socket 要求；help agent operation 必须说明 request-file 使用已安装 capability definition，help agent query 必须说明只能 query 原 run_id／idempotency key。帮助输出不得显示 secret、owner-private path、Provider executable path 或可复制的 bearer。

### 5.2 owner 安装与 Runtime 管理

| 命令 | 必填参数 | 可选参数与约束 | 结果 |
| --- | --- | --- | --- |
| webenvoy setup | --data-dir DIR、--host-dir DIR | Provider binding 只能使用已批准的官方 source／version／hash 参数；--codex-profile NAME 必须匹配 [a-z0-9-]{1,64}；--approve-tools 只写 host approval，不授予 Core 权限 | 写入或复用安装文件、client、receipt、host config，输出 fingerprint 和 manifest 摘要 |
| webenvoy start | --data-dir DIR | 无 | 确保同一 Runtime service，输出 status |
| webenvoy diagnose | --data-dir DIR | 无 | 只读输出 Runtime、bundle、Provider、endpoint、OS boundary 和安全 recovery guidance |
| webenvoy stop | --data-dir DIR | 无 | owner-only 停止 Runtime service 及其 managed child；不是 Instance handoff 或业务 Run stop |
| webenvoy uninstall | --data-dir DIR、--host-dir DIR | --codex-profile NAME 可指定受管 profile 文件 | Runtime 已停止时删除 receipt 列出的受管 host 文件，保留 data root、Principal、Grant、Run、Profile 和恢复资料 |
| webenvoy app | --data-dir DIR | 仅兼容历史开发／桌面流程 | 非正式 V1 入口；不得成为 setup、owner control 或 Agent operation 的必要条件 |

setup 的 Provider 参数保持现有实现的命名和校验，不另建 Provider schema：

- Camoufox：--browser-install-root 或 --browser-root、--browser-executable、--python-path 或 --python、--browser-version、--camoufox-version、--playwright-version、--browser-source-path／--browser-source／--browser-archive、--camoufox-source-path／--camoufox-source／--camoufox-wheel、--playwright-source-path／--playwright-source／--playwright-wheel，可选 --browser-executable-sha256 和 --python-executable-sha256。
- Official Chrome：--chrome-install-root 或 --chrome-browser-root、--chrome-executable、--chrome-python-path 或 --chrome-python、--chrome-version、--chrome-playwright-version、--chrome-source-path／--chrome-source／--chrome-archive，可选 --chrome-executable-sha256。
- 更新或从历史安装迁移时可显式提供 --previous-installation PATH；该路径必须经过 bundle／identity 验证，不能覆盖用户修改的 host 文件。
- 已退役或未 Qualification 的 Camoufox artifact 参数必须明确拒绝；不能把历史私有 artifact 当作 Provider fallback。

### 5.3 owner 信任、授权和恢复

以下命令只能由经过 OS identity／control socket 认证的 owner CLI 调用。目标实现中 CLI 不读取明文 owner service bearer；若 Runtime service 内部需要 bearer 或 supervisor token，只能由受保护的 service process 使用。Agent credential 调用这些路径必须返回 owner-only denied：

    webenvoy access list --data-dir DIR
    webenvoy access register --data-dir DIR --display-name NAME --credential-hash SHA256 --idempotency-key KEY
    webenvoy access grant --data-dir DIR --grant-file FILE
    webenvoy access grant-v2 --data-dir DIR --grant-file FILE --confirm
    webenvoy access policy-v2 --data-dir DIR --policy-file FILE --confirm
    webenvoy access revoke --data-dir DIR --kind principals|connections|grants --id ID --idempotency-key KEY
    webenvoy access operation --data-dir DIR --operation-ref REF

grant JSON 只允许以下字段：idempotency_key、principal_id、profile_refs、allowed_operations、allowed_origins、expires_at、creation_template、max_created_profiles、skill_scope、file_scope；其中 `idempotency_key` 是必填的 caller key。grant-v2 另外使用已有 v2 字段：source_grant_id、source_grant_digest、policy_digest、replaces_grant_id、replaces_grant_digest，以及同一 scope／expiry 字段，`idempotency_key` 同样必填。policy-v2 只允许 idempotency_key、profile_ref、current_policy_digest、allowed_operations、allowed_origins、controlled_interaction_origins，`idempotency_key` 必填。缺 key 或空 key 是本地 usage error；额外字段必须在发送前拒绝。

以下恢复命令沿用现有 [installed profile recovery](installed-profile-recovery-v1.md) owner 合同：

    webenvoy recovery inspect --data-dir DIR --profile-ref PROFILE [--idempotency-key KEY]
    webenvoy recovery backup --data-dir DIR --profile-ref PROFILE --idempotency-key KEY
    webenvoy recovery plan --data-dir DIR --profile-ref PROFILE --backup-ref BACKUP --idempotency-key KEY
    webenvoy recovery apply --data-dir DIR --plan-file FILE --idempotency-key KEY (--confirm|--confirmation-file FILE)
    webenvoy recovery status --data-dir DIR (--operation-ref REF|--idempotency-key KEY) [--kind inspect|backup|plan|apply]

access grant-v2、access policy-v2、recovery apply 缺 --confirm 或 confirmation file 时是本地 usage error，不得等待 stdin。owner 写入不统一强加同一种 key：需要 Core receipt 的动作按第 5.3.1 节要求 caller key，已有 operation ref、Harbor 固有幂等或 ControlLease CAS 的动作按各自既有事实对账；缺少 key 的只读 recovery inspect 可以生成 owner-local key，但必须把最终 operation ref 返回给 owner。

#### 5.3.1 owner 写入的幂等适用矩阵

caller key 是调用方在提交前生成并保存的稳定 `idempotency_key`。它只复用 Core／Recovery 已有 receipt，不增加 CLI 私有 receipt、注册表或重试服务。当前 `/agent-access/operations/{REF}` 路由的 `REF` 在 Core 中按原始 caller key 查找 receipt；CLI 保留 `--operation-ref` 参数名以兼容现有入口，不能把它误解为另一套 operation store。

这张表按当前 `packages/core/src/managed-access.ts`、`packages/api-server/src/managed-access-api.ts`、`services/harbor/packages/runtime-api/src/managed-files.ts` 和 [installed profile recovery](installed-profile-recovery-v1.md) 的 owner API／旧合同收准；这些实现路径是核对依据，不是新增公共状态 owner。

| owner action | 适用的现有事实和请求形式 | 重复请求、丢响应或断线后的处理 |
| --- | --- | --- |
| `access register`、`access grant`、`access grant-v2`、`access policy-v2`、`access revoke` | Core `managed-access` 的 receipt 以 caller key 和完整请求 hash 去重。register／revoke 使用 `--idempotency-key KEY`；grant、grant-v2、policy-v2 在各自 JSON 文件中使用必填 `idempotency_key`。 | 保存原 key 和原请求；用同一 key、同一请求安全取得原结果，key 相同而请求不同必须得到 `managed_access_idempotency_conflict`，不得执行第二次。响应丢失时可运行 `access operation --operation-ref KEY` 查询已有 receipt；查询不到时仍只能以原 key 重试，不能换新 key。 |
| `recovery backup`、`recovery plan`、`recovery apply` | 复用 [installed profile recovery](installed-profile-recovery-v1.md) 的必填 caller key；Core 由 `kind:key` 派生既有 `operation_ref`。`apply` 另需 `--confirm` 或 confirmation file。 | 保存原 key、kind 和返回的 operation ref。响应丢失时用 `recovery status --operation-ref REF`，或用原 key 与对应 `--kind` 查询；同 key、同请求返回历史结果，改请求返回 `idempotency_conflict`，`unknown_outcome` 只能查询／对账，禁止换 key 重放。 |
| `recovery inspect` | 这是只读检查，但现有 Recovery Core 仍为它创建 Run。显式 `--idempotency-key KEY` 时按上一行的 receipt／operation-ref 规则；省略时沿用 CLI 生成的 owner-local key 例外。 | 显式 key 的响应丢失按原 key 查询。省略 key 且响应丢失时，原随机 key 对调用方不可恢复；可以重新执行一次新的只读 inspect，但必须把它标为新的 operation，不能声称取得原 receipt 或把它当作写入重试。 |
| `access list`、`access operation`、`recovery status`、`files inspect` | 只读查询，不生成新的写 receipt。`access operation` 使用原 access caller key 作为现有 API 的 selector；`recovery status` 使用 operation ref 或 `idempotency_key`／kind 派生 ref；files inspect 使用 file ref 或 owner file catalog。 | 丢响应只重复同一个查询；不生成新的 key，不把查询结果当作提交成功。Runtime／Harbor 不可用时保持 unavailable，并在恢复后查询。 |
| `files import` | `/owner/files/import` 当前没有 caller key。可选 `--operation-ref REF` 只写入 managed-file record 作为关联字段，当前 Harbor `importFile` 不用它去重，也不把 owner import 写入 file operation receipt。 | 响应丢失保持 outcome unknown；先用 `files inspect`（必要时按返回目录中的 operation_ref、profile、名称、大小和摘要核对）与 owner 本地源文件事实对账，不能仅凭 REF 假定已完成，也不能盲目重新导入。没有唯一可核对记录时由 owner 决定后续动作；换一个 REF 不能绕过 unknown。 |
| `files export` | `/owner/files/export` 当前没有 caller key；Harbor 以 owner 指定的 destination path 做 `O_EXCL` 写入，已有目标返回 `file_destination_exists`。这是目标路径的固有重复保护，不是新的 receipt。 | 响应丢失先检查同一 destination 的存在性并核对内容／摘要，再用 `files inspect --file-ref FILE_REF` 核对源记录。目标存在且内容／摘要匹配时按同一导出事实对账；存在但不匹配时保持冲突，不覆盖；目标不存在且源仍可用时只能重试同一 file_ref／destination，不能换目标路径掩盖 unknown。 |
| `files revoke`、`files delete` | `/owner/files/revoke` 和 `/owner/files/delete` 当前没有 caller key；操作以准确 `file_ref` 为对象，revoke 对已 revoked 记录保持状态，delete 重复清理并保持 deleted 记录。 | 响应丢失先用 `files inspect --file-ref FILE_REF`；状态已是目标状态即完成，仍可用时可以重试同一 file_ref，不能伪造 key、换 ref 或把缺失的 ref 当作另一个文件。 |
| `instance takeover`、`instance handback`、`lock`、`release` | 这些 owner ControlLease 写入不使用 caller key，必须带同一次 list／inspect 得到的 `expected_control`，由 Harbor 在单一现场原子比较 owner、lock、holder 和 generation；不是 CLI 先查再写。 | 丢响应后必须 fresh observe。目标状态已成立即完成；仍等于原 expected 状态时可重试同一请求；generation、holder 或任一 control 字段已变化则返回冲突并停止，不能用旧快照或新 key 重放。ABA 由 generation 区分。 |
| `instance stop` | owner API 以准确 `runtime_session_ref` 调用 Harbor `/runtime/sessions/{ref}/stop`，没有 caller key，也不停止 Runtime service。Harbor 对已 closed 的同一 session 保持 terminal 事实；它不是 Run receipt。 | 丢响应后用 `instance inspect` fresh observe；已 closed 即完成，仍 active 时才可针对同一 ref 再请求，缺失／unavailable 保持未知并查询恢复，不能换 ref 或新 key。 |
| `setup`、`start`、`stop`、`uninstall` | 这些是安装／Runtime 生命周期或 receipt 清理操作，现有入口没有 Core owner receipt caller key；它们依赖安装 manifest、Runtime status、精确 data／host 路径和 installation receipt。 | 响应丢失先用 `diagnose`／`status` 和 receipt 读取当前事实，再按当前前置状态继续；不得把生命周期重试伪装成 Core idempotency receipt，也不得用新 key 掩盖未知状态。 |

实现和帮助必须逐项遵守这张矩阵。除表中现有 receipt、operation selector、目标路径／file_ref 语义和 ControlLease CAS 外，不得新增幂等机制；无法查询或对账时必须保留 unknown／unavailable。

### 5.4 owner 文件管理

    webenvoy files import --data-dir DIR --source-path PATH --profile-ref PROFILE [--display-name NAME] [--mime-type TYPE] [--operation-ref REF]
    webenvoy files inspect --data-dir DIR [--file-ref FILE_REF]
    webenvoy files export --data-dir DIR --file-ref FILE_REF --destination-path PATH
    webenvoy files revoke --data-dir DIR --file-ref FILE_REF
    webenvoy files delete --data-dir DIR --file-ref FILE_REF

本地 owner path 只用于 owner files route。Agent request 只能携带不透明 file_ref 和当前 operation 需要的 task_scope.file_refs；owner source／destination path、Cookie、文件内容和本地目录不得进入 Agent request、Grant、Plugin 或 Run public result。

上述四个写入命令保持现有 Harbor owner API 的字段，不添加 `--idempotency-key`：import 的 `--operation-ref` 是可选关联字段，不是去重凭据；export 的 destination path 排他写入、revoke/delete 的准确 file_ref 状态转换分别是第 5.3.1 节的固有保护。帮助必须把这些例外和 response-loss 对账步骤写出来，不能用“所有 owner 写操作都必须带 key”覆盖它们。

### 5.5 owner Instance 控制

owner 必须能够在没有保存 Agent key 或 runtime_session_ref、且 Agent host 已断线时独立发现当前现场。S1 冻结一个 live discovery projection，不建立第二个持久 Instance registry：Harbor 直接从现有 RuntimeSessionStore 生成 owner-only session facts，Runtime service 只转发该事实。Runtime service／Harbor 不可用时返回 unavailable，不从旧 Run 或客户端缓存猜测当前现场。

    webenvoy instance list --data-dir DIR [--profile-ref PROFILE]
    webenvoy instance inspect --data-dir DIR --runtime-session-ref REF
    webenvoy instance takeover --data-dir DIR --runtime-session-ref REF
    webenvoy instance handback --data-dir DIR --runtime-session-ref REF
    webenvoy instance stop --data-dir DIR --runtime-session-ref REF

- list 是 owner read，不启动 Runtime、Profile、Page 或 Provider，不获取 ControlLease。它映射到 owner-authenticated GET /runtime/sessions?profile_ref=PROFILE；省略 profile_ref 返回当前 RuntimeSessionStore 中尚未 closed 的全部 session facts。当前 Harbor 已有按 ref 读取 RuntimeSessionStore 的事实和 routes；list 是在 owner-authenticated Runtime seam 上增加的窄投影，不是第二个持久 registry。每项只返回最小身份和控制字段：runtime_session_ref、profile_ref、identity_environment_ref、provider_ref、lifecycle_state、created_at、last_seen_at、availability、control_owner、control_generation、control_lock（owner、state、holder_ref）、current_page 的安全 ref／generation／status 摘要、current_error.code。它不返回 Cookie、token、raw DOM、HAR、截图、任意本地路径或 Provider 私有材料。
- inspect 是 owner read；读取 /runtime/sessions/{ref} 与 /runtime/sessions/{ref}/runtime-facts，不获取写 ControlLease，不启动、导航或刷新 Page。
- takeover 先读取该 session 的当前事实并按下列分支执行：若 control_owner=core_task 且 control_lock.owner=core_task、state=held，则 POST /runtime/sessions/{ref}/handoff；请求保留 control_owner=user、expected_control_owner=core_task、handoff_reason=user_requested 和可选 holder_ref 字段，并必须带第 5.5.1 节的 expected_control 前置状态；若 control_owner=user 且 control_lock.owner=user、state=held，则返回 already_user 的当前事实，不重复 handoff；若 control_owner=none 且 control_lock.owner=none、state=released，则 POST /runtime/sessions/{ref}/lock，请求带 control_owner=user、holder_ref=harbor_mediated_user 和同一 expected_control 前置状态；其他 owner、lock 或 lifecycle 组合返回 control_state_unavailable，不猜测或改写状态。handoff 需要 viewer 可用；成功后返回当前 control owner、control generation 和安全事实摘要，不创建替代 Profile、不重新打开 URL、不清除 Run。
- handback 先读取当前事实：若 control_owner=user 且 user lock 为 held，则 POST /runtime/sessions/{ref}/release，请求带 control_owner=user、holder_ref=当前 user holder 和 expected_control 前置状态；成功结果必须是 control_owner=none、control_lock.owner=none、state=released；若 control_owner=none 且 control_lock.owner=none、state=released，则返回 already_released；若仍是 core_task/held、provider／system owner 或组合不一致，则返回 control_lock_conflict／control_state_unavailable，不替 user release。release 后 Agent 只能以 core_task 和自己的 holder_ref 重新 lock，并先 fresh observe。handback 不是 App 关闭、CLI 退出、socket 断线或浏览器窗口消失的别名。
- stop 只停止指定 Instance／browser session；它不停止本地 Runtime service，不删除 Profile，不回放原 Run。停止后原 Run 和 outcome 仍可 query。

### 5.5.1 owner control 的 CAS 前置状态

owner 的 inspect／list 投影必须返回可用于一次写入比较的 `control_generation`。它来自 Harbor 当前 RuntimeSessionRecord 已有的单现场控制代数；当前公共 RuntimeSessionFacts 尚未暴露该内部字段，目标 owner projection 必须以 owner-only 字段返回它，不能用时间戳、holder_ref 相等或客户端自增值替代。代数从 0 开始，并在同一现场每次成功 handoff、lock 或 release 后单调递增；它不建立第二个持久锁或状态机。

所有 owner 的 takeover、handback、lock、release 请求都必须携带以下 request-only `expected_control` 对象；它不是 Run、Grant 或 Harbor durable record：

    {
      "schema_version": "harbor-control-precondition/v1",
      "control_owner": "core_task|user|none",
      "lock_owner": "core_task|user|none",
      "lock_state": "held|released|closed",
      "holder_ref": "opaque-ref|null",
      "control_generation": 12
    }

owner CLI 从同一次 inspect／list 结果逐字段复制 expected_control。handoff 的请求字段因此是现有 control_owner=user、expected_control_owner=core_task、handoff_reason=user_requested、可选 holder_ref，加上 required expected_control；released→lock 是 control_owner=user、holder_ref=harbor_mediated_user，加上 required expected_control；user→release 是 control_owner=user、holder_ref=当前 user holder，加上 required expected_control。旧 handoff 的“body 只能是三个字段、可选 holder_ref”限制由这个带版本前置状态的 allowlist 替代；lock／release 也不得只传 owner 和 holder。

Runtime service 只能把 owner request 和 expected_control 原样转发给 Harbor。Harbor 必须在单一 RuntimeSessionStore 现场内原子地比较 control_owner、control_lock.owner、control_lock.state、control_lock.holder_ref 和 control_generation，比较成功后执行一次 mutation 并递增代数；不能由 CLI 或 Runtime service 先 inspect、再独立调用旧写接口来假装 CAS。检查失败返回 409 control_state_changed（现场正在收敛时可返回 409 session_locked），不得修改现场；返回的安全当前控制摘要可供 owner 重新 inspect，但不得自动重试。user→released→新 user 即使 holder_ref 相同，也因 control_generation 改变而拒绝旧请求，消除 ABA。

旧 Harbor handoff body 仍可供已认证的既有 Core supervisor 调用者在兼容期使用，但缺少 expected_control 的 legacy 请求不满足本 owner 合同，不能由 owner control socket 或 owner CLI 发出；owner proxy 不支持 v1 时返回 control_precondition_unsupported／unavailable，不降级为先读后写。实现若将该字段接入现有 Harbor route，必须保留现有 handoff 字段和 route，不新增通用锁服务；不声称当前 public Harbor route 已提供 generation CAS。

没有 viewer 不得假装 takeover 成功；主机断线不得自动 handback。

### 5.6 Agent／程序 CLI

Agent CLI 是 MCP projection 的一次性、非交互、薄适配。它读取 --client-file FILE，禁止读取 data-dir/owner-private store，禁止接受 owner service credential、supervisor token 或 --confirm owner flag。

    webenvoy agent status --client-file FILE
    webenvoy agent skill --client-file FILE
    webenvoy agent connect --client-file FILE
    webenvoy agent describe --client-file FILE --request-file FILE
    webenvoy agent operation --client-file FILE --request-file FILE
    webenvoy agent query --client-file FILE (--run-id RUN_ID|--idempotency-key KEY)
    webenvoy agent recovery --client-file FILE --request-file FILE
    webenvoy agent skills --client-file FILE --request-file FILE

参数规则：

- --client-file 必须是安装生成的 webenvoy-client.json 或等价的受管 Agent credential file；文件内只允许 `data_dir`、`credential`、`agent_endpoint`、`owner_uid`、`agent_uid` 五类字段，权限、OS UID／ACL、socket 本体和路径由安装 verifier 每次检查。安装 manifest 使用同名的顶层 `owner_uid`、`agent_uid`、`agent_endpoint` 字段；不接受 camelCase、`os_boundary` 或用户填入的 process／ACL 布尔值作为替代。`agent_endpoint` 不能指向 owner control socket；client file 不得包含 owner token、supervisor token、owner-private path 或可代理 owner route 的材料。
- agent connect 只能调用 /agent-connections 注册现有 Principal；没有 owner register／grant 权限。
- agent describe 的 request file 是现有 webenvoy_describe 的 JSON 参数：operation，可选 context（grant_id、profile_ref、task_scope），可选 arguments。它不得创建 Run、启动 Instance、打开 Page、获取 ControlLease 或授予权限。
- agent operation 的 request file 与 webenvoy_operation 完全相同：必填 idempotency_key、grant_id、operation、task_scope；其余字段严格取自已安装 managed-capability-definitions.json 的该 operation allowed 集合。未知 operation、未知字段、将后续步骤混入当前 task_scope、缺少 operation-specific origin、错误 Page／file selector 或违反 file_refs 约束，在发送前拒绝。
- agent recovery 只投影 recovery.inspect、recovery.request、recovery.status；不能 backup、plan、confirm、apply。
- agent skills 只投影现有 skill.list|inspect|install|enable|read|update|rollback|disable，是否允许由 Skill Grant 与 Core 判定。
- agent query 只接受 managed-[a-f0-9]{64} 的 Run id，或一个原始 idempotency key；两者同时提供是 usage error。使用 key 时按当前 Principal 计算原 Run id，不能为查询生成新 key。
- 所有 request file 的未知 JSON field、额外 owner 字段、connection_id、principal_id、run_id、owner_token、supervisor_token 都必须拒绝；connection_id 由已认证连接在本地适配层注入，不能由 Agent 指定。

Agent CLI 不提供 agent instance takeover、agent instance handback、agent access grant、agent files import 或 agent recovery apply。这些动作属于 owner control plane。

## 6. 请求、能力定义与 API／Plugin 映射

### 6.1 统一 operation envelope

agent operation、已安装 Plugin webenvoy_operation 和直接 API consumer 使用相同语义：

    {
      "idempotency_key": "task-20260922-001",
      "grant_id": "grant:example",
      "operation": "instance.start",
      "task_scope": {
        "operations": ["instance.start"],
        "profile_refs": ["profile:example"],
        "origins": ["https://example.test"]
      },
      "profile_ref": "profile:example",
      "origin": "https://example.test",
      "url": "https://example.test/start"
    }

上例只展示 instance.start 的字段。真实 required／allowed／conditional fields 以安装 bundle 的 managed-capability-definitions.json 为准；CLI、MCP 和 API 不得各自维护一份副本。所有 Agent managed operation（包括会改变外部状态的 operation）必须由调用者提供全新 idempotency key；重用同 key 但 request hash 不同必须返回 managed_browser_idempotency_conflict，不得执行第二次。owner action 的例外只按第 5.3.1 节处理。

现有 exposed browser operation 名称为：

| 类型 | operation |
| --- | --- |
| Profile | profile.create、profile.list、profile.read |
| Provider preference | provider.preference.read、provider.preference.set、provider.preference.clear |
| Instance／environment | instance.start、instance.observe、instance.diagnostics、environment.read、environment.update、instance.navigate、instance.read、instance.snapshot、instance.click、instance.input、instance.press、instance.scroll、instance.wait、instance.handoff、instance.stop |
| Page | page.list、page.open、page.activate、page.close、page.navigate、page.reload、page.back、page.forward |
| File | file.upload、file.download |

account.bind 可以存在于 Core capability definition，但当前未暴露给 Agent；CLI 不得自行暴露。recovery.* 与 skill.* 通过各自 managed operation projection 处理。

### 6.2 映射表

| CLI | 已安装 Plugin tool | 本地 service／API 路径 | Core／Harbor owner |
| --- | --- | --- | --- |
| agent status | webenvoy_status | Runtime /status，再读取已验证 manifest | 无 Run |
| agent skill | webenvoy_skill | 读取安装完整性验证的 SKILL | 无 Run |
| agent connect | webenvoy_connect | POST /agent-connections | Core Principal authentication |
| agent describe | webenvoy_describe | POST /managed-browser/capabilities/describe | Core discovery，必要时 Harbor capability facts |
| agent operation | webenvoy_operation | POST /managed-browser/operations，服务端注入已认证 connection_id | Core Grant／Run，Harbor supervisor execution |
| agent query | webenvoy_query | GET /managed-browser/operations/{run_id} 或 Skill operation query | Core 原 Run／receipt |
| agent recovery | webenvoy_recovery | POST /managed-browser/operations 的 recovery projection | Core recovery；owner confirmation 仍在 owner plane |
| agent skills | webenvoy_skills | POST /managed-skills/operations | Core Skill Grant／Run |
| access list\|register\|grant\|grant-v2\|policy-v2\|revoke\|operation | 无 | owner local /agent-access... | Core owner managed access |
| files ... | 无 | owner /owner/files... | Core／Harbor owner file store |
| recovery ... | 无 | owner /owner/recovery... | Core owner recovery service |
| instance list | 无 | owner-authenticated GET /runtime/sessions?profile_ref=... | Harbor RuntimeSessionStore live facts |
| instance inspect | 无 | owner-authenticated GET /runtime/sessions/{ref}、GET /runtime/sessions/{ref}/runtime-facts | Harbor session facts |
| instance takeover | 无 | owner-authenticated POST /runtime/sessions/{ref}/handoff（core_task held）或 POST /runtime/sessions/{ref}/lock（released），均带 harbor-control-precondition/v1 | Harbor ControlLease |
| instance handback | 无 | owner-authenticated POST /runtime/sessions/{ref}/release，带 harbor-control-precondition/v1 | Harbor ControlLease |
| instance stop | 无 | owner-authenticated POST /runtime/sessions/{ref}/stop | Harbor exact Instance |

owner session routes must be reachable only through a trusted owner control plane. If the current local service does not yet proxy these Harbor supervisor routes, implementation must add the narrow owner-authenticated forwarding seam; it must not expose them through Agent MCP or create a second direct Harbor client in CLI.

所有 takeover、handback、lock、release 写请求复用第 5.5.1 节的 expected_control CAS 前置状态。CLI 的 inspect 结果、Runtime service 的转发和 Harbor 的单现场原子比较是同一个请求链；任何只在 CLI 端保存 generation、再调用没有 expected_control 的旧 route 的实现都不满足本规范。

### 6.3 API 与 Plugin 的一致性

API consumer 可能在本地 service 之外运行，但必须提交相同 operation envelope，并由 Core 生成同样的 run_id、request hash、status、dispatch receipt 和 result query。API、CLI 和 Plugin 的差异只允许是 transport 和 authentication binding：

- CLI Agent 使用安装的 client credential 与 local service；
- Plugin 使用同一 client credential 通过 MCP；
- API 使用已批准的 API caller binding，但最终映射到同一 Core Principal／Grant／Run 合同；
- owner CLI 使用可信 owner OS identity／control socket；Runtime service 内部的 owner service bearer 不进入 CLI、API／Plugin projection，永远不能变成 Agent credential。

Plugin tool 列表和参数继续由 [plugin-runtime-exposure-v1](plugin-runtime-exposure-v1.md) 冻结；本规范不增加动态工具、不为每个 Provider 生成新 tool、不把 access、files、owner recovery 暴露给 Plugin。

## 7. 输出、stderr 与退出码

### 7.1 输出 envelope

命令没有 format 分支；机器可消费 JSON 是默认且唯一的成功格式。help 是唯一例外，输出稳定纯文本帮助。

当请求已经到达 Core 并形成一个可查询的结果时，CLI 将完整结构化结果写到 stdout，即使业务状态不是 succeeded。browser operation 的最小 envelope 与现有 Core response 一致：

    {
      "ok": false,
      "run_id": "managed-<sha256>",
      "status": "unknown_outcome",
      "dispatch_state": "dispatched",
      "failure": {"code": "managed_browser_outcome_unknown"},
      "reconciliation": null
    }

字段规则：

- run_id、status、failure.code、dispatch_state、reconciliation 只来自 Core／Harbor receipt；CLI 不自己改名或推断 succeeded。
- ok 只有 status == succeeded 时为 true。pending、admitted、running、failed、blocked、requires_user_action、manual_recovery_required、unknown_outcome 都必须保留真实 status。
- owner read／setup／diagnose 可返回其现有 JSON 结果，但同样不得混入日志或 secret。
- Core 在 createRun 前拒绝的 denied、usage、Grant／Principal 无效或 owner-only 结果没有 run_id，CLI 不得伪造 Run；只有 Core 已持久化 Run 的 pending、requires_user_action、failed、blocked 或 unknown 结果才保留 run_id 和 recovery/query hint。

### 7.2 stderr 诊断

非零退出时，CLI 最多写一行 UTF-8 JSON diagnostic 到 stderr；不得写 Node stack trace、命令回显中的 secret 或未脱敏路径。格式：

    {"error":{"code":"<stable-code>","message":"<safe-message>","next":"<safe-next-step>"},"run_id":"<optional>","operation_ref":"<optional>"}

message 可供人阅读，code 和 next 供程序处理。stdout 已有 Core result 时，stderr 只补充诊断，不重复大 payload。stdout／stderr 都必须以 newline 结束，禁止进度条、spinner 或混合日志。

### 7.3 退出码

| 码 | 含义 | 是否可能已有 durable Run | 调用者动作 |
| ---: | --- | --- | --- |
| 0 | 请求成功；读操作完成；或写操作明确 succeeded、admitted 或 running 且 transport 已返回结构化结果 | 是／否 | 读取 stdout；admitted／running 继续 query |
| 2 | usage／schema／未知 command、flag、字段、参数或 request file 无效，未 dispatch | 否 | 修复输入；不得重试同一外部动作 |
| 3 | 明确 denied、未注册 Principal、Grant 失效／撤销、owner-only route 或本地认证失败；Core createRun 前的 Grant 拒绝属于此类 | 通常否；若 Core 已建 Run 必须返回其 ref | 修复 owner Grant／身份；不得改用 owner service credential |
| 4 | 仅限 Core 已持久化的 pending、requires_user_action 或 manual_recovery_required，需要可信用户或人工恢复 | 是 | 交给 owner；不等待、不代确认、不换 key |
| 5 | Core 已知的 failed、blocked、cancelled、expired 或 not_dispatched 失败 | 是／否；取决于是否已建 Run | 按 failure/recovery_hint 处理；不把它当 unknown |
| 6 | 只有 unknown_outcome 或已 dispatch 但 response／receipt 无法确认的结果 | 是 | 只使用原 run_id 或原 idempotency key query/reconcile；禁止重放 |
| 7 | 本地 Runtime／socket／bundle／Provider unavailable，且没有可证明已 dispatch 的 Run | 否 | 先 diagnose/status；不得假定成功 |
| 8 | 内部完整性、协议或未分类实现错误 | 不确定 | 保留真实 diagnostics；开发者修复后再运行，禁止由 CLI 改写状态 |

admitted／running 是已知的正常非终态，query 看到它们仍退出 0；它们不表示业务完成。unknown_outcome 不是普通的“还没完成”，只能退出 6。pending／requires_user_action／manual_recovery_required 只有在 Core 已持久化对应 Run 时退出 4；没有 Run 的授权拒绝仍退出 3。一个结果只能按 Core status 和 dispatch_state 选取退出码，不能因为命令“执行过”而返回成功。

## 8. 非交互、长任务、停止、查询与 unknown

### 8.1 非交互 pending

Agent CLI、Plugin 和 API consumer 都是非交互调用：

- 不读取 stdin 等待 owner；
- 不打开 App、浏览器授权对话框或系统凭据弹窗；
- 不调用 access grant、policy-v2 --confirm、recovery apply；
- 缺少 Grant、未注册 Principal、过期／撤销 Grant 或 owner-only 路径在 Core createRun 前拒绝时，返回明确 denied、没有 run_id、退出 3；不得把它们合成 pending；
- 只有 Core 已创建并持久化、且确实等待 owner decision／manual recovery 的 Run 才返回 status: pending、requires_user_action 或 manual_recovery_required、run_id、安全 next，退出 4；
- human_control 若只是当前现场阻断且没有 Core 待决定记录，按 Core 的 denied／failed／blocked 和 dispatch_state 返回，不由 CLI 合成 pending。

owner CLI 的 confirmation 只由显式 --confirm 或受 schema 验证的 confirmation file 提供；缺失时立即退出 2。不能将 Agent request 转交 owner CLI 自动确认。

### 8.2 长任务

一次 agent operation 只提交一个静态 operation，不提交隐含 workflow，也不负责后续步骤。CLI 在 Core 返回 admitted 或 running 后立即返回，不能默认轮询到业务完成。调用者应保存 stdout 中的 run_id 和原 idempotency_key，随后执行：

    webenvoy agent query --client-file FILE --run-id managed-<sha256>

或：

    webenvoy agent query --client-file FILE --idempotency-key ORIGINAL_KEY

Plugin 使用 webenvoy_query，API 使用同一个 Core query 事实。query 是只读；不能启动 Runtime、打开 Page、获得 lease、重新提交 operation 或改变 Grant。

### 8.3 stop 与 client exit

三种动作必须区分：

1. webenvoy stop 停止本地 Runtime service 和其 managed child，是 owner lifecycle；它不代表原 Run succeeded，也不保证业务 Instance 可以继续。
2. webenvoy instance stop --runtime-session-ref REF 或受 Grant 的 instance.stop 停止准确 Instance／browser session；它不删除 Profile、Run、receipt 或外部结果。
3. CLI、MCP、Plugin、脚本或 API 进程退出只关闭调用 client；它不停止 Runtime、Instance，也不释放用户 ControlLease。断线不等于 handback。

Agent 如要停止自己创建或被授权的 Instance，必须用一个新的 instance.stop operation 和新的 idempotency key；它不能把原 instance.start key 重用为 stop。owner stop 则以准确 session ref 走 owner control plane，结果仍写入既有事实。

### 8.4 unknown/no-replay

以下情况都保留 unknown：

- 请求已经可能 dispatch，但 client 在 response 前断线；
- Runtime service、Core 或 Harbor 在写操作 receipt 前不可用；
- Provider 返回无法判断是否已执行的结果；
- query 发现 Core 已将可能 dispatch 的写操作标记为 unknown_outcome；单纯看到 Run 仍为 admitted／running 是已知的正常非终态，不得改写成 unknown。

调用者只能：

1. 重新连接同一 Principal；
2. 使用原 run_id 或原 idempotency key query；
3. 根据 Core／Harbor reconciliation 或 owner manual recovery 继续；
4. 必要时停止后续新写操作。

禁止改用新 key、换 connection、换 Provider、换 Profile、换 MCP／API transport、重新打开 URL 或让模型“再试一次”来确认写操作。相同 key 不同 request hash 也必须拒绝。

## 9. Instance 控制、A/B 与断线

### 9.1 A 实例控制顺序

以 A 为 runtime_session_ref=A、B 为另一个 session 为例：

1. Agent 以 core_task lease 对 A 执行 operation。
2. owner 从同一次 inspect 结果携带 A 的 owner、lock、holder 和 control_generation，运行 webenvoy instance takeover --runtime-session-ref A。Harbor 在单一现场原子比较 expected_control、当前 lease、viewer／现场；成功后 A 的 control_owner=user。检查后若发生 user→released→新 user 的 ABA 或其他变化，返回 409，不能覆盖新 owner。
3. 在 A 由用户接管期间，任何 Agent click、input、press、scroll、navigate、page mutation 或 file operation 都返回 control_lock_conflict 或等价 denied；它不能通过新连接绕过 A 的 owner。
4. B 的 lease、Grant 和 operation 不因 A takeover 改变；B 仍可执行其被授权的操作。
5. 用户从当前 inspect 结果携带新的 expected_control 运行 webenvoy instance handback --runtime-session-ref A，明确释放 user lease；generation 不匹配时保持原控制事实并返回 409。它不表示已有 Page 仍新鲜。
6. Agent 对 A 重新提交 instance.observe 或按 operation 要求获取 fresh observation；旧 Page／target／document generation 不得继续用于输入。

### 9.2 断线和 viewer 缺失

- Agent client 断线：保留 A 的 Core／Harbor 控制事实和 Run status；不自动释放 user lease，不自动重放。
- owner CLI 断线：同样不改变 handoff；owner 可重新运行 inspect、takeover、handback 或 stop。
- viewer 不可用：takeover 报 viewer_unavailable 或事实等价的明确状态；inspect、query 和符合权限的 stop 不能因此全局阻断。
- Browser crash／Host disconnect：记录 Runtime／Instance unavailable；不能以“用户已交还”结束 lease，恢复由 owner／Harbor receipt 决定。

## 10. 正式安装、产物与数据接续

### 10.1 必需安装产物

正式 Agent installation bundle 至少包含：

- 独立可执行的 webenvoy launcher 和可验证 Runtime；
- agent-entry/cli.mjs、mcp.mjs、client.mjs、service.mjs、os-boundary.mjs、bundle.mjs、installation.mjs 及其依赖；
- 与当前 bundle digest 匹配的 managed-capability-definitions.json 和版本化 WebEnvoy SKILL；
- Core／Harbor Runtime 构建产物、已 Qualification 的 Provider driver/binding 和 manifest；
- installation receipt 所需的签名／digest／版本资料；
- 可选 Lode／增强 Skill 资产缺失时，不得阻断不依赖它们的基础 owner／Agent browser capability。

文件名是说明性安装资产边界；最终包可以打包，但必须保留可审阅的 manifest、digest 和角色边界。

### 10.2 目录、权限和 OS boundary

至少保持以下目录关系：

- installation root：只读或受安装器管理，包含 bundle 和 manifest；
- owner 安装者创建并持有 installation root、Runtime Node、CLI／service 代码和 manifest；Agent setup 只由 Agent UID 创建自己的 host root 资产，不能修改 bundle、fixed Node、CLI、service 或 manifest。实际安装若无法复核这些路径对 Agent UID 不可写，必须拒绝 Agent data plane；
- data root：独立、持久、0700，保存 Runtime／Core 状态、Principal／Grant／Run 相关数据和 recovery；
- host root：独立、持久、0700，保存 webenvoy-client.json、host config、SKILL 和 installation receipt；
- Agent IPC root／endpoint：独立于 owner data root 和 host root，由安装器预置并按 owner／Agent 角色配置；Agent endpoint 可由 owner service 创建但不允许复用 owner control socket，Agent 只能通过 client file 中的已验证引用连接；
- owner-private store／control socket：只能由可信 owner UID 或强制验证的人类 control client 访问；Agent UID／脚本 UID 无权读写；
- owner runtime record、client 文件、receipt 和受管 host config：按当前实现的 0600 约束原子写入；任何冲突的用户文件保护用户内容。

权限模式只作为纵深检查。服务端仍必须按角色、Principal、Grant 和 route 检查；拥有路径读权限的同 UID 进程不能因此被视为普通 Agent。若 owner 与 Agent 同 UID 且没有等价 OS sandbox／签名身份，必须按第 4.2 节禁用 Agent data plane。

### 10.3 去 App 构建和进程依赖

正式 V1 安装必须满足：

- setup、首次 register／grant、Agent connect／operation、owner inspect／takeover／handback／stop、query、uninstall 可以在没有 Desktop App 进程时完成；
- launcher 不要求 checkout、node_modules、Electron App bundle、ELECTRON_RUN_AS_NODE 或 App 的 process.execPath 才能提供正式 Runtime；
- App 可以作为被冻结的历史工作台或兼容 helper，但不能是隐藏的 service supervisor、首次信任入口、owner service credential broker 或 capability registry；
- 安装、Runtime、CLI 和 MCP 使用 manifest／asset digest 验证的同一 bundle；失败时停止并报告 integrity error；
- Provider 来源、版本和 executable hash 不满足 Qualification 时明确 blocked／unsupported；不静默切换 Provider、Profile 或协议。

当前 package:agent、Electron host config 和 app 仍是候选实现事实。W1 必须提供独立 launcher 和 no-App 验证证据后，才能把本节的目标标为完成。

### 10.4 更新、重装、卸载与数据继续

- 在同一 data root 上升级或重装时，先显式停止旧 Runtime；验证新 bundle 后复用同一安装身份、Principal／Grant、Run、Profile、recovery 和有效 client credential。
- 更新不得自动复活旧 Instance、复用过期 Page／target、改变 Grant scope 或把 unknown 写成 succeeded；Agent 必须重新 connect，操作必须重新 observe。
- client credential rotation 是显式 owner action：注册新 fingerprint、迁移／替换 Grant、撤销旧 Principal／connection，并保留审计和 idempotency 事实；不能在 setup 重跑时静默换 credential。
- uninstall 只删除当前 receipt 列出的受管 host 文件；data root、Run、Profile、Grant 和恢复资料默认保留，并输出 data_preserved。
- 旧 host 文件有用户修改或 receipt／identity 不匹配时停止并报告 conflict，不覆盖、不删除、不假装卸载完成。

## 11. 安全数据和错误边界

CLI、MCP、API、SKILL 和 Run public result 只返回实现后可验证的最小摘要：

- Principal／Grant／Profile／Instance／Page／Run／Operation 的 opaque ref；
- Provider id、lifecycle、ControlLease owner、safe availability reason；
- operation status、dispatch state、receipt、failure code、recovery hint；
- 已获准的受限 observation／file receipt。

禁止返回或持久化到 Agent 可见 surface：

- owner service credential、supervisor token、client secret 明文；
- Cookie、session token、账号密码、完整 identity environment；
- raw CDP、完整页面 HTML、未脱敏 DOM／HAR、任意本地绝对路径；
- owner 文件原文或文件内容，除非未来独立 contract 明确批准且仍受 Grant／File scope 约束。

外部输入、request file、JSON body、环境变量和 host 文件都按不可信数据处理；具体 schema、origin、Page generation、file ref、Grant digest 和 Provider facts 必须由已有 owner／Core／Harbor 校验。错误时保持真实状态，尤其不得把 unknown、pending、blocked 或 denied 改成成功。

## 12. 端到端示例与反例

### 12.1 正例：首次 no-App trust 和同一 Run 查询

下面是 shell 形态示例；真实 Provider 参数按第 5.2 节和安装候选补齐。

`grant.json` 必须包含本次调用方保存的 `idempotency_key`；grant-v2 和 policy-v2 文件同样必须包含 caller key。

    webenvoy setup --data-dir /var/lib/webenvoy/data --host-dir /var/lib/webenvoy/host --codex-profile browser-agent
    webenvoy access register --data-dir /var/lib/webenvoy/data --display-name browser-agent --credential-hash SETUP_OUTPUT_FINGERPRINT --idempotency-key principal-register-20260922-001
    webenvoy access grant --data-dir /var/lib/webenvoy/data --grant-file grant.json
    webenvoy agent connect --client-file /var/lib/webenvoy/host/webenvoy-client.json
    webenvoy agent operation --client-file /var/lib/webenvoy/host/webenvoy-client.json --request-file start.json

start.json 返回 Core 的 admitted 或 running 后，CLI 退出而不保持交互。调用者将 stdout 中的 run_id 和原 key 交给另一台 API consumer、Plugin 或重新连接的 CLI：

    webenvoy agent query --client-file /var/lib/webenvoy/host/webenvoy-client.json --idempotency-key task-20260922-001

三种入口应看到同一 managed-<sha256>、同一 status 和同一 result／failure；Plugin query 不能创建第二 Run。

### 12.2 正例：pending 到 owner 决策

只有 Core 已持久化待决定 Run 时，Agent operation 才可能返回：

    {"ok":false,"run_id":"managed-...","status":"requires_user_action","failure":{"code":"owner_confirmation_required"}}

CLI 退出 4，不等待 stdin。owner 根据 next step 使用 owner CLI 完成确认、takeover 或 Grant 修订；Agent 之后只 query 原 Run 或提交明确允许的下一 operation。Agent 不能把 owner confirmation file 作为 request file 发送。

缺少 Grant 的请求在 Core createRun 前被拒绝时返回：

    {"ok":false,"error":{"code":"managed_access_grant_unavailable"}}

该响应没有 run_id，CLI 退出 3；它不是 pending，也不允许调用者用新 key 重放。

### 12.3 正例：unknown 后只查询

写操作已可能 dispatch，但 socket 在 response 前断开：

    {"ok":false,"run_id":"managed-...","status":"unknown_outcome","dispatch_state":"dispatched","failure":{"code":"managed_browser_outcome_unknown"}}

CLI 退出 6。调用者重新 connect 后只运行 agent query --run-id managed-... 或 Plugin webenvoy_query；不能用新 key 重跑 click、input、upload、navigate、provider preference 或 profile creation。

### 12.4 正例：宿主断线后的 owner discovery

Agent host 断线且 owner 没有保存 Agent key 或 runtime_session_ref 时，owner 先运行 `webenvoy instance list --data-dir DIR`，从 Harbor 当前 live facts 选择准确的 runtime_session_ref，再运行 `instance inspect` 和 `instance takeover`。list 只读 RuntimeSessionStore；Runtime／Harbor 不可用时返回 unavailable，不能从旧 Run、客户端缓存或猜测的 ref 继续控制。

### 12.5 正例：A/B handoff

owner 运行 instance takeover --runtime-session-ref A 后，A 的 Agent input 得到 control_lock_conflict，B 的 operation 不受影响。owner 在原浏览器现场操作 A，再运行 instance handback --runtime-session-ref A。Agent 对 A 先 instance.observe，确认新 generation／Page／observation ref 后才继续。owner 关闭 terminal 或主机断线不会自动执行 handback。

### 12.6 反例：伪隔离和伪恢复

- Agent 从 data-dir/owner-private store 读取 owner service credential 再调用 /agent-access/grants：必须在 OS ACL、进程环境和 service route 任一层拒绝，并记录 owner-only denial。
- Agent 把 --confirm 加到 agent operation：必须 usage error；Agent CLI 不支持 owner confirmation。
- CLI 收到 timeout 后用新 idempotency key 重新 click：违反 no-replay，必须保持 unknown 并指向原 key。
- setup 检测到 Provider executable 缺少 hash 后打开 App 或换另一个 Provider：违反 Qualification 和 explicit selection，必须返回 blocked／unsupported。
- App、MCP 或浏览器窗口关闭后把 user lease 自动改成 none：违反 ControlLease；必须保留事实，owner 明确 handback 或 Harbor recovery 才能改变。
- 仅因为 owner 与 Agent 同 UID、文件 0600、文件路径不同就声称安全隔离：验收失败。

## 13. Design Obligation Gate

本 Work Item 的 obligation 结论如下；实现若改变触发条件，必须先补相应 Spec／Contract／Schema，不能先让消费者依赖新 wire。

| Obligation | 结论 | 理由和完成条件 |
| --- | --- | --- |
| `DO-PLUGIN-EXPOSURE` | `triggered` | CLI 是复用既有固定 Plugin exposure 规则的第二宿主；最小补充见 [plugin-runtime-exposure-v1](plugin-runtime-exposure-v1.md)。不新增 tool 或动态过滤；任何 projection 变化必须同步更新两份规范。 |
| `DO-GRANT-WIRE` | `not-triggered` | 使用已有 profile_refs、allowed_operations、allowed_origins、expiry、creation template、skill/file scope 和 v2 digest；不新增持久或跨进程 Grant 维度。 |
| `DO-NETWORK-CONTRACT` | `not-triggered` | 不新增 Driver→Harbor→Core→Plugin 的公共 Network payload、拦截、body 或修改能力；session discovery/control 是 Harbor 控制面事实。 |
| `DO-CONSOLE-CONTRACT` | `not-triggered` | 不新增 console、page-error、log、source 或 exception 公共 payload。 |
| `DO-PROVIDER-PRIVATE-SCHEMA` | `not-triggered` | setup 复用既有 Camoufox／Official Chrome binding 与 Qualification；不新增 Provider-private 持久 bundle/config/replay。 |
| `DO-APP-IA` | `not-triggered` | 不新增 App 页面、导航或工作台；owner CLI 是正式入口。 |

安全／身份边界和安装／分发要求是本规范的完成条件，但不是 `docs/specs/README.md` 中另一个 Design Obligation trigger；对应合同见第 4、10、14 节。

## 14. 验收、证据和交付边界

S1 文档验收必须能由实现者直接转换为检查：

1. clean machine／clean data root 在没有 App 进程时完成 setup、register、grant、connect 和一次最小 read／start operation。
2. owner service credential、client credential、OS UID／ACL、同 UID fallback、环境继承、owner route 和 Agent route 的正反例均可验证；Agent 不能 register／grant／revoke／files owner／recovery apply／Instance supervisor。
3. CLI 的帮助、未知参数、未知字段、stdout／stderr、退出码和非交互 pending 有确定性测试；缺 Grant／未注册 Principal 的 pre-createRun denied 必须没有 run_id 并退出 3，真实 owner decision 的持久 Run 才能退出 4；帮助和语法检查逐项验证第 5.3.1 节的 required caller key 与文件／CAS 例外。
4. Core access receipt 的同 key／同请求 replay、同 key／异请求 conflict、access operation selector、Recovery 按 kind 派生 operation-ref、files import 的 correlation-only 行为、export 的 destination conflict、revoke/delete 的 file_ref 固有幂等和 ControlLease 的 expected_control 原子冲突都必须有最小可复核检查；CLI 提交后退出，Plugin、API、重连 CLI 能 query 同一个原 Run；response loss、Provider unknown、Core／Harbor disconnect 都必须证明 no-replay，response loss 只能按矩阵查询／对账，不能用新 key 重放。
5. A takeover、B unaffected、handback fresh observe、viewer unavailable、host disconnect、检查后变化以及相同 holder_ref 的 user→released→新 user ABA 均有受控验证；exact Instance stop 仍按准确 ref 验证。
6. 重装／更新复用 data root、Grant、Run、Profile、recovery 和明确的 credential identity；卸载保留 data 并只清理 receipt 管理的文件。
7. 验证记录准确的提交、平台、Runtime／Provider 版本、安装身份、bundle digest、owner／Agent OS identity、测试 surface 和候选边界；fixture／mock 不得冒充真实安装或真实 Provider。

本文件本身的 docs-only 交付不包含上述 live／install／third-party Agent 证据。#562 完成表示 S1 合同已经冻结并进入实现与验证；不自动关闭父 FR #474、S0、#568、#569 或 W1 安装任务，也不表示 App 代码、Electron launcher 或历史 verification 文档已经完成替换。

## 15. 旧条款替代、索引请求和关联资料

本规范正式替代以下与 S1 冲突的旧表述：

- apps/desktop/agent-entry/cli.mjs 的 setup 输出中“打开 App、在 App 注册 fingerprint”作为下一步的表述；替换为第 4.5 节 owner CLI 流程。
- 任何把 App process、Electron build、App approval 或 App settings 当作首次信任、owner control 或 Agent Runtime 前提的安装／入口说明。
- [ADR 0006：API、CLI、MCP、SDK 共用任务入口 v0](../adr/0006-common-task-entry-v0.md) 中“本轮不定义最终 CLI 命令、MCP tool 注册或 runtime 实现”的未冻结范围：只在本规范列出的 installed Agent／owner managed browser surface 内替换；其他未列 CLI 产品仍由其原 owner 负责。
- [installed-agent verification](../verification/installed-agent.md) 中描述历史 App 候选的步骤不能作为目标合同；它们必须在 no-App W1 候选验证时更新或保留为带日期的历史证据。

公共索引和验证证据由其各自的 owning change 维护；本规范只冻结 S1 合同，不复制索引状态或过程清单。

关联资料：

- [Product architecture V1](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)
- [Runtime Capability Plane](../architecture/runtime-capability-plane.md)
- [跨仓架构](../architecture/cross-repo-architecture.md)
- [ADR 0006：API、CLI、MCP、SDK 共用任务入口 v0](../adr/0006-common-task-entry-v0.md)
- [ADR 0012：Runtime Capability Plane and Plugin First](../adr/0012-runtime-capability-plane-and-plugin-first.md)
- [ADR 0013：optional model-assisted browser tasks](../adr/0013-optional-model-assisted-browser-tasks.md)
- [ADR 0014：browser infrastructure and App freeze](../adr/0014-browser-infrastructure-and-app-freeze.md)
- [Plugin runtime exposure V1](plugin-runtime-exposure-v1.md)
- [Grant wire contract V1](grant-wire-contract-v1.md)
- [Installed profile recovery V1](installed-profile-recovery-v1.md)
