# Core #344 历史导入记录

本次 topology-only 迁移在 `408853bfe53da14326c0dc334646f76397e6ad7b`
（tree `2bd6a60796b5a61c55c80c0792fa0e889d38fded`）之后使用原生
`git subtree add --no-squash`，按 App、Harbor 各生成一个中文 Conventional
merge commit。目标 head 为 `b47ea4ef3ff17f72a4eef11906e0165c30de4a91`。

| 来源 default ref | 目标前缀 | source tip / tree | import merge / second parent | DAG / 文件 / bytes | 许可证 |
| --- | --- | --- | --- | ---: | --- |
| `WebEnvoy/App:origin/main` | `apps/desktop` | `d417eb3b…` / `7405c3db…` | `078f8834…` / `d417eb39…` | 137 / 204 / 7,721,922 | AGPL-3.0-only |
| `WebEnvoy/Harbor:origin/main` | `services/harbor` | `bcfc1b90…` / `95a4a09f…` | `b47ea4ef…` / `bcfc1b90…` | 160 / 104 / 1,331,065 | AGPL-3.0-only |

完整机器可读字段见同目录的 `core-344-history-import.json`。每个 source
default-branch reachable DAG 的 SHA 保持不变，并从对应 import merge 的第二父提交
可达；各 prefix tree 与 source tip tree 相同。branch-only refs 只记录数量，交给
后续 GitHub mapping，不进入 product tree（App local/remote non-default 69/19，
Harbor 113/47；两仓均无 tag）。

App 的 tracked images、prototype samples 与 packaged-smoke previews 统一标为
`design_or_local_fixture`，不是 Harbor runtime evidence；它们仍属于 App 的设计/本地
fixture 资产。迁移未带入 credential、cookie、token、profile、raw DOM、HAR 或生产
payload。Harbor 仍是
Runtime/敏感运行事实 owner；Core、Harbor、App 保持独立进程和 owner API。没有
submodule、Lode history、Lode package/site strategy 或行为、依赖、lock、workflow
改动。

验证：两个 prefix 的 `git ls-tree` 与 source tree diff clean，source tip 与全部
default DAG ancestor/readback、`git cat-file`、文件数/字节数、`git fsck --full`、
`git diff --check`、submodule/Lode guard 均通过；源仓导入前后 status 不变。对
`apps/desktop/<path>` 执行 `git log --follow` 在 subtree merge boundary 上可能为空，
因为该选项不跨 merge parent/path prefix；普通 `git log -- apps/desktop` 可见
import merge，但原始历史仍以 second parent 与 source SHA 映射为准。未运行 build，
由 #345 负责。失败时优先对两个 import merge 使用可恢复的 `git revert -m 1`；专用未
合并迁移分支也可回到记录的 target base，源仓不变、不删除、不归档。
