# ADR 0011：以受管浏览器与 SKILL 纵向路径推进 V1

- 状态：Accepted
- 日期：2026-09-06
- 规范：[WebEnvoy v1 产品与架构方向规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)

## 背景

既有路线已经交付并验证了部分 Core、Harbor、Desktop 和 Lode 基础能力，但规划逐渐按对象、合同和小红书四种创作形态横向展开。真实页面又反证了 prepare-only 共性假设；继续补齐预测性合同会延后 Provider、受管 Profile、正式 Agent 入口和真实网站消费者的验证。

## 决策

1. 当前交付以用户或 Agent 的纵向真实路径为单位。对象和合同只细化到当前消费者所需，不要求先形成独立服务、存储、队列或完整字段矩阵。
2. 当前批验证 Camoufox、一个 WebEnvoy 管理的 Profile、人工接管、最小正式入口和一个低风险真实任务；下一批验证单宿主多个 Profile、最小 Grant、显式账号绑定、冲突与控制权。
3. Camoufox 只是默认 Provider 的首个验证目标；Chrome 保留为显式兼容 Provider。ego-lite／ego-browser 与 Wayfern 不进入产品。
4. 站点知识以标准 Agent SKILL 为主要载体；AccountSystem 独立复用，运行时以用户本地定义为准。没有网站 SKILL 不阻断通用浏览器。
5. Core 统一拥有授权、Run、外部结果、幂等和恢复；Harbor 拥有 Profile、Provider、Instance、现场与 ControlLease；Desktop 投影 owner facts；Lode 不成为运行时或授权来源。
6. 首个网站写入只保留图片上传、必要字段回读和页面实际证明支持的一种明确授权 commit。统一复用现有授权、锁、幂等、unknown outcome 与只读对账，不预建第二套站点状态机。
7. App 首批围绕 Activity、同实例现场、内容与目标摘要、必要确认和人工接管，不预设完整创作编辑器、Task Thread 工作台或多实例直播。

## 保留

现有 Profile 存储、运行现场、统一授权、锁、Run Record、result envelope、unknown outcome、对账、诊断、数据保护以及已验证 Lode 资产继续复用。历史代码、Profile、用户数据、Run、Issue、PR 和 ADR 不因规划变化删除或改写。

## 被替代的实施解释

- ADR 0002–0010 中“先铺满公共对象／合同再接真实消费者”的解释被本 ADR 替代；其已验证 owner、状态、授权和数据边界仍有效。
- Desktop ADR 0009 中 Work/Browser/Library 的长期信息架构仍是候选方向；Task Thread、固定布局和完整工作台不再是首批实现前置。
- Harbor ADR 0003/0009 中已确认的 Provider 所有权和生命周期保留；Chrome/CDP-first、横向 Provider 集成或未验证 Provider claim 不再决定优先级。
- Lode ADR 0006 的既有站点资料保留；BOSS 退出近期交付，小红书全形态合同不再是首版前置。

## 验收与回退

早期 Work Item 分别定义成功、必要拒绝和恢复证据；原型失败可完成验证，但不代表能力交付。若 Camoufox 不满足采用门槛，记录具体失败并回到 Chrome 兼容路径或新的有限 Provider 决策，不回退到预测性全形态路线。
