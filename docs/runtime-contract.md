# Runtime Contract

Runtime Contract 描述 WebEnvoy Core 如何与 Harbor 协作。

它不是 Harbor 的内部实现文档，而是 WebEnvoy API Server、Core、Harbor、SDK、CLI、MCP 和 Console 之间需要稳定下来的调用边界。

## 核心概念

| 概念 | 说明 |
|---|---|
| Profile | 浏览器身份容器，包含 user_data_dir、Cookie、扩展、代理和浏览器配置 |
| Execution Identity | 站点绑定的执行身份，包含账号、登录态、历史状态、风险事件、资源约束和可用通道 |
| Runtime Session | 一次运行中的浏览器会话，包含 session_id、profile_id、identity_id、driver、cdp_url、viewer_url 和状态 |
| Capability Execution Context | Core 执行站点能力时从 Harbor 获取的上下文，包括 session、资源约束、证据策略和可用通道 |
| Evidence | 执行证据，包括截图、关键 DOM 摘要、网络摘要、console 错误、执行步骤和验证结果 |

## 最小协作流程

```text
1. Core 读取 Lode 中的能力定义和资源需求
2. Core 向 Harbor 请求可用 Execution Identity / Runtime Session
3. Harbor 返回 session、CDP/VNC 信息、证据策略和执行约束
4. Core 执行站点能力
5. Core 将执行步骤、验证结果和失败原因写入 Evidence
6. Core 释放或保留 Runtime Session
7. Core 将结构化结果交给 API Server
8. API Server 返回结构化结果给调用方
```

## 边界要求

Core 不应：

- 直接启动或杀死浏览器进程；
- 直接操作 user_data_dir；
- 直接保存 Cookie、Token 或完整请求响应；
- 在不了解资源约束的情况下绕过 Harbor 使用外部通道。

Harbor 不应：

- 理解具体站点业务语义；
- 决定业务策略；
- 替 Core 执行站点能力编排；
- 默认上传用户敏感状态。

## 待稳定内容

- Runtime Session Schema；
- Execution Identity Schema；
- Evidence Schema；
- WebEnvoy Public / Internal API；
- Harbor acquire / release session API；
- CDP / VNC 暴露策略；
- 错误类型和状态码；
- 写入前检查与写入后验证的证据格式。
