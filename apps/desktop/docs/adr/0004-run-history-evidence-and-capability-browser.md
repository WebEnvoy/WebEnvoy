# 0004. Run History, Evidence, and Capability Browser

## Status

Draft.

## Context

App 除了 live run，还需要持久用户表面：run history、evidence browsing 和 capability/task package browsing。这些是 App 产品表面，但真相源都在 App 外部：

- Core 拥有 run、admission、result、reconciliation 和 Run Record state。
- Harbor 拥有 runtime viewer/session facts 和 evidence capture mechanics。
- Lode 拥有 capability metadata、package versions、task templates、fixtures 和 catalog organization。

App 必须让用户检查和跳转这些事实，但不能创建第二份真相源。

## Decision

App run history 读取 Core-owned runs，并展示：

- run status、timestamps、inputs summary、result summary、failure category 和 recovery outcome；
- 来自 Lode-facing metadata 的 capability 或 task package identity 与 version；
- 来自 Harbor-facing facts 的 runtime/session references；
- evidence references、thumbnails 和 redacted summaries。

App evidence browser 按 reference 打开 evidence。它可以缓存 UI thumbnail 和非敏感展示 metadata，但不能成为 evidence store。raw screenshots、traces、HAR、video、network bodies、browser storage 和 downloaded files 继续受 owning evidence policy 管理。

App capability browser 读取 Lode-owned catalog metadata，并展示：

- platform assets、personal assets、task templates、versions、install/update/lock status 和 failure markers；
- 从 run 跳转到其使用的 capability version；
- report capability breakage 或创建 repair/exploration draft 的入口。

App 不定义 capability package schema、workflow block schema、fixture format 或 Core execution semantics。App 只决定用户如何浏览和串联 run、evidence 与 catalog facts。

## Consequences

- 用户可以从失败 run 跳到 evidence，再跳到对应 capability，而 App 不拥有这些记录。
- Evidence privacy 继续由 Core/Harbor policy 约束，而不是被 App 便利性绕开。
- 即使 Lode package schema 尚未最终稳定，capability catalog UI 也可以先消费 Lode-provided metadata，并清楚标记 unknown field。
- App 需要为 evidence 和 catalog item 提供 empty、unavailable、redacted、permission-denied 状态。

## Alternatives Considered

- 在 App 中存储 normalized Run Records 以加速 history：拒绝，因为 Core 是 run truth source。
- 把 evidence artifacts 复制到 App-local storage：拒绝，因为 evidence 可能包含敏感页面内容，必须受显式 policy 管理。
- 在 App 中定义 Lode capability schema 来 unblock catalog UI：拒绝，因为 App 应消费 capability metadata，而不是拥有 package contract。
- 现在就构建 visual workflow builder：拒绝，因为 research 支持先收敛 package schema 和 execution boundary。

## Research Evidence

- <https://github.com/WebEnvoy/research/blob/main/synthesis.md> 指出 capability/workflow asset 需要 schema 与 versioning，同时 Run Record/evidence 是公共边界。
- <https://github.com/WebEnvoy/research/blob/main/absorability/themes/evidence-and-observability.md> 支持最小 Run Record 方向，并拒绝默认捕获敏感 screenshot、HAR、trace、video 或 raw network body。
- <https://github.com/WebEnvoy/research/blob/main/absorability/themes/api-cli-mcp-and-agent-interface.md> 支持小型确定性接口和 reference-over-value evidence output。
- <https://github.com/WebEnvoy/research/blob/main/absorability/themes/workflow-and-task-package.md> 支持 Lode package 方向，包括 input/output schema、steps、verification checks 和 expected outcomes，并延后复杂 visual builder。

## Open Questions

- [PD-0012](pending-decisions.md#pd-0012)：App 第一版应展示哪些 evidence reference types：screenshots、console/network summaries、trace、HAR、video、downloads、result refs。
- [PD-0013](pending-decisions.md#pd-0013)：哪些 evidence type 可以默认展示 thumbnail，哪些需要用户显式打开。
- [PD-0014](pending-decisions.md#pd-0014)：App 应如何展示已存在但被 redacted 或 expired 的 evidence。
- [PD-0015](pending-decisions.md#pd-0015)：哪些 Lode catalog fields 已稳定到足以支持 App filtering 和 search。
- [PD-0016](pending-decisions.md#pd-0016)：Run history 是否应支持 App local-only retention settings，还是只反映 Core retention policy。
