# WebEnvoy Core 架构

本文档描述 WebEnvoy Core，也就是 `WebEnvoy/WebEnvoy` 仓库的内部架构。组织级仓库地图和跨仓关系由 `WebEnvoy/.github` 维护，见 [仓库地图](https://github.com/WebEnvoy/.github/blob/main/docs/repository-map.md)。

WebEnvoy 是完整产品体系；WebEnvoy Core 是其中的 API Server、Core Runtime 和任务执行契约仓库。统一产品入口位于 `WebEnvoy/App`，浏览器身份和运行现场由 Harbor 提供，站点知识和能力资产由 Lode 维护。

## 架构目标

WebEnvoy Core 的架构目标，是让 Agent、自动化程序、WebEnvoy App 和上游系统通过统一入口调用网站能力，并让每次网页操作任务进入同一条可准入、可记录、可验证、可归因、可对账的核心任务路径。

这意味着 WebEnvoy Core 不应该在 API、CLI、MCP、SDK 或 WebEnvoy App 之间形成多套执行逻辑。不同入口可以有不同使用体验，但最终都应进入 API Server 和 Core Runtime。

## 分层关系

```text
Agent / 上游系统 / SDK / CLI / MCP / WebEnvoy App
  ↓
WebEnvoy API Server
  ↓
WebEnvoy Core Runtime
  ↓                 ↓
Lode                Harbor
网站经验 / 能力      浏览器身份 / Runtime Session
任务封装 / 模板      能力事实 / Evidence / 人工接管
```

WebEnvoy App / Console 是人类用户的统一产品入口，位于 `WebEnvoy/App` 仓库。它不绕过 API Server 执行任务，也不承载独立于 Core 的任务运行逻辑。

## 同一核心任务路径

所有入口都应复用同一条 Core Runtime 路径：

```text
API / SDK / CLI / MCP / WebEnvoy App
  → API Server
  → Core Runtime
  → Capability Admission
  → Resource Requirement Matching
  → Harbor Runtime Session / Capability Facts
  → Run Record
  → Result Envelope / Evidence
```

该路径保证：

- 能力准入规则一致；
- 输入校验规则一致；
- 资源需求匹配规则一致；
- Harbor Runtime Session 获取方式一致；
- 写入前检查、写入后验证和状态对账一致；
- Run Record 和 Evidence 一致；
- 错误类型和失败原因一致。

如果 CLI、MCP、SDK 或 WebEnvoy App 直接绕开 Core 调用 Harbor，就会破坏这些一致性。

## Core Runtime 主链路

Core Runtime 负责把一次外部调用推进为可记录的运行结果：

```text
外部调用
  → 请求归一化
  → 能力准入
  → 输入和目标校验
  → 资源需求匹配
  → Runtime Session 绑定
  → Run Record accepted
  → Run Record running
  → 能力执行 / 任务封装执行
  → 写入前检查 / 写入后验证 / 状态对账
  → Evidence 记录
  → Run Record terminal
  → 结构化结果返回
```

详细设计见 [Core Runtime](core-runtime.md) 和 [Runtime Contract](runtime-contract.md)。

## 与 App 的边界

WebEnvoy App 是统一产品入口，不是 Core Runtime。

App 负责：

- Work、Library、Browser 三个产品域的用户界面；
- 任务、运行记录、证据和恢复入口的呈现；
- Lode 能力资产的浏览、安装、配置、探索和上报入口；
- Harbor Profile、Runtime Session、Viewer 和人工接管入口。

Core 负责为 App 提供 App-facing API，但不把 App Shell 放入本仓库。

## 与 Lode 的边界

Lode 保存可复用的网站经验和能力资产。

Lode 负责：

- 站点知识；
- 站点能力包；
- 原子动作；
- 任务封装；
- 模板；
- 测试样例；
- 能力版本和失效标记；
- 资源需求声明。

WebEnvoy Core 读取并执行 Lode 的能力定义，但不把具体站点知识直接内置到 Core。

## 与 Harbor 的边界

Harbor 负责浏览器身份和运行现场。

Harbor 负责：

- Profile；
- Execution Identity；
- Runtime Session；
- provider / Profile / Runtime Session 能力事实；
- CDP / Viewer / VNC；
- 人工接管；
- Evidence Store；
- Runtime API。

WebEnvoy Core 不直接管理浏览器进程、Cookie、user_data_dir、代理或指纹。Core 基于 Lode 的资源需求、Harbor 返回的能力事实和用户策略判断一次任务是否具备运行条件。

## 边界原则

- Core 不直接绑定具体浏览器；
- Core 不保存 Cookie、token、完整 DOM、完整请求响应或用户业务数据；
- Harbor 不理解具体站点业务；
- Lode 不依赖具体 Runtime 实现；
- API Server 是本仓库的一等入口；
- SDK、CLI、MCP 和 WebEnvoy App 复用 API，不各自绕开 Core 建立独立入口；
- WebEnvoy App 不承载核心执行逻辑；
- Schema 应尽量表达跨仓公共契约，而不是某个实现细节；
- provider 能力事实用于资源匹配，不应变成黑盒风险分或 provider 排名。

## Core 内部模块方向

```text
packages/
  api-server/
    public-api/
    internal-api/
  core/
    core-runtime/
    capability-admission/
    resource-matcher/
    capability-runner/
    task-runner/
    execution-planner/
    state-recognition/
    write-side-safety/
    reconciliation/
    run-records/
    result-normalizer/
    evidence-collector/
  schemas/
  sdk-js/
  sdk-python/
  cli/
  mcp-server/

docs/
examples/
```

以上目录是初期实施方向，不代表已经实现。

## 不属于本仓库的内容

WebEnvoy Core 不应承载：

- WebEnvoy App Shell 或人类用户界面；
- Harbor 的浏览器进程、Profile、Cookie、CDP、Viewer、VNC 或 provider driver 实现；
- Lode 的站点能力资产和任务模板公共库；
- research 中的外部项目调研材料；
- 上游业务系统、账号运营策略、内容排期或业务决策逻辑。
