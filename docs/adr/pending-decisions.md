# ADR 待决策索引

本文件是仓库内唯一待决策索引。ADR 正文中的未决项和已接受 ADR 的非阻塞后续项都必须链接到这里。

## PD-0001

- 问题：公共合同模式定义应留在 AGPL Core 仓库，还是拆到宽松许可证 `contracts` 或 SDK 仓库。
- 来源 ADR：[0001](0001-record-architecture-decisions.md)、[0002](0002-run-task-capability-model.md)
- 阻塞什么：公共合同产物抽取、SDK 发布和跨仓许可证边界。
- 当前状态：待决策。
- 后续归属/下一步：Core 合同落地前，由仓库治理和许可证决策统一确认。

## PD-0002

- 问题：ADR 数量增加后，是否新增 `docs/adr/README.md` 索引。
- 来源 ADR：[0001](0001-record-architecture-decisions.md)
- 阻塞什么：不阻塞当前 ADR 流程；只影响 ADR 列表增长后的导航。
- 当前状态：延后。
- 后续归属/下一步：ADR 数量增长到需要目录时再补索引。

## PD-0003

- 问题：任务请求、能力准入、资源需求和运行时能力事实的最终 JSON Schema 名称与字段名。
- 来源 ADR：[0002](0002-run-task-capability-model.md)
- 阻塞什么：Core 公共合同 Schema、API 入参和运行时匹配实现。
- 当前状态：待规格化。
- 后续归属/下一步：后续 Core 合同 Schema ADR 或规格文档收敛。

## PD-0004

- 问题：`experimental` 能力是否可以通过单独标记的探索模式运行。
- 来源 ADR：[0002](0002-run-task-capability-model.md)
- 阻塞什么：实验能力的执行入口和 App/Lode 探索流程。
- 当前状态：待决策。
- 后续归属/下一步：Lode 能力编写与 Core 探索模式设计时确认。

## PD-0005

- 问题：CLI、MCP 和 SDK 生成所需的第一版最小 API 面是什么。
- 来源 ADR：[0002](0002-run-task-capability-model.md)
- 阻塞什么：入口生成、工具注册和 SDK 初始范围。
- 当前状态：待决策。
- 后续归属/下一步：Core API/CLI/MCP 最小入口 ADR 或规格文档收敛。

## PD-0006

- 问题：同一运行时身份下任务执行的锁或并发粒度是什么。
- 来源 ADR：[0002](0002-run-task-capability-model.md)
- 阻塞什么：运行时调度、并发拒绝和资源租约实现。
- 当前状态：待决策。
- 后续归属/下一步：Core Runtime 与 Harbor 资源租约设计时确认。

## PD-0007

- 问题：结果封装和运行记录的最终 JSON Schema。
- 来源 ADR：[0003](0003-result-envelope-and-run-record.md)
- 阻塞什么：公共结果返回、运行记录存储和 API/SDK 类型生成。
- 当前状态：待规格化。
- 后续归属/下一步：结果封装 / 运行记录 Schema ADR 或规格文档收敛。

## PD-0008

- 问题：最小证据分类、保留策略和脱敏策略。
- 来源 ADR：[0003](0003-result-envelope-and-run-record.md)
- 阻塞什么：证据引用、Harbor 证据采集默认值和 App 展示边界。
- 当前状态：待决策。
- 后续归属/下一步：证据策略规格收敛。

## PD-0009

- 问题：CLI 退出码与失败分类如何映射。
- 来源 ADR：[0003](0003-result-envelope-and-run-record.md)
- 阻塞什么：CLI 自动化调用、脚本错误处理和测试断言。
- 当前状态：待决策。
- 后续归属/下一步：CLI 合同设计时确认。

## PD-0010

- 问题：成本、令牌和延迟指标是否进入持久运行记录，还是进入单独指标流。
- 来源 ADR：[0003](0003-result-envelope-and-run-record.md)
- 阻塞什么：运行记录字段和可观测指标边界。
- 当前状态：待决策。
- 后续归属/下一步：可观测性规格收敛。

## PD-0011

- 问题：步骤级历史默认进入运行记录多少，多少只进入证据产物。
- 来源 ADR：[0003](0003-result-envelope-and-run-record.md)
- 阻塞什么：运行记录粒度、证据体积和隐私边界。
- 当前状态：待决策。
- 后续归属/下一步：运行记录 Schema 与证据策略联合确认。

## PD-0012

- 问题：数据集投影在 Core 中保存归一化载荷，还是只保存投影引用。
- 来源 ADR：[0003](0003-result-envelope-and-run-record.md)
- 阻塞什么：数据集投影存储边界和 Core 是否保存公共数据载荷。
- 当前状态：待决策。
- 后续归属/下一步：数据集投影规格设计时确认。

## PD-0013

- 问题：动作风险、执行意图、审批证据和幂等追踪的最终 Schema。
- 来源 ADR：[0004](0004-admission-and-action-risk.md)
- 阻塞什么：写侧准入、审批记录和幂等实现。
- 当前状态：待规格化。
- 后续归属/下一步：写侧安全 / 准入 Schema ADR 或规格文档收敛。

## PD-0014

- 问题：四个最小风险类别是否足够支撑 App 策略和 MCP/CLI 展示。
- 来源 ADR：[0004](0004-admission-and-action-risk.md)
- 阻塞什么：App 审批展示、MCP/CLI 风险提示和策略配置。
- 当前状态：待决策。
- 后续归属/下一步：App 策略与 Core 准入设计时确认。

## PD-0015

- 问题：审批有效期、撤销行为，以及与操作、目标、载荷和身份的绑定方式。
- 来源 ADR：[0004](0004-admission-and-action-risk.md)
- 阻塞什么：审批证据校验和写侧安全实现。
- 当前状态：待决策。
- 后续归属/下一步：App 审批流与 Core 写侧准入共同确认。

## PD-0016

- 问题：写任务锁粒度是会话、标签页、Profile、身份、能力还是目标对象。
- 来源 ADR：[0004](0004-admission-and-action-risk.md)
- 阻塞什么：写侧并发、安全串行化和未知结果降噪。
- 当前状态：待决策。
- 后续归属/下一步：写侧安全运行时设计时确认。

## PD-0017

- 问题：每个动作风险类别的最小证据要求。
- 来源 ADR：[0004](0004-admission-and-action-risk.md)
- 阻塞什么：写侧证据策略、运行记录字段和 App 审计展示。
- 当前状态：待决策。
- 后续归属/下一步：证据策略与动作风险规格共同确认。

## PD-0018

- 问题：人工接管、验证码和登录恢复如何映射到准入或终态结果。
- 来源 ADR：[0004](0004-admission-and-action-risk.md)
- 阻塞什么：人工恢复状态、App 恢复入口和 Harbor 接管协作。
- 当前状态：待决策。
- 后续归属/下一步：Core / Harbor / App 接管设计时确认。

## PD-0019

- 问题：Core 消费 Harbor runtime facts、Snapshot / RefMap、evidence refs、Lode package / schema 和 App 用户意图的最终跨仓字段、状态和有效性规则。
- 来源 ADR：[0002](0002-run-task-capability-model.md)、[0003](0003-result-envelope-and-run-record.md)；GitHub issues WebEnvoy/WebEnvoy#16、#17、#18。
- 阻塞什么：Core #16 的跨仓 closeout、阶段二最小统一协议、Harbor / Lode / App 对外 facts 与 Core 消费合同对齐。
- 当前状态：需要跨仓收敛。
- 后续归属/下一步：由调度线程在 WebEnvoy/Harbor#8、#9，WebEnvoy/Lode#6、#9，WebEnvoy/App#6、#9 与 Core #16 之间收敛；Core 本轮只固定“不复制其他仓 truth，只消费对外 refs / facts / intent”的边界。
