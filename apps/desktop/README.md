# WebEnvoy App

WebEnvoy App 是 WebEnvoy 的统一人类用户入口。

它面向市场、运营、产品经理等非技术用户，承载确定性网页任务的自动执行入口、WebEnvoy 全局运行事实观测、站点技能管理、账号身份管理、浏览器执行现场和异常处理入口。

WebEnvoy App 不是 Core Runtime，不是 Harbor Runtime，也不是 Lode 资产仓库。自动任务执行通过 WebEnvoy API Server 和 Core Runtime；站点技能和 capability package metadata 来自 Lode，workflow package 是后续扩展；账号身份、浏览器环境和执行现场通过 Harbor Runtime API。

## 产品定位

WebEnvoy App 是产品外壳，不是执行真相源，也不是能力资产真相源。

它让用户通过一个入口完成：

- 选择站点技能、账号身份和业务输入，运行 Lode 提供的确定性站点能力入口；
- 查看 App、Agent、API、CLI、MCP、SDK 或 skills 产生的运行记录；
- 查看结构化结果、失败原因、结果依据和执行现场；
- 在失败时修改输入、再次执行、打开现场、接管或等待恢复；
- 创建和管理账号身份、浏览器环境、Runtime Session 和 Viewer；
- 没有合适站点技能时，启动受控浏览器实例进行手动浏览、登录、观察或准备环境；
- 浏览、安装、更新、锁定和回滚站点技能与平台能力资产；
- 创建、配置、测试和版本管理个人能力资产；
- 标记能力失效、创建修复草稿，并提交脱敏失效上报。

## 核心心智

当前 Desktop checkpoint 采用 Task Thread first：

```text
Task = 站点技能 + 账号身份 + 业务输入
Run = 同一 Task 下的一次执行记录
```

这个定义约束 App 的自动任务入口。Agent、API、CLI、MCP、SDK、skills 或其他上层应用不受 App 自动执行入口限制；它们产生的运行事实仍应在 App 中可观测。

## 主要产品面

### Task Thread

Task Thread 是首个桌面闭环的主体验：

- 左侧任务列表默认按 `账号身份 -> 站点技能 -> Task` 组织；
- 中间栏展示当前 Task、Run navigation rail、任务结束报告和执行过程；
- 底部固定控制区提供修改输入、再次执行、查看结果依据、打开执行现场等操作；
- 右侧上下文面板展示结果依据、执行现场、账号身份、站点技能和诊断。

### Library

Library 是 Lode 资产的人类工作台，不因 Task Thread first 被取消。

- Platform Assets：平台站点知识、官方能力包、官方任务模板、版本和更新；
- My Assets：个人能力、个人任务模板、私有 overlay / fork、草稿、测试样例和版本历史；
- Reports：能力失效、站点变化、修复请求和脱敏证据上报；
- Explorer：后续网站探索、知识捕获、能力草稿和任务模板草稿入口。

Lode 仍是能力资产和任务封装的真相源。

### Browser

Browser 是 Harbor 账号身份和执行现场的人类工作台，也不因 Task Thread first 被取消。

- Account Identities；
- Browser Environments；
- Runtime Sessions；
- Viewer / Takeover；
- Provider Capability Facts；
- 手动浏览实例启动。

没有合适站点技能时，用户、Agent、API、CLI 或 MCP 可以从 Browser 或账号身份入口启动受控浏览器实例；这不是自动任务执行，也不能被标记为 task success。direct Identity Runtime Session 不创建 Core Task/Run/Result，只有进入 Core task path 后才展示 Task Thread result/evidence/failure。

## 与 WebEnvoy / Harbor / Lode 的关系

- WebEnvoy App 负责统一人类用户入口和全局观测；
- WebEnvoy Core 负责 API Server、Core Runtime、任务执行、结果归一和 Run Record；
- Lode 负责网站经验、能力包、capability package metadata、模板、测试样例、版本和失效标记；workflow package 是后续扩展。
- Harbor 负责账号身份、浏览器环境、Identity Runtime Session、Viewer、人工接管、provider 能力事实和运行证据。

```text
WebEnvoy App
  ├── WebEnvoy API Server -> WebEnvoy Core Runtime
  ├── Lode asset/catalog/source APIs
  └── Harbor Runtime API
```

App 不绕过 Core 写任务记录，不保存 Lode 能力资产真相，也不绕过 Harbor API 操作浏览器会话。

## 第一阶段产品表面

第一阶段按 Desktop App first 设计。开发期可以用本地 Web UI 调试，但最终产品形态、信息架构、连接状态和交互优先级按 Desktop App 收敛。

当前技术基线见 [ADR 0007](docs/adr/0007-desktop-app-technical-baseline.md)。当前桌面设计 checkpoint 见 [ADR 0008](docs/adr/0008-desktop-ui-design-checkpoint.md) 和 [DESIGN.md](DESIGN.md)。

## 不做什么

WebEnvoy App 不应：

- 在 App 内运行 Agent；
- 把自动任务入口做成任意网页读写任务启动器；
- 直接执行 Lode 能力；
- 保存 Lode 能力资产真相；
- 直接管理浏览器进程、浏览器数据目录或 provider driver；
- 直接写 Core Run Record；
- 绕过 Harbor Runtime API 操作 Runtime Session；
- 默认上传用户个人资产、业务输入或未脱敏执行现场；
- 成为业务策略系统、账号运营系统或内容排期系统。

## 文档

- [愿景](VISION.md)
- [桌面设计契约](DESIGN.md)
- [路线图](ROADMAP.md)
- [架构决策记录](docs/adr/0001-record-architecture-decisions.md)

## 许可证

本仓库采用 [GNU Affero General Public License v3.0](LICENSE)。
