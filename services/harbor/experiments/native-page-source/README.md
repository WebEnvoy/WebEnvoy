# #504 原生页面关联：隔离原型

这是用户授权的本地评估代码，**不是正式 Provider、安装入口或稳定产品合同**。状态与采用决定只维护在 [#504](https://github.com/WebEnvoy/WebEnvoy/issues/504)，#507 保持 draft。不得把本目录接入正式构建、替换原安装或分发修改版浏览器。

## 范围与来源

固定基线为 Camoufox Python 0.5.6、Playwright 1.60.0、browser 152.0.4-beta.30。构建器校验原包 Juggler Protocol、BrowserHandler、TargetRegistry 的源码哈希；仅在新建的 `/tmp/webenvoy-native-prototype-504` 子目录复制应用。产品可执行文件、内核、页面焦点/可见性设置和依赖版本均不修改。

副本只修改 `Protocol.js` 与 `BrowserHandler.js`，增加无参数私有方法 `Browser.webenvoyNativeSnapshot`。另修改副本显示名/bundle ID，复制同字节公开 `properties.json` 到既有 Driver 需要的相邻位置。原型资源已不同于原签名覆盖的资源，不能描述成原版签名已验证产物。外置 `prototype-manifest.json` 记录原包/修改后归档、补丁源码、逐项修改、Info.plist 与相邻 schema 的 SHA-256，并标记禁止生产使用/分发。

## 最小接口

私有快照版本为 `webenvoy-native-snapshot/prototype-1`，以 manifest 与补丁源码 SHA 锁定本次具体修订。包含：

- `epoch`：此私有 BrowserHandler 连接代次；重启/重连后旧绑定不能延续。
- `sampleSequence`、`observedAt`：该次同步查询的序号、采样时间。序号不是状态变更 revision，不宣称记录每次用户操作。
- `pages`：Provider target、原生窗口、原生 tab 对象的私有身份对应。
- `windows`：每窗口当前选中的 target，或 `out_of_scope`；独立的 `browserWindowActive` 可为 unknown。

同步查询不 `await`，直接读取当前 `gBrowser.selectedTab`，不缓存 selected，不依赖标题、URL、顺序、页面标记或人工操作历史。原生对象使用连接内 WeakMap 身份；已销毁、已断开或无法关联的对象拒绝查询。超过 256 页或 64 窗口明确拒绝，不截断后伪称完整。

BrowserHandler 只返回当前私有连接可附着的 targets；窗口选中了其他 context 时，不暴露其 target，返回 `out_of_scope`。这是 Provider 私有 context 过滤，不等于 Core Grant/origin 授权；本原型不新增公共 Agent 能力。

## Driver、系统前台与控制权

`probe.mjs` 使用当前安装的 Playwright 进程内接口，从同一 FFBrowser 私有 pipe 查询，通过 `_ffPages[targetId]._page` 与实际 client Page 的对象身份建立对应。没有新调试端口、任意浏览器执行接口、依赖补丁或网页注入。当前正式 Python Driver 尚无此消费路径；此实验不能被当作它已支持新能力。

浏览器内部 `Services.focus.activeWindow` **不等于可靠的 OS 前台事实**，尤其无头模式。可选 `process-state.mm` 只是独立测试参照：通过现有 macOS AppKit/libproc 查询本进程所启动子进程的活动/隐藏状态，验证父进程及启动身份，不读取 AX 树或其他应用内容，不申请权限。身份缺失、变化或观测前后不一致时，系统前台投影为 unknown，不能使 selected 变成猜测值或让它一起失效。此测试组件未承诺正式安装交付。

探针把真实浏览器接入既有 `RuntimeSessionStore` 的内存测试实例，由 user 持有控制权；每次查询前后比较 owner、lock、控制代次和 in-flight 计数。它证明本次只读调用没有改变实际控制记录，但不是 App 接管/交还或正式 Plugin 集成验收。

快照只表示采样当时；不能用旧快照授权之后的输入。Driver 要求当前连接、递增序号、完整 Page 对应和有界往返时长，错误不回退到旧值。正式动作前的 Core/Harbor 代次复核仍属于后续采用工作，本轮不实现。

## 运行

仅限已具备固定 Provider、Python venv、Node 24 和 Xcode 工具链的当前 Mac。无安装第三方依赖步骤。

1. 在 monorepo 中运行 `pnpm --dir services/harbor build`。
2. 运行 `python3 services/harbor/experiments/native-page-source/build-prototype.py '/tmp/webenvoy-native-prototype-504/new-build/WebEnvoy Native Prototype.app'`；目的地必须不存在。
3. 用固定 venv 的 Python 运行 `prepare-options.py <副本 executable> <本轮 Profile 路径> <新 options.json>`；可加 `--headless`。它复用现有 Driver 的环境生成、校验和重放，只截获启动参数，不启动浏览器；选项文件是私有材料，不能提交。
4. 可用 `xcrun clang++ -bundle -undefined dynamic_lookup -fobjc-arc -I <Node24/include/node> -framework Foundation -framework AppKit process-state.mm -o /tmp/webenvoy-native-prototype-504/process-state.node` 编译独立参照。
5. 运行 `node probe.mjs <options.json> <私有 evidence.jsonl> [process-state.node]`，保持 stdin 打开。仅支持固定 `snapshot`、合成页面 `inspect`、`invalid-query`、`disconnect`、`stop` 命令。开页/切页/重排/移窗/关闭测试使用浏览器原生交互；不要把 Agent activate 充当人工动作。
6. `node native-snapshot.test.mjs` 检查只读、对象失效、scope 过滤、代次、边界及缺失/复用进程身份。

探针仅打开本轮 loopback 合成页；正文 A/B 是独立验收参照，不进入识别逻辑。`inspect` 不用于任意真实页面。原生截图、对象绑定、环境参数和私有日志留在临时实验目录；GitHub 只回写脱敏结论及摘要。停止时断开/关闭所属浏览器和本地服务，保留 Profile、恢复前副本和证据。

## 当前限制与维护责任

原型不修复既有 target/actor 生命周期。已观察到“把现存标签移到新窗口”后原生页面可见，但 Playwright 未提供可用 Page；此时准确拒绝映射。它不是修复后仍可用的承诺，也不允许通过重新导航或猜另一个页面绕过。

若后续批准采用，WebEnvoy Harbor/Provider 维护方需承担固定源码补丁、依赖兼容、完整性/签名/安装消费、失效诊断以及源版本变化时的重新验证；不能把责任默认转交给上游。正式 Python Driver 接入和跨窗 adoption 生命周期问题都必须有明确方案、独立审查及真实验收，不能仅凭本原型通过部分样本就完成 #504。
