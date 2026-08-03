# Core–Harbor–Lode 离线只读竖切

该检查启动相互独立的本地 Core API 进程和 Harbor owner-shaped fixture 子进程，不访问真实账号、生产页面、浏览器、credential、cookie、token、profile storage、raw DOM、HAR 或 screenshot，也不执行外部写入。

## 可重跑命令

使用 Harbor 和 Lode 的精确 commit object 或 clean checkout：

```bash
WEBENVOY_HARBOR_ROOT=/path/to/Harbor-containing-bcfc1b9 \
WEBENVOY_LODE_ROOT=/path/to/Lode-at-6238d3f9 \
WEBENVOY_LODE_REGISTRY_PATH=/path/to/Lode-at-6238d3f9/registry/local-packages.json \
pnpm --filter @webenvoy/api-server test
```

Lode 输入会使用 clean checkout，或从精确 Git object 创建临时只读 archive。Harbor fixture 启动前会从 `bcfc1b9` Git object 校验 Runtime API route、测试和 smoke locator 的 SHA-256 与合同 marker。任一精确输入不可取得或不匹配时，检查输出 `structured_unavailable`，不生成伪造的通过 provenance。

## 固定 provenance

| Owner | Commit |
| --- | --- |
| Core 合同基线 | `a8325687abf01833a4b477f39f66cca4c9979ce1` |
| Harbor | `bcfc1b902c3fb8c2fd691c805a2ada1ddae51181` |
| Lode | `6238d3f9de0cd09157c9769e27d90174c299406a` |

运行输出为 `webenvoy.offline-readonly-vertical-slice-provenance.v0`。其中 Core commit 从当前测试 checkout 的 `HEAD` 读取，合同基线单独记录；Harbor 记录 exact Git object、source locator SHA 和 fixture contract digest；Lode 记录精确 pin、registry、declaration 与八项 asset SHA。

四态及保护路径：success、structured unavailable、failure attribution、明确 unsupported 的 bounded rollback。回滚输出包含 canonical unsupported、legacy GET、成功 read operation、release 和 idle/none cleanup readback 的有序 trace 与 transition diff；canonical network/5xx/session_missing/malformed 均 fail closed，不能回退到 legacy。
