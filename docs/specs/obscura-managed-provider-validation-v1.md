# Obscura Managed Provider Validation V1

状态：有界验证基线；版本：1.2；日期：2026-09-11；owner：Harbor。产品归口：[#511](https://github.com/WebEnvoy/WebEnvoy/issues/511)，父项 [#471](https://github.com/WebEnvoy/WebEnvoy/issues/471)；相关完整能力 [#497](https://github.com/WebEnvoy/WebEnvoy/issues/497)、Plugin 消费 [#474](https://github.com/WebEnvoy/WebEnvoy/issues/474)、V1 验收 [#482](https://github.com/WebEnvoy/WebEnvoy/issues/482)。产品依据：canonical v1.2；架构依据：[ADR 0013](../adr/0013-provider-choice-and-obscura-validation.md)。

本文冻结本轮实际验证版本、最小正式 Driver、安全边界、证据和缺口。它不表示 main 已合并、正式安装包已发布、Obscura 已成为推荐或默认，也不缩小 Browser Runtime V1。

## 1. 固定输入

| 事实 | 固定值／结论 |
|---|---|
| upstream | `https://github.com/h4ckf0r0day/obscura`，Apache-2.0 |
| 最新 release | `v0.2.2`，tag commit `a1e09de68c7617b8079fbb1661b0548c501971c1` |
| release arm64 artifact | `obscura-aarch64-macos.tar.gz`，SHA-256 `607471654d0c23799abd3bf45d1f4afd314a11fdbe1ee376e29018f32a2dfab9` |
| 验证源码 | upstream `main` commit `01e1caa33360f6c02643457307894ec885e82eef` |
| build | macOS 26.6.2 arm64；Rust 1.94.0；`CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=2 cargo build --release -p obscura-cli --bins --features render` |
| binary | `obscura 0.1.0-dev+01e1caa`；SHA-256 `d05336b807fde6b27221af3f1427550666d1f855166c3cc94be537a08b4ba98d` |
| worker | SHA-256 `4e936a5da20d312483f48a5e20c633dda89271a85682a7c89eb94534568855e1` |
| protocol readback | CDP `1.3`；Provider 自报 `Chrome/145.0.0.0`、V8 `14.5.0.0` |
| distribution | linker/ad-hoc signed，无 TeamIdentifier，Gatekeeper 拒绝；仅 no-release 验证，不是正式可信安装包 |

不能使用 `v0.2.2` 进入本接入：其 render 资源路径存在上游 [#890](https://github.com/h4ckf0r0day/obscura/issues/890)，会绕过代理、Cookie、CORS／SSRF／blocked URL／interception 并阻塞输入；修复只存在于未发布 [#949](https://github.com/h4ckf0r0day/obscura/pull/949) 所在 main。测试不得跟随 `latest`，Driver 对本轮 binary hash fail closed。

## 2. 最小正式 Driver

- 一个 Profile 一个专用 Obscura 进程和受管目录；同一 Profile 仍最多一个主 Instance。
- 只监听 `127.0.0.1`，`--max-connections 1`；生产默认不启用 private network 或 file access。
- Harbor 持有唯一 browser WebSocket，在其中创建 target、attach session 并复用 `sessionId`。App／Agent 不直连、不拿 endpoint、不调用 Obscura MCP。
- 固定 `OBSCURA_PROFILE=0`、`OBSCURA_ROTATE_PROFILE=0`；timezone 和已解析 proxy 由 Harbor 注入专用进程，凭据不进入命令行。
- 固定构建的 locale 只能是其原生 `en-US`；正式创建入口只接受这个值，其他 language 以 `unsupported_configuration` 局部拒绝，不伪装为已应用。
- `openUrl`、同现场控件 snapshot、点击、显式 focus 后文本输入、按键、滚动、固定观察和截图复用现有 Profile／Instance／ControlLease／operation／receipt 边界。snapshot 只投影有界的标题／段落／status 文本并逐项丢弃凭据特征；既有 input value、Cookie、token 与完整 DOM 不导出。
- Viewer 通过 Harbor owner-only frame/input 路由复用同一 WebSocket、target 和 session；独立 owner Viewer token 只交给 App 主进程，Core 与 Plugin bearer 均不能调用。只读取帧不取得 ControlLease，输入要求当前 user-held lease、`viewer_ref`、绑定画面及 Page/DOM 代际的 `frame_ref` 和幂等 `operation_ref`；文本目标在派发前以当前页面 hit-test 复核。PNG 单帧不超过 2 MiB／4096×4096，不落盘、不进入 Run／Plugin；输入、接管、导航、页面变化或 Driver 丢失使旧帧失效。
- 上层 Agent、App 或 Viewer 断开不关闭底层 WebSocket。底层连接或进程丢失时 Provider context 和全部页面死亡；Runtime 必须使旧 Instance／Page／observation／target ref 失效。
- 恢复路径是停止专用进程、从同 Profile 显式创建新 Instance。已派发但未确认的写入保持 `unknown_outcome`，禁止自动重放。

## 3. Profile 数据和环境

| 材料／事实 | owner | 当前状态 | 证据与限制 |
|---|---|---|---|
| Cookie | Provider 持久化于受管目录 | `supported` | 连接关闭写盘；同一进程重连不重载，必须重启；正式 Harbor 路径跨重启 fixture 已回读 |
| localStorage | Harbor 私有 checkpoint + Provider 内存 | `limited` | 当前 origin 在受管导航、确认交互与正常关闭时全量 checkpoint；下一文档作者脚本前按 origin 精确回灌。站点自行导航、后台异步修改或崩溃前未 checkpoint 仍可能丢失 |
| sessionStorage | Provider 内存 | `unsupported` 持久 | 只属于当前现场 |
| IndexedDB | Provider 未持久 | `unsupported` 持久 | 未测试不等于可用；源码明确无持久实现 |
| profile index | Provider | `limited` | 固定 0 且禁轮换；不是完整 seed 连续性证明 |
| timezone | WebEnvoy 配置、Provider 应用 | `limited` | 进程启动前设置 IANA zone；需继续做完整 configured/effective/drift 回读 |
| proxy | WebEnvoy ref、Provider transport | `limited` | 只注入已解析 endpoint；v0.2.2 render 绕过使该版本拒绝 |
| locale | Provider profile | `limited` | 固定构建只接受并回读原生 `en-US`；不能按 Profile 任意配置 |
| viewport | WebEnvoy、CDP | `limited` | device metrics 可设置；完整 App 体验未验证 |
| fingerprint／seed | Provider | `provider_claim`／`limited` | 不声明不可检测或站点通过率 |

`DO-PROVIDER-PRIVATE-SCHEMA=triggered`：Harbor 新增唯一私有文件 `obscura-local-storage-v1.json`，正式 schema 为 [`obscura-local-storage-v1.schema.json`](../../services/harbor/packages/runtime-api/contracts/obscura-local-storage-v1.schema.json)。只接受 canonical HTTP(S) origin、唯一 origin／key、有界字符串和不超过 4 MiB 的完整文件；损坏、重复、超限或非普通文件使相关 Profile 启动 fail closed，原文件不被空状态覆盖。写入使用同目录 `0600` 临时文件、file fsync、rename 与 directory fsync；空 entries 是权威删除，不读取旧 backup，因此旧值不会在后续正常启动复活。v1 没有迁移来源；未知 schema/version 拒绝，回退到不理解该文件的版本不得宣称 localStorage 连续。

Viewer 的稳定 owner frame response 由 [`viewer-frame-v1.schema.json`](../../services/harbor/packages/runtime-api/contracts/viewer-frame-v1.schema.json) 冻结。它不是 Plugin projection，不新增 Grant 维度；owner 输入 route 使用安装 supervisor 生成并只写入 owner 文件的专用 Viewer credential，同时复用 ControlLease 与 receipt。App 对响应丢失或 `unknown_outcome/dispatched` 保留同一请求，只允许按原 `operation_ref` 查询，不生成新编号重放。`DO-PLUGIN-EXPOSURE`、`DO-GRANT-WIRE`、`DO-NETWORK-CONTRACT`、`DO-CONSOLE-CONTRACT` 不因该 owner-only surface 触发；`DO-APP-IA` 不触发，因为只补既有 Run Instance 接管面板，不新增顶层 IA。

no-release Agent 包可在打包时显式提供固定二进制；打包器先校验上述 commit/hash，再写入 required manifest。安装服务清除继承的 Obscura／Harbor override，只在完整 bundle 校验后设置包内路径。受控 loopback 放行是测试 manifest 的显式布尔值，默认不存在且不是生产配置。

## 4. 证据矩阵

证据等级沿用 `provider_claim`、`fixture_verified`、`live_verified`、`plugin_verified`、`stale`。以下只记录实际完成；未执行为“待证据”，不是 `unsupported`。

### A. 用户选择与长期 Profile

- `live_verified`：owner mutation 显式 `requested_provider_id=obscura` 创建受管 Profile；真实 binding 启动 Obscura，其他 Provider 不受影响。
- `fixture_verified`：不可用的显式 Provider 返回 `requested_provider_unavailable`，`selected_provider_id` 与 `fallback_provider_id` 均为 null。
- `live_verified`：受控站点 HttpOnly Cookie 经正常 stop、专用进程重启后从同 Profile 回读。
- `live_verified`／`limited`：localStorage 更新和删除经受管 checkpoint，在作者脚本前回灌并跨两次正常重开；写盘失败保持旧文件不变，未知 schema 的损坏文件使该 Profile 启动不可用且不被覆盖。IndexedDB 不持久；不能把 Cookie／localStorage 通过冒充为完整登录现场连续性。
- `plugin_verified`：no-release 安装包经正式 MCP/Core/Harbor 路径以 template 显式创建 Obscura，真实绑定回读为 Obscura；固定 `en-US` 成立，其他 locale 保持局部拒绝。
- 待证据：完整 configured/effective/pending/drift、所有关键 seed、用户默认偏好。用户默认尚未实现；本轮未改任何用户默认或旧 Profile。

### B. 隔离与混合使用

- `plugin_verified`：同一隔离安装中三个 Obscura Profile 以三个合成草稿并行运行，snapshot 分别回读且不串用；重复 start 回到同一 `runtime_session_ref`，没有建立第二主 Instance。
- `plugin_verified`：同一安装同时启动本机既有 Camoufox Profile 并完成独立输入回读，证明新增 Obscura 没有替换另一 Provider。
- 待证据：下载／代理隔离和 30 分钟资源样本。未执行这些项目不能推断不适配。

### C. 人工使用、同现场与接管

- `live_verified`：同一 Harbor-held target 上 owner frame、坐标点击、滚动、显式 focus 后中文 `Input.insertText` 与受限公开文本回读成功；既有 input value、Cookie、token 与完整 DOM 不导出。
- `live_verified`／缺口：鼠标点击输入框不产生默认 focus；没有 `Input.imeSetComposition`，合成中文文本不能冒充真实中文 IME。
- `live_verified` 实现路径：`viewer_entry` 为 interactive，App 的既有 Run Instance 面板读取原实例帧并只在 user-held ControlLease 下发送输入；自动化已证明 Agent 输入在人工持有时拒绝、交还后必须重新 snapshot。真实人类画面可用性与 macOS 中文输入法组词仍待集中人工验收，不能用 `Input.insertText` 冒充真人 IME。
- `live_verified`：关闭底层 WebSocket 后 target 列表为空；因此旧帧和引用必须失效。
- `plugin_verified`：MCP client 断开时 Harbor 所持其他现场继续存在；新连接可查询旧 Run。Viewer 面板关闭后的真实 App 行为仍待人工证据。

### D. 网站任务主要能力

- `live_verified`：受控 HTTP 页面导航、受限控件观察、有界公开文本、点击、中文 insertText、滚动、owner frame；semantic text projection 为 `limited`，只覆盖标题／段落／status，input value 仍不开放。
- `provider_claim`／待证据：query／fragment、redirect/history、select/state wait、rich text、frame、Shadow DOM、复杂编辑器、Network／Console、受控执行和 permissions。
- 固定版本明确缺口：popup／dialog 不支持；download no-op；upload 需要同时放开广泛 `--allow-file-access`，当前正式 Driver 不开放。
- `plugin_verified`：正式安装 MCP 路径完成普通文本编辑、受控保存、版本/写入次数及重启回读；这证明通用有副作用任务可成立，不把 Provider 定位成只读。
- 待证据：文件上传仍未开放，因此完整“编辑→上传→保存→回读”未通过。公共 Runtime 或 Driver 缺口归 #497／#511。

### E. 断连、unknown 与恢复

- `live_verified`：底层 WebSocket 断开销毁现场；同进程新连接不会读回刚写 Cookie，正确恢复要求重启专用进程。
- `fixture_verified`：Driver 的空闲断连信号与截图／交互／观察异常都会使旧 Runtime session、ControlLease、Page／observation／target ref 失效；已派发 interaction receipt 保持 `unknown_outcome` 且不重放。
- `plugin_verified`：受控站点第二次保存先持久化版本/写入次数，再在 CDP click 回执前终止 Provider；Run 返回 `unknown_outcome/dispatched`。MCP 重连后只按原 idempotency key 查询，仍为 unknown；再次提交因 connection-bound request hash 冲突而拒绝，站点最终精确为 version 2／writes 2，没有第三次写入。
- 待证据：真实 Viewer 中断；重开页面不会自动改写旧 unknown 的长期人工对账仍待验。

### F. 真实站点与正式安装消费

- `plugin_verified`：隔离 no-release `.app` 内含 hash-verified Obscura，安装服务只使用包内路径；MCP 经 Agent Principal、Grant、template、Run 和 receipt 完成创建、启动、观察、交互、重启、查询及拒绝。验证没有依赖开发 worktree 的运行时路径或 raw CDP。
- 待证据：真实 Codex Agent 自主消费、App 人工入口和已授权真实站点。没有外部账号／写入授权，本轮没有读取或写入真实站点，也没有索取 Cookie／密码。
- 该包仍是隔离 no-release 测试安装，Obscura binary 的签名／发布不合格；不能称为正式发布或用户可信安装。

## 5. 当前采用判断

结论：**继续验证／待证据，不进入正式可安装支持**。

已成立的是：固定 main render build 在 macOS arm64 上可由 Harbor 和隔离安装 Plugin 正式路径显式选择；三个独立 Obscura Profile、一个 Camoufox Profile、同现场 owner Viewer 实现、Cookie／受限 localStorage 重启连续、受控保存与 dispatched unknown 不重放已有实证。核心底线尚未全部成立：真人 Viewer／中文 IME、完整 storage、文件类能力、30 分钟样本、真实 Codex Agent 和真实站点仍缺证据；unsigned/unreleased 分发也是正式可选阻断。

缺口按 owner 分类：

1. WebEnvoy：用户默认偏好、Viewer 人工验收、真实 Agent 消费、完整 Runtime 能力矩阵。
2. Driver：连接丢失后的显式进程重建、更多能力适配、完整环境 readback、上传安全边界。
3. 固定 Obscura：非 checkpoint storage、不支持 popup/dialog/download、click-focus 和 IME、unsigned/unreleased 分发。
4. 网站：尚未进入任何真实站点兼容结论。
5. 证据／授权：真实账号、人工操作、真实写入和正式安装路径均待授权或待环境。

以上继续由 #511 及其关联 FR 承接；不得关闭 #471/#497/#474/#482，也不得重开或改写 #450 的历史采用证据。
