# Harbor Runtime 愿景

Harbor 为 WebEnvoy 提供长期受管的浏览器身份和真实运行现场。产品方向以 [canonical v1 规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md) 为准。

Harbor 管理 Profile、ProviderBinding、EnvironmentConfiguration、Instance、页面操作、Viewer、ControlLease 和现场观测；Core 决定授权与业务结果，Lode 提供网站知识，App 组合并展示这些事实。

Provider 由用户选择；Camoufox 只保留首个工程验证及已验证范围，Chrome 是显式兼容选择，其他 Provider 通过有界验证进入支持范围。公共能力保持 provider-neutral，不把 CDP、供应商声明或反检测承诺变成产品真相。
