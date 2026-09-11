# ADR 0013：Provider 用户选择与 Obscura 有界验证

- 状态：Accepted
- 日期：2026-09-11
- 产品规范：[WebEnvoy v1.2 产品与架构方向规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)
- 产品归口：[Provider／环境 FR #471](https://github.com/WebEnvoy/WebEnvoy/issues/471)
- 执行项：[Obscura 受管验证 #511](https://github.com/WebEnvoy/WebEnvoy/issues/511)
- 取代关系：取代 [ADR 0011](0011-v1-managed-browser-and-skill-delivery.md) 第 3 条中“默认 Provider”与 Camoufox 失败后回到 Chrome 的解释；补充 [ADR 0012](0012-runtime-capability-plane-and-plugin-first.md) 的 Provider-neutral 规则。

## 背景

Camoufox 已完成首个工程 qualification，但“首个验证对象”被部分文档和代码扩张为产品默认、其他 Provider 前置及 Chrome 受限回退。这个解释混淆了工程优先级、产品推荐、用户新建默认偏好和每个 Profile 的持久绑定，也会把 Driver 缺失或协议差异错误升级为 Provider 不适配。

## 决策

1. 用户选择 Provider；新增 Provider 增加选择，不替换现有 Provider。显式选择优先于用户新建默认，两者都必须可用且获授权；不可用时局部拒绝，不静默回退。
2. 无用户默认时，人类入口可以展示可修改的项目推荐预选并要求确认；Agent 未指定且无用户默认时返回需要选择。修改默认只影响后续创建，不修改旧 Profile、Instance、环境、账号绑定或 Grant，也不授予 Provider 管理权。
3. Profile 创建后始终按持久 ProviderBinding 运行；跨 Provider 或不兼容版本变化走显式迁移。
4. Provider 接入评估 WebEnvoy、Driver 与 Provider 的组合结果。内核、协议、存储、窗口和网站差异按版本记录为适配、限制或待验证事实；不同 Provider 不要求相同实现或支持等级，完整 Runtime 能力类别不缩减。
5. 人工使用要求用户能观看并操作原 Instance、完成接管和交还；原生有头窗口不是统一前置，只有截图也不是交互通过。
6. Camoufox 保留首个工程验证及已验证范围；Chrome 保留平等的显式兼容选择。Obscura 通过 #511 的一个 Profile／一个进程／一个目录最小 Driver 验证，不预设只读定位，也不开放 Provider 平台或进程池。

## 安全与恢复

身份和数据不混淆、同一真实现场、有效授权与 ControlLease、可信外部结果和 `unknown` 不重放是所有 Provider 的底线。Driver 底层连接丢失导致页面死亡时，旧 Instance／Page 必须准确失效；恢复可以从同一 Profile 显式创建新 Instance，但不得宣称无损恢复页面或自动重放在途写入。

## 后果

- Provider catalog、创建入口和 Plugin projection 不再表达永久默认或自动回退。
- capability 支持和证据按 Provider／版本／平台查询；未测试不是 `unsupported`。
- 用户默认偏好需要独立持久实现和验收；它不是 Obscura 最小显式选择验证的前置。
- Obscura 的 release、源码构建、签名、持久化、连接生命周期和网站兼容缺口分别记录，不用单一“支持 CDP”或低风险样本代替产品结论。

## 非目标

不重选既有 Provider 的许可或分发政策，不重开历史 #450，不依赖未合并 #507，不建设通用 Provider 插件平台、共享 Obscura 服务、远程云服务或全量 DevTools 克隆。
