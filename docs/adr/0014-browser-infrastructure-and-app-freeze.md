# ADR 0014：浏览器基础设施定位、全能力可集成与 App 产品化冻结

- 状态：Accepted；[S0 #561](https://github.com/WebEnvoy/WebEnvoy/issues/561) 的组织 canonical、主仓与 Lode 基线已于 2026-09-18 合并并回读。
- 日期：2026-09-18
- 产品依据：[canonical v1 修订](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)
- 产品归口：[S0 #561](https://github.com/WebEnvoy/WebEnvoy/issues/561)
- 被局部替代：[ADR 0012](0012-runtime-capability-plane-and-plugin-first.md) 的“Plugin 后完整 App 产品化”决定

## 背景

现行产品叙事以矩阵社媒、多店铺运营和 Plugin-first 后补完整 App 为中心。新的产品决定把 WebEnvoy 收敛为第三方 Agent 和上游系统的浏览器基础设施：长期身份、隔离与隐身质量是基础，页面语义、受控视觉、Network、人工介入、结果与恢复是可集成能力；上游拥有经营策略和业务编排。

这是显式范围修订，不表示 CLI、站点脚本、主动 Network、视觉操作或新的质量门已经实现，也不改写此前证据的适用范围。

## 决定

1. WebEnvoy 是产品和 monorepo；Core、Harbor、App 是内部模块，Lode 继续独立。
2. 进入产品范围的能力必须有不依赖 Desktop App 的正式路径。CLI 优先；API、Plugin、受管站点脚本和可信用户入口消费同一 Profile、Grant、Instance、ControlLease、Run、结果与恢复事实。
3. Desktop App 专属工作台、配置页、Library／Activity、官方多实例布局和独立发行产品化冻结。现有代码、历史设计和证据保留，无自动重启。
4. 冻结不取消可信用户授权、监督、接管、交还、撤权、停止和恢复。原受管浏览器窗口、CLI 或宿主表面可以承载人类控制，但不得建立第二 Runtime 或授权库。
5. 站点 SKILL 统一承载 references、确定性 scripts、assets、任务分流、输入输出、验证和修复。正式支持按具体任务声明；纯知识可用但不能冒充可执行支持。
6. OpenCLI 采用可验证转化和明确子集兼容，不复制其 Runtime，不承诺任意插件原样运行，也不向普通 Agent 暴露 raw CDP、Cookie、任意脚本或本机权限。
7. 页面语义、受控视觉与主动 Network 都是正式能力方向；具体运行合同分别由 S2/S5/S4 接受后实施。现有 selector、坐标、evaluate、Network body／mutation 和权限 wire 不因本 ADR 放宽。
8. 隔离、连续性和隐身质量分别验证。Provider 可在统一公共语义下采用有证据的正式能力优化；不预设直接 CDP 更快，不恢复私有补丁、Obscura 或随机设备身份路线。

## 保留

- Core 的授权、Run、ExternalOutcome、幂等和恢复；Harbor 的 Profile、Page、现场与 ControlLease；Lode 的可分发资产职责。
- Page／document／target 新鲜度、ControlLease、敏感数据最小化、unknown 不重放和 Provider Qualification Gate。
- installed Plugin 的真实第三方 Agent 验收；CLI 验收不能冒充 `plugin_verified`。
- ADR 0013 的可选模型边界：默认关闭、正式模型接入条件、独立外发／费用决定、#558/#559 非 V1 阻塞。

## 被替代的决定

ADR 0012 第 6 节中“完整 App 产品化后移”的默认后段目标被“App 专属产品化冻结且无自动重启”替代。该 ADR 的 Runtime capability plane、薄 Plugin、Provider 资格、能力／暴露／授权／可执行性分离及事实归属继续有效。

旧文档中把可信人类入口等同 Desktop App、把站点 SKILL 只看作指导、或把 Provider 公共语义解释成所有内部实现必须一致的要求，同样被本决定替代。历史内容保留为来源，不再作为当前实施门。

## 后果与边界

- 修订后 V1 增加无 App／CLI、非首站可执行 SKILL、一个 OpenCLI 转化、主动 Network 读写、受控视觉闭环和环境／隐身质量基线；其他既有必需项不静默删除。
- Lode 拥有站点包格式与可分发资产；主仓拥有运行权限、控制、Run 和结果。两者互相引用，不复制合同。
- 不新增服务、存储、队列、通用工作流、模型平台或不可信脚本沙箱。
- 不删除 App，不改变运行代码、依赖或现有 wire；后续能力分别由 S1—S6 与对应 Work Item 验收。
- #555/#556 保持原范围，#558/#559 保持条件性后续，不成为本决定的全局前置。

## 验收

S0 只验收产品文档、旧条款替代、GitHub 原生规划与跨仓归属一致。CLI、站点 SKILL、Network、视觉和环境／隐身质量的真实结果由各自 Spec 和实施项验收；本 ADR 或任一 docs PR 合并均不证明功能完成。
