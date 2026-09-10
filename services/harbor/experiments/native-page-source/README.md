# #504 原生页面关联：采用条件与因果证据

当前结论是 **C：根因已在固定 Juggler 生命周期层得到证据，但 F3 尚未满足采用条件，仍不采用**。F3 只在隔离副本中完成过一次 B popup 移到新窗口后的连续性观察；移回、移到已有窗口、三轮连续移交以及移交中断线没有通过或没有可执行证据。#504 保持未完成，#507 保持 draft；本目录仍是本地评估实验，不是正式 Provider、安装入口或稳定产品合同。

本轮实现隔离局部修复，并记录实验版本、根因、采用门槛和维护影响。固定组合为 Camoufox Python 0.5.6、browser 152.0.4-beta.30、Playwright 1.60.0。正式 Python/App/Plugin 消费、原安装替换、分发和产品合同不在本轮交付范围。

## 版本和证据分离

| 标识 | 实验对象 | 关键完整性/版本事实 | 结论 |
| --- | --- | --- | --- |
| U | `/Applications/Camoufox.app` 固定安装基线 | source `omni.ja` SHA-256 为 `bed61930f353ef21011487c4c0fc84e64103b00617b5f8dd0538fb261d0732a5` | 用于复现失联；不是修复候选 |
| R | `/tmp/webenvoy-native-prototype-504/adoption/r-trace/` | prototype jar `4f0c3eb55c9f5c378baeeeb4faa685cd1ba60f7ad42fb43eddf4fb2b499487e6`；manifest 的 `diagnostic_trace.version=adoption-trace-1`、`lifecycle_fix=false`；没有 adoption patch | 只读因果追踪版本；不能与 F3 的通过/失败混写 |
| F2 | `.local-artifacts/f2/` | prototype jar `a3ec7a1c75a94247e62187155b27fa2c5f7705f6f4bde83fbaae11212c70dad8`；启用 `native-swap-1` adoption patch | 第一版局部生命周期修复候选 |
| F3 | `.local-artifacts/f3/` | **与 F2 使用同一个 jar SHA-256 `a3ec7a1c75a94247e62187155b27fa2c5f7705f6f4bde83fbaae11212c70dad8`**；Juggler 三个改动文件、patch source 和 adoption patch 相同；仅 bundle/Info.plist 身份分离；manifest 没有 diagnostic trace 字段，详细 trace 关闭 | 当前最终候选；结论仍为 C，不得写成 A |
| 旧 v1/v2/v3/v4 | `/tmp/webenvoy-native-prototype-504/v*/` 与旧 private probe | 旧快照/旧 UI 矩阵；例如旧 v3 jar `0971dd2b…`、v4 jar `b076a8…` | 历史迭代，不能替代 F3 adoption 证据 |

所有修改版 manifest 都保留 `original_signature_not_valid_for_modified_resources=true` 和 `distribution_or_production_use_authorized=false`。F2/F3 只用于隔离实验。`chrome.css` 是实验 UI 条件，不能作为产品级生命周期修复。

## 最小快照接口

本实验的私有快照版本为 `webenvoy-native-snapshot/prototype-1`，具体版本由 manifest 与补丁源码 SHA 锁定。它只用于验证 Provider 内部的原生关联，不是公共 Agent schema。字段边界如下：

- `epoch`：当前私有 BrowserHandler 连接的代次；重启或重连后旧绑定不能延续。
- `sampleSequence`、`observedAt`：本次同步查询的序号和采样时间；序号不是状态变更 revision，也不声称记录每次用户操作。
- `pages`：Provider target、原生窗口和原生 tab 的私有身份对应。
- `windows`：每个窗口当前选中的 target，或 `out_of_scope`；`browserWindowActive` 独立表达，可为 unknown。

查询同步执行，不 `await`，直接读取当前 `gBrowser.selectedTab`，不缓存 selected，不依赖标题、URL、顺序、页面标记或人工操作历史。原生 window/tab 对象使用连接内 WeakMap 身份；对象已销毁、连接已断开或无法完整关联时拒绝查询。超过 256 个 page 或 64 个 window 时明确拒绝，不截断后伪称完整。

BrowserHandler 只返回当前私有连接可附着的 target；窗口选中了其他 context 时，不暴露该 target，并返回 `out_of_scope`。这是 Provider 私有 context 过滤，不等于 Core Grant 或 origin 授权；本原型没有新增公共 Agent 能力。

## Driver、系统前台与控制权

`probe.mjs` 在同一 Playwright Node 进程中读取私有 FFBrowser pipe，通过 `_ffPages[targetId]._page` 与实际 client Page 的对象身份建立实验绑定。它不打开新的调试端口、不提供任意浏览器执行接口、不依赖网页注入；F3 的 Node 探针成功也不能被当作正式 Python Driver 已支持该能力。

浏览器内部 `Services.focus.activeWindow` **不等于可靠的 OS 前台事实**，尤其在无头模式。可选的 `process-state.mm` 只是独立测试参照：通过现有 macOS AppKit/libproc 查询本进程启动的子进程活动/隐藏状态，验证父进程及启动身份，不读取 AX 树或其他应用内容，也不申请权限。身份缺失、变化或观测前后不一致时，OS 前台投影为 unknown，不能把 selected 变成猜测值，也不让 selected 一起失效。该组件未承诺正式安装交付。

探针把真实浏览器接入既有 `RuntimeSessionStore` 的内存测试实例，由 user 持有控制权；每次查询前后比较 owner、lock、控制代次和 in-flight 计数，证明只读调用没有改变实际控制记录，但不构成 App 接管/交还或正式 Plugin 集成验收。

快照只表示采样当时，不能用旧快照授权之后的输入。探针要求当前连接、递增序号、完整 Page 对应和有界往返时长；错误不回退到旧值。正式动作前的 Core/Harbor 代次复核仍属于后续采用工作。

## 可复现运行入口

以下命令只适用于已经具备固定 Provider、Python venv、Node 24 和 Xcode 工具链的当前 Mac；不安装第三方依赖。副本只允许新建在 `/tmp/webenvoy-native-prototype-504` 或本实验目录的 `.local-artifacts` 下；专用 Profile、options 和 evidence 留在 `/tmp/webenvoy-native-prototype-504`，不能提交。

1. 在 monorepo 中运行 `pnpm --dir services/harbor build`。
2. 构建无 adoption 的快照副本：`python3 services/harbor/experiments/native-page-source/build-prototype.py '/tmp/webenvoy-native-prototype-504/<variant>/WebEnvoy Native Prototype.app'`；目的地必须不存在。构建局部生命周期修复候选时，在同一命令后加 `--adoption`。
3. 构建只读因果追踪副本：`python3 services/harbor/experiments/native-page-source/build-trace.py '/tmp/webenvoy-native-prototype-504/r-trace/WebEnvoy Native Prototype.app'`。该脚本基于未修复快照增加有界 trace，不启用 adoption patch；它会额外校验固定 `PageHandler.js` pin。
4. 用固定 venv 的 Python 运行 `prepare-options.py <副本 executable> <本轮 Profile 路径> <新 options.json>`；可在末尾加 `--headless`。它复用现有 Driver 的环境生成、校验和重放，只截获启动参数，不启动浏览器；options 文件是私有材料。
5. 可选地编译独立前台参照：`xcrun clang++ -bundle -undefined dynamic_lookup -fobjc-arc -I <Node24/include/node> -framework Foundation -framework AppKit process-state.mm -o /tmp/webenvoy-native-prototype-504/process-state.node`。
6. `probe.mjs` 已永久停用并在浏览器派发前拒绝；不再运行 live 探针或 `--baseline`，历史调用记录只作离线核对。开页、切页、重排、移窗和关闭测试不在本轮执行。
7. 运行 `node native-snapshot.test.mjs`，检查只读 selected、对象失效、scope 过滤、代次、边界及缺失/复用进程身份；运行 `node adoption.test.mjs`，将固定源码的实际补丁方法载入 VM 检验 swap 和引用失效；这是离线组件检查，不是原生 live。

历史探针只打开本轮 loopback 合成页；正文 A/B 是独立验收参照，不进入识别逻辑，`inspect` 也不用于任意真实页面。原生截图、对象绑定、环境参数和私有日志留在临时实验目录；GitHub 只回写脱敏结论及摘要。现有现场不重开，必要材料保留供核对。

## 已确认的因果链

### U/R 的失联

U 与 R 都复现了原生标签移到新窗口后 Provider Page 失联，并且都在有界等待后拒绝映射：

- U：`adoption-u.jsonl.summary.jsonl` 记录 inventory 中 B 变为 `null`，最终为 `association_unavailable_after_10000ms:provider_page_not_ready`。
- R：`adoption-r.jsonl.summary.jsonl` 记录 inventory 中 B 变为 `null`，最终为 `association_unavailable_after_10000ms:native_page_unmapped`。
- 两者都没有回退到 A、重新导航、重开页面或猜测同名同址页面。

固定 Provider 的 `TargetRegistry.js` 给出直接根因：`onTabCloseListener` 通过 `tab.linkedBrowser` 查找 target 后立即调用 `target.dispose()`；`PageTarget.dispose()` 从 `_browserToTarget` 与 `_browserIdToTarget` 删除 browser/browserId 映射并发出 `TargetDestroyed`。现有窗口监听只有 `TabOpen`/`TabClose`，没有完整的原生 reparent/adoption 事件。`PageTarget` 同时缓存旧的 `_window`、`_gBrowser`、`_tab` 与 `_linkedBrowser`。因此移交若先表现为旧窗口 TabClose，target、actor/channel 和 Playwright Page 的关联会被拆掉；R 的 Node 探针随后能看到新 target 已在 `browser._ffPages` 中但尚未初始化，`context.pages()` 没有对应的 client Page，`waitForAssociation` 最终以 `native_page_unmapped` 拒绝映射。这里记录的是 Node 实验客户端的实际行为，不是正式 Python Driver 的结果。

可核对的位置是 `/tmp/webenvoy-native-prototype-504/adoption-source/chrome/juggler/content/TargetRegistry.js`：监听和 dispose 约在 162–193、235–256、442–497、1058–1077 行；actor 通过 `browserId` 绑定约在 409–439 行。`BrowserHandler.js` 只把 `TargetCreated/TargetDestroyed` 转成 `Browser.attachedToTarget/detachedFromTarget`，约在 96–119 行。该证据说明的是当前生命周期缺口，不代表所有 Firefox 原生移动操作的事件顺序已经穷举。

R 的 `adoption-r.jsonl` 保存完整有界事件顺序；关键 provider sequence 如下。下列数字是同一次连接内的诊断对象标识，不进入关联算法。

| sequence | 实际事件与关系 |
| --- | --- |
| 40 | 新 placeholder target 对应 browser19/window20/tab21，context15/document29，尚无 actor。 |
| 41–42 | 源 B browser17/window2/tab18 承载 context10737418241/document10737418246/actor16；TabClose.adoptedBy 指向 browser19 的 tab，原实现仍 dispose B target，删除 target 索引。 |
| 43–44 | 两端 SwapDocShells **交换前**：browser17 仍承载原 B context/document/actor16，但 target 与 indexedTarget 已为空；browser19 仍承载 placeholder。 |
| 45–46 | EndSwapDocShells 后，browser19 承载原 B context/document/actor16；其 browser→target 仍指向 placeholder，browserId→target 已为空。browser17 承载 placeholder context15，browserId 索引却仍指向 browser19 的 target。 |
| 47–50 | 创建 context15/document29 的 placeholder actor22，错误设置给仍绑定 browser19 的 placeholder target；随后 actor22 被销毁并移除。原 B actor16 没有重新绑定到正确 target。 |

此后 Node 新 target 仍未初始化，inventory ref 为 null，10 秒到期为 `native_page_unmapped`。这不是根据 `context.pages()` 缺 B 单独推定网页已死亡；原 document/actor 的存活与原生移交另有上述事实。

### F2/F3 局部修复的边界

单次 `wait-association` 固定为 10 秒测试上限；先订阅真实 attach/ready/page 变化再查询，不使用固定 sleep，也不伪造 initialized。超时、追踪超限/不完整或移交关系未确认时明确不可用。

F2/F3 的 `TargetRegistry.js` 补丁增加 `SwapDocShells`/`EndSwapDocShells` 观察，在已经确认两个 browser 对象及其 BrowsingContext 互换时更新 target 的 tab/window 引用，并重新设置 `_browserToTarget`。原 browser.webProgress 监听必须在 swap 前解绑，防止交换后误解绑到另一个 document；browserId→target 与活 actor/channel 跟随原内容，dispose 使用注册时的 browserId 并校验映射所有权。TabClose 只有在原生事件明确带 `adoptedBy` 时才暂缓 dispose。补丁保留连接内 target/actor，不按标题、URL、tab 顺序或最近创建时间猜测页面，也不主动重建页面或导航。

这解释了 F3 唯一成功的 transfer 样本，但补丁只覆盖已观察到的 native swap 路径；它没有证明所有 TabClose/reparent 路径都有 adoption 事件，也没有把 formal Playwright/Python transport 扩展为公共能力。移交中若出现缺失、顺序不一致或对象已销毁，仍必须拒绝关联。

## F3 实际证据

`adoption-f3.jsonl.summary.jsonl` 的第 4 条是本轮唯一完成的跨窗连续性样本：

- `continuity=preserved`、`sameClientPage=true`、`sameRuntimeSession=true`、`sameTarget=true`；旧观察被拒绝。
- B 的输入 `F3-retained-input`、`scrollY=240`、`historyLength=3`、`historyState.step=2`、同名同址与 `persistentMarker` 保留。
- 原生观察显示 A 在 window-1、B 在 window-2，B 为该窗口 selected 且当时 OS foreground 为 true。

同一 F3 运行还证明了若干隔离/失效事实，但它们不等于跨窗 adoption 已完成：

- seq8 有 A/B/C 三个 Page；seq9 对 C 的原生 Move to Start 完成标签重排，Page 映射未变；这是重排通过，不能写成跨窗移动通过。
- seq10 关闭非选中的 C 后 A/B 仍可观察；seq11 新建同名同址 D 得到新的 `page-4`，没有复用已关闭的 `page-3`；seq12 每个窗口的 selected 独立；seq13 关闭 selected D 后回到 A。B 的状态 inspect 仍完整。
- F3 stop 正常退出（exit 0），旧 query 被拒绝并完成 cleanup；P2 的 F3 headless session 共完成 4 次 snapshot，其中 P1 stop/pipe 断开后的读取也正常，证明实验实例之间没有共享该 pipe 的错误关联。
- F3 restart 用同一专用 Profile、同一端口 `50117` 读回 `F3-retained-input`；新连接取得新 epoch。`adoption-environment-result.json` 只证明 `privateEnvironmentBundleHashUnchanged=true` 和 `exactLaunchOptionsUnchanged=true`。它不证明日常 Profile 的自动 metadata 未变化。
- 真正断开 P1 pipe 后旧 query 被拒绝、cleanup 为 0；CUA 重开后两次 `timeoutReached`，所以“移交中途断线”没有形成可计通过的样本。

F3 原生 UI 记录 `f3-native-ui.jsonl` 第 2 条显示 `Move Tab` 及其子项均为 disabled。F3 副本的 `Contents/Resources/chrome.css` 第 22–33 行设置 `#TabsToolbar` 的 `-moz-window-dragging: drag`、tab 继承该行为并将 `.tab-content` 设为 `pointer-events: none`。因此移回、已有窗口、源窗口最后标签移出和三轮真实 tab move 在当前 UI 条件下不能被视为通过；不能用该 CSS 规避生命周期问题。

固定 source 的 UI 入口也只支持有限结论：`tabbrowser.js` 约 10603–10610 行在仅有一个 visible tab 时禁用整个 Move Tab；`browser.xhtml` 约 494–507 行只列出 start/end/new 等目标，没有已有窗口目的地；`replaceTabWithWindow` 约 6837–6840 行对单 tab 直接 return。故当前 fixture 的入口是不可达或不完整，不能把它写成 transfer 已失败的完整矩阵，也不能据此推断所有 Firefox 原生路径永远不可达。

本轮一次 UI 助手错误启动了原版空白默认窗口，随后已停止。原版安装资源 hash 未改变；该事件不是 F3 证据。日常 Profile 的自动 metadata 未核对，本 README 对“日常 Profile 不变”不作断言。

### 误启动防护（2026-09-11）

仓内没有 `skyUI`、按应用名查找或自动启动原版浏览器的产品入口；该次误启动来源是主会话 `node_repl` 中的历史闭包 `adoptionEvidence`、`adoptionEvidenceFor`、`f3MoveToNewWindow`、`f3Tile`、`adoptionSky`，不属于本仓库的可执行入口。主会话已清除这些闭包和 `sky` 引用，并以拒绝函数替换旧 helper。

本实验入口也已在 `probe.mjs` 的浏览器派发前永久拒绝。`ui-launch-guard.mjs` 只接受用于核对的已登记目标事实：运行状态、PID/启动身份、隔离可执行文件、隔离 Profile 和实验 manifest；缺失、退出、身份不符、原版路径、非测试 Profile 或 manifest 不匹配均拒绝。即使全部匹配，暂停中的 UI 自动化仍拒绝，且入口不接收 launcher callback，不能派发进程。

离线断言：`node services/harbor/experiments/native-page-source/ui-launch-guard.test.mjs`。该检查只构造内存事实，不访问日常 Profile、不扫描进程、不启动浏览器；覆盖上述拒绝条件并断言启动派发次数为 `0`。既有 `f3-native-ui.jsonl` 与 `adoption-ui.jsonl` 只作历史调用记录核对，不能证明日常 Profile 未受影响。

## 构建器和归档审计

当前三条候选 entry 与 F3 逐字节一致，其余归档 entry 与原安装一致。F3 旧 manifest 没有 `source_checkout` 或 `builder` 字段，不能回写或冒称为新版构建；当前新版只改变 metadata，patch 输出已与 F3 对齐。构建器的负向检查也保持有效：source mismatch 在 copy 前拒绝，snapshot-4/adoption-14/trace-2 anchor 不匹配时拒绝，Trace PageHandler pin 不符合固定基础 builder 时在构建前拒绝。

本轮适用 Harbor 检查为 313 pass、1 skip、0 fail；它只证明当前代码/实验检查的结果，不替代下述原生 adoption 矩阵，也不把 F3 变成正式产品交付。

## 正式 Python 路径的只读核对

F3 的 Node 探针是在同一 Playwright 进程中读取私有 `FFBrowser`/`_ffPages[targetId]._page`，再用 Page 对象身份建立实验绑定。这不是正式 Python Driver 已支持的路径。

当前正式源代码的事实如下：

- `services/harbor/packages/runtime-api/src/camoufox-driver.py` 的模块说明和 `send()`（约 1–6、116–119 行）是有界 JSONL bridge，只输出 page facts/readiness，不输出 DOM、storage、cookies、network body 或 Playwright endpoint。
- Python 以 `id(page)` 关联内存中的 Playwright Page，在约 926–974 行生成私有 `provider_page_ref`；约 937–949 行只输出 URL/title/status、`provider_page_ref`、`document_generation`、`active` 和 opener 私有 ref。native `targetId/windowId/tabId`、actor 或 selected 事实没有字段和读取入口。
- `set_active_provider_page()`（约 1018–1029 行）只有在 `bring_to_front()` 成功后才发布 active；它不能把 DOM focus 当作原生 selected 证据。launch（约 1322–1340 行）注册 `CONTEXT.pages`，context page handler 只登记新 Page。
- Python allowlist（约 2280–2324 行）没有 `webenvoyNativeSnapshot` 或 adoption 查询操作。
- TypeScript `camoufox-driver.ts`（约 65–201 行）只负责 Python 子进程 JSONL 的 request/response、行大小和超时；约 484–537 行解析 page/pages 与版本。`runtime-session-types.ts` 的 `LocalProviderPageState`（约 201–229 行）只有 `provider_page_ref`、opener ref、active、document generation 等 Provider Page 状态，没有 native target/window/tab 字段。

所以新增私有事实若要成为正式能力，真实链路必须完整经过：

`Juggler TargetRegistry/actor → protocol → Playwright Firefox client Page → Python Page state → JSONL → TypeScript parser → Harbor/Core`

当前 F3 只验证了隔离 Node 探针的一段，不包含正式 Python/App/Plugin 接入。未来若需正式消费者，仍应保持 Provider 私有事实边界，对外只投影稳定、opaque 的 Page 语义；不得把 target/actor/browser 对象或 raw protocol 句柄暴露给 Agent。

## 采用条件

F3 只有在以下条件全部满足后，才可进入独立正式采用评审；当前任何一项未满足都应保持 unavailable/unknown，而不是猜测或回退：

1. **事件因果闭环。** 在固定版本上记录并核对新窗口、已有窗口、移回、源窗口最后标签、重排、popup、关闭和后台标签的真实 TabOpen/TabClose/SwapDocShells/actor 就绪顺序。证明 reparent 时同一网页现场保留同一 Runtime/Instance/Profile、输入、适用 history 与 environment；不靠 reload、重开或替代页面恢复。
2. **target/actor 关联闭环。** adoption 前后不得出现旧 target 被错误 dispose、重复 target、孤立 actor、错误 opener、Page.ready 缺失或 Browser detached 后无对应 Page。必须更新缓存的 window/gBrowser/tab/linkedBrowser 与 browser/browserId 映射，并对 actor-before-target、target-before-actor、部分 swap、重复/乱序事件 fail closed。
3. **真实原生矩阵。** 有头环境通过同名同址 A/B、selected 切换、重排、popup、关闭、独立窗口、移出/移回/已有窗口、源窗口最后标签移出、双 Profile、后台只读不抢焦点；关键“移出 → 恢复 → 移回 → 恢复”至少连续三轮。Move Tab 不能因实验 CSS disabled 而跳过。
4. **状态与引用证明。** 每次成功 transfer 都取得可用 client Page，并准确对应原生 tab；页数、输入、滚动、适用 history、opener 和 selected/window/OS foreground 三类事实分别核对。旧观察、旧 epoch、旧 document generation、断线、stop、缺页、超时和中途异常必须拒绝且不回放；不能按同名同址、顺序或最近创建页面复用 ref。
5. **正式消费路径。** 若产品要求 Python/Core/Plugin 使用 native 事实，必须补齐并审查上面的正式 transport 链路、版本/协议 schema、超时/断线/未知状态和 opaque Page 投影；Node 私有 probe 的成功不能代替正式 Driver 或 Plugin 验收。
6. **可复现完整性。** 记录 exact head、source/prototype/patch/adoption hash、manifest、适用 CI 和独立原型审查；核对修改版签名/安装/回滚路径和 Provider 版本升级后的重新验证。CI 不能替代真实原生矩阵。

## 维护影响和边界

若未来批准采用，Harbor/Provider 维护方需承担固定 Camoufox/Juggler 源码补丁、TargetRegistry/actor 生命周期、Playwright coupling、私有协议兼容、构建/完整性/签名/安装消费、失效诊断、回滚和每次源版本更新后的完整矩阵。上游不默认承担这部分维护。

F3 的 adoption patch 是局部实验修复，不是 Gecko/C++、DOM、进程安全、权限、Provider 版本或 Playwright 正式修改；不增加调试端口、任意脚本接口、forceScopeAccess、system principal、扩展或常驻服务。正式化时也必须维持这些边界，并继续区分 Provider existence、exposure、authorization、execution、native selected 和 OS foreground。

原始 U/R 失败证据、F2/F3 Profile、恢复前副本、manifest 和 summary 应保留用于复核。所有本轮浏览器、Driver 和 loopback 服务已停止；最终 matrix、exact head/tree、独立审查与 CI 的交付状态只在 #504/#507 回读维护。

## 原设计义务继续有效

本轮增量不覆盖、也不清除 #504 已触发的原设计义务。现阶段没有新增正式 Agent 工具、持久授权字段、App surface 或公共 Network/Console 合同，因此本轮增量的 `DO-PLUGIN-EXPOSURE`、`DO-GRANT-WIRE`、`DO-APP-IA`、`DO-NETWORK-CONTRACT`、`DO-CONSOLE-CONTRACT` 均保持 not-triggered；这是增量判断，不代表 #504 原有义务已完成。

`DO-PROVIDER-PRIVATE-SCHEMA` 保持 conditional：当前消息、补丁、manifest 和 snapshot 只服务本地实验；一旦正式 Driver、Plugin 或持久 Provider 配置依赖这些字段，必须先固定版本、兼容、迁移、失效和安全边界的正式合同，不得把实验 schema 直接上线。

继续遵守既有产品不变量：同一 Account/Profile/Instance/Runtime 的状态连续性、原生可信关联、opaque public Page ref、document generation 与 stale ref 拒绝、ControlLease/owner 不变、unknown/no replay/no silent Provider switch，以及 Network/Console/Plugin 的权限和脱敏合同。此次 F3 只证明一次隔离 transfer 样本，不能关闭 #504、合并 #507、替换原安装或声称产品目标已经交付。
