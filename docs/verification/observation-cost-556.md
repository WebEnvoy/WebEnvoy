# #556 有界观察成本调查

归口：[#556](https://github.com/WebEnvoy/WebEnvoy/issues/556)，owning FR [#497](https://github.com/WebEnvoy/WebEnvoy/issues/497)。仅调查既有观察与续读，不实施优化，不发布。

## 执行前冻结（2026-09-24）

- 运行候选：main `5bfb19347ea1dd4079d4d9524686deedc5f2d872`，tree `f4b90d5e7a099abf2411902692efe306847b542a`。即使 #475/#555 后续改变 main，本记录仍只适用于该候选。
- 正式入口：本候选构建的 standalone-runtime CLI，`--version` integrity=verified。manifest SHA-256 `08efc54ebab512940c990151d93e03f73375a9312465de7c56fc3c7b8fbf6911`；archive SHA-256 `bde4bd5393a4a17e3cdd806cdb48253e5a4b6b9effdd8f214397e5f1b3e4ea43`；release=false。构建未包含可选 Lode 资产，本调查不消费站点 SKILL。
- 机器：Mac16,10，arm64，10 logical CPUs，16 GiB RAM；macOS 27.0 / 26A428，Node 24.14.0，pnpm 10.30.3。同机其他应用负载未隔离，不把微小差异当作可靠收益。
- Provider：只运行重新通过正式来源核验的 Camoufox 0.5.6 / browser 152.0.4-beta.30 / Playwright 1.60.0。Chrome 固定 153.0.8010.37 材料缺失；本机 Info.plist 仍为 153.0.8010.53，不启动或采用它；Chrome 测量为 not_evaluated。
- 材料：仅 loopback 静态、无账号、无外部资源的受控表单；普通 32 / 128 / 160 控件，另一个 800 控件长元数据压力页。页面生成规则和摘要随测量脚本固定，不把样本规模当作容量承诺。
- 普通样本：每规模三次首次 snapshot，按实际新启动/已启动状态标记；自然产生 cursor 时续读到末段，随后对已返回的普通 textbox 做一次正常 input。32/128 在 limit=128 时无续读，记不适用；160 应为 128+32。压力页一次，成功时最多 16 段，失败即停止该路径。
- 诊断：另行有界运行相同共享生产方法，只记录阶段、公开 Provider 调用和 CPU，不修改供应方文件或方法、不改变产品 wire/权限/完整性/timeout。诊断样本与正式安装端到端样本分开，不将仪器开销当基线。
- 统计口径：采集、末次/续读整批复核、响应投影及 target freshness 是顶层阶段；其中 DOM 语义、公开 accessibility、对象相等性与句柄释放是嵌套子阶段，inclusive 值不能再次相加。Provider 公共 API 调用单独计数，不冒称协议消息或网络 round-trip。只有直接观测到的序列化/客户端解析时间才归因传输；独立 CLI 与诊断的差值保持未归因。
- 预算：普通每规模最多三次正式样本；诊断每规模最多三次、压力一次；最多两个专属无账号 Profile，浏览器串行；每个 live 层最多 15 分钟。正式 operation 仍为原 60 秒边界；客户端等待上限只负责取得原操作结果，不延长产品 timeout。
- 退出条件：来源漂移、Profile 隔离不明、非预期失败、timeout/unknown、预算耗尽即停止受影响样本扩展，保留尝试，不换 key/Provider 重放动作。只允许查询原 Run、停止专属实例和清理本次服务。压力页失败不抹去普通样本。测量前检查其他 Camoufox/专属 Runtime 进程，避免与 #475 同时占用浏览器资源。

## 合同与边界

沿用 [Observation Targets V1](../specs/observation-targets-v1.md)、[#540/#554 证据](observation-targets-540.json)及 [W3 材料限制](browser-environment-quality-570.md)。原对象身份、语义和 enabled 复核、同批 cursor、固定资源预算、脱敏、Core 授权、ControlLease、unknown/no-replay 均保持。

Design Obligation：`DO-PLUGIN-EXPOSURE / DO-GRANT-WIRE / DO-NETWORK-CONTRACT / DO-CONSOLE-CONTRACT / DO-PROVIDER-PRIVATE-SCHEMA / DO-APP-IA = not-triggered`；仅添加 repo-local 测量与证据，不改变稳定合同或产品实现。若选择 B，后续实施须重新判断，不由本调查豁免。

正式安装客户端、诊断直接方法、真实第三方 Agent、真实站点是不同证据；本项不声称 plugin_verified、真实账号可用或完整 V1 完成。
