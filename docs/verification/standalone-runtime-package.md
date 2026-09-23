# macOS arm64 standalone Runtime candidate

`@webenvoy/app` 提供独立的 macOS arm64 候选打包路径。它使用构建机当前的 Node 24 可执行文件作为固定 Runtime，输出目录内包含 `runtime/node`、`bin/webenvoy`、Agent 入口、Core/Harbor 构建产物和 `agent-manifest.json`；锁定的 Lode 资产存在时一并带入，缺失时按可选资产记录为 unavailable；包内不包含 Electron `.app` 或 Electron 可执行文件。

在 macOS arm64、Node `24.14.0`、pnpm `10.30.3` 的干净 checkout 中运行：

```sh
pnpm --filter @webenvoy/app package:standalone /tmp/webenvoy-standalone-macos-arm64
pnpm --filter @webenvoy/app check:standalone /tmp/webenvoy-standalone-macos-arm64
```

打包命令同时生成 `/tmp/webenvoy-standalone-macos-arm64.tar.gz` 和对应的 `.sha256` 文件。`agent-manifest.json` 记录 `platform`、`arch`、Node 精确版本、`runtime/node` 的 SHA-256、Core/Harbor workspace tree 和 Lode provenance。启动时 `bundle.mjs` 会校验当前进程确实是该固定 Node、平台为 Darwin arm64，并逐项校验受管资产；校验失败会停止。

owner 使用安装包入口记录独立 Agent UID，并启动 Runtime：

```sh
/tmp/webenvoy-standalone-macos-arm64/bin/webenvoy setup --data-dir /path/to/owner-data --agent-uid AGENT_UID
/tmp/webenvoy-standalone-macos-arm64/bin/webenvoy start --data-dir /path/to/owner-data
```

Agent 在自己的普通非管理员 UID 下创建 host 资产，使用 owner 提供的公开配置；随后 owner 按 CLI 帮助注册其凭据指纹并发放有限 Grant：

```sh
/tmp/webenvoy-standalone-macos-arm64/bin/webenvoy agent setup --host-dir /path/to/agent-host --data-dir /path/to/owner-data --owner-uid OWNER_UID
```

入口按自身目录解析固定 Node，不读取 PATH，也不需要 checkout、`node_modules`、Electron 或 Desktop App。owner data、Agent host 与包目录必须分离；同 UID 或无法核实隔离时不得启用 Agent data plane。完整命令合同见 [S1](../specs/cli-integration-v1.md)。

`Standalone Runtime candidate` workflow 从准确候选 SHA 和锁定 Lode 构建，上传带 source SHA／manifest SHA 的归档及 SHA-256 文件；候选 artifact 的保留期为 7 天。workflow 中的双 UID 检查使用 CI 已有 nobody 账户，覆盖有限 `profile.list`、原 Run 查询、重启和文件权限边界；它不执行浏览器任务，也不代表真实第三方 Agent 消费。实际结果以对应 SHA 的 Actions run 为准。

候选保持 `release: false`；可获取的 CI artifact 不表示 GitHub Release、签名、真实 Provider、真实账号或第三方 Agent 验收已经完成。
