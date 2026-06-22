# WebEnvoy 定位

WebEnvoy 是面向 Agent 和上游系统的网站能力基础设施中的站点能力执行与编排层。

它不是一个通用浏览器 Agent，也不是单纯的浏览器自动化框架。它的核心目标是把复杂网站沉淀为可复用、可执行、可验证的能力，让 Agent / 程序以更低探索成本、更少噪音和更稳定的方式完成网站读写任务。

## 核心职责

WebEnvoy Core 负责：

- 解释 Lode 中定义的站点知识、站点能力和任务封装；
- 根据能力声明、资源需求、执行身份和运行状态生成执行策略；
- 调用 Harbor 获取 Profile、Execution Identity、Runtime Session 和执行上下文；
- 执行读写动作前后的检查、验证和结果归一；
- 通过 API Server 向 Agent、上游系统、SDK、CLI、MCP 和 Console 返回结构化事实。

## API 定位

WebEnvoy API 是主仓的一等入口，不是 SDK 的附属能力。

- Public API 面向 Agent、上游系统和外部程序，用于调用站点能力、任务封装、查询运行结果和获取结构化证据；
- Internal API 面向 Console、CLI、MCP 和 SDK，用于配置、调试、能力测试、运行记录和包管理；
- SDK、CLI、MCP 和 Console 应复用 API Server，而不是各自绕开 Core 建立独立执行入口。

## 不负责什么

WebEnvoy Core 不直接负责：

- 浏览器进程生命周期；
- 指纹配置和 Profile 存储；
- Cookie、代理、扩展和 user_data_dir 管理；
- VNC / noVNC / CDP endpoint 暴露；
- 站点能力资产的公共维护和分发。

这些职责分别由 Harbor 和 Lode 承担。

## 用户

WebEnvoy 的直接调用方主要是：

- Agent 系统；
- 自动化程序；
- 上游业务系统；
- 需要稳定读写网站能力的开发者或产品系统。

Console 可以服务人类用户，但它主要承担配置、观察、调试和异常处理职责，不应成为唯一或核心执行入口。
