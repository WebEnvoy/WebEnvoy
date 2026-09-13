# Runtime Continuity V1 verification

状态：2026-09-14，#526 的确定性、正式安装、固定原版与真实 Agent 验证已完成。
本记录只证明列出的 macOS arm64 / Camoufox 组合与受控无账号页面；不外推真实账号、
任意站点、其他 Provider/平台、真人体验或完整 Runtime。

本记录覆盖官方 public Playwright async Driver 的 Runtime 连续性边界。所有
Playwright 对象由同一个 owning asyncio event loop 使用；stdin reader 只在
`asyncio.to_thread` 中读取字节，普通 Provider 操作仍由一个 consumer 串行派发，
owner `close` 走独立 lifecycle consumer。

## 已验证边界

- 普通 JSONL 输入有界：一个在途命令加 63 个缓冲项，总数不超过 64；队列满时按
  原请求 ID 拒绝，reader 仍可接收 close/EOF。
- 页面事件持续处理：正式 click 返回后 10 秒无 MCP/browser read、snapshot、wait、
  diagnostics 或保活命令，页面的 1 秒 timer、同源 work response、DOM 更新和
  completion 回执仍在窗口内各完成一次。
- close/EOF 可独立生效：close 不排在普通业务队列尾部；EOF 先建立关闭屏障，再用
  public `BrowserContext.close()` 收敛已派发调用。未派发请求保持 `not_dispatched`。
- 结果分类保持因果：确定性的 `wait_condition_timeout` 是 `failed + dispatched`；
  接管/停止改变控制代次的已派发等待是 `unknown_outcome + dispatched`。原 key query
  只返回原 Run，不重放。
- owner 控制建立新派发屏障：在强 T0（Driver receipt 已显示 wait dispatched，且原生
  页面工作在同一 wait pending 时完成）后，撤权约 205 ms 生效并使新操作
  `grant_unavailable/not_dispatched`；接管约 3 ms 生效并使新输入
  `control_lock_conflict/not_dispatched`；stop 约 97 ms 关闭目标 Instance，后续操作
  `session_missing/not_dispatched`。这些是观测值，不是新增 SLA。
- 人工接管路径由已存在的原生 UI 自动化验证：helper 绑定确切 PID、固定原版 executable、
  本任务 Profile 路径、窗口标题与 URL；10 秒内没有 Driver 命令，页面仍完成。该证据
  是 native UI automation，不冒充真人。人工持有时 Agent 输入拒绝；交还后旧 target
  拒绝，fresh observe 可继续同一 Page。
- P1 控制未污染 P2：同一安装中的独立 P2 在最终候选上完成普通 `instance.input`、
  `observe`、`read` 和值回读。
- 文件路径受影响回归通过：标准 PNG 上传与普通 GET CSV 下载各一次；服务器 hash 分别为
  `0a64b890…` 与 `c66edb8…`。Runtime stop/start 后原两个 Run 仍可 query，下载材料可由
  owner inspect/export，两次 export 都是 15 bytes、`c66edb8…`，服务器计数仍为 1/1。
- 下载取消保持隔离：deadline/quota/owner close 使用 public `Download.cancel()`；不把
  asyncio task cancellation 当作浏览器动作取消。必要时 public Context close 建立
  `driver_closing` fence，直到 task-owned cleanup 收敛。
- close 失败保持隔离：public Context/Playwright stop 的原错误进入 sticky lifecycle
  state；未收敛资源不释放 ephemeral Profile，也不被新操作复用。

## 正式安装与真实 Agent

安装候选来自 commit `7f842a56ef12438b822be52bda3720104ba1a0a9`、tree
`91f598908af31fc5f15cf935e4f27525269923f4`，asset digest
`d37b5fd3d2e2bd8b1da64c4c702529fdc023f28124796ce112d0136417c38b42`。固定原版为
Camoufox Python 0.5.6、browser 152.0.4-beta.30、Playwright 1.60.0；未修改浏览器、
Juggler、Playwright/site-packages 或私有协议。

真实 Codex task `01a09cc1-3197-73d1-bc47-0820614ba6c4` 使用宿主接受并回读的
`gpt-6-astra/low`。第一段从 installed Plugin fresh snapshot 取得 target，click 一次后
立即停止浏览器命令；独立 fixture 在随后静默窗口内记录 work/completion 各一次。续接段
connect 后只 query 原 click key、fresh observe 和 read，读到 `completion-recorded`，
同一 session/Page 且没有重放。三次无浏览器派发的续接配置失败（未带 MCP server、未带
tool approval、未先 connect）保留为 invalid test-setup evidence，不计产品失败或额外消费任务。

## 可重复确定性检查

关键实现与测试位于：

- `services/harbor/packages/runtime-api/src/camoufox-upstream-driver.py`
- `services/harbor/packages/runtime-api/src/camoufox-upstream-driver.ts`
- `services/harbor/packages/runtime-api/src/camoufox-upstream-driver.test.ts`
- `services/harbor/packages/runtime-api/src/runtime-session.ts`
- `services/harbor/packages/runtime-api/src/control-interaction.test.ts`
- `services/harbor/packages/runtime-api/src/managed-interaction.test.ts`
- `packages/core/src/managed-browser.ts`
- `packages/core/src/managed-browser-self-check.ts`

`python3 -m py_compile`、Harbor build/full test（346 pass、1 Windows-only skip）、Core
build/test（5/5）、Desktop build/typecheck、packaged no-release、workspace CI、Lode pins
与 host attestation 均通过。重点定向集为 Driver 20/20、control 12/12、managed
interaction 10/10；覆盖 bounded queue、close/EOF、control generation、排队旧输入拒绝、
响应丢失、迟到结果与不重放。

脱敏机器摘要见 `docs/verification/runtime-continuity-v1.json`。原始非临时任务证据保存在
`artifacts/browser-runtime-526-live-20260914`；无效样本与首个反例一并保留，未提交
Profile、凭据、正文或安装大包。
