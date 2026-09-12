# Harbor Runtime 愿景

Harbor 为 WebEnvoy 提供长期受管的浏览器身份和真实运行现场。产品方向以 [canonical v1 规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md) 为准。

Harbor 管理 Profile、ProviderBinding、EnvironmentConfiguration、Instance、页面操作、Viewer、ControlLease 和现场观测；Core 决定授权与业务结果，Lode 提供网站知识，App 组合并展示这些事实。

Provider 由用户在已支持、可用且获准的范围内选择；产品推荐、用户新建默认和 Profile 实际绑定分离。公共能力保持 provider-neutral，但不把中立语义变成由 WebEnvoy 补齐浏览器内核的义务。Obscura 在当前愿景内不采用；该方向以待合并的 [canonical 修订 .github#20](https://github.com/WebEnvoy/.github/pull/20) 为前提。
