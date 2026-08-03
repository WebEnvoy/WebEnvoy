# 0009. 人类工作台信息架构与信息分层

## 状态

Accepted by App #306 as the direction for App #298 product correction, 2026-07-14.

本 ADR 只接受产品方向和设计约束，不代表 IA inventory、原型或场景验收已经完成，
也不关闭 App #298 或其 #299-#305、#308 子项。

2026-07-15 process correction：App #298 在 IA 定稿前增加 Loom Story 用户确认
Gate，并以高保真原型用户验收替代低保真场景验收。Loom review、自动 review、PR
merge 或 agent 判断不能代替这两次用户确认。

2026-07-15 Story Gate 已由用户明确确认。#300-#304 的 canonical IA candidate
记录于 `docs/design/human-workbench-information-architecture.md`；该候选只允许进入
#305 高保真原型，不能代替高保真原型的第二次用户验收。

2026-07-19 用户明确回复“批准当前用户故事和高保真原型，继续目标”。因此 Story
Business Confirmation 记录为 `confirmed`，高保真原型人工 Gate 记录为 `approved`。
本文与 canonical IA 文档冻结 IA 和关键旅程；原型 head
`ddcd13d6cb556cfbe65a72f466d9f12992d438fc` 冻结视觉基线。该确认不代表生产 UI、
owner runtime 合同或真实运行证据已经完成。

本 ADR 固化产品方向和下一轮设计约束，不实现生产 UI。它保留 ADR
0005/0006/0008 的 owner truth、敏感数据和本地缓存边界，但 supersede 以下旧决策：

- evidence card、refs、runtime facts 或右侧 context tabs 默认可见；
- risk/approval-request-first 写侧交互；
- Task Thread 固定三栏作为所有场景的唯一页面结构；
- Settings 与 Work、Browser、Library 并列为业务域。

## 背景

当前 App 能展示大量 Core、Harbor 和 Lode facts，但页面以运行状态、refs、
provider/session/controller 和 owner 边界为中心。人类用户难以直接回答：现在能做
什么、任务得到了什么、哪个账号正在使用、失败后下一步是什么。

小红书是当前真实运行验收切片，不是 App 的产品边界。App 还必须观察 CLI、MCP、
API、SDK 和 Agent 产生的任务，并作为账号身份/浏览器环境和站点技能的人类工作台。

## 决策

### 三个业务域

| 业务域 | 用户目标 | 主要对象 |
| --- | --- | --- |
| Work | 创建和管理任务，消费业务结果，处理失败与人工介入 | Task、Run、Result、用户可执行恢复动作 |
| Browser | 管理账号身份、provider、浏览器环境和实例 | 账号身份、环境、provider、实例、登录状态 |
| Library | 浏览、管理和使用站点技能 | 技能、版本、输入输出、资源和动作要求 |

Settings 只承载偏好、全局执行方式默认值、连接和诊断，不是第四业务域。

### 三种自然入口

```text
账号身份 -> 打开浏览器或选择技能 -> Task
站点技能 -> 选择兼容账号身份 -> Task
Work 全局任务入口 -> 空状态创建页 -> 选择“账号身份 + 站点技能”推荐组合或自行选择 -> Task
App/CLI/MCP/API/SDK/Agent Task -> App 查看运行与结果
```

App 自动任务仍满足：

```text
站点技能 + 账号身份 = Task Thread
Task Thread + 一次业务输入 = Task Turn
Task Turn 的一次执行尝试 = Run
```

线程内 Composer 保持紧凑的固定位置，但站点技能和账号身份只读展示或省略，只包含该
技能声明的结构化业务字段、附件、校验状态和提交操作。提交后，同一字段定义渲染为回合
顶部的只读输入卡，Composer 清空业务输入并等待下一次提交。模型、语言、权限模式和
自由对话控制不属于该 Composer。

Work 可按站点技能或账号身份组织同一批 Task Thread；切换只改变前端分组，
不复制 Task、Run 或结果事实。

Work、Browser 和 Library 的左栏下半区只承载同一任务线程列表。账号身份和站点技能
分别在中栏集合页中浏览、搜索、排序和管理；技能组标题的 hover/focus “+”用于选择
另一个兼容账号身份创建任务，不改变当前线程。

手动浏览实例属于 Browser，不伪装成 Core Task/Run/Result。

### 信息层级

任务线程顶部只承载固定的站点技能、账号身份和线程级动作。中栏中的每个任务回合按
以下顺序展示：

1. **业务输入**：使用技能字段定义渲染的只读输入卡。
2. **正在执行或已处理**：执行中显示“正在执行”，完成后显示“已处理”和执行时长；默认收起，展开后展示该回合已有的页面执行动作。
3. **业务结果或未解决项**：读取、采集、创建、修改或提交了什么；失败原因和下一步。
4. **回合脚标**：已结束回合显示时间，非 App 创建渠道在右侧同行显示；App 渠道隐藏。

正常页面不得默认显示 evidence ref、session ref、viewer ref、capture method、source
locator、owner 说明或完整事件流。业务执行步骤已经位于回合折叠区，不再增加重复的
详情区；只有确实存在技术诊断记录时，才通过独立入口按需查看或导出。

中栏按时间顺序展示当前 Task Thread 的全部 Task Turn。运行中和等待人工处理使用进度
摘要；完成、部分完成、失败、取消和未提交诚实展示业务结果或未解决项，不增加额外
总结标题。回合导航只负责滚动定位，不切换中栏或右栏内容。右栏默认折叠或恢复该
线程上一次的折叠/展开状态，不绑定导航轨或最新回合；只有用户从中栏明确打开结果或
文件时才绑定对应回合。

### 结果渲染

Work 优先渲染 Lode/Core 提供的公共业务类型：content、author/profile、comment、
media、metric、record collection 和 write operation。未知 output schema 使用通用
表格或键值详情，不要求每个站点拥有独立页面，也不把 raw JSON 当首选结果。

站点技能必须声明结构化输出，且可以随技能发布版本提供一个可选结果视图及其兼容信息。
结构化输出是持久结果事实；视图只是展示资源，不能成为唯一可消费形态。中栏始终使用
App 原生摘要或标准列表，用户明确打开后，右栏才可以加载技能视图，同时保留结构化
数据入口。视图缺失、失败或版本不兼容时，App 回退到标准组件或通用表格、键值详情。
每个回合结果保留生成时的视图兼容声明；技能升级不能静默改写历史结果的展示关联。

生产实现中的技能视图必须运行在隔离容器中，只接收当前结果所需的结构化数据，并通过
受限桥接发送业务动作意图；不得直接访问 Cookie、账号环境、文件系统或 Runtime API，
也不得绕过当前有效执行方式。技能发布版本拥有视图资源兼容信息；“我的技能默认”只
表示用户执行方式，两者不共享版本语义。本 ADR 只确定该边界，不选择具体沙箱或资源协议。

### Browser 生命周期

Browser 以账号身份组织环境。用户可以检测 provider、创建或选择环境、登录、启动、
停止和人工使用实例。Provider 分为 Harbor managed、system installed 和 external
managed 三种来源；恢复旅程必须说明当前来源、可执行动作和责任边界。Provider 缺失、
损坏、版本不兼容或启动失败时，用户进入检测 -> 下载 -> 完整性校验 ->
安装/更新/修复 -> 启动验证 -> 返回原任务的恢复路径。system/external provider
不可由 Harbor 修改时，App 提供定位、重检或打开外部管理入口，不伪装成一键修复。

同一设备上的账号身份副本分为完整复制和仅复制环境配置。完整复制由 Provider 在本机
克隆账号资料、站点存储和环境配置；App 只发送复制意图，不读取或保存原始 Cookie、
令牌或浏览器档案内容。两种副本都生成新的身份 ID 和数据目录，并排除活动实例、进程
锁、临时文件和运行时连接。

浅层只显示可执行状态，例如“可以使用”“需要登录”“未安装”“修复后重试”。路径、
版本探测、原始错误和 runtime refs 进入诊断。

### 动作分级与统一执行策略

App 通过 owner policy API 管理用户执行策略，不从底层点击、输入或滚动推断风险。站点技能以稳定动作 ID 声明业务动作、目标范围和提交边界，并把动作归入“读取和下载、填写但不提交、发布或提交、危险行为”。用户为动作分类选择“自动、确认、禁止”。

- 全局用户配置提供各动作分类的默认执行方式；
- 技能包提供推荐执行配置，用户安装时可以直接采用或修订后安装，结果在界面中称为“我的技能默认”；站点技能自身发布版本与用户保存的执行方式是两个独立对象，不使用同一种版本文案；
- 官方推荐技能的每个发布版本必须经过声明审核，确认业务动作、目标范围和提交边界完整且与实际执行一致；审核不替用户决定执行方式；
- Task Thread Composer 摘要展示当前有效方式及来源，展开后展示该技能声明的全部业务动作类型；每类可以独立修订当前线程后续回合，或显式“保存为该技能的默认设置”；
- 当前动作的有效方式按“当前动作单次决定 > 当前线程修订 > 我的技能默认 > 全局用户配置”计算，技能包推荐配置只用于安装初始化；
- 单次决定只允许或拒绝当前具体动作，在完成、取消、超时或目标变化后失效，不修改当前线程、“我的技能默认”或全局配置；当前线程修订只能从 Composer 主动完成；
- 没有关联技能或线程的 Browser environment operation 只消费适用的全局配置和当前动作决定。

用户可以把危险行为配置为自动执行。App 不替用户强制采用更严格方式，但必须持续展示醒目风险图标；说明文字可以关闭，执行记录仍保留当时的有效方式和来源。任务动作必须与技能声明及实际目标一致，未声明、目标不匹配或无法分类时停止执行。无关联技能或线程的浏览器环境操作不要求技能声明，但必须匹配系统已定义的动作和目标；未定义、目标不匹配或无法分类时同样停止执行。

App 不建立站点专用审批状态机，也不把 owner policy truth 复制为 App 自有事实。个人本机体验使用“执行方式”或“确认”，只有未来真实多人流程才使用“审批”。

## Story 与高保真设计门槛

生产 UI Work Item 前必须完成：

- Loom User Story、Story Readiness 与 Story Business Confirmation；confirmation
  初始为 `pending`，只有用户明确确认后才可进入 IA 定稿；
- 当前页面 inventory，并标记保留、重命名、移动、折叠、仅诊断或删除；
- 三域导航和页面清单；
- 账号、技能、任务三种入口旅程；
- provider 安装修复、人工接管、执行策略和单次确认旅程；
- 业务结果、空结果、失败和需要人工处理状态；
- 高保真原型场景验收；原型可采用交互单页应用、图片状态序列或其他足以评审
  关键旅程的载体，但必须由用户明确批准。

用户要求修订 Story 或原型时，状态保持 `revision-requested`，不得进入生产 UI
Work Item。Loom review 与自动检查只可验证载体，不构成产品审核。

固定三栏、右侧 tabs、navigation rail 或 Task Thread 树只能作为候选组件，不再是
未经场景验证的全局结构约束。

## 影响

- App #241 默认展示业务结果，截图和 refs 降为诊断。
- App #258 显示用户可处理状态，health/admission 细节降为诊断。
- App #233/#234/#237 以账号身份和 provider/实例生命周期组织 Browser。
- App #246 消费统一执行策略，不再延续 approval-request-first UI。
- ADR 0006 继续约束 owner truth、缓存和敏感数据，但其默认 display hierarchy 被本 ADR 取代。
- ADR 0008 继续作为历史设计 checkpoint，其固定 Task Thread IA 不再指导新实现。
- 历史 App #80/#93/#95/#96/#104/#156/#193 中的固定 Task Thread、evidence-first
  或 approval-first 结论由本 ADR supersede；这些历史 issue 不作为新 UI 验收证明。
- 当前实现 FR/Work Items #233/#238/#243/#256 必须消费本 ADR，但仍需各自的真实实现
  与 E2E 证据，本 ADR 不关闭它们。

## 非目标

- 不在本 ADR 中决定视觉样式、像素、组件库或最终路由名。
- 不创建 App-owned task、runtime、capability、evidence 或 execution-policy truth。
- 不实现站点任务、provider installer 或 Core policy evaluator。
- 不把小红书或 BOSS 作为 App 全局信息架构。
