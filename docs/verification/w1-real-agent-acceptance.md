# W1 真实模型安装入口验收记录

日期：2026-09-23。详细现场记录见 [#568 验收评论](https://github.com/WebEnvoy/WebEnvoy/issues/568#issuecomment-5789308764)。

运行候选为 `ac57b7799fb3edd05b90377f7ce016466173a24a` 的 macOS arm64 standalone-runtime 安装包（manifest SHA-256 `326c345fefcb7ddba8e310e842387be2b0302e50faf5020869baaa9e84baf378`；archive SHA-256 `49163ac56f64f1cd39974cd86fa75c555b314907194050a08ff098f464c7daa5`；非 Release）。#579 后续提交 `80ec7760374c8bfb5d7eb14f314a9367146e34af` 只修正 README，没有改变该运行包。

环境为 macOS arm64、`trusted_local` 同 UID 受信宿主（不提供 OS 进程隔离）、Codex CLI `0.155.0-alpha.16`、安装版 `webenvoy-browser` SKILL `0.2.0`、Camoufox Python `0.5.6`／Browser `152.0.4-beta.30`／Playwright `1.60.0`。目标是无账号、无生产效果的本地受控页面。

真实模型读取安装版 SKILL，并通过已安装 MCP 观察页面、输入 `W1 codex verified`、回读 `Received: W1 codex verified`。模型完成后，另一正式入口运行 `webenvoy agent query --run-id` 查询原 Run；Run 与完整结果和 MCP 查询一致，未重放。

**边界：** Codex CLI 是模型宿主；上面的浏览器操作由模型经 MCP 执行。事后 CLI 查询证明可从 CLI 查询同一结果，不能证明模型按 SKILL 直接调用了 WebEnvoy Agent CLI。下面单独记录 CLI 路径。此记录不表示 installed Plugin 已验证、发布了 Release 或完成真人 GUI 验收。

## 真实模型使用 WebEnvoy Agent CLI

首次 CLI-only 会话按安装 SKILL 读取 `webenvoy help agent describe` 时只得到顶层帮助，模型猜测 `--operation profile.create`，被 `unknown_flag` 拒绝并在派发前停止。这个可复现的可发现性缺口由 [PR #580](https://github.com/WebEnvoy/WebEnvoy/pull/580) 修复：帮助现在给出 `--request-file` 语法和最小 JSON 示例；回归测试先失败、修复后通过。正式重试使用该 PR 合并后的 `main def02e0f6644c39db7cec0a705e1c1fdf966ca4b`，合并树与独立审查的 PR HEAD 相同。

新候选从上述 `main` 在 checkout 外构建并完成 `check:standalone` 完整性验证：macOS arm64 standalone-runtime，manifest SHA-256 `84b4227af6efaa6c4b1cf088f4c3524ce326f4e644c70a8fabb76ffeda9b7dc0`，归档 SHA-256 `7e761b0bd5f3eada6925e4302f8d1872d46693c622b2917de8754459cd15623f`，`release:false`。owner 停止旧 Runtime 后由新包 setup/start，安装 Agent host receipt 更新至 `def02e0…`；`agent status` 回报该提交和 `integrity:verified`。宿主仍为 Codex CLI `0.155.0-alpha.16`，SKILL `0.2.0`，Provider／browser 组合与上节相同，诊断为同 UID `trusted_local`，不声称 OS 隔离。

owner 为**新的** `127.0.0.1` 无账号页面建立限时、单 Profile、单 origin、固定 Camoufox 的有限 Grant。模型在不配置 WebEnvoy MCP 的全新会话中，只读安装 SKILL 和 CLI 帮助，自己建立下列 JSON request file 并调用安装包的 `webenvoy agent`。表内 `<bin>`、`<client>`、`<requests>` 分别替代现场安装包、Agent client file 和模型自建 0600 request 目录；命令顺序及请求文件名来自模型命令事件，未附原始含连接元数据的会话日志。

| 模型实际执行的命令 | 已观察结果 |
| --- | --- |
| `<bin> help agent`、`help agent operation`、`help agent query`、`help agent describe` | 均退出 0；describe 帮助显示 `--client-file FILE --request-file FILE` 与 `{"operation":"profile.create"}`。 |
| `<bin> agent connect --client-file <client>` | 发现此次未撤销、仅许可新 origin 的 Grant。 |
| `<bin> agent describe --client-file <client> --request-file <requests>/describe-create.json` | 返回 `profile.create` 的正式输入 schema。 |
| `<bin> agent operation --client-file <client> --request-file <requests>/create.json` | `profile.create` succeeded；Run `managed-8b36de624cecbd5181b5d0485b3e9e94164fe6b62dd84ac6cb53f9e5906692da`。 |
| 同一命令分别提交 `start.json`、`snapshot.json` | `instance.start` 与 `instance.snapshot` succeeded；模型得到原 Instance 的 `Message` 普通文本字段和当前 target。 |
| 同一命令提交 `input.json` | `instance.input` succeeded／`dispatched`，仅输入 `W1 CLI model verified`；原 Run `managed-ed2ecc16a615c572efc3fbed332770d12f96b177dc6c21d2a04b859b88c0c15e`，原 key `w1-cli-model-20260923-060053-input`。 |
| 同一命令提交 `read.json` | `instance.read` succeeded；页面文本为 `No account local page Message Received: W1 CLI model verified`。 |

这六个 request file 均为 0600；各正式操作使用不同 key，输入沿用 snapshot 给出的 `observation:page:1:2:1`／`control:2:1:0`，没有重放旧任务。检查完整模型事件序列，只有上述 SKILL/CLI/自身 request file 的 shell 调用，没有 WebEnvoy MCP tool call，也没有源码、测试、内部数据库或 owner data 读取。原事件 JSONL 的 SHA-256 为 `01b07c52d97a809f702d73f31e053c24c4c903b02298c421687328ce64f79ed5`；本表是其脱敏的可持续回读投影，不把未提交的原日志当作仓库证据。

模型会话结束后，另一正式入口——新包中安装的 MCP `webenvoy_query`——按**原输入 key** 查询 CLI 发起的 Run。独立的 Agent CLI `query --run-id` 也按原 ID 查询；两边返回相同 `run_id`、`succeeded`／`dispatched` 与完整 `result`，规范化结果 SHA-256 `3834254ce0a45599f0ec12d8150268e4a2615497a386e0931f3202bf7def67bf`，均为查询而非再次执行。此前接管、交还、停止、撤权、独立 UID 与重启接续的证据仍见 [#568 既有评论](https://github.com/WebEnvoy/WebEnvoy/issues/568#issuecomment-5789308764)，此次窄补验未重跑它们。
