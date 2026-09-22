# macOS arm64 standalone Runtime candidate

`@webenvoy/app` 提供独立的 macOS arm64 候选打包路径。它使用构建机当前的 Node 24 可执行文件作为固定 Runtime，输出目录内包含 `runtime/node`、`bin/webenvoy`、Agent 入口、Core/Harbor 构建产物和 `agent-manifest.json`；锁定的 Lode 资产存在时一并带入，缺失时按可选资产记录为 unavailable；包内不包含 Electron `.app` 或 Electron 可执行文件。

在 macOS arm64、Node `24.14.0`、pnpm `10.30.3` 的干净 checkout 中运行：

```sh
pnpm --filter @webenvoy/app package:standalone /tmp/webenvoy-standalone-macos-arm64
pnpm --filter @webenvoy/app check:standalone /tmp/webenvoy-standalone-macos-arm64
```

打包命令同时生成 `/tmp/webenvoy-standalone-macos-arm64.tar.gz` 和对应的 `.sha256` 文件。`agent-manifest.json` 记录 `platform`、`arch`、Node 精确版本、`runtime/node` 的 SHA-256、Core/Harbor workspace tree 和 Lode provenance。启动时 `bundle.mjs` 会校验当前进程确实是该固定 Node、平台为 Darwin arm64，并逐项校验受管资产；校验失败会停止。

正式入口是：

```sh
/tmp/webenvoy-standalone-macos-arm64/bin/webenvoy setup --data-dir /path/to/data --host-dir /path/to/host
```

入口按自身目录解析固定 Node，不读取 PATH，也不需要 checkout、`node_modules`、Electron 或 Desktop App。`data-dir` 与包目录必须分离。当前候选是本地可审阅构建，`release: false`；不表示 GitHub Release、签名、真实 Provider、真实账号或第三方 Agent 验收已经完成。
