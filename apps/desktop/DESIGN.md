# DESIGN.md

## 1. 桌面设计主张

> 2026-07-14 correction：本文件中的固定 Task Thread 三栏、right context tabs、
> evidence-first 和 approval-request-first 规则已由
> [ADR 0009](docs/adr/0009-human-workbench-information-architecture.md) supersede。
> Owner truth、敏感数据、桌面密度和可访问性规则继续有效。生产 UI 实施前必须先
> 完成 App #298 的 inventory、用户确认 Story、
> [canonical IA candidate](docs/design/human-workbench-information-architecture.md)
> 和高保真原型场景验收。

WebEnvoy App 应像一个克制、紧凑、可信的人类网站工作台，而不是聊天应用或技术状态控制台。它同时承载 Work、Browser 和 Library；Browser 是账号身份、provider、浏览器环境和实例的操作台。

目标用户是市场、运营、产品经理等非技术用户。他们需要选择站点技能、选择账号身份、填写业务输入、执行确定性任务、查看结果依据和执行现场，也需要观测 Agent/API/CLI/MCP 等非 App 调用方产生的运行事实。站点技能当前先消费 Lode capability package metadata，workflow package 是后续扩展。

历史方向稿：

![WebEnvoy Desktop Task Thread direction](docs/design/desktop-task-thread-direction.png)

这张图只作为历史研究输入，不是当前 IA 或页面结构。App #298 可以复用其中经过场景验证的密度和桌面交互，不得直接继承固定任务树、三栏、右侧 tabs 或底部操作区。

现有 WebEnvoy-native foundation 可以继续复用 token、图标按钮、列表行、focus、scroll 和窗口交互；具体 shell、导航、面板和任务操作区由 App #298 的场景验收决定。

## 2. 平台目标

- 产品形态：Desktop App first。
- 平台深度：cross-platform desktop。
- 默认技术载体：Electron shell + React renderer + Radix primitives。
- macOS 和 Windows 应共享信息架构，但窗口控制、菜单、快捷键、focus、selection、theme 和高对比模式跟随平台。
- 原生层只封装 OS 边界能力，不承载 WebEnvoy 业务协议。
- light/dark、motion、density、scrollbar、selection、focus 和 status 表达必须走 renderer token，不在页面组件中散落硬编码色值或临时动画参数。

## 3. 窗口与表面系统

- Work、Browser、Library 必须能从稳定的全局导航到达，但不预设任务树或固定分栏。
- Work 主区域优先展示业务输入、结果、失败原因和下一步；运行详情和诊断按需展开。
- Browser 主区域围绕账号身份、provider、环境和实例生命周期组织。
- Library 主区域围绕技能发现、理解、版本和使用组织。
- Settings 是偏好、全局授权默认值、连接和诊断页面，不与三个业务域并列。
- 弹窗只用于短确认或单次授权；账号身份创建、导入和环境恢复使用保留上下文的完整页面，不把长配置塞进 modal。

## 4. 布局语法

布局必须从用户旅程和对象关系推导。跨页面保持稳定的只有业务域导航、对象身份和返回原任务的路径。Work 的信息顺序是：

- 业务输入、业务结果、失败原因和下一步；
- 来源摘要和原页面入口；
- 有业务意义的运行阶段；
- 执行现场和人工介入；
- refs、trace、endpoint 与原始错误诊断。

没有合适站点技能时，自动任务入口不可用；用户、Agent、API、CLI 或 MCP 仍可从账号身份或 Browser 管理面启动受控浏览器实例，进行手动浏览、登录、观察或准备环境。direct session 属于 Browser/Harbor session 管理路径，不创建 Core Task/Run/Result；只有进入 Core task path 才展示 Task Thread result/evidence/failure。

## 5. 排版

- 使用系统字体。
- 标题只用于当前 Task，不使用 hero-scale type。
- 列表行、metadata、状态、字段来源和时间戳要紧凑但可读。
- 技术字段在浅层 UI 中应转成业务语言，例如 `结果依据`、`执行现场`、`账号身份`。
- 代码、路径、原始 selector 或诊断细节只在深层诊断或开发者模式中显示。

## 6. 间距与密度

密度目标：dense，但不是 control-room。

- 左侧栏行高接近桌面 source list。
- 中间栏报告区允许表格和紧凑 metadata。
- 按需诊断面可以高密度展示字段来源和状态。
- 控件必须保留可点击目标、focus ring 和 disabled 说明。
- 不使用大面积 marketing 留白、dashboard 卡片墙或 hero 区块。
- 密度应由 token 和 primitive 控制：toolbar icon button、panel tab、list row、settings row、status glyph 和 navigation rail 不各自发明尺寸。

## 7. 色彩与材质

- 主色只用于 selection、primary action 和少量 brand anchor。
- success、warning、error、info 使用语义色，不被品牌色覆盖。
- 左侧栏可使用轻微 tinted surface；主内容保持高可读白/系统背景。
- 详情或诊断 surface 用边界和轻量层级表达，不预设固定方位或 tab 结构。
- 材质和透明只服务平台感，不牺牲表格、正文、状态和证据可读性。
- Design Token 必须覆盖 surface、text、border、hover、selected、focus、shadow、scrollbar、status、motion 和 density。组件只能消费 token 或已有 primitive，不直接写一次性色值。
- light/dark 必须同步到 document/root token；系统主题变化、Electron shell theme 和 packaged preview 都应保持一致。

## 8. 组件

当前组件规则必须等待 App #298 高保真原型的用户验收。可复用但不预设全局存在的组件包括：

- Codex-style foundation primitives：`icon-xs`、`icon-2xs`、`cursor-interaction`、`hide-scrollbar`、`vertical-scroll-fade-mask`、toolbar icon button、panel tab、list row、sectioned page、settings row、status glyph、thread navigation rail。
- Global navigation：Work、Browser、Library 和 Settings 的稳定入口。
- Object list：任务、账号身份或站点技能的紧凑列表；分组方式由对应旅程决定。
- Status adornment：spinner、warning、check 等只作辅助，不替代业务结果或可执行下一步。
- Business result：按公共结果类型渲染内容、记录集合和写操作状态。
- Process log：运行中可见，完成后默认折叠。
- Details/diagnostics：只在用户主动展开时承载运行记录和技术信息。
- Site skill discovery/detail：参考 Codex 插件发现页和详情页的信息层级，但使用站点技能、Lode metadata、Core/Harbor 边界等 WebEnvoy 语义；作为 app-level 页面承载，不放进右侧 inspector。
- Settings：参考 Codex 设置页骨架，作为独立 app-level 页面，不与 Task Thread 三栏和右侧 inspector 共存。
- Modal：用于创建账号身份等短流程。

不要在第一版创建完整组件库清单；只沉淀已经被实现消费的 foundation primitive。

## 9. 动效与交互手感

- 动效服务状态确认和空间理解。
- Hover 只揭示次级控制，例如任务区标题行的 `+` / `⋯`。
- 可折叠或可调整尺寸的 surface 应有稳定阈值、宽度记忆和 reduced motion 策略，不能造成主内容抖动。
- Run 切换、过程折叠和任务完成反馈要轻，不做营销式动画。
- Loading 应靠近对象 inline 展示，不用全屏遮罩替代局部状态。

## 10. 品牌表达

品牌表达应服务可信任务执行：

- app icon、selected color、completion marker 和少量 microcopy 可以体现 WebEnvoy 识别；
- 主工作区和结果依据区域必须克制；
- 不做品牌官网式背景、装饰大卡、渐变海报或空洞插画；
- 空态文案应直接告诉用户下一步，而不是讲愿景。

## 11. Anti-Slop 规则

- 不把 App 做成 Agent 聊天窗口。
- 不把任务创建入口做成没有业务字段和能力边界的自由聊天输入框。
- 不把自动任务入口伪装成普通浏览器；但允许 Browser 管理面作为账号身份/浏览器环境启动台。
- 不把首屏做成 Work/Library/Browser/Settings 的网页 dashboard；但 Library/Browser 管理面不能消失。
- 不在浅层 UI 暴露 API endpoint、schema、Core/Harbor/Lode 细节。
- 不用卡片墙替代表格、列表和树。
- 不让 details/diagnostics panel 承担主流程。
- 不把 evidence refs、runtime facts、owner 说明或完整事件流作为默认内容。
- 不在 App 页面中复制 Core 的统一授权策略或站点专用审批状态机。
- 不在 app-level 页面保留空的 right panel、right panel tabs 或右侧打开/折叠控制。
- 不把状态作为左侧任务列表的第一分组。
- 不在 App 中保存 raw evidence、cookie、token、profile storage 或 owner truth。
- 不用设计稿里的假数据反推合同。
- 不在组件里新增硬编码主题色、hover 色、selected 色、shadow 或 scrollbar；先补 token 或复用 primitive。
- 不继续逐点补 CSS 来追 Codex 外观；复杂 shell 行为必须回到 Codex restored 源码和截图对齐后再实现。

## 12. Agent 实现指南

后续 Agent 修改 App UI 前必须先读取：

- `VISION.md`
- `DESIGN.md`
- `docs/adr/0009-human-workbench-information-architecture.md`

ADR 0008 只作为历史 checkpoint 和候选组件输入，不再拥有当前 IA 权威。

新增 UI 时先说明它覆盖的用户旅程、业务域、主要对象、业务结果和 owner API boundary；旧 Task Thread 结构不得作为默认继承项。

修改 shell、panel、task entry、site skill 或 settings 时，优先复用现有 WebEnvoy-native foundation：

- `src/renderer/uiFoundation.css` 中的 token 和 utility；
- `shellPrimitives.tsx` 中的 shell/panel primitive；
- 已有 status glyph、navigation rail、sectioned page、list row 和 settings row。

Codex 截图和 restored 源码只可作为桌面交互参考；WebEnvoy 的场景验收和 ADR 0009 决定信息架构，Task / Run / Identity / Site Skill / Harbor Session 语义不被参考产品替代。

如果实现需要偏离当前设计方向，必须记录：

- 为什么偏离；
- 影响哪些 issue 或 FR；
- 是否改变 Task / Run / 账号身份 / 站点技能语义；
- 是否需要用户重新确认。

实现验证至少检查：

- 覆盖的用户旅程和用户批准的高保真原型结论；
- 业务结果、来源摘要、运行详情和诊断的层级；
- computed style：token、light/dark、list row、focus 和 scrollbar；
- 真实数据下的任务、账号身份和站点技能页面；
- 长任务标题、长 URL 和长账号身份名；
- 运行中、完成、失败、需要处理、已读/未读状态；
- 键盘 focus 和 selection；
- 窗口缩放；
- 极限宽度下图标、文字和主要命令不溢出；
- 详情与诊断默认折叠且可访问；
- light/dark 或系统主题边界。

不要把本文件扩展成完整设计系统。只有真实实现需要的规则才进入这里。
