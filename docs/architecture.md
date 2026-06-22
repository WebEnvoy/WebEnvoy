# WebEnvoy 架构

本文档只描述 `WebEnvoy/WebEnvoy` 主仓内部架构。组织级仓库地图和跨仓关系由 `WebEnvoy/.github` 维护，见 [仓库地图](https://github.com/WebEnvoy/.github/blob/main/docs/repository-map.md)。

## 分层关系

```text
Agent / 上游系统
  ↓
Public API / SDK / CLI / MCP
  ↓
WebEnvoy API Server
  ↓
WebEnvoy Core

Console
  ↓
Internal API
  ↓
WebEnvoy API Server
  ↓                 ↓
Lode                Harbor
站点知识 / 能力      Profile / Execution Identity / Runtime Session
任务封装 / 模板      CDP / VNC / Evidence / Browser Drivers
```

## 边界原则

- Core 不直接绑定具体浏览器；
- Harbor 不理解具体站点业务；
- Lode 不依赖具体 Runtime 实现；
- API Server 是主仓的一等入口；
- SDK、CLI、MCP 和 Console 复用 API，不各自绕开 Core 建立独立入口；
- Console 不承载核心执行逻辑；
- Schema 应尽量表达跨仓公共契约，而不是某个实现细节。

## Core 内部模块方向

```text
packages/
  api-server/
    public-api/
    internal-api/
  core/
    capability-runner/
    task-runner/
    execution-planner/
    state-recognition/
    result-normalizer/
  schemas/
  sdk-js/
  sdk-python/
  cli/
  mcp-server/

apps/
  console/

docs/
examples/
```

以上目录是初期实施方向，不代表已经实现。
