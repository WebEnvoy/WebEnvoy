# #584 固定站点任务安装验收

本证据绑定 [Work Item #584](https://github.com/WebEnvoy/WebEnvoy/issues/584) 的一个受控只读任务，不表示 #475/#476 完成，也不是 Release 或完整 installed Plugin checkpoint。

## 候选与环境

- 运行代码：`0c9e82f4e23adec8a3e42876a3a993a1a18b8707`，从干净独立 checkout 构建无 Electron standalone 包。
- Lode 分发提交：`608ebfa425fbdeb4e651cb438d1e97c2618f2bc8`（[Lode #323](https://github.com/WebEnvoy/Lode/pull/323)）；任务 pin、完整包 digest、archive/manifest 摘要和执行摘要见 [JSON 证据](site-skill-task-584.json)。
- macOS arm64、Node 24.14.0；正式 Camoufox browser `152.0.4-beta.30`、Python package `0.5.6`、Playwright `1.60.0`。
- `trusted_local`，独立安装父目录、owner/Agent 数据目录和新建测试 Profile；页面为本机 `http://127.0.0.1:4173/catalog`，无账号及第三方数据。
- 消费者是安装后的 `webenvoy agent task` CLI，由验收脚本调用；真实 Provider=true，真实模型 Agent=false，`plugin_verified=false`，正常任务路径模型调用数=0。

## 实际结果

安装后的 owner CLI 配置有限 Grant，Agent CLI 发现完整任务 pin、安装并显式启用。固定任务实际读取页面，并依据固定 Lode 声明检查 Page 身份、完整 snapshot、输出 schema 和业务 post-check，返回 `succeeded` 及原生 Result Envelope。

未安装、禁用、pin 失配、额外输入、陈旧目标、撤销后查询分别返回 JSON 中记录的准确代码。只读 snapshot 保持 `not_dispatched`。一次成功读取不被解释为真实外部写入验证。

丢失响应用丢弃提交 CLI 的 stdout 模拟；随后只用原 key 查询同一 Run，没有重提。停止并重启 Runtime 后，原 Run 和完整结果逐字段相同。对已完成 Run 的 stop 返回同一 Run，不回滚结果。owner 接管期间提交被 `control_lock_conflict` 拒绝，owner inspect 仍为 `control_owner=user`；未夺回控制。正常验收和清理均通过。

## 验证入口与证据边界

真实安装入口为 [standalone-site-task-check.mjs](../../apps/desktop/scripts/standalone-site-task-check.mjs)。先从固定提交运行现有 `build-standalone.mjs`、`package-standalone.mjs`，再把新解包的 standalone 路径传给该脚本。每次使用新的安装父目录；既有安装绑定不被覆盖。

首个运行候选 `470621f` 的打包入口漏装配 task service，真实安装提交返回 `managed_task_unavailable`；已在上述候选修复。验收脚本随后核对准确拒绝代码，不能把入口不可用冒充准入拒绝通过。通过轮的脚本 hash 单独固定在 JSON 中。

Core 自动检查使用真实固定 Lode 字节及受控 snapshot stub，覆盖包生命周期、原 Run 与原子终态持久化、当前授权、业务结果反例、取消/超时与迟到结果。它们不代替真实 Provider 证据；安装闭环也不代替真实 unknown 写入或执行包内脚本的隔离验收。

集成运行 `WEBENVOY_LODE_ROOT=<固定 Lode checkout> pnpm --filter @webenvoy/core-runtime test` 通过既有 self-check 及全部 12 个 test（无跳过），包括新增五个任务场景。此前工作区 build/typecheck/lint、Schema/API/CLI 检查和当前运行候选的 required checks、standalone/no-release 打包 CI 均通过；最终待合并提交仍须获得自己的 required checks 与补审。

后续仅测试、证据或验收脚本断言变化时，可通过相对该候选的运行文件 diff 复用本次昂贵验证；运行逻辑或包 pin 变化必须重新判断影响。main 的最终提交及 required checks、exact-head 独立 review 由 PR/Git ref/Checks 记录，不在本证据滚动复制动态状态。
