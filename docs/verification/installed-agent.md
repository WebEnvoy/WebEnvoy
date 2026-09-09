# 安装后的单宿主 Agent 入口

本切片由 [Work Item #490](https://github.com/WebEnvoy/WebEnvoy/issues/490) 承载；当前证据、验收和后继范围以该 Issue/PR 为准。支持当前验证的 macOS、Codex MCP 和已有 Camoufox。测试包不签名、不发布，不代表完整发行或多宿主支持。

## 安装和显式授权

在仓库根构建一个新的独立测试位置：

```sh
pnpm --filter @webenvoy/app package:agent '/tmp/webenvoy-test/WebEnvoy Test.app'
'/tmp/webenvoy-test/WebEnvoy Test.app/Contents/MacOS/webenvoy' setup \
  --data-dir /tmp/webenvoy-test-data --host-dir /tmp/webenvoy-test-host \
  --codex-profile webenvoy-test --approve-tools
```

`setup` 写入独立的 Codex 命名 profile，不改已有 `config.toml`。重名且内容不同时拒绝；相同安装可重复执行。`--approve-tools` 是用户对这个测试配置中五个 WebEnvoy 工具的显式宿主批准，不替代 Core Grant。省略它时按宿主自己的批准机制处理。只输出客户端凭据的 SHA-256 指纹，原始凭据留在 host-dir 的私有文件中。

双击这个 App（或运行 `webenvoy app`），进入设置 → Agent 接入：登记名称与公开指纹，允许已授权的环境管理操作，再选择 Agent 并授予页面展示的管理范围。该范围只创建最多两个非生产 Camoufox Profile，限定 `https://example.com`；不包含已有 Profile、绑定账号或内容写入。Core 的管理执行策略只作用于 `harbor:managed-browser`，不会修改网站策略。

在 host-dir 运行 `codex -p webenvoy-test`。先调用 `webenvoy_skill` 读取实际安装的版本化 SKILL，再调用 `webenvoy_status`、`webenvoy_connect`。连接返回同一 Principal 的 Grant、模板和已创建 Profile，宿主无需读取 owner 文件、内部端口或复制凭据。之后使用 `webenvoy_operation` 与 `webenvoy_query`。

## 生命周期和数据

`webenvoy start` / `diagnose` / `app` / `stop` 自动读取这个安装包关联的数据目录。Agent MCP 调用也能冷启动 Runtime。独立进程复用 Desktop 的 Core/Harbor 启动实现，通过私有 Unix socket 发现；Core/Harbor 服务必须由该进程实际启动并宣告 ready，端口占用拒绝连接。

App 只持有 owner 连接。完整退出 App 不停止独立 Runtime 或 Profile Instance；再次打开连接同一 Runtime。`stop` 是 owner 命令，显式停止 Runtime 和其子进程。重启后 Profile、Grant、Run 保留，旧 Instance 不再被报告为运行。运行进程退出或版本不匹配时先诊断，再显式停止/重启并重新打开 App；不会自动替换 Provider。

安装资产、host 接入口和长期 data-dir 分离。移除测试配置或测试安装包不删除 data-dir。升级本切片时使用新安装位置、先停止旧 Runtime，再将新安装关联到原 data-dir；不覆盖旧接入口，不自动迁移 Profile。首次完整发行、自动升级和账号生命周期由 #475/#477/#469 的剩余范围承接。

## 操作边界与恢复

`instance.navigate` / `instance.read` 需要精确 `runtime_session_ref`，在该实例原 PAGE 内导航和读取至多 4096 字符的可见正文；不执行网站 SKILL、任意脚本、CDP、表单编辑或上传。导航通过原 PAGE 的请求拦截禁用重定向跟随（所有 3xx 拒绝），允许响应仍在同页渲染；持续 guard 阻止脚本跨 origin 顶层跳转，正式人工接管后释放。另一个 Profile 不受影响。账号依赖站点/已绑定身份 origin 在这个公开读取入口明确拒绝。

每次操作仍取 Principal Grant、Profile ceiling、task scope、origin 和 ControlLease 的交集。人工在 App 的真实 Instance 面板接管、交还后，Agent 先观察同一实例再继续。撤销只停止后续动作，不回滚已发生结果。响应丢失时重新连接，使用原 `idempotency_key` 查询；不得改 key 重发未知动作。

MCP 每次调用校验实际安装文件、管理 SKILL、Runtime/Harbor 及 Electron 可执行文件 hash。`status` 返回实际加载版本、完整性和 Lode provenance。必需资产缺失、损坏或不匹配时恢复原安装后重连；可选网站资产不可用不阻止管理和基础浏览器。测试安装依赖已有 Provider，不带安装软件或匿名降级逻辑。

辅助检查：`pnpm --filter @webenvoy/app check:installed-agent '/tmp/webenvoy-test/WebEnvoy Test.app'`。它验证真实打包进程、资产拒绝与恢复、owner 隔离、端口占用、重连查询和停止，但不替代 Issue 中真实 Codex 与 App 点击的现场验收。
