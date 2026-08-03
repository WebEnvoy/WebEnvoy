# Core–Harbor–Lode 离线只读竖切

该检查只启动本地 Core API 进程和 Harbor owner-shaped fixture，不访问真实账号、生产页面、浏览器、credential、cookie、token、profile storage、raw DOM、HAR 或 screenshot，也不执行外部写入。

## 可重跑命令

使用 Lode 的 clean checkout 或精确 commit archive：

```bash
WEBENVOY_LODE_ROOT=/path/to/Lode-at-6238d3f9 \
WEBENVOY_LODE_REGISTRY_PATH=/path/to/Lode-at-6238d3f9/registry/local-packages.json \
pnpm --filter @webenvoy/api-server test
```

没有配置 Lode checkout 时，测试会尝试从相邻 Lode Git object 创建临时、只读的精确 archive；若无法取得 pin，则输出 `structured_unavailable` provenance 并退出，不降级到未 pin 的 package body。

## 固定 provenance

| Owner | Commit |
| --- | --- |
| Core | `a8325687abf01833a4b477f39f66cca4c9979ce1` |
| Harbor | `bcfc1b902c3fb8c2fd691c805a2ada1ddae51181` |
| Lode | `6238d3f9de0cd09157c9769e27d90174c299406a` |

运行输出为 `webenvoy.offline-readonly-vertical-slice-provenance.v0`，包含 registry、`lode://site-capability/xiaohongshu/search-notes@0.1.0`、`registry/search-runtime-consumption.json`、八项精确 asset SHA、四个 run id 和回放状态。

四态及保护路径：success、structured unavailable、failure attribution、明确 unsupported 的 bounded rollback；canonical network/5xx/session_missing/malformed 均 fail closed，不能回退到 legacy。
