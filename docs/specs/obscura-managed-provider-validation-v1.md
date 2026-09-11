# Obscura Managed Provider Validation V1

状态：有界验证基线；版本：1.0；日期：2026-09-11；owner：Harbor。产品归口：[#511](https://github.com/WebEnvoy/WebEnvoy/issues/511)，父项 [#471](https://github.com/WebEnvoy/WebEnvoy/issues/471)；相关完整能力 [#497](https://github.com/WebEnvoy/WebEnvoy/issues/497)、Plugin 消费 [#474](https://github.com/WebEnvoy/WebEnvoy/issues/474)、V1 验收 [#482](https://github.com/WebEnvoy/WebEnvoy/issues/482)。产品依据：canonical v1.2；架构依据：[ADR 0013](../adr/0013-provider-choice-and-obscura-validation.md)。

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
- `openUrl`、同现场控件 snapshot、点击、显式 focus 后文本输入、按键、滚动、固定观察和截图复用现有 Profile／Instance／ControlLease／operation／receipt 边界；通用页面文本和既有 input value 因无法可靠区分任意命名的凭据而保持不导出。
- 上层 Agent、App 或 Viewer 断开不关闭底层 WebSocket。底层连接或进程丢失时 Provider context 和全部页面死亡；Runtime 必须使旧 Instance／Page／observation／target ref 失效。
- 恢复路径是停止专用进程、从同 Profile 显式创建新 Instance。已派发但未确认的写入保持 `unknown_outcome`，禁止自动重放。

## 3. Profile 数据和环境

| 材料／事实 | owner | 当前状态 | 证据与限制 |
|---|---|---|---|
| Cookie | Provider 持久化于受管目录 | `supported` | 连接关闭写盘；同一进程重连不重载，必须重启；正式 Harbor 路径跨重启 fixture 已回读 |
| localStorage | Provider 内存 | `limited` | 进程退出后丢失；WebEnvoy 尚无保存回灌合同 |
| sessionStorage | Provider 内存 | `unsupported` 持久 | 只属于当前现场 |
| IndexedDB | Provider 未持久 | `unsupported` 持久 | 未测试不等于可用；源码明确无持久实现 |
| profile index | Provider | `limited` | 固定 0 且禁轮换；不是完整 seed 连续性证明 |
| timezone | WebEnvoy 配置、Provider 应用 | `limited` | 进程启动前设置 IANA zone；需继续做完整 configured/effective/drift 回读 |
| proxy | WebEnvoy ref、Provider transport | `limited` | 只注入已解析 endpoint；v0.2.2 render 绕过使该版本拒绝 |
| locale | Provider profile | `observed-only` | 当前不能按 Profile 任意配置 |
| viewport | WebEnvoy、CDP | `limited` | device metrics 可设置；完整 App 体验未验证 |
| fingerprint／seed | Provider | `provider_claim`／`limited` | 不声明不可检测或站点通过率 |

本轮不新增 Provider-private bundle，所以 `DO-PROVIDER-PRIVATE-SCHEMA=not-triggered`。若后续保存回灌 storage、文件或 seed，必须先转为 triggered 并建立 versioned contract。

## 4. 证据矩阵

证据等级沿用 `provider_claim`、`fixture_verified`、`live_verified`、`plugin_verified`、`stale`。以下只记录实际完成；未执行为“待证据”，不是 `unsupported`。

### A. 用户选择与长期 Profile

- `live_verified`：owner mutation 显式 `requested_provider_id=obscura` 创建受管 Profile；真实 binding 启动 Obscura，其他 Provider 不受影响。
- `fixture_verified`：不可用的显式 Provider 返回 `requested_provider_unavailable`，`selected_provider_id` 与 `fallback_provider_id` 均为 null。
- `live_verified`：受控站点 HttpOnly Cookie 经正常 stop、专用进程重启后从同 Profile 回读。
- `live_verified`／限制：localStorage 与 IndexedDB 不持久；不能把 Cookie 通过冒充为完整登录现场连续性。
- 待证据：第二次重启、完整 configured/effective/pending/drift、所有关键 seed、用户默认偏好。用户默认尚未实现；本轮未改任何用户默认或旧 Profile。

### B. 隔离与混合使用

- `fixture_verified`：现有 Runtime Profile 锁继续拒绝同 Profile 第二主 Instance；Provider 绑定匹配检查保留。
- 待证据：三个 Obscura Profile 并行、下载／代理范围、与当前可运行另一 Provider 并存、30 分钟资源样本。未执行这些项目不能推断不适配。

### C. 人工使用、同现场与接管

- `live_verified`：同一 Harbor-held target 上截图、滚动、点击按钮、显式 focus 后中文 `Input.insertText` 成功；snapshot 只返回受限控件元数据，不导出通用页面文本或既有 input value。
- `live_verified`／缺口：鼠标点击输入框不产生默认 focus；没有 `Input.imeSetComposition`，合成中文文本不能冒充真实中文 IME。
- `unsupported` 当前产品路径：`viewer_entry` 保持 unsupported；尚无正式 App 原现场画面、人工 ControlLease 接管／交还。截图能力不冒充 Viewer 或人机共用通过。
- `live_verified`：关闭底层 WebSocket 后 target 列表为空；因此旧帧和引用必须失效。上层断连保持连接的 App／Plugin 实测待证据。

### D. 网站任务主要能力

- `live_verified`：受控 HTTP 页面导航、受限控件观察、点击、中文 insertText、滚动、截图；通用 semantic text/value projection 记为 `limited`，待正式敏感内容分类 owner 后再开放。
- `provider_claim`／待证据：query／fragment、redirect/history、select/state wait、rich text、frame、Shadow DOM、复杂编辑器、Network／Console、受控执行和 permissions。
- 固定版本明确缺口：popup／dialog 不支持；download no-op；upload 需要同时放开广泛 `--allow-file-access`，当前正式 Driver 不开放。
- 待证据：正式“编辑→上传→保存→回读”。公共 Runtime 或 Driver 缺口归 #497／#511，不据此把 Obscura 定位成只读。

### E. 断连、unknown 与恢复

- `live_verified`：底层 WebSocket 断开销毁现场；同进程新连接不会读回刚写 Cookie，正确恢复要求重启专用进程。
- `fixture_verified`：Driver 的空闲断连信号与截图／交互／观察异常都会使旧 Runtime session、ControlLease、Page／observation／target ref 失效；已派发 interaction receipt 保持 `unknown_outcome` 且不重放。
- 待证据：正式路径分别注入 Agent、Viewer、底层连接、进程中断，以及“提交已生效、响应前中断”的计数对账；在完成前不能宣称恢复底线全部成立。

### F. 真实站点与正式安装消费

- `fixture_verified`：Desktop owner Grant 入口要求明确选择 template Provider；Plugin 仍只能使用获准 template ref，不能改 Provider。
- 待证据：当前正式安装 Plugin 的真实第三方 Agent、人工入口和已授权真实站点。没有外部账号／写入授权，本轮没有读取或写入真实站点，也没有索取 Cookie／密码。
- 当前 binary 位于隔离源码 checkout，且签名／安装不合格；因此不能把开发路径称为最终安装消费。

## 5. 当前采用判断

结论：**继续验证／待证据，不进入正式可安装支持**。

已成立的是：固定 main render build 在 macOS arm64 上可由 Harbor 正式 owner 路径显式选择并管理一个专用 Profile／进程／底层连接；基本观察、截图、受控输入、Cookie 重启持久和不静默 fallback 有实证。核心底线尚未全部成立：完整 storage 连续性、人类 Viewer／接管、底层中断后的正式 unknown 对账、三 Profile 隔离、30 分钟样本、真实已安装 Plugin 均缺证据；unsigned/unreleased 分发也是正式可选阻断。

缺口按 owner 分类：

1. WebEnvoy：用户默认偏好、正式 Viewer、已安装 Plugin 消费、完整 Runtime 能力矩阵。
2. Driver：连接丢失后的显式进程重建、更多能力适配、环境 readback、上传安全边界。
3. 固定 Obscura：非 Cookie storage、不支持 popup/dialog/download、click-focus 和 IME、unsigned/unreleased 分发。
4. 网站：尚未进入任何真实站点兼容结论。
5. 证据／授权：真实账号、人工操作、真实写入和正式安装路径均待授权或待环境。

以上继续由 #511 及其关联 FR 承接；不得关闭 #471/#497/#474/#482，也不得重开或改写 #450 的历史采用证据。
